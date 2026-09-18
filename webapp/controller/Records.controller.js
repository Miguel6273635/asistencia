sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "com/mitsu/monitorasistencia/model/formatter",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast"
], function (BaseController, formatter, JSONModel, MessageToast) {
    "use strict";

    return BaseController.extend("com.mitsu.monitorasistencia.controller.Records", {
        formatter: formatter,

        onInit: function () {
            this.setModel(new JSONModel({
                title: "Registros de asistencia",
                employee: {},
                allRecords: [],
                records: [],
                pageRecords: [],
                selectedRecord: {},
                center: "all",
                scheduleId: "",
                status: "all",
                periodType: "month",
                referenceDate: "2026-08-31",
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
            this.getRouter().getRoute("records").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function (oEvent) {
            this._employeeId = oEvent.getParameter("arguments").employeeId || "all";
            this.getModel("attendance").dataLoaded().then(this._loadRecords.bind(this));
        },

        _loadRecords: function () {
            var oAttendanceModel = this.getModel("attendance");
            var aEmployees = oAttendanceModel.getProperty("/employees") || [];
            var aSchedules = oAttendanceModel.getProperty("/schedules") || [];
            var aRecords = (oAttendanceModel.getProperty("/records") || [])
                .concat(oAttendanceModel.getProperty("/userPerformanceHistory") || []);
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
                var bOutsideZone = !bLocationOptional && bHasDistance && oRecord.distanceMeters > 2;
                var sEffectiveStatus = bOutsideZone ? "Fuera de zona" : oRecord.status;
                var sGeofenceStatus = bLocationOptional ? "No aplica" :
                    (bHasDistance ? (bOutsideZone ? "Fuera de zona" : "Dentro de zona") : "Sin ubicación");
                var sGeofenceState = bOutsideZone ? "Error" :
                    (bHasDistance ? "Success" : (bLocationOptional ? "Information" : "None"));
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
                    scheduleId: oRecordEmployee.scheduleId || "",
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

            oViewModel.setProperty("/employee", oEmployee || {});
            oViewModel.setProperty("/title", oEmployee ? "Historial de asistencia: " + oEmployee.name : "Registros de asistencia");
            oViewModel.setProperty("/allRecords", aFilteredByEmployee);
            oViewModel.setProperty("/center", "all");
            oViewModel.setProperty("/scheduleId", "");
            oViewModel.setProperty("/status", "all");
            this._updatePeriodRange();
            this._applyFilters();
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

        _formatShortDate: function (oDate) {
            return String(oDate.getDate()).padStart(2, "0") + "/" +
                String(oDate.getMonth() + 1).padStart(2, "0") + "/" + oDate.getFullYear();
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
            this._updatePeriodRange();
            this._applyFilters();
        },

        onReferenceDateChange: function (oEvent) {
            var sValue = oEvent.getParameter("value") || oEvent.getSource().getValue();
            if (this._parseDisplayDate(sValue)) {
                this.getModel("view").setProperty("/referenceDate", sValue);
            }
            this.onPeriodChange();
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
            MessageToast.show("Aquí se conectará la exportación a Excel");
        },

        onNewIncident: function () {
            MessageToast.show("El formulario de incidencias se conectará al servicio OData");
        }
    });
});
