/*  sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "com/mitsu/monitorasistencia/model/formatter",
    "com/mitsu/monitorasistencia/model/periodHelper",
    "sap/ui/model/json/JSONModel"
], function (BaseController, formatter, periodHelper, JSONModel) {
    "use strict";

    var PRESENT_STATUSES = ["Presente", "Home office", "Viaje de trabajo"];
    var INCIDENT_STATUSES = ["Retardo", "Ausente", "Fuera de zona", "Incompleto"];

    return BaseController.extend("com.mitsu.monitorasistencia.controller.Centers", {
        formatter: formatter,

        onInit: function () {
            this.setModel(new JSONModel({
                zoneId: "all",
                search: "",
                granularity: "week",
                referenceDate: periodHelper.toKey(new Date()),
                periodLabel: "",
                centers: [],
                stats: { centers: 0, users: 0, present: 0, incidents: 0 }
            }), "view");
            this.getRouter().getRoute("centers").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function (oEvent) {
            this.getModel("view").setProperty("/zoneId", oEvent.getParameter("arguments").zoneId || "all");
            this.getModel("attendance").dataLoaded().then(function () {
                this._applyFilters();
                this._configureChart();
            }.bind(this));
        },

        _configureChart: function () {
            var oChart = this.byId("centerRankingChart");
            if (oChart) {
                oChart.setVizProperties({
                    title: { visible: false },
                    legend: { visible: false },
                    plotArea: { colorPalette: ["#0A6ED1"], dataLabel: { visible: true } },
                    valueAxis: { title: { visible: true, text: "% de asistencia" }, scale: { fixedRange: true, minValue: 0, maxValue: 100 } },
                    categoryAxis: { title: { visible: false } }
                });
            }
        },

        _getPeriod: function () {
            var oViewModel = this.getModel("view");
            var oPeriod = periodHelper.getPeriod(oViewModel.getProperty("/granularity"), oViewModel.getProperty("/referenceDate"));
            oViewModel.setProperty("/periodLabel", oPeriod.label);
            return oPeriod;
        },

        _getEnrichedRecords: function (oPeriod) {
            var oAttendanceModel = this.getModel("attendance");
            var aEmployees = oAttendanceModel.getProperty("/employees") || [];
            var aCenters = oAttendanceModel.getProperty("/centers") || [];
            var mEmployees = {};
            var mCentersByName = {};
            aEmployees.forEach(function (oEmployee) { mEmployees[oEmployee.id] = oEmployee; });
            aCenters.forEach(function (oCenter) { mCentersByName[String(oCenter.name || "").toLowerCase()] = oCenter; });

            var aFacts = (oAttendanceModel.getProperty("/records") || []).concat(
                oAttendanceModel.getProperty("/userPerformanceHistory") || []
            );

            return periodHelper.filterRecords(aFacts, oPeriod).map(function (oRecord) {
                var oEmployee = mEmployees[oRecord.employeeId] || {};
                var oCenter = mCentersByName[String(oRecord.center || "").toLowerCase()] || {};
                return Object.assign({}, oRecord, {
                    employeeId: oRecord.employeeId || oEmployee.id,
                    centerId: oEmployee.centerId || oCenter.id || ""
                });
            });
        },

        _applyFilters: function () {
            var oViewModel = this.getModel("view");
            var sZoneId = oViewModel.getProperty("/zoneId");
            var sSearch = (oViewModel.getProperty("/search") || "").toLowerCase();
            var aMasterCenters = this.getModel("attendance").getProperty("/centers") || [];
            var aRecords = this._getEnrichedRecords(this._getPeriod());
            var aFilteredCenters = aMasterCenters.filter(function (oCenter) {
                var bZoneMatch = sZoneId === "all" || oCenter.zoneId === sZoneId;
                var bSearchMatch = !sSearch || String(oCenter.name || "").toLowerCase().includes(sSearch) || String(oCenter.code || "").toLowerCase().includes(sSearch);
                return bZoneMatch && bSearchMatch;
            }).map(function (oCenter) {
                var aCenterRecords = aRecords.filter(function (oRecord) { return oRecord.centerId === oCenter.id; });
                var iPresent = this._countStatuses(aCenterRecords, PRESENT_STATUSES);
                var iLate = this._countStatuses(aCenterRecords, ["Retardo"]);
                var iAbsent = this._countStatuses(aCenterRecords, ["Ausente"]);
                var iIncidents = this._countStatuses(aCenterRecords, INCIDENT_STATUSES);
                var iUsers = new Set(aCenterRecords.map(function (oRecord) { return oRecord.employeeId; }).filter(Boolean)).size;
                return Object.assign({}, oCenter, {
                    users: iUsers,
                    records: aCenterRecords.length,
                    present: iPresent,
                    late: iLate,
                    absent: iAbsent,
                    incidents: iIncidents,
                    attendance: aCenterRecords.length ? Number((iPresent * 100 / aCenterRecords.length).toFixed(1)) : 0
                });
            }.bind(this));
            var aVisibleCenterIds = aFilteredCenters.map(function (oCenter) { return oCenter.id; });
            var aVisibleRecords = aRecords.filter(function (oRecord) { return aVisibleCenterIds.indexOf(oRecord.centerId) >= 0; });
            var oStats = {
                centers: aFilteredCenters.filter(function (oCenter) { return oCenter.records > 0; }).length,
                users: new Set(aVisibleRecords.map(function (oRecord) { return oRecord.employeeId; }).filter(Boolean)).size,
                present: this._countStatuses(aVisibleRecords, PRESENT_STATUSES),
                incidents: this._countStatuses(aVisibleRecords, INCIDENT_STATUSES)
            };
            if (this.getModel("attendance").getProperty("/serviceState/live") && !aVisibleRecords.length) {
                oStats = aFilteredCenters.reduce(function (oResult, oCenter) {
                    oResult.centers += oCenter.records > 0 ? 1 : 0;
                    oResult.users += Number(oCenter.users) || 0;
                    oResult.present += Number(oCenter.present) || 0;
                    oResult.incidents += Number(oCenter.incidents) || Number(oCenter.late) + Number(oCenter.absent) + Number(oCenter.outside) || 0;
                    return oResult;
                }, { centers: 0, users: 0, present: 0, incidents: 0 });
            }

            oViewModel.setProperty("/centers", aFilteredCenters);
            oViewModel.setProperty("/stats", oStats);
            console.groupCollapsed("[Monitor][FILTERS][Centros][APPLY]");
            console.info({ zoneId: sZoneId, search: sSearch, period: this._getPeriod(), sourceRows: aMasterCenters.length, resultRows: aFilteredCenters.length });
            console.groupEnd();
        },

        _countStatuses: function (aRecords, aStatuses) {
            return aRecords.filter(function (oRecord) { return aStatuses.indexOf(oRecord.status) >= 0; }).length;
        },

        onFilterChange: function (oEvent) {
            this.getModel("view").setProperty("/zoneId", oEvent.getSource().getSelectedKey());
            this._applyFilters();
        },

        onPeriodChange: function () { this._applyFilters(); },

        onSearch: function (oEvent) {
            this.getModel("view").setProperty("/search", oEvent.getParameter("newValue"));
            this._applyFilters();
        },

        onNavOverview: function () { this.navTo("overview"); }
    });
});
 
 */

