sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "com/mitsu/monitorasistencia/model/formatter",
    "com/mitsu/monitorasistencia/model/AttendanceApi",
    "com/mitsu/monitorasistencia/model/MonitorData",
    "com/mitsu/monitorasistencia/model/periodHelper",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/ui/export/Spreadsheet"
], function (BaseController, formatter, AttendanceApi, MonitorData, periodHelper, JSONModel, MessageToast, Spreadsheet) {
    "use strict";

    function markingGeoStatus(sCode, sDescription, vDistance, bHasMark, bLocationOptional) {
        var sRawCode = String(sCode || "").trim();
        var sRawDescription = String(sDescription || "").trim();
        var sCombined = (sRawCode + " " + sRawDescription).toUpperCase();
        var bOutside = /(^|\s)(OUT|OUTSIDE)(\s|$)|FUERA(?:\s+DE)?\s+(?:RANGO|ZONA|GEOCERCA)/.test(sCombined);
        var bInside = /(^|\s)IN(?:SIDE)?(\s|$)|DENTRO(?:\s+DE)?\s+(?:DEL\s+RANGO|RANGO|ZONA|GEOCERCA)/.test(sCombined);
        var bHasDistance = typeof vDistance === "number" && Number.isFinite(vDistance);
        var bOutsideByDistance = !bOutside && !bInside && bHasDistance && vDistance > 2;
        var sDistance = bHasDistance ? vDistance.toFixed(1) + " m" : "Sin dato";
        var sText;
        var sState;

        if (!bHasMark) {
            return {
                text: "Sin marcación",
                state: "None",
                tooltip: "No existe una marcación para consultar su GeoStatus"
            };
        }
        if (bOutside || bOutsideByDistance) {
            sText = sRawDescription || "Registro fuera de rango";
            sState = "Error";
        } else if (bInside || bHasDistance) {
            sText = sRawDescription || "Registro dentro del rango";
            sState = "Success";
        } else if (bLocationOptional) {
            sText = "No aplica";
            sState = "Information";
        } else {
            sText = sRawDescription || "Sin información de zona";
            sState = "None";
        }

        return {
            text: sText,
            state: sState,
            tooltip: "GeoStatus: " + (sRawCode || "Sin dato") + " · Distancia: " + sDistance
        };
    }

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
                dayStatusOptions: [{ key: "all", text: "Todos" }],
                selectedRecord: {},
                center: "all",
                scheduleId: "",
                dayStatusFilter: "all",
                recordFilter: "all",
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
                    absentPercentage: "0%",
                    incomplete: 0,
                    incompletePercentage: "0%"
                },
                statusCards: []
            }), "view");
            this._attendanceApi = new AttendanceApi();
            this.getRouter().getRoute("records").attachPatternMatched(this._onRouteMatched, this);
        },

        onAfterRendering: function () {
            this._protectNonTranslatableText();
        },

        onExit: function () {
            if (this._dayStatusTranslationObserver) {
                this._dayStatusTranslationObserver.disconnect();
                this._dayStatusTranslationObserver = null;
            }
        },

        onNoTranslateContentRendered: function () {
            this._protectNonTranslatableText();
        },

        onDayStatusFilterBeforeOpen: function (oEvent) {
            var oSelect = oEvent.getSource();
            var oPicker = oSelect.getAggregation("_picker");

            this._protectDayStatusPickerText(oSelect);

            if (!oPicker || this._dayStatusPicker === oPicker) {
                return;
            }
            this._dayStatusPicker = oPicker;
            oPicker.addStyleClass("notranslate");
            oPicker.addEventDelegate({
                onAfterRendering: function () {
                    var oPickerDomRef = oPicker.getDomRef();
                    if (oPickerDomRef) {
                        oPickerDomRef.setAttribute("translate", "no");
                    }
                }
            });
        },

        _protectDayStatusPickerText: function (oSelect) {
            var oStaticArea = document.getElementById("sap-ui-static");
            var oHomeOfficeItem = oSelect.getItems().find(function (oItem) {
                return oItem.getKey() === "HOME OFFICE";
            });
            var sHomeOfficeItemId = oHomeOfficeItem && oHomeOfficeItem.getId();
            var fnRestoreHomeOffice;

            if (!oStaticArea || !sHomeOfficeItemId) {
                return;
            }
            oStaticArea.classList.add("notranslate");
            oStaticArea.setAttribute("translate", "no");
            fnRestoreHomeOffice = function () {
                var oItemDomRef = document.getElementById(sHomeOfficeItemId);
                if (!oItemDomRef) {
                    return;
                }
                oItemDomRef.classList.add("notranslate");
                oItemDomRef.setAttribute("translate", "no");
                [oItemDomRef].concat(
                    Array.prototype.slice.call(oItemDomRef.querySelectorAll("*"))
                ).forEach(function (oElement) {
                    if (!oElement.children.length &&
                        String(oElement.textContent || "").trim().toUpperCase() === "OFICINA CENTRAL") {
                        oElement.textContent = "HOME OFFICE";
                        oElement.classList.add("notranslate");
                        oElement.setAttribute("translate", "no");
                    }
                });
            };
            fnRestoreHomeOffice();
            if (!this._dayStatusTranslationObserver) {
                this._dayStatusTranslationObserver = new MutationObserver(fnRestoreHomeOffice);
                this._dayStatusTranslationObserver.observe(oStaticArea, {
                    childList: true,
                    characterData: true,
                    subtree: true
                });
            }
        },

        _protectNonTranslatableText: function () {
            var aRoots = [];
            var oViewDomRef = this.getView() && this.getView().getDomRef();
            var oDetailDialog = this.byId("recordDetailDialog");
            var oDialogDomRef = oDetailDialog && oDetailDialog.getDomRef();

            if (oViewDomRef) {
                aRoots.push(oViewDomRef);
            }
            if (oDialogDomRef) {
                aRoots.push(oDialogDomRef);
            }

            aRoots.forEach(function (oRoot) {
                Array.prototype.forEach.call(oRoot.querySelectorAll(".notranslate"), function (oElement) {
                    oElement.setAttribute("translate", "no");
                });
            });
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
                var sDayStatus = this._formatDayStatus(oRecord.dayStatus, oRecord.status);
                var sLaborStatusCode = oRecord.relationJob || "";
                var sLaborStatus = oRecord.relationJobDescription || "Sin estatus laboral";
                var sGroupPerson = oRecord.groupPerson || "";
                var sGroupPersonDescription = oRecord.groupPersonDescription || "Sin tipo de personal";
                var aLocationOptionalStatuses = ["Viaje de trabajo", "Vacaciones", "Paternidad", "HOME OFFICE"];
                var bLocationOptional = aLocationOptionalStatuses.indexOf(sDayStatus) !== -1;
                var bHasDistance = typeof oRecord.distanceMeters === "number";
                var sGeoStatus = String(oRecord.geoStatus || "").toUpperCase();
                var bBackendOutside = oRecord.isOutOfZone || /OUT|FUERA/.test(sGeoStatus);
                var bBackendInside = /(^|\s)IN($|\s)|DENTRO/.test(sGeoStatus);
                var bOutsideZone = bBackendOutside ||
                    (!bBackendInside && bHasDistance && oRecord.distanceMeters > 2);
                var sGeofenceStatus = bOutsideZone ?
                    (oRecord.geoStatusDescription || "Registro fuera de rango") :
                    (bBackendInside ? (oRecord.geoStatusDescription || "Registro dentro del rango") :
                        (bHasDistance ? "Registro dentro del rango" :
                            (bLocationOptional ? "No aplica" : "Sin información de zona")));
                var sGeofenceState = bOutsideZone ? "Error" :
                    (bHasDistance || bBackendInside ? "Success" : (bLocationOptional ? "Information" : "None"));
                var sDistanceLabel = bHasDistance ? oRecord.distanceMeters.toFixed(1) + " m" :
                    (bLocationOptional ? "No aplica" : "Sin dato");
                var oEntryGeo = markingGeoStatus(
                    oRecord.entryGeoStatus,
                    oRecord.entryGeoStatusDescription,
                    oRecord.entryDistanceMeters,
                    oRecord.entry && oRecord.entry !== "—",
                    bLocationOptional
                );
                var oMealStartGeo = markingGeoStatus(
                    oRecord.mealStartGeoStatus,
                    oRecord.mealStartGeoStatusDescription,
                    oRecord.mealStartDistanceMeters,
                    oRecord.mealCheckOut && oRecord.mealCheckOut !== "—",
                    bLocationOptional
                );
                var oMealEndGeo = markingGeoStatus(
                    oRecord.mealEndGeoStatus,
                    oRecord.mealEndGeoStatusDescription,
                    oRecord.mealEndDistanceMeters,
                    oRecord.mealCheckIn && oRecord.mealCheckIn !== "—",
                    bLocationOptional
                );
                var oExitGeo = markingGeoStatus(
                    oRecord.exitGeoStatus,
                    oRecord.exitGeoStatusDescription,
                    oRecord.exitDistanceMeters,
                    oRecord.exit && oRecord.exit !== "—",
                    bLocationOptional
                );

                return Object.assign({}, oRecord, {
                    dayStatus: sDayStatus,
                    dayStatusRaw: oRecord.dayStatus || "",
                    laborStatusCode: sLaborStatusCode,
                    laborStatus: sLaborStatus,
                    employmentStatusDescription: sLaborStatus,
                    laborStatusState: this._getLaborStatusState(
                        sLaborStatusCode,
                        sLaborStatus
                    ),
                    groupPerson: sGroupPerson,
                    groupPersonDescription: sGroupPersonDescription,
                    personTypeDescription: sGroupPersonDescription,
                    groupPersonState: this._getGroupPersonState(sGroupPersonDescription),
                    dayStatusDescription: sDayStatus,
                    employeeNumber: oRecordEmployee.number || oRecord.employeeId,
                    initials: oRecordEmployee.initials || this._getInitials(oRecord.employee),
                    role: oRecordEmployee.role || "Colaborador",
                    employee: oRecord.employee || oRecordEmployee.name || "Colaborador",
                    center: oRecord.center || oRecordEmployee.center || "Sin centro",
                    centerCode: oRecord.centerCode || oRecordEmployee.centerCode || "",
                    shift: oRecord.shift || oRecordEmployee.shift || "Sin turno",
                    scheduled: oRecord.scheduled || oSchedule.shortDescription || "Sin horario",
                    scheduleId: oRecord.scheduleId || oRecordEmployee.scheduleId || "",
                    scheduleName: oSchedule.name || oRecordEmployee.scheduleName || "Sin horario asignado",
                    scheduleDescription: oSchedule.description || oSchedule.shortDescription || "No existe una regla semanal asociada",
                    mealCheckOut: oRecord.mealCheckOut || "—",
                    mealCheckIn: oRecord.mealCheckIn || "—",
                    mealRange: (oRecord.mealCheckOut || "—") + " – " + (oRecord.mealCheckIn || "—"),
                    entryGeoStatusText: oEntryGeo.text,
                    entryGeoStatusState: oEntryGeo.state,
                    entryGeoStatusTooltip: oEntryGeo.tooltip,
                    mealStartGeoStatusText: oMealStartGeo.text,
                    mealStartGeoStatusState: oMealStartGeo.state,
                    mealStartGeoStatusTooltip: oMealStartGeo.tooltip,
                    mealEndGeoStatusText: oMealEndGeo.text,
                    mealEndGeoStatusState: oMealEndGeo.state,
                    mealEndGeoStatusTooltip: oMealEndGeo.tooltip,
                    exitGeoStatusText: oExitGeo.text,
                    exitGeoStatusState: oExitGeo.state,
                    exitGeoStatusTooltip: oExitGeo.tooltip,
                    geofenceStatus: sGeofenceStatus,
                    geoStatusDescriptionText: sGeofenceStatus,
                    geofenceState: sGeofenceState,
                    distanceLabel: sDistanceLabel,
                    historyDate: oRecord.date + " " + (oRecord.entry === "—" ? "08:30" : oRecord.entry)
                });
            }.bind(this));
            var aFilteredByEmployee = this._employeeId === "all" ? aEnrichedRecords : aEnrichedRecords.filter(function (oRecord) {
                return oRecord.employeeId === this._employeeId;
            }.bind(this));
            var mDayStatusOptions = {
                all: { key: "all", text: "Todos" }
            };
            aFilteredByEmployee.forEach(function (oRecord) {
                var sStatus = String(oRecord.dayStatusDescription || "").trim();
                if (sStatus && !mDayStatusOptions[sStatus]) {
                    mDayStatusOptions[sStatus] = { key: sStatus, text: sStatus };
                }
            });
            var aDayStatusOptions = Object.keys(mDayStatusOptions).map(function (sKey) {
                return mDayStatusOptions[sKey];
            }).sort(function (oLeft, oRight) {
                if (oLeft.key === "all") { return -1; }
                if (oRight.key === "all") { return 1; }
                return oLeft.text.localeCompare(oRight.text, "es");
            });
            var oViewModel = this.getModel("view");
            var mCenterOptions = {};
            aEnrichedRecords.forEach(function (oRecord) {
                var sCenterCode = String(oRecord.centerCode || "").trim();
                var sCenterName = String(oRecord.center || "").trim();
                var sKey = sCenterCode || sCenterName;
                if (sKey && !mCenterOptions[sKey]) {
                    mCenterOptions[sKey] = {
                        key: sKey,
                        text: sCenterCode && sCenterName ? sCenterName + " (" + sCenterCode + ")" : sCenterName || sCenterCode
                    };
                }
            });
            var aCenterOptions = Object.keys(mCenterOptions).map(function (sKey) {
                return mCenterOptions[sKey];
            }).sort(function (oLeft, oRight) {
                return oLeft.text.localeCompare(oRight.text, "es");
            });

            oViewModel.setProperty("/employee", oEmployee || {});
            oViewModel.setProperty("/title", oEmployee ? "Historial de asistencia: " + oEmployee.name : "Registros de asistencia");
            oViewModel.setProperty("/allRecords", aFilteredByEmployee);
            oViewModel.setProperty("/dayStatusOptions", aDayStatusOptions);
            if (bResetFilters || (oViewModel.getProperty("/centerOptions") || []).length <= 1) {
                oViewModel.setProperty("/centerOptions", [{ key: "all", text: "Todos" }].concat(aCenterOptions));
            }
            if (bResetFilters) {
                oViewModel.setProperty("/center", "all");
                oViewModel.setProperty("/scheduleId", "");
                oViewModel.setProperty("/dayStatusFilter", "all");
                oViewModel.setProperty("/recordFilter", "all");
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
            var sDayStatusFilter = oViewModel.getProperty("/dayStatusFilter");
            var sRecordFilter = oViewModel.getProperty("/recordFilter") || "all";
            var oPeriodStart = oViewModel.getProperty("/periodStart");
            var oPeriodEnd = oViewModel.getProperty("/periodEnd");
            var aRecords = oViewModel.getProperty("/allRecords") || [];
            var aScopedRecords = aRecords.filter(function (oRecord) {
                var oRecordDate = this._parseDisplayDate(oRecord.date);
                return (sCenter === "all" || oRecord.centerCode === sCenter || oRecord.center === sCenter) &&
                    (!sScheduleId || oRecord.scheduleId === sScheduleId) &&
                    (sDayStatusFilter === "all" || this._recordMatchesStatus(oRecord, sDayStatusFilter)) &&
                    (!oRecordDate || !oPeriodStart || !oPeriodEnd || (oRecordDate >= oPeriodStart && oRecordDate <= oPeriodEnd));
            }.bind(this));
            var aFilteredRecords = aScopedRecords.filter(function (oRecord) {
                return this._matchesRecordFilter(oRecord, sRecordFilter);
            }.bind(this));
            var iTotal = aScopedRecords.length;
            var iPresent = this._countStatus(aScopedRecords, "Presente");
            var iLate = this._countStatus(aScopedRecords, "Retardo");
            var iAbsent = this._countStatus(aScopedRecords, "Ausente");
            var iIncomplete = this._countStatus(aScopedRecords, "Incompleto");
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
                absentDescription: iAbsent + " de " + iTotal + " registros · ausencias ÷ total",
                incomplete: iIncomplete,
                incompletePercentage: this._formatPercentage(iIncomplete, iTotal),
                incompleteDescription: iIncomplete + " de " + iTotal + " registros · incompletos ÷ total"
            };
            oViewModel.setProperty("/records", aFilteredRecords);
            oViewModel.setProperty("/stats", oStats);
            oViewModel.setProperty("/statusCards", this._createStatusCards(aScopedRecords, iTotal));
            oViewModel.setProperty("/currentPage", 1);
            console.groupCollapsed("[Monitor][FILTERS][Registros][APPLY]");
            console.info({
                center: sCenter,
                scheduleId: sScheduleId,
                dayStatusFilter: sDayStatusFilter,
                recordFilter: sRecordFilter,
                periodStart: oPeriodStart,
                periodEnd: oPeriodEnd,
                sourceRows: aRecords.length,
                scopedRows: aScopedRecords.length,
                resultRows: aFilteredRecords.length
            });
            console.groupEnd();
            this._updatePage(true);
        },

        _countStatus: function (aRecords, sStatus) {
            return aRecords.filter(function (oRecord) {
                return this._recordMatchesStatus(oRecord, sStatus);
            }.bind(this)).length;
        },

        _recordMatchesStatus: function (oRecord, sStatus) {
            var sNormalizedStatus = this._formatDayStatus(sStatus, sStatus);
            var sDayStatus = this._formatDayStatus(oRecord.dayStatus, oRecord.status);
            return sDayStatus === sNormalizedStatus;
        },

        _matchesRecordFilter: function (oRecord, sRecordFilter) {
            if (!sRecordFilter || sRecordFilter === "all") {
                return true;
            }
            if (sRecordFilter === "Fuera de zona") {
                return oRecord.geofenceState === "Error" || oRecord.isOutOfZone;
            }
            return this._recordMatchesStatus(oRecord, sRecordFilter);
        },

        _formatDayStatus: function (sDayStatus, sFallbackStatus) {
            var sRaw = String(sDayStatus || "").trim().toUpperCase();
            var sFallbackRaw = String(sFallbackStatus || "").trim().toUpperCase();
            var mStatuses = {
                "PRESENTE": "Presente",
                "RETARDO": "Retardo",
                "AUSENTE": "Ausente",
                "INCOMPLETO": "Incompleto",
                "OFICINA CENTRAL": "HOME OFFICE",
                "HOME OFFIC": "HOME OFFICE",
                "HOME OFFICE": "HOME OFFICE",
                "VACACIONES": "Vacaciones",
                "PATERNIDAD": "Paternidad",
                "VIAJE DE NEGOCI": "Viaje de trabajo",
                "VIAJE DE NEGOCIO": "Viaje de trabajo"
            };

            if (/^VIAJE/.test(sRaw)) {
                return "Viaje de trabajo";
            }
            if (mStatuses[sRaw]) {
                return mStatuses[sRaw];
            }
            if (sRaw) {
                return sRaw.charAt(0) + sRaw.slice(1).toLowerCase();
            }
            if (mStatuses[sFallbackRaw]) {
                return mStatuses[sFallbackRaw];
            }
            if (/^VIAJE/.test(sFallbackRaw)) {
                return "Viaje de trabajo";
            }
            return sFallbackStatus === "Fuera de zona" ? "Sin estatus del día" :
                (sFallbackStatus || "Sin estatus del día");
        },

        _getLaborStatusState: function (sCode, sDescription) {
            var sValue = (String(sCode || "") + " " + String(sDescription || "")).toUpperCase();
            if (/06|SANCION|07|BAJA/.test(sValue)) {
                return "Error";
            }
            if (/03|INCAPACIDAD/.test(sValue)) {
                return "Warning";
            }
            if (/01|VACACION|05|CUMPELA|CUMPLEA/.test(sValue)) {
                return "Success";
            }
            if (/02|HOME|04|VIAJE/.test(sValue)) {
                return "Information";
            }
            return "None";
        },

        _getGroupPersonState: function (sDescription) {
            var sValue = String(sDescription || "").trim().toUpperCase();
            if (/SINDICAL|CONFIANZA/.test(sValue)) {
                return "Information";
            }
            return "None";
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
                oEnd = new Date(oStart);
                oStart.setDate(oStart.getDate() - 6);
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
            var sCenter = oViewModel.getProperty("/center");
            if (sCenter && sCenter !== "all") {
                aFilters.push({ field: "CenterOffice", value: sCenter });
            }

            this.getView().setBusy(true);
            return this._attendanceApi.getAttendanceHistory(aFilters).then(function (aRows) {
                var aSchedules = this.getModel("attendance").getProperty("/schedules") || [];
                var aMappedRecords = MonitorData.mapAttendanceRecords(aRows, aSchedules);
                var aInRangeRecords = periodHelper.filterRecords(aMappedRecords, { start: oStart, end: oEnd });
                console.info("[Monitor][FILTERS][Registros][LOCAL-RANGE]", {
                    receivedRows: aRows.length,
                    mappedRows: aMappedRecords.length,
                    inRangeRows: aInRangeRecords.length,
                    dateFrom: this._formatODataDate(oStart),
                    dateTo: this._formatODataDate(oEnd)
                });
                this._setRecords(aInRangeRecords, false);
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
                    status: "HOME OFFICE",
                    description: "Jornada remota autorizada",
                    icon: "sap-icon://home",
                    color: "#07838f"
                },
                {
                    status: "Fuera de zona",
                    description: "Marcación fuera del rango autorizado",
                    icon: "sap-icon://map-2",
                    color: "#bb0000"
                }
            ];

            return aDefinitions.map(function (oDefinition) {
                var iCount = oDefinition.status === "Fuera de zona" ?
                    aRecords.filter(function (oRecord) {
                        return oRecord.geofenceState === "Error" || oRecord.isOutOfZone;
                    }).length :
                    this._countStatus(aRecords, oDefinition.status);
                return Object.assign({}, oDefinition, {
                    filterKey: oDefinition.status,
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

        onRecordFilterSelectionChange: function (oEvent) {
            var oViewModel = this.getModel("view");
            var oItem = oEvent.getParameter("listItem");
            var oContext = oItem && oItem.getBindingContext("view");
            var oCard = oContext && oContext.getObject();
            var sRequestedFilter = String(
                oItem && oItem.data("recordFilter") ||
                oCard && (oCard.filterKey || oCard.status) ||
                "all"
            ).trim() || "all";

            oViewModel.setProperty("/recordFilter", sRequestedFilter);
            this._applyFilters();
            MessageToast.show(sRequestedFilter === "all" ?
                "Mostrando todos los registros" : "Filtro aplicado: " + sRequestedFilter);
        },

        onPeriodChange: function () {
            var sPeriodType = this.getModel("view").getProperty("/periodType");
            if (sPeriodType === "week") {
                this._updatePeriodRange();
                this._applyFilters();
                return;
            }
            this._applyMonthYearSelection();
        },

        onReferenceDateChange: function (oEvent) {
            var sValue = oEvent.getParameter("value") || oEvent.getSource().getValue();
            if (this._parseDisplayDate(sValue)) {
                this.getModel("view").setProperty("/referenceDate", sValue);
                this._syncPeriodSelectors();
                this._updatePeriodRange();
                this._applyFilters();
            }
        },

        onMonthYearChange: function () {
            this._applyMonthYearSelection();
        },

        onApplyFilters: function () {
            var sPeriodType = this.getModel("view").getProperty("/periodType");
            if (sPeriodType === "month" || sPeriodType === "year") {
                this._applyMonthYearSelection();
            } else {
                this._updatePeriodRange();
                this._applyFilters();
            }
            this._reloadRecordsForPeriod().then(function () {
                MessageToast.show("Filtros aplicados: " + this.getModel("view").getProperty("/periodLabel"));
            }.bind(this));
        },

        onClearFilters: function () {
            var oToday = new Date();
            var oViewModel = this.getModel("view");
            var sToday = oToday.getFullYear() + "-" +
                String(oToday.getMonth() + 1).padStart(2, "0") + "-" +
                String(oToday.getDate()).padStart(2, "0");

            oViewModel.setProperty("/periodType", "month");
            oViewModel.setProperty("/referenceDate", sToday);
            oViewModel.setProperty("/selectedMonth", String(oToday.getMonth() + 1).padStart(2, "0"));
            oViewModel.setProperty("/selectedYear", String(oToday.getFullYear()));
            oViewModel.setProperty("/center", "all");
            oViewModel.setProperty("/scheduleId", "");
            oViewModel.setProperty("/dayStatusFilter", "all");
            oViewModel.setProperty("/recordFilter", "all");
            oViewModel.setProperty("/currentPage", 1);

            this._updatePeriodRange();
            this._applyFilters();
            this._reloadRecordsForPeriod().then(function () {
                MessageToast.show("Filtros limpiados. Mostrando " + oViewModel.getProperty("/periodLabel"));
            });
        },

        onRecordSelectionChange: function (oEvent) {
            var oListItem = oEvent.getParameter("listItem");
            if (oListItem) {
                this.getModel("view").setProperty("/selectedRecord", oListItem.getBindingContext("view").getObject());
                this.byId("recordDetailDialog").open();
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
            this.byId("recordDetailDialog").close();
        },

        onDetailAfterClose: function () {
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
                { label: "GeoStatus entrada", property: "entryGeoStatusText", width: 24 },
                { label: "Inicio de comida", property: "mealCheckOut", width: 16 },
                { label: "GeoStatus inicio comida", property: "mealStartGeoStatusText", width: 24 },
                { label: "Fin de comida", property: "mealCheckIn", width: 16 },
                { label: "GeoStatus fin comida", property: "mealEndGeoStatusText", width: 24 },
                { label: "Salida", property: "exit", width: 10 },
                { label: "GeoStatus salida", property: "exitGeoStatusText", width: 24 },
                { label: "Tipo de personal", property: "personTypeDescription", width: 20 },
                { label: "Estatus del día", property: "dayStatusDescription", width: 18 },
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
