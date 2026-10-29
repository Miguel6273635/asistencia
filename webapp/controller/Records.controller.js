sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "com/mitsu/monitorasistencia/model/formatter",
    "com/mitsu/monitorasistencia/model/AttendanceApi",
    "com/mitsu/monitorasistencia/model/MonitorData",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/ui/export/Spreadsheet"
], function (BaseController, formatter, AttendanceApi, MonitorData, JSONModel, MessageToast, Spreadsheet) {
    "use strict";

    return BaseController.extend("com.mitsu.monitorasistencia.controller.Records", {
        formatter: formatter,

        onInit: function () {
            var oToday = new Date();
            var sToday = oToday.getFullYear() + "-" +
                String(oToday.getMonth() + 1).padStart(2, "0") + "-" +
                String(oToday.getDate()).padStart(2, "0");
            var aMonthOptions = [
                "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
                "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
            ].map(function (sMonth, iIndex) {
                return { key: String(iIndex + 1).padStart(2, "0"), text: sMonth };
            });
            var aYearOptions = [];
            for (var iYear = oToday.getFullYear() + 1; iYear >= oToday.getFullYear() - 10; iYear -= 1) {
                aYearOptions.push({ key: String(iYear), text: String(iYear) });
            }

            this.setModel(new JSONModel({
                title: "Registros de asistencia",
                employee: {},
                allRecords: [],
                records: [],
                pageRecords: [],
                centerOptions: [{ key: "all", text: "Todos" }],
                selectedRecord: {},
                center: "all",
                scheduleId: "",
                status: "all",
                periodType: "month",
                referenceDate: sToday,
                selectedMonth: String(oToday.getMonth() + 1).padStart(2, "0"),
                selectedYear: String(oToday.getFullYear()),
                monthOptions: aMonthOptions,
                yearOptions: aYearOptions,
                periodStart: null,
                periodEnd: null,
                periodLabel: "",
                pageSize: 7,
                currentPage: 1,
                totalPages: 1,
                rangeText: "0 registros",
                hasPreviousPage: false,
                hasNextPage: false,
                stats: {
                    total: 0,
                    totalPercentage: "0%",
                    present: 0,
                    presentPercentage: "0%",
                    late: 0,
                    latePercentage: "0%",
                    absent: 0,
                    absentPercentage: "0%"
                },
                statusCards: []
            }), "view");
            this._attendanceApi = new AttendanceApi();
            this.getRouter().getRoute("records").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function (oEvent) {
            this._employeeId = oEvent.getParameter("arguments").employeeId || "all";
            this.getModel("attendance").dataLoaded().then(this._loadRecords.bind(this));
        },

        _loadRecords: function () {
            var oAttendanceModel = this.getModel("attendance");
            var aRecords = (oAttendanceModel.getProperty("/records") || [])
                .concat(oAttendanceModel.getProperty("/userPerformanceHistory") || []);
            this._setRecords(aRecords, true);
        },

        _setRecords: function (aRecords, bResetFilters) {
            var oAttendanceModel = this.getModel("attendance");
            var aEmployees = oAttendanceModel.getProperty("/employees") || [];
            var aSchedules = oAttendanceModel.getProperty("/schedules") || [];
            var oEmployee = aEmployees.find(function (oItem) { return oItem.id === this._employeeId; }.bind(this));
            var mEmployees = aEmployees.reduce(function (mResult, oItem) {
                mResult[oItem.id] = oItem;
                return mResult;
            }, {});
            var mSchedules = aSchedules.reduce(function (mResult, oItem) {
                mResult[oItem.id] = oItem;
                return mResult;
            }, {});
            var aEnrichedRecords = aRecords.map(function (oRecord) {
                var oRecordEmployee = mEmployees[oRecord.employeeId] || {};
                var oSchedule = mSchedules[oRecordEmployee.scheduleId] || {};
                var aLocationOptionalStatuses = ["Viaje de trabajo", "Vacaciones", "Paternidad", "Home office"];
                var bLocationOptional = aLocationOptionalStatuses.indexOf(oRecord.status) !== -1;
                var bHasDistance = typeof oRecord.distanceMeters === "number";
                var sGeoStatus = String(oRecord.geoStatus || "").toUpperCase();
                var bBackendOutside = oRecord.isOutOfZone || /OUT|FUERA/.test(sGeoStatus);
                var bBackendInside = /(^|\s)IN($|\s)|DENTRO/.test(sGeoStatus);
                var bOutsideZone = !bLocationOptional && (bBackendOutside || (bHasDistance && oRecord.distanceMeters > 2));
                var sEffectiveStatus = bOutsideZone ? "Fuera de zona" : oRecord.status;
                var sGeofenceStatus = bLocationOptional ? "No aplica" :
                    (bOutsideZone ? "Fuera de zona" :
                        (bBackendInside ? (oRecord.geoStatusDescription || "Dentro de zona") :
                            (bHasDistance ? "Dentro de zona" : "Sin ubicación")));
                var sGeofenceState = bOutsideZone ? "Error" :
                    (bHasDistance || bBackendInside ? "Success" : (bLocationOptional ? "Information" : "None"));
                var sDistanceLabel = bHasDistance ? oRecord.distanceMeters.toFixed(1) + " m" :
                    (bLocationOptional ? "No aplica" : "Sin dato");

                return Object.assign({}, oRecord, {
                    status: sEffectiveStatus,
                    employeeNumber: oRecordEmployee.number || oRecord.employeeId,
                    initials: oRecordEmployee.initials || this._getInitials(oRecord.employee),
                    role: oRecordEmployee.role || "Colaborador",
                    employee: oRecord.employee || oRecordEmployee.name || "Colaborador",
                    center: oRecord.center || oRecordEmployee.center || "Sin centro",
                    shift: oRecord.shift || oRecordEmployee.shift || "Sin turno",
                    scheduled: oRecord.scheduled || oSchedule.shortDescription || "Sin horario",
                    scheduleId: oRecord.scheduleId || oRecordEmployee.scheduleId || "",
                    scheduleName: oSchedule.name || oRecordEmployee.scheduleName || "Sin horario asignado",
                    scheduleDescription: oSchedule.description || oSchedule.shortDescription || "No existe una regla semanal asociada",
                    mealCheckOut: oRecord.mealCheckOut || "—",
                    mealCheckIn: oRecord.mealCheckIn || "—",
                    mealRange: (oRecord.mealCheckOut || "—") + " – " + (oRecord.mealCheckIn || "—"),
                    geofenceStatus: sGeofenceStatus,
                    geofenceState: sGeofenceState,
                    distanceLabel: sDistanceLabel,
                    historyDate: oRecord.date + " " + (oRecord.entry === "—" ? "08:30" : oRecord.entry)
                });
            }.bind(this));
            var aFilteredByEmployee = this._employeeId === "all" ? aEnrichedRecords : aEnrichedRecords.filter(function (oRecord) {
                return oRecord.employeeId === this._employeeId;
            }.bind(this));
            var oViewModel = this.getModel("view");
            var aCenterOptions = Array.from(new Set(aEnrichedRecords.map(function (oRecord) {
                return String(oRecord.center || "").trim();
            }).filter(Boolean))).sort().map(function (sCenter) {
                return { key: sCenter, text: sCenter };
            });

            oViewModel.setProperty("/employee", oEmployee || {});
            oViewModel.setProperty("/title", oEmployee ? "Historial de asistencia: " + oEmployee.name : "Registros de asistencia");
            oViewModel.setProperty("/allRecords", aFilteredByEmployee);
            oViewModel.setProperty("/centerOptions", [{ key: "all", text: "Todos" }].concat(aCenterOptions));
            if (bResetFilters) {
                oViewModel.setProperty("/center", "all");
                oViewModel.setProperty("/scheduleId", "");
                oViewModel.setProperty("/status", "all");
            }
            this._updatePeriodRange();
            this._applyFilters();
            if (bResetFilters) {
                this._reloadRecordsForPeriod();
            }
        },

        _applyFilters: function () {
            var oViewModel = this.getModel("view");
            var sCenter = oViewModel.getProperty("/center");
            var sScheduleId = oViewModel.getProperty("/scheduleId");
            var sStatus = oViewModel.getProperty("/status");
            var oPeriodStart = oViewModel.getProperty("/periodStart");
            var oPeriodEnd = oViewModel.getProperty("/periodEnd");
            var aRecords = oViewModel.getProperty("/allRecords") || [];
            var aFiltered = aRecords.filter(function (oRecord) {
                var oRecordDate = this._parseDisplayDate(oRecord.date);
                return (sCenter === "all" || oRecord.center === sCenter) &&
                    (!sScheduleId || oRecord.scheduleId === sScheduleId) &&
                    (sStatus === "all" || oRecord.status === sStatus) &&
                    (!oRecordDate || !oPeriodStart || !oPeriodEnd || (oRecordDate >= oPeriodStart && oRecordDate <= oPeriodEnd));
            }.bind(this));
            var iTotal = aFiltered.length;
            var iPresent = this._countStatus(aFiltered, "Presente");
            var iLate = this._countStatus(aFiltered, "Retardo");
            var iAbsent = this._countStatus(aFiltered, "Ausente");
            var oStats = {
                total: iTotal,
                totalPercentage: iTotal ? "100%" : "0%",
                totalDescription: iTotal + " registros en el periodo seleccionado",
                present: iPresent,
                presentPercentage: this._formatPercentage(iPresent, iTotal),
                presentDescription: iPresent + " de " + iTotal + " registros · presentes ÷ total",
                late: iLate,
                latePercentage: this._formatPercentage(iLate, iTotal),
                lateDescription: iLate + " de " + iTotal + " registros · retardos ÷ total",
                absent: iAbsent,
                absentPercentage: this._formatPercentage(iAbsent, iTotal),
                absentDescription: iAbsent + " de " + iTotal + " registros · ausencias ÷ total"
            };
            oViewModel.setProperty("/records", aFiltered);
            oViewModel.setProperty("/stats", oStats);
            oViewModel.setProperty("/statusCards", this._createStatusCards(aFiltered, iTotal));
            oViewModel.setProperty("/currentPage", 1);
            this._updatePage(true);
        },

        _countStatus: function (aRecords, sStatus) {
            return aRecords.filter(function (oRecord) {
                return oRecord.status === sStatus;
            }).length;
        },

        _formatPercentage: function (iValue, iTotal) {
            if (!iTotal) {
                return "0%";
            }
            return (iValue * 100 / iTotal).toFixed(1).replace(".", ",") + "%";
        },

        _parseDisplayDate: function (sValue) {
            if (sValue instanceof Date && !isNaN(sValue.getTime())) {
                return new Date(sValue.getFullYear(), sValue.getMonth(), sValue.getDate(), 12, 0, 0, 0);
            }
            var sDate = String(sValue || "").trim();
            var aIsoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(sDate);
            var aDisplayMatch = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(sDate);
            if (aIsoMatch) {
                return new Date(Number(aIsoMatch[1]), Number(aIsoMatch[2]) - 1, Number(aIsoMatch[3]), 12, 0, 0, 0);
            }
            if (aDisplayMatch) {
                return new Date(Number(aDisplayMatch[3]), Number(aDisplayMatch[2]) - 1, Number(aDisplayMatch[1]), 12, 0, 0, 0);
            }
            return null;
        },

        _updatePeriodRange: function () {
            var oViewModel = this.getModel("view");
            var sPeriodType = oViewModel.getProperty("/periodType") || "month";
            var oReference = this._parseDisplayDate(oViewModel.getProperty("/referenceDate")) || new Date(2026, 7, 31);
            var oStart = new Date(oReference.getFullYear(), oReference.getMonth(), oReference.getDate(), 0, 0, 0, 0);
            var oEnd;
            var sLabel;

            if (sPeriodType === "week") {
                var iDay = oStart.getDay() || 7;
                oStart.setDate(oStart.getDate() - iDay + 1);
                oEnd = new Date(oStart);
                oEnd.setDate(oEnd.getDate() + 6);
                sLabel = "Semana del " + this._formatShortDate(oStart) + " al " + this._formatShortDate(oEnd);
            } else if (sPeriodType === "year") {
                oStart = new Date(oReference.getFullYear(), 0, 1, 0, 0, 0, 0);
                oEnd = new Date(oReference.getFullYear(), 11, 31, 23, 59, 59, 999);
                sLabel = "Año " + oReference.getFullYear();
            } else {
                oStart = new Date(oReference.getFullYear(), oReference.getMonth(), 1, 0, 0, 0, 0);
                oEnd = new Date(oReference.getFullYear(), oReference.getMonth() + 1, 0, 23, 59, 59, 999);
                sLabel = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" }).format(oReference);
                sLabel = sLabel.charAt(0).toUpperCase() + sLabel.slice(1);
            }

            oEnd.setHours(23, 59, 59, 999);
            oViewModel.setProperty("/periodStart", oStart);
            oViewModel.setProperty("/periodEnd", oEnd);
            oViewModel.setProperty("/periodLabel", sLabel);
        },

        _syncPeriodSelectors: function () {
            var oViewModel = this.getModel("view");
            var oReference = this._parseDisplayDate(oViewModel.getProperty("/referenceDate"));
            if (!oReference) {
                return;
            }
            oViewModel.setProperty("/selectedMonth", String(oReference.getMonth() + 1).padStart(2, "0"));
            oViewModel.setProperty("/selectedYear", String(oReference.getFullYear()));
        },

        _applyMonthYearSelection: function () {
            var oViewModel = this.getModel("view");
            var iYear = Number(oViewModel.getProperty("/selectedYear"));
            var iMonth = Number(oViewModel.getProperty("/selectedMonth")) || 1;
            if (!Number.isInteger(iYear) || iYear < 1900 || iYear > 9999) {
                return;
            }
            var sReferenceDate = iYear + "-" + String(iMonth).padStart(2, "0") + "-01";
            oViewModel.setProperty("/referenceDate", sReferenceDate);
            this._updatePeriodRange();
            this._applyFilters();
        },

        _formatShortDate: function (oDate) {
            return String(oDate.getDate()).padStart(2, "0") + "/" +
                String(oDate.getMonth() + 1).padStart(2, "0") + "/" + oDate.getFullYear();
        },

        _formatODataDate: function (oDate) {
            return oDate.getFullYear() +
                String(oDate.getMonth() + 1).padStart(2, "0") +
                String(oDate.getDate()).padStart(2, "0");
        },

        _reloadRecordsForPeriod: function () {
            var oViewModel = this.getModel("view");
            var oStart = oViewModel.getProperty("/periodStart");
            var oEnd = oViewModel.getProperty("/periodEnd");
            if (!(oStart instanceof Date) || !(oEnd instanceof Date)) {
                return Promise.resolve();
            }

            var aFilters = [
                { field: "DateFrom", value: this._formatODataDate(oStart) },
                { field: "DateTo", value: this._formatODataDate(oEnd) }
            ];
            var sPersonalNumber = this.getModel("view").getProperty("/employee/number");
            if (this._employeeId !== "all" && sPersonalNumber) {
                aFilters.push({ field: "PersonalNumber", value: sPersonalNumber });
            }

            this.getView().setBusy(true);
            return this._attendanceApi.getAttendanceHistory(aFilters).then(function (aRows) {
                var aSchedules = this.getModel("attendance").getProperty("/schedules") || [];
                var aMappedRecords = MonitorData.mapAttendanceRecords(aRows, aSchedules);
                this._setRecords(aMappedRecords, false);
            }.bind(this)).catch(function (oError) {
                MessageToast.show("No fue posible consultar el periodo seleccionado en SAP");
                console.error("Error al consultar AttendanceHistorySet por rango", oError);
            }).finally(function () {
                this.getView().setBusy(false);
            }.bind(this));
        },

        _createStatusCards: function (aRecords, iTotal) {
            var aDefinitions = [
                {
                    status: "Viaje de trabajo",
                    description: "Asignación laboral fuera del centro",
                    icon: "sap-icon://flight",
                    color: "#0a6ed1"
                },
                {
                    status: "Vacaciones",
                    description: "Permiso vacacional autorizado",
                    icon: "sap-icon://travel-expense",
                    color: "#188918"
                },
                {
                    status: "Paternidad",
                    description: "Licencia de paternidad vigente",
                    icon: "sap-icon://family-care",
                    color: "#7858d7"
                },
                {
                    status: "Home office",
                    description: "Jornada remota autorizada",
                    icon: "sap-icon://home",
                    color: "#07838f"
                },
                {
                    status: "Fuera de zona",
                    description: "Marcación a más de 2 m del centro",
                    icon: "sap-icon://map-2",
                    color: "#bb0000"
                }
            ];

            return aDefinitions.map(function (oDefinition) {
                var iCount = this._countStatus(aRecords, oDefinition.status);
                return Object.assign({}, oDefinition, {
                    count: iCount,
                    percentage: this._formatPercentage(iCount, iTotal)
                });
            }.bind(this));
        },

        _updatePage: function (bSelectFirst) {
            var oViewModel = this.getModel("view");
            var aRecords = oViewModel.getProperty("/records") || [];
            var iPageSize = oViewModel.getProperty("/pageSize") || 5;
            var iTotalPages = Math.max(1, Math.ceil(aRecords.length / iPageSize));
            var iCurrentPage = Math.min(Math.max(oViewModel.getProperty("/currentPage") || 1, 1), iTotalPages);
            var iStart = (iCurrentPage - 1) * iPageSize;
            var aPageRecords = aRecords.slice(iStart, iStart + iPageSize);
            var iEnd = iStart + aPageRecords.length;

            oViewModel.setProperty("/currentPage", iCurrentPage);
            oViewModel.setProperty("/totalPages", iTotalPages);
            oViewModel.setProperty("/pageRecords", aPageRecords);
            oViewModel.setProperty("/hasPreviousPage", iCurrentPage > 1);
            oViewModel.setProperty("/hasNextPage", iCurrentPage < iTotalPages);
            oViewModel.setProperty("/rangeText", aRecords.length ?
                (iStart + 1) + "–" + iEnd + " de " + aRecords.length + " registros" :
                "0 registros");

            if (bSelectFirst || !aPageRecords.some(function (oRecord) {
                return oRecord.id === oViewModel.getProperty("/selectedRecord/id");
            })) {
                oViewModel.setProperty("/selectedRecord", aPageRecords[0] || {});
            }
        },

        _getInitials: function (sName) {
            return (sName || "")
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map(function (sPart) { return sPart.charAt(0).toUpperCase(); })
                .join("");
        },

        onFilterChange: function () {
            this._applyFilters();
        },

        onPeriodChange: function () {
            this._syncPeriodSelectors();
            this._updatePeriodRange();
            this._applyFilters();
            this._reloadRecordsForPeriod();
        },

        onReferenceDateChange: function (oEvent) {
            var sValue = oEvent.getParameter("value") || oEvent.getSource().getValue();
            if (this._parseDisplayDate(sValue)) {
                this.getModel("view").setProperty("/referenceDate", sValue);
                this._syncPeriodSelectors();
            }
            this.onPeriodChange();
        },

        onMonthYearChange: function () {
            this._applyMonthYearSelection();
            this._reloadRecordsForPeriod();
        },

        onRecordSelectionChange: function (oEvent) {
            var oListItem = oEvent.getParameter("listItem");
            if (oListItem) {
                this.getModel("view").setProperty("/selectedRecord", oListItem.getBindingContext("view").getObject());
            }
        },

        onPreviousPage: function () {
            var oViewModel = this.getModel("view");
            oViewModel.setProperty("/currentPage", oViewModel.getProperty("/currentPage") - 1);
            this._updatePage(true);
        },

        onNextPage: function () {
            var oViewModel = this.getModel("view");
            oViewModel.setProperty("/currentPage", oViewModel.getProperty("/currentPage") + 1);
            this._updatePage(true);
        },

        onCloseDetail: function () {
            this.getModel("view").setProperty("/selectedRecord", {});
            this.byId("recordsTable").removeSelections(true);
        },

        onEditRecord: function () {
            MessageToast.show("Aquí se conectará la edición del registro seleccionado");
        },

        onOpenUserPerformance: function (oEvent) {
            var oContext = oEvent && oEvent.getSource().getBindingContext("view");
            var sEmployeeId = oContext ? oContext.getProperty("employeeId") :
                this.getModel("view").getProperty("/selectedRecord/employeeId");

            if (sEmployeeId) {
                this.navTo("userPerformance", { employeeId: sEmployeeId });
            }
        },

        onNavOverview: function () {
            this.navTo("overview");
        },

        onNavCenter: function () {
            var sCenterId = this.getModel("view").getProperty("/employee/centerId");
            if (sCenterId) {
                this.navTo("center", { centerId: sCenterId });
            }
        },

        onExport: function () {
            var oViewModel = this.getModel("view");
            var aRecords = oViewModel.getProperty("/records") || [];
            if (!aRecords.length) {
                MessageToast.show("No hay registros para exportar con los filtros seleccionados");
                return;
            }

            var aColumns = [
                { label: "Fecha", property: "date", width: 12 },
                { label: "Número de empleado", property: "employeeNumber", width: 18 },
                { label: "Colaborador", property: "employee", width: 28 },
                { label: "Centro de trabajo", property: "center", width: 24 },
                { label: "Horario", property: "scheduleName", width: 18 },
                { label: "Jornada asignada", property: "scheduled", width: 28 },
                { label: "Entrada", property: "entry", width: 10 },
                { label: "Inicio de comida", property: "mealCheckOut", width: 16 },
                { label: "Fin de comida", property: "mealCheckIn", width: 16 },
                { label: "Salida", property: "exit", width: 10 },
                { label: "Horas", property: "hours", width: 10 },
                { label: "Distancia", property: "distanceLabel", width: 14 },
                { label: "Estatus", property: "status", width: 16 },
                { label: "Observaciones", property: "observation", width: 36 }
            ];
            var sPeriod = String(oViewModel.getProperty("/periodLabel") || "periodo")
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-zA-Z0-9]+/g, "-")
                .replace(/^-|-$/g, "")
                .toLowerCase();
            var oSpreadsheet = new Spreadsheet({
                workbook: { columns: aColumns },
                dataSource: aRecords,
                fileName: "registros-asistencia-" + sPeriod + ".xlsx",
                worker: false
            });

            oSpreadsheet.build().then(function () {
                MessageToast.show(aRecords.length + " registros exportados");
            }).catch(function (oError) {
                MessageToast.show("No fue posible exportar los registros");
                console.error("Error al exportar registros", oError);
            }).finally(function () {
                oSpreadsheet.destroy();
            });
        },

        onNewIncident: function () {
            MessageToast.show("El formulario de incidencias se conectará al servicio OData");
        }
    });
});