/* global Promise */
/* global Promise */
/* global Promise */
sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "com/mitsu/monitorasistencia/model/formatter",
    "com/mitsu/monitorasistencia/model/periodHelper",
    "com/mitsu/monitorasistencia/model/AttendanceApi",
    "com/mitsu/monitorasistencia/model/MonitorData",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast"
], function (BaseController, formatter, periodHelper, AttendanceApi, MonitorData, JSONModel, MessageToast) {
    "use strict";

    return BaseController.extend("com.mitsu.monitorasistencia.controller.Center", {
        formatter: formatter,

        onInit: function () {
            var sToday = periodHelper.toKey(new Date());

            this._attendanceApi = new AttendanceApi();
            this.setModel(new JSONModel({
                center: {},
                allRecords: [],
                employees: [],
                loading: false,
                dataSource: "",
                periodType: "week",
                referenceDate: sToday,
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
            var oAttendanceModel = this.getModel("attendance");
            var oNavigationContext = oAttendanceModel.getProperty("/centerNavigationContext") || {};
            var sRouteCenterId = decodeURIComponent(
                oEvent.getParameter("arguments").centerId || ""
            );
            var aCenters = oAttendanceModel.getProperty("/centers") || [];
            var pDataReady;

            this._centerId = sRouteCenterId;
            if (oNavigationContext.centerId === sRouteCenterId) {
                this.getModel("view").setProperty(
                    "/periodType",
                    oNavigationContext.periodType || "week"
                );
                this.getModel("view").setProperty(
                    "/referenceDate",
                    oNavigationContext.referenceDate || periodHelper.toKey(new Date())
                );
                this._updatePeriodRange();
            }

            pDataReady = aCenters.length ? Promise.resolve() :
                this.getOwnerComponent().reloadAttendanceData();
            pDataReady.then(function () {
                if (this._loadCenter()) {
                    this._reloadCenterData();
                }
                this._configureCharts();
            }.bind(this));
        },

        _loadCenter: function () {
            var oAttendanceModel = this.getModel("attendance");
            var aCenters = oAttendanceModel.getProperty("/centers") || [];
            var aRecords = (oAttendanceModel.getProperty("/records") || [])
                .concat(oAttendanceModel.getProperty("/userPerformanceHistory") || []);
            var oNavigationContext = oAttendanceModel.getProperty("/centerNavigationContext") || {};
            var sCenterKey = String(this._centerId || "").toLowerCase();
            var oCenter = aCenters.find(function (oItem) {
                return [oItem.id, oItem.code, oItem.name].some(function (vValue) {
                    return String(vValue || "").toLowerCase() === sCenterKey;
                });
            }) || (
                oNavigationContext.centerId === this._centerId &&
                oNavigationContext.center
            );

            if (!oCenter) {
                this.navTo("centers", { zoneId: "all" });
                return false;
            }

            this.getModel("view").setProperty("/center", oCenter);
            this._setCenterRecords(aRecords, oCenter, true);
            return true;
        },

        _setCenterRecords: function (aRecords, oCenter, bResetFilters) {
            var oAttendanceModel = this.getModel("attendance");
            var aEmployees = oAttendanceModel.getProperty("/employees") || [];
            var aSchedules = oAttendanceModel.getProperty("/schedules") || [];
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
            if (bResetFilters) {
                oViewModel.setProperty("/scheduleId", "");
                oViewModel.setProperty("/status", "all");
                oViewModel.setProperty("/search", "");
            }
            this._updatePeriodRange();
            this._applyFilters();
        },

        _formatODataDate: function (oDate) {
            return oDate.getFullYear() +
                String(oDate.getMonth() + 1).padStart(2, "0") +
                String(oDate.getDate()).padStart(2, "0");
        },

        _number: function (vValue) {
            var nValue = Number(String(vValue === undefined || vValue === null ? "" : vValue)
                .trim().replace(",", "."));
            return Number.isFinite(nValue) ? nValue : 0;
        },

        _isoWeek: function (oDate) {
            var oUtcDate = new Date(Date.UTC(
                oDate.getFullYear(),
                oDate.getMonth(),
                oDate.getDate()
            ));
            var iDay = oUtcDate.getUTCDay() || 7;
            var oYearStart;

            oUtcDate.setUTCDate(oUtcDate.getUTCDate() + 4 - iDay);
            oYearStart = new Date(Date.UTC(oUtcDate.getUTCFullYear(), 0, 1));
            return Math.ceil((((oUtcDate - oYearStart) / 86400000) + 1) / 7);
        },

        _toSapPeriodType: function (oRange) {
            var sPeriodType = this.getModel("view").getProperty("/periodType");

            if (sPeriodType === "year") {
                return "AÑO " + oRange.start.getFullYear();
            }
            if (sPeriodType === "month") {
                return "MES " + String(oRange.start.getMonth() + 1).padStart(2, "0");
            }
            return "SEMANA " + this._isoWeek(oRange.end);
        },

        _matchesCenterRow: function (oRow, oCenter) {
            var sRowCode = String(oRow.CenterCode || "").trim().toLowerCase();
            var sRowName = String(oRow.CenterOffice || "").trim().toLowerCase();
            var sCenterCode = String(oCenter.code || oCenter.id || "").trim().toLowerCase();
            var sCenterName = String(oCenter.name || "").trim().toLowerCase();

            return (!sRowCode && !sRowName) ||
                sRowCode === sCenterCode || sRowName === sCenterName;
        },

        _reloadCenterData: function () {
            var oViewModel = this.getModel("view");
            var oCenter = oViewModel.getProperty("/center") || {};
            var oRange = {
                start: oViewModel.getProperty("/rangeStart"),
                end: oViewModel.getProperty("/rangeEnd")
            };
            var sSapPeriod = this._toSapPeriodType(oRange);
            var iRequest = (this._detailRequest || 0) + 1;
            var aErrors = [];
            var bHistoryFailed = false;
            var aHistoryFilters = [
                { field: "DateFrom", value: this._formatODataDate(oRange.start) },
                { field: "DateTo", value: this._formatODataDate(oRange.end) }
            ];
            var aCenterFilters = [{ field: "PeriodType", value: sSapPeriod }];

            this._detailRequest = iRequest;
            oViewModel.setProperty("/loading", true);
            this.getView().setBusy(true);

            return Promise.all([
                this._attendanceApi.getAttendanceHistory(aHistoryFilters).catch(function (oError) {
                    bHistoryFailed = true;
                    aErrors.push(oError);
                    return [];
                }),
                this._attendanceApi.getCenterSnapshot(sSapPeriod, "").catch(function (oError) {
                    aErrors.push(oError);
                    return {
                        indicators: [],
                        scheduleDistribution: [],
                        incidentTrend: [],
                        schedules: []
                    };
                }),
                this._attendanceApi.getCollection("CenterOfficeSummarySet", {
                    filters: aCenterFilters
                }).catch(function (oError) {
                    aErrors.push(oError);
                    return [];
                })
            ]).then(function (aResults) {
                var aSchedules;
                var aMappedRecords;
                var aInRangeRecords;
                var oSnapshot = aResults[1];
                var oSummary;

                if (iRequest !== this._detailRequest) { return; }
                aSchedules = this.getModel("attendance").getProperty("/schedules") || [];
                aMappedRecords = MonitorData.mapAttendanceRecords(aResults[0], aSchedules);
                aInRangeRecords = periodHelper.filterRecords(aMappedRecords, oRange);

                if (!bHistoryFailed) {
                    this._setCenterRecords(aInRangeRecords, oCenter, false);
                    oViewModel.setProperty("/dataSource", "AttendanceHistorySet");
                }

                oSummary = aResults[2].find(function (oRow) {
                    var sReturnedPeriod = String(oRow.PeriodType || "").trim().toUpperCase();
                    return this._matchesCenterRow(oRow, oCenter) &&
                        (!sReturnedPeriod || sReturnedPeriod === sSapPeriod.toUpperCase());
                }.bind(this));
                if (oSummary && !oViewModel.getProperty("/stats/records")) {
                    this._applyCenterSummary(oSummary);
                    oViewModel.setProperty("/dataSource", "CenterOfficeSummarySet");
                }
                this._applySnapshotAnalytics(oSnapshot, oCenter);

                if (aErrors.length && !aInRangeRecords.length && !oSummary) {
                    MessageToast.show("SAP no devolvió detalle para este centro y periodo");
                }
            }.bind(this)).catch(function (oError) {
                MessageToast.show(
                    "No fue posible preparar la información del centro: " +
                    (oError.message || String(oError))
                );
            }).finally(function () {
                if (iRequest === this._detailRequest) {
                    oViewModel.setProperty("/loading", false);
                    this.getView().setBusy(false);
                }
            }.bind(this));
        },

        _applyCenterSummary: function (oSummary) {
            var oViewModel = this.getModel("view");
            var iUsers = this._number(oSummary.UsersCount);
            var iRecords = this._number(oSummary.EvaluatedCount);
            var iPresent = this._number(oSummary.PresentCount);
            var iLate = this._number(oSummary.LateCount);
            var iAbsent = this._number(oSummary.AbsenceCount);
            var iOutside = this._number(oSummary.OutOfZoneCount);
            var iIncidents = this._number(oSummary.IncidentCount) ||
                iLate + iAbsent + iOutside;
            var iOnTime = Math.max(iPresent - iLate, 0);

            oViewModel.setProperty("/stats", {
                users: iUsers,
                records: iRecords,
                attendancePercentage: this._percentage(iPresent, iRecords),
                attendanceDescription: iPresent + " de " + iRecords + " jornadas con asistencia",
                punctualityPercentage: this._percentage(iOnTime, iPresent),
                punctualityDescription: iOnTime + " de " + iPresent + " asistencias a tiempo",
                incidentPercentage: this._percentage(iIncidents, iRecords),
                incidentDescription: iIncidents + " de " + iRecords + " registros con incidencia"
            });
        },

        _applySnapshotAnalytics: function (oSnapshot, oCenter) {
            var aScheduleStats = (oSnapshot.scheduleDistribution || [])
                .filter(function (oRow) {
                    return this._matchesCenterRow(oRow, oCenter);
                }.bind(this)).map(function (oRow, iIndex) {
                    var iTotal = this._number(oRow.TotalCount);
                    var iPresent = this._number(oRow.PresentCount);
                    var iLate = this._number(oRow.LateCount);
                    var iAbsent = this._number(oRow.AbsenceCount);
                    var iOutside = this._number(oRow.OutOfZoneCount);
                    var iOther = this._number(oRow.OtherCount);
                    return {
                        scheduleId: String(oRow.ScheduleCode || oRow.Schedule || ""),
                        scheduleLabel: String(oRow.Schedule || oRow.ScheduleCode || "Sin horario"),
                        scheduleName: String(oRow.ScheduleDescription || oRow.Schedule || "Sin horario asignado"),
                        presentPercentage: iTotal ? Number((iPresent * 100 / iTotal).toFixed(1)) : 0,
                        latePercentage: iTotal ? Number((iLate * 100 / iTotal).toFixed(1)) : 0,
                        absentPercentage: iTotal ? Number((iAbsent * 100 / iTotal).toFixed(1)) : 0,
                        outsidePercentage: iTotal ? Number((iOutside * 100 / iTotal).toFixed(1)) : 0,
                        otherPercentage: iTotal ? Number((iOther * 100 / iTotal).toFixed(1)) : 0,
                        total: iTotal,
                        order: iIndex,
                        detail: iTotal + (iTotal === 1 ? " registro evaluado" : " registros evaluados")
                    };
                }.bind(this));
            var aDailyTrend = (oSnapshot.incidentTrend || [])
                .filter(function (oRow) {
                    return this._matchesCenterRow(oRow, oCenter);
                }.bind(this)).map(function (oRow) {
                    var oDate = periodHelper.parseDate(
                        oRow.TrendDate || oRow.ReferenceDate || oRow.DateFrom
                    );
                    return oDate ? {
                        date: this._formatDate(oDate).substring(0, 5),
                        order: oDate.getTime(),
                        late: this._number(oRow.LateCount),
                        absent: this._number(oRow.AbsenceCount),
                        outside: this._number(oRow.OutOfZoneCount)
                    } : null;
                }.bind(this)).filter(Boolean).sort(function (oFirst, oSecond) {
                    return oFirst.order - oSecond.order;
                });

            if (aScheduleStats.length && !(this.getModel("view").getProperty("/allRecords") || []).length) {
                this.getModel("view").setProperty("/scheduleStats", aScheduleStats);
            }
            if (aDailyTrend.length) {
                this.getModel("view").setProperty("/dailyTrend", aDailyTrend);
            }
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
                        outside: 0,
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
                } else if (oRecord.status === "Fuera de zona") {
                    mStats[sGroupKey].outside += 1;
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
                oItem.outsidePercentage = Number((oItem.outside * 100 / oItem.total).toFixed(1));
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
            var oPeriod = periodHelper.getPeriod(sPeriodType, dReference);
            var dStart = new Date(oPeriod.start.getTime());
            var dEnd = new Date(oPeriod.end.getTime());

            dStart.setHours(0, 0, 0, 0);
            dEnd.setHours(23, 59, 59, 999);
            return { start: dStart, end: dEnd };
        },

        _parseRecordDate: function (vDate) {
            return periodHelper.parseDate(vDate) || new Date(NaN);
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
                    colorPalette: ["#188918", "#E9730C", "#BB0000", "#7858D7", "#6A7F92"],
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
            this._reloadCenterData();
        },

        onReferenceDateChange: function (oEvent) {
            var sReference = oEvent.getParameter("value") || oEvent.getSource().getValue();
            var dReference = this._parseRecordDate(sReference);
            if (isNaN(dReference.getTime())) {
                return;
            }
            this.getModel("view").setProperty("/referenceDate", sReference);
            this._updatePeriodRange();
            this._reloadCenterData();
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
