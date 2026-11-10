sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "com/mitsu/monitorasistencia/model/AttendanceApi",
    "com/mitsu/monitorasistencia/model/MonitorData",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast"
], function (BaseController, AttendanceApi, MonitorData, JSONModel, MessageToast) {
    "use strict";

    var MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    var SHORT_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

    return BaseController.extend("com.mitsu.monitorasistencia.controller.UserPerformance", {
        onInit: function () {
            this.setModel(new JSONModel({
                employee: {},
                period: "weekly",
                years: [],
                months: MONTHS.map(function (sMonth, iIndex) { return { key: String(iIndex), text: sMonth }; }),
                weeks: [],
                selectedYear: "",
                selectedMonth: "",
                selectedWeek: "",
                periodLabel: "",
                allRecords: [],
                records: [],
                trend: [],
                statusSummary: [],
                recordRangeText: "0 registros",
                tableHeight: "6rem",
                kpis: this._emptyKpis()
            }), "view");
            this._attendanceApi = new AttendanceApi();
            this._requestSequence = 0;
            this.getRouter().getRoute("userPerformance").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function (oEvent) {
            this._employeeId = oEvent.getParameter("arguments").employeeId;
            this.getModel("attendance").dataLoaded().then(this._loadData.bind(this));
        },

        _loadData: function () {
            var oAttendance = this.getModel("attendance");
            var aEmployees = oAttendance.getProperty("/employees") || [];
            var aSchedules = oAttendance.getProperty("/schedules") || [];
            var aCurrent = oAttendance.getProperty("/records") || [];
            var aHistory = oAttendance.getProperty("/userPerformanceHistory") || [];
            var oEmployee = aEmployees.find(function (oItem) { return oItem.id === this._employeeId; }.bind(this)) || {};
            var oSchedule = aSchedules.find(function (oItem) { return oItem.id === oEmployee.scheduleId; }) || {};
            var aRecords = aCurrent.concat(aHistory)
                .filter(function (oRecord) { return oRecord.employeeId === this._employeeId; }.bind(this))
                .map(this._normalizeRecord.bind(this))
                .sort(function (a, b) { return b.dateObject - a.dateObject; });
            var oLatestRecord = aRecords[0] || {};
            var oLatest = aRecords[0] && aRecords[0].dateObject || new Date();
            var oViewModel = this.getModel("view");
            this._personalNumber = this._resolvePersonalNumber(oEmployee, oLatestRecord);

            oEmployee = Object.assign({}, oEmployee, {
                number: this._personalNumber || "Sin número",
                center: this._cleanText(oEmployee.center) || this._cleanText(oLatestRecord.center) || "Sin centro",
                scheduleName: this._cleanText(oSchedule.name) || this._cleanText(oEmployee.scheduleName) ||
                    this._cleanText(oLatestRecord.shift) || "Sin horario",
                scheduleDescription: this._cleanText(oSchedule.shortDescription) ||
                    this._cleanText(oEmployee.scheduleDescription) || "Sin regla semanal"
            });
            oViewModel.setProperty("/employee", oEmployee);
            oViewModel.setProperty("/allRecords", aRecords);
            this._buildFilterOptions(aRecords, oLatest);
            this._applyFilters();
            this._refreshPeriodRecords();
        },

        _resolvePersonalNumber: function (oEmployee, oRecord) {
            var aCandidates = [
                oEmployee && oEmployee.PersonalNumber,
                oEmployee && oEmployee.PersonnelNumber,
                oEmployee && oEmployee.number,
                oRecord && oRecord.PersonalNumber,
                oRecord && oRecord.employeeNumber,
                String(this._employeeId || "").replace(/^employee-/, "")
            ];
            for (var iIndex = 0; iIndex < aCandidates.length; iIndex += 1) {
                var sCandidate = this._cleanText(aCandidates[iIndex]);
                if (sCandidate) {
                    return sCandidate;
                }
            }
            return "";
        },

        _formatODataDate: function (oDate) {
            return oDate.getFullYear() +
                String(oDate.getMonth() + 1).padStart(2, "0") +
                String(oDate.getDate()).padStart(2, "0");
        },

        _refreshPeriodRecords: function () {
            var oRange = this._getSelectedRange();
            var sPersonalNumber = this._personalNumber || this._resolvePersonalNumber(this.getModel("view").getProperty("/employee"), {});
            if (!sPersonalNumber) {
                MessageToast.show("No se encontró el número del empleado para consultar su historial");
                return Promise.resolve();
            }

            var iRequest = ++this._requestSequence;
            var aFilters = [
                { field: "PersonalNumber", value: sPersonalNumber },
                { field: "DateFrom", value: this._formatODataDate(oRange.start) },
                { field: "DateTo", value: this._formatODataDate(oRange.end) }
            ];
            this.getView().setBusy(true);
            return this._attendanceApi.getAttendanceHistory(aFilters).then(function (aRows) {
                if (iRequest !== this._requestSequence) {
                    return;
                }
                var aSchedules = this.getModel("attendance").getProperty("/schedules") || [];
                var aRecords = MonitorData.mapAttendanceRecords(aRows, aSchedules)
                    .map(this._normalizeRecord.bind(this))
                    .sort(function (oLeft, oRight) { return oRight.dateObject - oLeft.dateObject; });
                var oViewModel = this.getModel("view");
                var oEmployee = oViewModel.getProperty("/employee") || {};
                var oLatestRecord = aRecords[0] || {};
                oViewModel.setProperty("/employee", Object.assign({}, oEmployee, {
                    number: sPersonalNumber,
                    center: this._cleanText(oEmployee.center) || this._cleanText(oLatestRecord.center) || "Sin centro",
                    scheduleName: this._cleanText(oEmployee.scheduleName) || this._cleanText(oLatestRecord.shift) || "Sin horario"
                }));
                oViewModel.setProperty("/allRecords", aRecords);
                this._applyFilters();
                console.info("[Monitor][FILTERS][Desempeño de usuario][ODATA]", {
                    personalNumber: sPersonalNumber,
                    dateFrom: this._formatODataDate(oRange.start),
                    dateTo: this._formatODataDate(oRange.end),
                    receivedRows: aRows.length,
                    mappedRows: aRecords.length
                });
            }.bind(this)).catch(function (oError) {
                if (iRequest === this._requestSequence) {
                    MessageToast.show("No fue posible consultar los demás días del periodo en SAP");
                    console.error("Error al consultar AttendanceHistorySet para desempeño", oError);
                }
            }.bind(this)).finally(function () {
                if (iRequest === this._requestSequence) {
                    this.getView().setBusy(false);
                }
            }.bind(this));
        },

        _buildFilterOptions: function (aRecords, oLatest) {
            var oViewModel = this.getModel("view");
            var aYears = Array.from(new Set(aRecords.map(function (oRecord) { return oRecord.dateObject.getFullYear(); })))
                .sort(function (a, b) { return b - a; })
                .map(function (iYear) { return { key: String(iYear), text: String(iYear) }; });
            if (!aYears.length) {
                aYears.push({ key: String(oLatest.getFullYear()), text: String(oLatest.getFullYear()) });
            }
            var aWeeks = [];
            var oEarliest = new Date(oLatest.getFullYear(), 0, 1);
            var oCursorEnd = new Date(oLatest.getFullYear(), oLatest.getMonth(), oLatest.getDate());
            while (oCursorEnd >= oEarliest) {
                var oStart = new Date(oCursorEnd.getFullYear(), oCursorEnd.getMonth(), oCursorEnd.getDate() - 6);
                aWeeks.push({
                    key: this._toIsoDate(oStart),
                    year: String(oCursorEnd.getFullYear()),
                    text: this._formatWeek(oStart, oCursorEnd)
                });
                oCursorEnd = new Date(oStart.getFullYear(), oStart.getMonth(), oStart.getDate() - 1);
            }
            oViewModel.setProperty("/years", aYears);
            oViewModel.setProperty("/weeks", aWeeks);
            oViewModel.setProperty("/selectedYear", String(oLatest.getFullYear()));
            oViewModel.setProperty("/selectedMonth", String(oLatest.getMonth()));
            oViewModel.setProperty("/selectedWeek", aWeeks.length ? aWeeks[0].key : "");
        },

        _normalizeRecord: function (oRecord) {
            var oDate = this._parseDate(oRecord.date);
            var sAttendanceStatus = oRecord.attendanceStatus || oRecord.status;
            var aLocationOptionalStatuses = ["Viaje de trabajo", "Vacaciones", "Paternidad", "Home office"];
            var bLocationOptional = aLocationOptionalStatuses.indexOf(sAttendanceStatus) !== -1;
            var oGeoInfo = this._getGeoInfo(oRecord, bLocationOptional);
            var sEffectiveStatus = sAttendanceStatus;
            var sObservation = oRecord.observation || "Sin observaciones registradas.";
            if (sAttendanceStatus === "Incompleto") {
                sObservation = this._incompleteObservation(oRecord);
            }
            return Object.assign({}, oRecord, {
                dateObject: oDate,
                attendanceStatus: sAttendanceStatus,
                status: sEffectiveStatus,
                mealRange: (oRecord.mealCheckOut || "—") + " – " + (oRecord.mealCheckIn || "—"),
                hours: this._calculateWorkedHours(oRecord),
                zoneLabel: oGeoInfo.label,
                zoneDetail: oGeoInfo.detail,
                zoneState: oGeoInfo.state,
                geoEvaluable: oGeoInfo.evaluable,
                geoInZone: oGeoInfo.inside,
                observation: sObservation,
                statusState: this._statusState(sEffectiveStatus),
                highlight: this._statusState(sEffectiveStatus)
            });
        },

        _cleanText: function (vValue) {
            var sValue = String(vValue == null ? "" : vValue).trim();
            return /^(undefined|indefinido|null|sin definir|no definido|sin número|sin centro|sin horario)$/i.test(sValue) ? "" : sValue;
        },

        _hasTime: function (vValue) {
            var sValue = String(vValue || "").trim();
            return Boolean(sValue && sValue !== "—" && sValue !== "00:00" && sValue !== "00:00:00");
        },

        _timeToMinutes: function (vValue) {
            var aMatch = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(vValue || "").trim());
            if (!aMatch) {
                return null;
            }
            var iHours = Number(aMatch[1]);
            var iMinutes = Number(aMatch[2]);
            return iHours <= 23 && iMinutes <= 59 ? iHours * 60 + iMinutes : null;
        },

        _calculateWorkedHours: function (oRecord) {
            var iEntry = this._timeToMinutes(oRecord.entry);
            var iExit = this._timeToMinutes(oRecord.exit);
            if (iEntry === null || iExit === null) {
                return "0:00";
            }
            if (iExit < iEntry) {
                iExit += 24 * 60;
            }
            var iMealStart = this._timeToMinutes(oRecord.mealCheckOut);
            var iMealEnd = this._timeToMinutes(oRecord.mealCheckIn);
            var iMealMinutes = 0;
            if (iMealStart !== null && iMealEnd !== null) {
                if (iMealEnd < iMealStart) {
                    iMealEnd += 24 * 60;
                }
                iMealMinutes = Math.max(0, iMealEnd - iMealStart);
            }
            var iWorkedMinutes = Math.max(0, iExit - iEntry - iMealMinutes);
            return Math.floor(iWorkedMinutes / 60) + ":" + String(iWorkedMinutes % 60).padStart(2, "0");
        },

        _incompleteObservation: function (oRecord) {
            var bHasEntry = this._hasTime(oRecord.entry);
            var bHasExit = this._hasTime(oRecord.exit);
            if (bHasEntry && !bHasExit) {
                return "Jornada incompleta: falta la marcación de salida.";
            }
            if (!bHasEntry && bHasExit) {
                return "Jornada incompleta: falta la marcación de entrada.";
            }
            return "Jornada incompleta: faltan marcaciones para cerrar el día.";
        },

        _getGeoInfo: function (oRecord, bLocationOptional) {
            if (bLocationOptional) {
                return { evaluable: false, inside: false, outside: false, label: "No aplica", detail: "La jornada no requiere geocerca", state: "Information" };
            }
            var sGeoStatus = String(oRecord.geoStatus || "").trim().toUpperCase();
            var sDescription = this._cleanText(oRecord.geoStatusDescription);
            var sGeoText = (sGeoStatus + " " + sDescription).toUpperCase();
            var bExplicitOutside = Boolean(oRecord.isOutOfZone) ||
                /(^|\s)(OUT|OUTSIDE)(\s|$)|FUERA(?:\s+DE)?\s+(?:ZONA|RANGO|GEOCERCA)|OUT_OF_ZONE/.test(sGeoText);
            var bExplicitInside = !bExplicitOutside &&
                /(^|\s)IN(?:SIDE)?(\s|$)|DENTRO(?:\s+DEL?|\s+DE LA)?\s+(?:ZONA|RANGO|GEOCERCA)/.test(sGeoText);
            var bHasDistance = typeof oRecord.distanceMeters === "number" && isFinite(oRecord.distanceMeters);
            var bEvaluable = bExplicitOutside || bExplicitInside || bHasDistance;
            var bInside = bExplicitInside || (!bExplicitOutside && !bExplicitInside && bHasDistance && oRecord.distanceMeters <= 2);
            var bOutside = bExplicitOutside || (!bExplicitInside && bHasDistance && oRecord.distanceMeters > 2);
            var sDistance = bHasDistance ? oRecord.distanceMeters.toFixed(1).replace(".", ",") + " m" : "Sin distancia";
            var sLabel = sDescription || (bOutside ? "Fuera del rango autorizado" : (bInside ? "Dentro del rango autorizado" : "Sin dato de zona"));
            var sDetail = [sGeoStatus ? "GeoStatus: " + sGeoStatus : "", sDistance].filter(Boolean).join(" · ");
            return {
                evaluable: bEvaluable,
                inside: bInside,
                outside: bOutside,
                label: sLabel,
                detail: sDetail,
                state: bOutside ? "Error" : (bInside ? "Success" : "None")
            };
        },

        _applyFilters: function () {
            var oViewModel = this.getModel("view");
            var aAllRecords = oViewModel.getProperty("/allRecords") || [];
            var oRange = this._getSelectedRange();
            var aRecords = aAllRecords.filter(function (oRecord) {
                return oRecord.dateObject >= oRange.start && oRecord.dateObject <= oRange.end;
            });
            console.groupCollapsed("[Monitor][FILTERS][Desempeño de usuario][APPLY]");
            console.info({
                period: oViewModel.getProperty("/period"),
                selectedYear: oViewModel.getProperty("/selectedYear"),
                selectedMonth: oViewModel.getProperty("/selectedMonth"),
                selectedWeek: oViewModel.getProperty("/selectedWeek"),
                range: oRange,
                sourceRows: aAllRecords.length,
                resultRows: aRecords.length
            });
            console.groupEnd();

            oViewModel.setProperty("/records", aRecords);
            oViewModel.setProperty("/periodLabel", oRange.label);
            oViewModel.setProperty("/recordRangeText", aRecords.length + (aRecords.length === 1 ? " registro" : " registros"));
            oViewModel.setProperty("/tableHeight", Math.min(15, Math.max(6, 3 + aRecords.length * 2.5)) + "rem");
            oViewModel.setProperty("/kpis", this._calculateKpis(aRecords));
            oViewModel.setProperty("/statusSummary", this._buildStatusSummary(aRecords));
            oViewModel.setProperty("/trend", this._buildTrend(aRecords));
            this._configureChart();
        },

        _getSelectedRange: function () {
            var oViewModel = this.getModel("view");
            var sPeriod = oViewModel.getProperty("/period");
            var iYear = parseInt(oViewModel.getProperty("/selectedYear"), 10) || new Date().getFullYear();
            var oStart;
            var oEnd;
            var sLabel;

            if (sPeriod === "weekly") {
                oStart = this._parseIsoDate(oViewModel.getProperty("/selectedWeek")) || new Date(iYear, 0, 1);
                oEnd = new Date(oStart.getFullYear(), oStart.getMonth(), oStart.getDate() + 6, 23, 59, 59, 999);
                sLabel = this._formatWeek(oStart, oEnd);
            } else if (sPeriod === "monthly") {
                var iMonth = parseInt(oViewModel.getProperty("/selectedMonth"), 10) || 0;
                oStart = new Date(iYear, iMonth, 1);
                oEnd = new Date(iYear, iMonth + 1, 0, 23, 59, 59, 999);
                sLabel = MONTHS[iMonth] + " " + iYear;
            } else {
                oStart = new Date(iYear, 0, 1);
                oEnd = new Date(iYear, 11, 31, 23, 59, 59, 999);
                sLabel = "Año " + iYear;
            }
            return { start: oStart, end: oEnd, label: sLabel };
        },

        _calculateKpis: function (aRecords) {
            var aAuthorizedLeave = ["Vacaciones", "Paternidad"];
            var aEffectiveStatuses = ["Presente", "Retardo", "Home office", "Viaje de trabajo"];
            var aEligible = aRecords.filter(function (oRecord) {
                return aAuthorizedLeave.indexOf(oRecord.attendanceStatus || oRecord.status) === -1;
            });
            var aEffective = aEligible.filter(function (oRecord) {
                return aEffectiveStatuses.indexOf(oRecord.attendanceStatus || oRecord.status) !== -1;
            });
            var aClassifiedAttendance = aEligible.filter(function (oRecord) {
                return ["Presente", "Retardo"].indexOf(oRecord.attendanceStatus || oRecord.status) !== -1;
            });
            var aOnTime = aClassifiedAttendance.filter(function (oRecord) {
                return (oRecord.attendanceStatus || oRecord.status) === "Presente";
            });
            var aComplete = aEligible.filter(function (oRecord) {
                return this._hasTime(oRecord.entry) && this._hasTime(oRecord.exit);
            }.bind(this));
            var aLocated = aRecords.filter(function (oRecord) { return oRecord.geoEvaluable; });
            var aInZone = aLocated.filter(function (oRecord) { return oRecord.geoInZone; });

            return {
                attendance: this._kpi(aEffective.length, aEligible.length, "jornadas válidas de los días evaluados"),
                punctuality: this._kpi(aOnTime.length, aClassifiedAttendance.length, "asistencias clasificadas sin retardo"),
                completion: this._kpi(aComplete.length, aEligible.length, "días evaluados con entrada y salida"),
                geofence: this._kpi(aInZone.length, aLocated.length, "registros evaluables dentro de zona")
            };
        },

        _kpi: function (iNumerator, iDenominator, sExplanation) {
            var fValue = iDenominator ? iNumerator * 100 / iDenominator : 0;
            return {
                value: fValue.toFixed(1).replace(".", ","),
                detail: iNumerator + " de " + iDenominator + " " + sExplanation,
                state: iDenominator === 0 ? "None" : (fValue >= 90 ? "Success" : (fValue >= 80 ? "Warning" : "Error"))
            };
        },

        _emptyKpis: function () {
            return {
                attendance: this._kpi(0, 0, "jornadas válidas de los días evaluados"),
                punctuality: this._kpi(0, 0, "asistencias clasificadas sin retardo"),
                completion: this._kpi(0, 0, "días evaluados con entrada y salida"),
                geofence: this._kpi(0, 0, "registros evaluables dentro de zona")
            };
        },

        _buildStatusSummary: function (aRecords) {
            var aDefinitions = [
                { status: "Presente", statuses: ["Presente"], description: "Jornada completa y a tiempo", state: "Success" },
                { status: "Retardo", statuses: ["Retardo"], description: "Entrada posterior a la tolerancia", state: "Warning" },
                { status: "Incompleto", statuses: ["Incompleto"], description: "Falta una marcación para cerrar la jornada", state: "Warning" },
                { status: "Ausente", statuses: ["Ausente"], description: "Día laborable sin marcaciones válidas", state: "Error" },
                { status: "Fuera de zona", statuses: ["Fuera de zona"], description: "GeoStatus fuera del rango autorizado", state: "Error" },
                { status: "Viaje de trabajo", statuses: ["Viaje de trabajo"], description: "Asignación laboral fuera del centro", state: "Information" },
                { status: "Home office", statuses: ["Home office"], description: "Jornada remota autorizada", state: "Information" },
                { status: "Permiso autorizado", statuses: ["Vacaciones", "Paternidad"], description: "Vacaciones o paternidad", state: "Information" }
            ];
            var aKnownStatuses = aDefinitions.reduce(function (aResult, oDefinition) {
                return aResult.concat(oDefinition.statuses);
            }, []);
            var aSummary = aDefinitions.map(function (oDefinition) {
                var iCount = aRecords.filter(function (oRecord) {
                    return oDefinition.statuses.indexOf(oRecord.status) !== -1;
                }).length;
                return Object.assign({}, oDefinition, {
                    count: iCount,
                    percentage: (aRecords.length ? (iCount * 100 / aRecords.length).toFixed(1) : "0.0").replace(".", ",") + "% del periodo"
                });
            }).filter(function (oItem) { return oItem.count > 0; });
            var iOther = aRecords.filter(function (oRecord) { return aKnownStatuses.indexOf(oRecord.status) === -1; }).length;
            if (iOther) {
                aSummary.push({
                    status: "Otro",
                    description: "Registros con una clasificación no catalogada",
                    state: "None",
                    count: iOther,
                    percentage: (iOther * 100 / aRecords.length).toFixed(1).replace(".", ",") + "% del periodo"
                });
            }
            return aSummary;
        },

        _buildTrend: function (aRecords) {
            var sPeriod = this.getModel("view").getProperty("/period");
            var mGroups = {};
            aRecords.forEach(function (oRecord) {
                var oInfo = this._trendGroupInfo(oRecord.dateObject, sPeriod);
                if (!mGroups[oInfo.key]) {
                    mGroups[oInfo.key] = { key: oInfo.key, label: oInfo.label, order: oInfo.order, records: [] };
                }
                mGroups[oInfo.key].records.push(oRecord);
            }.bind(this));

            return Object.keys(mGroups).map(function (sKey) {
                var oGroup = mGroups[sKey];
                var oKpis = this._calculateKpis(oGroup.records);
                return {
                    label: oGroup.label,
                    order: oGroup.order,
                    attendance: parseFloat(oKpis.attendance.value.replace(",", ".")),
                    punctuality: parseFloat(oKpis.punctuality.value.replace(",", ".")),
                    completion: parseFloat(oKpis.completion.value.replace(",", "."))
                };
            }.bind(this)).sort(function (a, b) { return a.order - b.order; });
        },

        _trendGroupInfo: function (oDate, sPeriod) {
            if (sPeriod === "weekly") {
                return { key: this._toIsoDate(oDate), label: oDate.getDate() + " " + SHORT_MONTHS[oDate.getMonth()], order: oDate.getTime() };
            }
            if (sPeriod === "monthly") {
                var iWeek = Math.ceil(oDate.getDate() / 7);
                return { key: "week-" + iWeek, label: "Semana " + iWeek, order: iWeek };
            }
            return { key: "month-" + oDate.getMonth(), label: SHORT_MONTHS[oDate.getMonth()], order: oDate.getMonth() };
        },

        _configureChart: function () {
            var oChart = this.byId("performanceTrend");
            if (!oChart) { return; }
            oChart.setVizProperties({
                title: { visible: false },
                legend: { visible: true, position: "bottom" },
                plotArea: {
                    colorPalette: ["#0A6ED1", "#188918", "#7858D7"],
                    dataLabel: { visible: true, formatString: "0.0" },
                    marker: { visible: true, size: 7 }
                },
                valueAxis: {
                    title: { visible: false },
                    scale: { fixedRange: true, minValue: 0, maxValue: 100 },
                    label: { formatString: "0" }
                },
                categoryAxis: { title: { visible: false } }
            });
        },

        _statusState: function (sStatus) {
            var mStates = {
                "Presente": "Success", "Home office": "Success", "Viaje de trabajo": "Information",
                "Retardo": "Warning", "Incompleto": "Warning", "Vacaciones": "Information",
                "Paternidad": "Information", "Ausente": "Error", "Fuera de zona": "Error"
            };
            return mStates[sStatus] || "None";
        },

        _parseDate: function (sDate) {
            var aParts = (sDate || "").split("/").map(Number);
            return new Date(aParts[2], aParts[1] - 1, aParts[0]);
        },

        _startOfWeek: function (oDate) {
            var oResult = new Date(oDate.getFullYear(), oDate.getMonth(), oDate.getDate());
            var iDay = oResult.getDay();
            oResult.setDate(oResult.getDate() - (iDay === 0 ? 6 : iDay - 1));
            return oResult;
        },

        _toIsoDate: function (oDate) {
            return [oDate.getFullYear(), String(oDate.getMonth() + 1).padStart(2, "0"), String(oDate.getDate()).padStart(2, "0")].join("-");
        },

        _parseIsoDate: function (sDate) {
            var aParts = (sDate || "").split("-").map(Number);
            return aParts.length === 3 ? new Date(aParts[0], aParts[1] - 1, aParts[2]) : null;
        },

        _formatWeek: function (oStart, oEnd) {
            if (oStart.getMonth() === oEnd.getMonth()) {
                return oStart.getDate() + "–" + oEnd.getDate() + " " + SHORT_MONTHS[oEnd.getMonth()] + " " + oEnd.getFullYear();
            }
            return oStart.getDate() + " " + SHORT_MONTHS[oStart.getMonth()] + " – " + oEnd.getDate() + " " + SHORT_MONTHS[oEnd.getMonth()] + " " + oEnd.getFullYear();
        },

        onPeriodChange: function (oEvent) {
            this.getModel("view").setProperty("/period", oEvent.getParameter("item").getKey());
            this._applyFilters();
            this._refreshPeriodRecords();
        },

        onFilterChange: function () {
            var oViewModel = this.getModel("view");
            var sYear = oViewModel.getProperty("/selectedYear");
            var sWeek = oViewModel.getProperty("/selectedWeek");
            var aWeeks = oViewModel.getProperty("/weeks") || [];
            if (oViewModel.getProperty("/period") === "weekly" && !aWeeks.some(function (oWeek) { return oWeek.key === sWeek && oWeek.year === sYear; })) {
                var oFirstWeek = aWeeks.find(function (oWeek) { return oWeek.year === sYear; });
                oViewModel.setProperty("/selectedWeek", oFirstWeek ? oFirstWeek.key : "");
            }
            this._applyFilters();
            this._refreshPeriodRecords();
        },

        onOpenMap: function () {
            var oEmployee = this.getModel("view").getProperty("/employee");
            this.navTo("mapUser", { zoneId: oEmployee.zoneId, employeeId: oEmployee.id });
        },

        onOpenSchedule: function () {
            var oEmployee = this.getModel("view").getProperty("/employee") || {};
            this.getModel("attendance").setProperty("/focusedScheduleId", oEmployee.scheduleId || "");
            this.navTo("shifts");
        },

        onNavUsers: function () { this.navTo("users"); },
        onNavOverview: function () { this.navTo("overview"); }
    });
});


