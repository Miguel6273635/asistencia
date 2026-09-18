sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "com/mitsu/monitorasistencia/model/formatter",
    "com/mitsu/monitorasistencia/model/periodHelper",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast"
], function (BaseController, formatter, periodHelper, JSONModel, MessageToast) {
    "use strict";

    return BaseController.extend("com.mitsu.monitorasistencia.controller.Shifts", {
        formatter: formatter,

        onInit: function () {
            this.setModel(new JSONModel({
                granularity: "week",
                referenceDate: "2026-08-31",
                periodLabel: "",
                allSchedules: [],
                schedules: [],
                riskSchedules: [],
                typeStats: [],
                search: "",
                scheduleType: "all",
                stats: {
                    active: 0,
                    coverage: "0.0",
                    coverageDescription: "0 presentes / 0 asignados",
                    assigned: 0,
                    absent: 0,
                    absentPercentage: "0.0",
                    absentDescription: "0 personas sin cobertura"
                }
            }), "view");
            this.getRouter().getRoute("shifts").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            this.getModel("attendance").dataLoaded().then(function () {
                this._loadSchedules();
                this._configureChart();
            }.bind(this));
        },

        _loadSchedules: function () {
            var oAttendanceModel = this.getModel("attendance");
            var oViewModel = this.getModel("view");
            var oPeriod = periodHelper.getPeriod(oViewModel.getProperty("/granularity"), oViewModel.getProperty("/referenceDate"));
            var aEmployees = oAttendanceModel.getProperty("/employees") || [];
            var mEmployees = {};
            var aFacts = (oAttendanceModel.getProperty("/records") || []).concat(oAttendanceModel.getProperty("/userPerformanceHistory") || []);
            var aPeriodRecords;
            var mSchedules = {};
            var aSchedules = (oAttendanceModel.getProperty("/schedules") || []).map(function (oSchedule) {
                var oDynamicSchedule = Object.assign({}, oSchedule, {
                    assigned: 0,
                    evaluated: 0,
                    present: 0,
                    absent: 0,
                    late: 0,
                    coverage: 0
                });
                mSchedules[oDynamicSchedule.id] = oDynamicSchedule;
                return oDynamicSchedule;
            });

            aEmployees.forEach(function (oEmployee) { mEmployees[oEmployee.id] = oEmployee; });
            aPeriodRecords = periodHelper.filterRecords(aFacts, oPeriod).map(function (oRecord) {
                var oEmployee = mEmployees[oRecord.employeeId] || {};
                return Object.assign({}, oRecord, { scheduleId: oEmployee.scheduleId || "" });
            });
            aPeriodRecords.forEach(function (oRecord) {
                var oSchedule = mSchedules[oRecord.scheduleId];
                if (!oSchedule) { return; }
                oSchedule.assigned += 1;
                oSchedule.evaluated += 1;
                if (["Presente", "Home office", "Viaje de trabajo"].indexOf(oRecord.status) >= 0) { oSchedule.present += 1; }
                if (oRecord.status === "Ausente") { oSchedule.absent += 1; }
                if (oRecord.status === "Retardo") { oSchedule.late += 1; }
            });
            aSchedules.forEach(function (oSchedule) {
                oSchedule.coverage = oSchedule.assigned ? Number((oSchedule.present * 100 / oSchedule.assigned).toFixed(1)) : 0;
            });

            oViewModel.setProperty("/periodLabel", oPeriod.label);
            oViewModel.setProperty("/allSchedules", aSchedules);
            this._calculateStats(aSchedules);
            this._buildSupportingData(aSchedules);
            this._applyScheduleFilters();
        },

        _calculateStats: function (aSchedules) {
            var oStats = aSchedules.reduce(function (oResult, oSchedule) {
                oResult.active += oSchedule.active ? 1 : 0;
                oResult.assigned += Number(oSchedule.assigned) || 0;
                oResult.present += Number(oSchedule.present) || 0;
                oResult.absent += Number(oSchedule.absent) || 0;
                return oResult;
            }, { active: 0, assigned: 0, present: 0, absent: 0 });

            oStats.coverage = oStats.assigned ? (oStats.present * 100 / oStats.assigned).toFixed(1) : "0.0";
            oStats.absentPercentage = oStats.assigned ? (oStats.absent * 100 / oStats.assigned).toFixed(1) : "0.0";
            oStats.coverageDescription = oStats.present + " presentes / " + oStats.assigned + " jornadas evaluadas";
            oStats.absentDescription = oStats.absent + " ausencias / " + oStats.assigned + " jornadas evaluadas";
            this.getModel("view").setProperty("/stats", oStats);
        },

        _buildSupportingData: function (aSchedules) {
            var aActive = aSchedules.filter(function (oSchedule) { return oSchedule.active; });
            var aRiskSchedules = aActive.filter(function (oSchedule) { return oSchedule.evaluated > 0; }).slice().sort(function (a, b) {
                return a.coverage - b.coverage;
            }).slice(0, 8);
            var aTypes = ["Diurno", "Vespertino", "Nocturno", "Fin de semana", "Mixto"];
            var aTypeStats = aTypes.map(function (sType) {
                var iCount = aActive.filter(function (oSchedule) { return oSchedule.type === sType; }).length;
                return {
                    type: sType,
                    count: iCount,
                    percentage: aActive.length ? Math.round(iCount * 100 / aActive.length) : 0,
                    distributionText: iCount + " de " + aActive.length + " horarios (" +
                        (aActive.length ? Math.round(iCount * 100 / aActive.length) : 0) + "% del catálogo)"
                };
            }).filter(function (oItem) { return oItem.count > 0; });

            this.getModel("view").setProperty("/riskSchedules", aRiskSchedules);
            this.getModel("view").setProperty("/typeStats", aTypeStats);
        },

        _applyScheduleFilters: function () {
            var oViewModel = this.getModel("view");
            var sSearch = (oViewModel.getProperty("/search") || "").toLowerCase();
            var sType = oViewModel.getProperty("/scheduleType") || "all";
            var aSchedules = oViewModel.getProperty("/allSchedules") || [];
            var aFiltered = aSchedules.filter(function (oSchedule) {
                var bType = sType === "all" || oSchedule.type === sType;
                var sHaystack = [oSchedule.code, oSchedule.name, oSchedule.description, oSchedule.type].join(" ").toLowerCase();
                return bType && (!sSearch || sHaystack.indexOf(sSearch) !== -1);
            });

            oViewModel.setProperty("/schedules", aFiltered);
        },

        _configureChart: function () {
            var oChart = this.byId("coverageChart");
            if (oChart) {
                oChart.setVizProperties({
                    title: { visible: false },
                    legend: { visible: false },
                    plotArea: {
                        colorPalette: ["#C00000"],
                        dataLabel: { visible: true, formatString: "0.0" },
                        gridline: { visible: true }
                    },
                    valueAxis: {
                        title: { visible: true, text: "% de cobertura" },
                        scale: { fixedRange: true, minValue: 0, maxValue: 100 }
                    },
                    categoryAxis: {
                        title: { visible: false },
                        label: { visible: true }
                    }
                });
            }
        },

        onSearchSchedule: function (oEvent) {
            this.getModel("view").setProperty("/search", oEvent.getParameter("newValue"));
            this._applyScheduleFilters();
        },

        onScheduleTypeChange: function () {
            this._applyScheduleFilters();
        },

        onPeriodChange: function () {
            this._loadSchedules();
        },

        onChartSelect: function () {
            MessageToast.show("Selecciona el horario en el catálogo para consultar su configuración");
        },

        onOpenShiftDialog: function () {
            this.byId("shiftName").setValue("");
            this.byId("shiftType").setSelectedKey("Diurno");
            this.byId("primaryDays").setSelectedKeys([]);
            this.byId("shiftStart").setValue("");
            this.byId("shiftEnd").setValue("");
            this.byId("secondaryDays").setSelectedKeys([]);
            this.byId("secondaryStart").setValue("");
            this.byId("secondaryEnd").setValue("");
            this.byId("tertiaryDays").setSelectedKeys([]);
            this.byId("tertiaryStart").setValue("");
            this.byId("tertiaryEnd").setValue("");
            this.byId("shiftDialog").open();
        },

        onCloseShiftDialog: function () {
            this.byId("shiftDialog").close();
        },

        onSaveShift: function () {
            var sName = this.byId("shiftName").getValue().trim();
            var sType = this.byId("shiftType").getSelectedKey();
            var aPrimaryDays = this.byId("primaryDays").getSelectedKeys();
            var sStart = this.byId("shiftStart").getValue();
            var sEnd = this.byId("shiftEnd").getValue();
            var aSecondaryDays = this.byId("secondaryDays").getSelectedKeys();
            var sSecondaryStart = this.byId("secondaryStart").getValue();
            var sSecondaryEnd = this.byId("secondaryEnd").getValue();
            var aTertiaryDays = this.byId("tertiaryDays").getSelectedKeys();
            var sTertiaryStart = this.byId("tertiaryStart").getValue();
            var sTertiaryEnd = this.byId("tertiaryEnd").getValue();

            if (!sName || !aPrimaryDays.length || !sStart || !sEnd) {
                MessageToast.show("Captura nombre, días y horas de la regla principal");
                return;
            }
            if (aSecondaryDays.length && (!sSecondaryStart || !sSecondaryEnd)) {
                MessageToast.show("Completa las horas de la regla especial");
                return;
            }
            if (aTertiaryDays.length && (!sTertiaryStart || !sTertiaryEnd)) {
                MessageToast.show("Completa las horas de la tercera regla");
                return;
            }

            var aAllDays = aPrimaryDays.concat(aSecondaryDays, aTertiaryDays);
            var bHasRepeatedDays = aAllDays.some(function (sDay, iIndex) {
                return aAllDays.indexOf(sDay) !== iIndex;
            });
            if (bHasRepeatedDays) {
                MessageToast.show("Un día no puede aparecer en más de una regla");
                return;
            }

            var aRules = [this._createRule(aPrimaryDays, sStart, sEnd)];
            if (aSecondaryDays.length) {
                aRules.push(this._createRule(aSecondaryDays, sSecondaryStart, sSecondaryEnd));
            }
            if (aTertiaryDays.length) {
                aRules.push(this._createRule(aTertiaryDays, sTertiaryStart, sTertiaryEnd));
            }

            var oModel = this.getModel("attendance");
            var aSchedules = oModel.getProperty("/schedules") || [];
            var iNumber = aSchedules.reduce(function (iMax, oSchedule) {
                var iCurrent = parseInt(String(oSchedule.code || "").replace(/\D/g, ""), 10) || 0;
                return Math.max(iMax, iCurrent);
            }, 0) + 1;
            var sCode = "H" + String(iNumber).padStart(2, "0");
            var sDescription = aRules.map(function (oRule) {
                return this._formatDays(oRule.days) + " " + oRule.start + "–" + oRule.end + (oRule.endNextDay ? " (+1)" : "");
            }.bind(this)).join(" · ");

            aSchedules.push({
                id: "horario-" + String(iNumber).padStart(2, "0"),
                code: sCode,
                name: sName,
                type: sType,
                shortDescription: sDescription,
                description: sDescription,
                assigned: 0,
                present: 0,
                absent: 0,
                coverage: 0,
                active: true,
                rules: aRules
            });
            oModel.refresh(true);
            this._loadSchedules();
            this.onCloseShiftDialog();
            MessageToast.show("Horario creado");
        },

        _createRule: function (aDays, sStart, sEnd) {
            return {
                days: aDays,
                start: sStart,
                end: sEnd,
                endNextDay: sEnd <= sStart
            };
        },

        _formatDays: function (aDays) {
            var mDays = { MON: "Lun", TUE: "Mar", WED: "Mié", THU: "Jue", FRI: "Vie", SAT: "Sáb", SUN: "Dom" };
            return aDays.map(function (sDay) { return mDays[sDay] || sDay; }).join(", ");
        },

        onNavOverview: function () {
            this.navTo("overview");
        }
    });
});
