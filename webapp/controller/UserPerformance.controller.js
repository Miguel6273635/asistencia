sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "sap/ui/model/json/JSONModel"
], function (BaseController, JSONModel) {
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
            var oLatest = aRecords[0] && aRecords[0].dateObject || new Date();
            var oViewModel = this.getModel("view");

            oEmployee = Object.assign({}, oEmployee, {
                scheduleName: oSchedule.name || oEmployee.scheduleName || "Sin horario",
                scheduleDescription: oSchedule.shortDescription || "Sin regla semanal"
            });
            oViewModel.setProperty("/employee", oEmployee);
            oViewModel.setProperty("/allRecords", aRecords);
            this._buildFilterOptions(aRecords, oLatest);
            this._applyFilters();
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
            var oEarliest = aRecords.length ? aRecords[aRecords.length - 1].dateObject : oLatest;
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
            var bHasDistance = typeof oRecord.distanceMeters === "number";
            return Object.assign({}, oRecord, {
                dateObject: oDate,
                mealRange: (oRecord.mealCheckOut || "—") + " – " + (oRecord.mealCheckIn || "—"),
                distanceLabel: bHasDistance ? oRecord.distanceMeters.toFixed(1).replace(".", ",") + " m" : "No aplica",
                distanceState: bHasDistance ? (oRecord.distanceMeters <= 2 ? "Success" : "Error") : "None",
                statusState: this._statusState(oRecord.status),
                highlight: this._statusState(oRecord.status)
            });
        },

        _applyFilters: function () {
            var oViewModel = this.getModel("view");
            var aAllRecords = oViewModel.getProperty("/allRecords") || [];
            var oRange = this._getSelectedRange();
            var aRecords = aAllRecords.filter(function (oRecord) {
                return oRecord.dateObject >= oRange.start && oRecord.dateObject <= oRange.end;
            });

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
            var aEligible = aRecords.filter(function (oRecord) { return aAuthorizedLeave.indexOf(oRecord.status) === -1; });
            var aAttended = aEligible.filter(function (oRecord) { return oRecord.entry && oRecord.entry !== "—"; });
            var aOnTime = aAttended.filter(function (oRecord) { return oRecord.status !== "Retardo"; });
            var aComplete = aAttended.filter(function (oRecord) { return oRecord.exit && oRecord.exit !== "—"; });
            var aLocated = aRecords.filter(function (oRecord) { return typeof oRecord.distanceMeters === "number"; });
            var aInZone = aLocated.filter(function (oRecord) { return oRecord.distanceMeters <= 2; });

            return {
                attendance: this._kpi(aAttended.length, aEligible.length, "días laborables con entrada registrada"),
                punctuality: this._kpi(aOnTime.length, aAttended.length, "asistencias iniciadas sin retardo"),
                completion: this._kpi(aComplete.length, aAttended.length, "asistencias con entrada y salida"),
                geofence: this._kpi(aInZone.length, aLocated.length, "marcaciones presenciales dentro de 2 m")
            };
        },

        _kpi: function (iNumerator, iDenominator, sExplanation) {
            var fValue = iDenominator ? iNumerator * 100 / iDenominator : 0;
            return {
                value: fValue.toFixed(1).replace(".", ","),
                detail: iNumerator + " de " + iDenominator + " " + sExplanation,
                state: fValue >= 90 ? "Success" : (fValue >= 80 ? "Warning" : "Error")
            };
        },

        _emptyKpis: function () {
            return {
                attendance: this._kpi(0, 0, "días laborables con entrada registrada"),
                punctuality: this._kpi(0, 0, "asistencias iniciadas sin retardo"),
                completion: this._kpi(0, 0, "asistencias con entrada y salida"),
                geofence: this._kpi(0, 0, "marcaciones presenciales dentro de 2 m")
            };
        },

        _buildStatusSummary: function (aRecords) {
            var aDefinitions = [
                { status: "Presente", description: "Jornadas completas y a tiempo", state: "Success" },
                { status: "Retardo", description: "Entradas posteriores a la tolerancia", state: "Warning" },
                { status: "Ausente", description: "Días laborables sin marcación", state: "Error" },
                { status: "Fuera de zona", description: "Marcaciones a más de 2 metros", state: "Error" },
                { status: "Permiso autorizado", description: "Vacaciones o paternidad", state: "Information" }
            ];
            return aDefinitions.map(function (oDefinition) {
                var iCount = oDefinition.status === "Permiso autorizado" ?
                    aRecords.filter(function (oRecord) { return ["Vacaciones", "Paternidad"].indexOf(oRecord.status) !== -1; }).length :
                    aRecords.filter(function (oRecord) { return oRecord.status === oDefinition.status; }).length;
                return Object.assign({}, oDefinition, {
                    count: iCount,
                    percentage: (aRecords.length ? (iCount * 100 / aRecords.length).toFixed(1) : "0.0").replace(".", ",") + "% del periodo"
                });
            }).filter(function (oItem) { return oItem.count > 0; });
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
                    label: { formatString: "0'%'" }
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
        },

        onOpenMap: function () {
            var oEmployee = this.getModel("view").getProperty("/employee");
            this.navTo("mapUser", { zoneId: oEmployee.zoneId, employeeId: oEmployee.id });
        },

        onNavUsers: function () { this.navTo("users"); },
        onNavOverview: function () { this.navTo("overview"); }
    });
});


