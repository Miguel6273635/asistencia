sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "com/mitsu/monitorasistencia/model/formatter",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast"
], function (BaseController, formatter, JSONModel, MessageToast) {
    "use strict";

    return BaseController.extend("com.mitsu.monitorasistencia.controller.Center", {
        formatter: formatter,

        onInit: function () {
            this.setModel(new JSONModel({
                center: {},
                allRecords: [],
                employees: [],
                periodType: "week",
                referenceDate: "2026-08-31",
                rangeStart: null,
                rangeEnd: null,
                rangeLabel: "",
                scheduleId: "",
                status: "all",
                search: "",
                stats: {
                    users: 0,
                    records: 0,
                    attendancePercentage: "0,0",
                    attendanceDescription: "0 de 0 jornadas con asistencia",
                    punctualityPercentage: "0,0",
                    punctualityDescription: "0 de 0 asistencias a tiempo",
                    incidentPercentage: "0,0",
                    incidentDescription: "0 de 0 registros con incidencia"
                },
                scheduleStats: [],
                dailyTrend: [],
                layout: {
                    scheduleChartHeight: "10rem",
                    statusChartHeight: "10rem"
                }
            }), "view");
            this._updatePeriodRange();
            this.getRouter().getRoute("center").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function (oEvent) {
            this._centerId = oEvent.getParameter("arguments").centerId;
            this.getModel("attendance").dataLoaded().then(function () {
                this._loadCenter();
                this._configureCharts();
            }.bind(this));
        },

        _loadCenter: function () {
            var oAttendanceModel = this.getModel("attendance");
            var aCenters = oAttendanceModel.getProperty("/centers") || [];
            var aEmployees = oAttendanceModel.getProperty("/employees") || [];
            var aSchedules = oAttendanceModel.getProperty("/schedules") || [];
            var aRecords = (oAttendanceModel.getProperty("/records") || [])
                .concat(oAttendanceModel.getProperty("/userPerformanceHistory") || []);
            var oCenter = aCenters.find(function (oItem) {
                return oItem.id === this._centerId;
            }.bind(this));

            if (!oCenter) {
                this.navTo("centers", { zoneId: "all" });
                return;
            }

            var mEmployees = aEmployees.reduce(function (mResult, oEmployee) {
                mResult[oEmployee.id] = oEmployee;
                return mResult;
            }, {});
            var mSchedules = aSchedules.reduce(function (mResult, oSchedule, iIndex) {
                mResult[oSchedule.id] = Object.assign({ catalogIndex: iIndex }, oSchedule);
                return mResult;
            }, {});
            var sCenterName = (oCenter.name || "").toLowerCase();
            var aCenterRecords = aRecords.filter(function (oRecord) {
                var oEmployee = mEmployees[oRecord.employeeId] || {};
                return oRecord.centerId === oCenter.id ||
                    oEmployee.centerId === oCenter.id ||
                    (oRecord.center || "").toLowerCase() === sCenterName;
            }).map(function (oRecord) {
                var oEmployee = mEmployees[oRecord.employeeId] || {};
                var sScheduleId = oRecord.scheduleId || oEmployee.scheduleId || "";
                var oSchedule = mSchedules[sScheduleId] || {};
                var aLocationOptionalStatuses = ["Viaje de trabajo", "Vacaciones", "Paternidad", "Home office"];
                var bLocationOptional = aLocationOptionalStatuses.indexOf(oRecord.status) !== -1;
                var bOutsideZone = !bLocationOptional &&
                    typeof oRecord.distanceMeters === "number" &&
                    oRecord.distanceMeters > 2;

                return Object.assign({}, oRecord, {
                    recordDate: this._parseRecordDate(oRecord.workDate || oRecord.dateISO || oRecord.date),
                    employeeId: oRecord.employeeId || oEmployee.id,
                    employee: oRecord.employee || oEmployee.name || "Colaborador sin identificar",
                    number: oEmployee.number || oRecord.employeeId || "—",
                    role: oEmployee.role || "Colaborador",
                    centerId: oCenter.id,
                    zoneId: oCenter.zoneId,
                    scheduleId: sScheduleId,
                    scheduleName: oSchedule.name || oEmployee.scheduleName || "Sin horario asignado",
                    scheduleDescription: oSchedule.shortDescription || oSchedule.description || oRecord.scheduled || "Pendiente de asignación",
                    status: bOutsideZone ? "Fuera de zona" : oRecord.status,
                    entry: oRecord.entry || "—",
                    exit: oRecord.exit || "—",
                    hours: oRecord.hours || "0:00"
                });
            }.bind(this));
            var oViewModel = this.getModel("view");

            oViewModel.setProperty("/center", oCenter);
            oViewModel.setProperty("/allRecords", aCenterRecords);
            oViewModel.setProperty("/scheduleId", "");
            oViewModel.setProperty("/status", "all");
            oViewModel.setProperty("/search", "");
            this._updatePeriodRange();
            this._applyFilters();
        },

        _applyFilters: function () {
            var oViewModel = this.getModel("view");
            var sScheduleId = oViewModel.getProperty("/scheduleId");
            var sStatus = oViewModel.getProperty("/status");
            var sSearch = (oViewModel.getProperty("/search") || "").toLowerCase();
            var dRangeStart = oViewModel.getProperty("/rangeStart");
            var dRangeEnd = oViewModel.getProperty("/rangeEnd");
            var aRecords = oViewModel.getProperty("/allRecords") || [];
            var aFiltered = aRecords.filter(function (oRecord) {
                var dRecord = oRecord.recordDate;
                var bDateMatch = dRecord instanceof Date && !isNaN(dRecord.getTime()) &&
                    dRecord >= dRangeStart && dRecord <= dRangeEnd;
                var bSearchMatch = !sSearch ||
                    (oRecord.employee || "").toLowerCase().includes(sSearch) ||
                    (oRecord.number || "").toLowerCase().includes(sSearch);

                return bDateMatch &&
                    (!sScheduleId || oRecord.scheduleId === sScheduleId) &&
                    (sStatus === "all" || oRecord.status === sStatus) &&
                    bSearchMatch;
            });
            var mUsers = {};
            var oCounts = aFiltered.reduce(function (oResult, oRecord) {
                if (oRecord.employeeId) {
                    mUsers[oRecord.employeeId] = true;
                }
                if (oRecord.status === "Presente") {
                    oResult.present += 1;
                } else if (oRecord.status === "Retardo") {
                    oResult.late += 1;
                } else if (oRecord.status === "Ausente") {
                    oResult.absent += 1;
                }
                if (oRecord.status === "Fuera de zona") {
                    oResult.outside += 1;
                }
                return oResult;
            }, { present: 0, late: 0, absent: 0, outside: 0 });
            var aEligible = aFiltered.filter(function (oRecord) {
                return ["Vacaciones", "Paternidad"].indexOf(oRecord.status) === -1;
            });
            var aAttended = aEligible.filter(function (oRecord) {
                return oRecord.entry && oRecord.entry !== "—";
            });
            var aOnTime = aAttended.filter(function (oRecord) {
                return oRecord.status !== "Retardo";
            });
            var iIncidents = oCounts.late + oCounts.absent + oCounts.outside;
            var oStats = {
                users: Object.keys(mUsers).length,
                records: aFiltered.length,
                attendancePercentage: this._percentage(aAttended.length, aEligible.length),
                attendanceDescription: aAttended.length + " de " + aEligible.length + " jornadas con asistencia",
                punctualityPercentage: this._percentage(aOnTime.length, aAttended.length),
                punctualityDescription: aOnTime.length + " de " + aAttended.length + " asistencias a tiempo",
                incidentPercentage: this._percentage(iIncidents, aFiltered.length),
                incidentDescription: iIncidents + " de " + aFiltered.length + " registros con incidencia"
            };

            oViewModel.setProperty("/employees", aFiltered);
            oViewModel.setProperty("/stats", oStats);
            this._buildChartData(aFiltered);
        },

        _percentage: function (iNumerator, iDenominator) {
            return (iDenominator ? iNumerator * 100 / iDenominator : 0).toFixed(1).replace(".", ",");
        },

        _buildChartData: function (aRecords) {
            var aSchedules = this.getModel("attendance").getProperty("/schedules") || [];
            var mSchedules = aSchedules.reduce(function (mResult, oSchedule, iIndex) {
                mResult[oSchedule.id] = Object.assign({ catalogIndex: iIndex }, oSchedule);
                return mResult;
            }, {});
            var mStats = {};
            var mDailyTrend = {};

            aRecords.forEach(function (oRecord) {
                var sGroupKey = oRecord.scheduleId || "unassigned";
                var oSchedule = mSchedules[oRecord.scheduleId] || {};

                if (!mStats[sGroupKey]) {
                    mStats[sGroupKey] = {
                        scheduleId: oRecord.scheduleId || "",
                        scheduleLabel: oSchedule.code || oSchedule.name || oRecord.scheduleName || "Sin horario",
                        scheduleName: oSchedule.name || oRecord.scheduleName || "Sin horario asignado",
                        present: 0,
                        late: 0,
                        absent: 0,
                        other: 0,
                        total: 0,
                        order: oSchedule.catalogIndex !== undefined ? oSchedule.catalogIndex : Number.MAX_SAFE_INTEGER
                    };
                }

                mStats[sGroupKey].total += 1;
                if (oRecord.status === "Presente") {
                    mStats[sGroupKey].present += 1;
                } else if (oRecord.status === "Retardo") {
                    mStats[sGroupKey].late += 1;
                } else if (oRecord.status === "Ausente") {
                    mStats[sGroupKey].absent += 1;
                } else {
                    mStats[sGroupKey].other += 1;
                }

                var sDateKey = this._formatDate(oRecord.recordDate);
                if (!mDailyTrend[sDateKey]) {
                    mDailyTrend[sDateKey] = {
                        date: sDateKey.substring(0, 5),
                        order: oRecord.recordDate.getTime(),
                        late: 0,
                        absent: 0,
                        outside: 0
                    };
                }
                if (oRecord.status === "Retardo") {
                    mDailyTrend[sDateKey].late += 1;
                } else if (oRecord.status === "Ausente") {
                    mDailyTrend[sDateKey].absent += 1;
                } else if (oRecord.status === "Fuera de zona") {
                    mDailyTrend[sDateKey].outside += 1;
                }
            }.bind(this));

            var aScheduleStats = Object.keys(mStats).map(function (sKey) {
                var oItem = mStats[sKey];
                oItem.presentPercentage = Number((oItem.present * 100 / oItem.total).toFixed(1));
                oItem.latePercentage = Number((oItem.late * 100 / oItem.total).toFixed(1));
                oItem.absentPercentage = Number((oItem.absent * 100 / oItem.total).toFixed(1));
                oItem.otherPercentage = Number((oItem.other * 100 / oItem.total).toFixed(1));
                oItem.detail = oItem.total + (oItem.total === 1 ? " registro evaluado" : " registros evaluados");
                return oItem;
            }).sort(function (oFirst, oSecond) {
                return oFirst.order - oSecond.order;
            });
            var aDailyTrend = Object.keys(mDailyTrend).map(function (sKey) {
                return mDailyTrend[sKey];
            }).sort(function (a, b) {
                return a.order - b.order;
            });
            var nSharedChartHeight = Math.max(10, Math.min(14,
                7.5 + Math.max(aScheduleStats.length * 1.1, aDailyTrend.length * 0.55)));
            var sChartHeight = nSharedChartHeight.toFixed(1) + "rem";
            var oViewModel = this.getModel("view");

            oViewModel.setProperty("/scheduleStats", aScheduleStats);
            oViewModel.setProperty("/dailyTrend", aDailyTrend);
            oViewModel.setProperty("/layout/scheduleChartHeight", sChartHeight);
            oViewModel.setProperty("/layout/statusChartHeight", sChartHeight);
        },

        _updatePeriodRange: function () {
            var oViewModel = this.getModel("view");
            var dReference = oViewModel.getProperty("/referenceDate");
            var sPeriodType = oViewModel.getProperty("/periodType") || "week";
            var oRange = this._getPeriodRange(dReference, sPeriodType);

            oViewModel.setProperty("/rangeStart", oRange.start);
            oViewModel.setProperty("/rangeEnd", oRange.end);
            oViewModel.setProperty("/rangeLabel", this._formatDate(oRange.start) + " – " + this._formatDate(oRange.end));
        },

        _getPeriodRange: function (dReference, sPeriodType) {
            var dParsedReference = this._parseRecordDate(dReference);
            var dSafeReference = !isNaN(dParsedReference.getTime()) ? dParsedReference : new Date(2026, 7, 31);
            var dStart = new Date(dSafeReference.getFullYear(), dSafeReference.getMonth(), dSafeReference.getDate());
            var dEnd;

            if (sPeriodType === "year") {
                dStart = new Date(dSafeReference.getFullYear(), 0, 1);
                dEnd = new Date(dSafeReference.getFullYear(), 11, 31);
            } else if (sPeriodType === "month") {
                dStart = new Date(dSafeReference.getFullYear(), dSafeReference.getMonth(), 1);
                dEnd = new Date(dSafeReference.getFullYear(), dSafeReference.getMonth() + 1, 0);
            } else {
                var iDay = dStart.getDay();
                var iOffsetToMonday = iDay === 0 ? -6 : 1 - iDay;
                dStart.setDate(dStart.getDate() + iOffsetToMonday);
                dEnd = new Date(dStart.getFullYear(), dStart.getMonth(), dStart.getDate() + 6);
            }

            dStart.setHours(0, 0, 0, 0);
            dEnd.setHours(23, 59, 59, 999);
            return { start: dStart, end: dEnd };
        },

        _parseRecordDate: function (vDate) {
            if (vDate instanceof Date) {
                return new Date(vDate.getFullYear(), vDate.getMonth(), vDate.getDate());
            }

            var sDate = String(vDate || "").trim();
            var aIsoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(sDate);
            var aDisplayMatch = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(sDate);

            if (aIsoMatch) {
                return new Date(Number(aIsoMatch[1]), Number(aIsoMatch[2]) - 1, Number(aIsoMatch[3]));
            }
            if (aDisplayMatch) {
                return new Date(Number(aDisplayMatch[3]), Number(aDisplayMatch[2]) - 1, Number(aDisplayMatch[1]));
            }
            return new Date(NaN);
        },

        _formatDate: function (dDate) {
            var sDay = String(dDate.getDate()).padStart(2, "0");
            var sMonth = String(dDate.getMonth() + 1).padStart(2, "0");
            return sDay + "/" + sMonth + "/" + dDate.getFullYear();
        },

        _configureCharts: function () {
            var oScheduleChart = this.byId("scheduleChart");
            var oTrendChart = this.byId("centerTrendChart");
            var oScheduleProperties = {
                title: { visible: false },
                legend: { visible: true, position: "bottom" },
                plotArea: {
                    colorPalette: ["#188918", "#E9730C", "#BB0000", "#6A7F92"],
                    dataLabel: { visible: true, formatString: "0.0" },
                    gridline: { visible: true }
                },
                valueAxis: {
                    title: { visible: true, text: "% de registros" },
                    scale: { fixedRange: true, minValue: 0, maxValue: 100 }
                },
                categoryAxis: { title: { visible: false } }
            };

            if (oScheduleChart) {
                oScheduleChart.setVizProperties(oScheduleProperties);
            }
            if (oTrendChart) {
                oTrendChart.setVizProperties({
                    title: { visible: false },
                    legend: { visible: true, position: "bottom" },
                    plotArea: {
                        colorPalette: ["#E9730C", "#BB0000", "#7858D7"],
                        dataLabel: { visible: true },
                        gridline: { visible: true }
                    },
                    valueAxis: { title: { visible: false }, scale: { minValue: 0 } },
                    categoryAxis: { title: { visible: false } }
                });
            }
        },

        onPeriodChange: function (oEvent) {
            this.getModel("view").setProperty("/periodType", oEvent.getSource().getSelectedKey());
            this._updatePeriodRange();
            this._applyFilters();
        },

        onReferenceDateChange: function (oEvent) {
            var sReference = oEvent.getParameter("value") || oEvent.getSource().getValue();
            var dReference = this._parseRecordDate(sReference);
            if (isNaN(dReference.getTime())) {
                return;
            }
            this.getModel("view").setProperty("/referenceDate", sReference);
            this._updatePeriodRange();
            this._applyFilters();
        },

        onFilterChange: function () {
            this._applyFilters();
        },

        onSearch: function (oEvent) {
            this.getModel("view").setProperty("/search", oEvent.getParameter("newValue"));
            this._applyFilters();
        },

        onEmployeePress: function (oEvent) {
            var oRecord = oEvent.getParameter("listItem").getBindingContext("view").getObject();
            if (oRecord.employeeId) {
                this.navTo("records", { employeeId: oRecord.employeeId });
            }
        },

        onOpenUserPerformance: function (oEvent) {
            var oRecord = oEvent.getSource().getBindingContext("view").getObject();
            if (oRecord.employeeId) {
                this.navTo("userPerformance", { employeeId: oRecord.employeeId });
            }
        },

        onNavOverview: function () {
            this.navTo("overview");
        },

        onNavZone: function () {
            this.navTo("centers", { zoneId: this.getModel("view").getProperty("/center/zoneId") });
        },

        onGoToUsers: function () {
            this.navTo("users");
        },

        onExport: function () {
            MessageToast.show("Aquí se conectará la exportación a Excel");
        }
    });
});
