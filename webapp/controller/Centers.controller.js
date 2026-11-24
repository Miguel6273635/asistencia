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

    var PRESENT_STATUSES = ["Presente", "Home office", "Viaje de trabajo"];
    var INCIDENT_STATUSES = ["Retardo", "Ausente", "Incompleto"];

    function normalizedRecordStatus(oRecord) {
        var sDayStatus = String(oRecord.dayStatus || "").trim().toUpperCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        if (/HOME OFFICE|OFICINA CENTRAL/.test(sDayStatus)) { return "Home office"; }
        if (/VIAJE/.test(sDayStatus)) { return "Viaje de trabajo"; }
        if (/PRESENT/.test(sDayStatus)) { return "Presente"; }
        if (/RETAR/.test(sDayStatus)) { return "Retardo"; }
        if (/AUSEN/.test(sDayStatus)) { return "Ausente"; }
        if (/INCOMPLET/.test(sDayStatus)) { return "Incompleto"; }
        return oRecord.status || "";
    }

    function isOutsideRecord(oRecord) {
        var sGeoStatus = [
            oRecord.geoStatus,
            oRecord.geoStatusDescription,
            oRecord.geofenceStatus,
            oRecord.geofenceDescription
        ].join(" ").toUpperCase();
        return oRecord.isOutOfZone === true ||
            oRecord.status === "Fuera de zona" ||
            /OUT|FUERA(?:\s+DE)?\s+(?:ZONA|RANGO|GEOCERCA)/.test(sGeoStatus);
    }

    function isIncidentRecord(oRecord) {
        return INCIDENT_STATUSES.indexOf(normalizedRecordStatus(oRecord)) >= 0 || isOutsideRecord(oRecord);
    }

    return BaseController.extend("com.mitsu.monitorasistencia.controller.Centers", {
        formatter: formatter,

        onInit: function () {
            this._attendanceApi = new AttendanceApi();
            this.setModel(new JSONModel({
                zoneId: "all",
                search: "",
                granularity: "week",
                referenceDate: periodHelper.toKey(new Date()),
                periodLabel: "",
                periodRecords: [],
                periodRecordsLoaded: false,
                centerSummaries: [],
                loading: false,
                centers: [],
                stats: { centers: 0, users: 0, present: 0, incidents: 0 }
            }), "view");
            this.getRouter().getRoute("centers").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function (oEvent) {
            this.getModel("view").setProperty("/zoneId", oEvent.getParameter("arguments").zoneId || "all");
            this.getModel("attendance").dataLoaded().then(function () {
                this._reloadCenterData();
                this._configureChart();
            }.bind(this));
        },

        _configureChart: function () {
            var oChart = this.byId("centerRankingChart");
            if (oChart) {
                oChart.setVizProperties({
                    title: { visible: false },
                    legend: { visible: true, position: "right" },
                    plotArea: {
                        colorPalette: ["#188918", "#E9730C", "#C00000", "#7858D7"],
                        dataLabel: { visible: true, formatString: "0.0" }
                    },
                    valueAxis: { title: { visible: true, text: "% de registros" }, scale: { fixedRange: true, minValue: 0, maxValue: 100 } },
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

        _toSapPeriodType: function (oPeriod) {
            var sGranularity = this.getModel("view").getProperty("/granularity");

            if (sGranularity === "year") {
                return "AÑO " + oPeriod.start.getFullYear();
            }
            if (sGranularity === "month") {
                return "MES " + String(oPeriod.start.getMonth() + 1).padStart(2, "0");
            }
            return "SEMANA " + this._isoWeek(oPeriod.end);
        },

        _reloadCenterData: function () {
            var oViewModel = this.getModel("view");
            var oPeriod = this._getPeriod();
            var sSapPeriod = this._toSapPeriodType(oPeriod);
            var iRequest = (this._centerRequest || 0) + 1;
            var aErrors = [];
            var aHistoryFilters = [
                { field: "DateFrom", value: this._formatODataDate(oPeriod.start) },
                { field: "DateTo", value: this._formatODataDate(oPeriod.end) }
            ];
            var aSummaryFilters = [{ field: "PeriodType", value: sSapPeriod }];

            this._centerRequest = iRequest;
            oViewModel.setProperty("/loading", true);
            this.getView().setBusy(true);

            return Promise.all([
                this._attendanceApi.getAttendanceHistory(aHistoryFilters).catch(function (oError) {
                    aErrors.push(oError);
                    return [];
                }),
                this._attendanceApi.getCollection("CenterOfficeSummarySet", {
                    filters: aSummaryFilters
                }).catch(function (oError) {
                    aErrors.push(oError);
                    return [];
                })
            ]).then(function (aResults) {
                var aSchedules;
                var aMappedRecords;
                var aPeriodRecords;
                var aSummaries;

                if (iRequest !== this._centerRequest) { return; }
                aSchedules = this.getModel("attendance").getProperty("/schedules") || [];
                aMappedRecords = MonitorData.mapAttendanceRecords(aResults[0], aSchedules);
                aPeriodRecords = periodHelper.filterRecords(aMappedRecords, oPeriod);
                aSummaries = aResults[1].filter(function (oRow) {
                    var sReturnedPeriod = String(oRow.PeriodType || "").trim().toUpperCase();
                    return !sReturnedPeriod || sReturnedPeriod === sSapPeriod.toUpperCase();
                });

                oViewModel.setProperty("/periodRecords", aPeriodRecords);
                oViewModel.setProperty("/periodRecordsLoaded", true);
                oViewModel.setProperty("/centerSummaries", aSummaries);
                this._applyFilters();

                if (aErrors.length && !aPeriodRecords.length && !aSummaries.length) {
                    MessageToast.show("SAP no devolvió información para el periodo seleccionado");
                }
            }.bind(this)).catch(function (oError) {
                MessageToast.show(
                    "No fue posible preparar la información de los centros: " +
                    (oError.message || String(oError))
                );
            }).finally(function () {
                if (iRequest === this._centerRequest) {
                    oViewModel.setProperty("/loading", false);
                    this.getView().setBusy(false);
                }
            }.bind(this));
        },

        _getEnrichedRecords: function (oPeriod) {
            var oAttendanceModel = this.getModel("attendance");
            var aEmployees = oAttendanceModel.getProperty("/employees") || [];
            var aCenters = oAttendanceModel.getProperty("/centers") || [];
            var mEmployees = {};
            var mCentersByName = {};
            aEmployees.forEach(function (oEmployee) { mEmployees[oEmployee.id] = oEmployee; });
            aCenters.forEach(function (oCenter) { mCentersByName[String(oCenter.name || "").toLowerCase()] = oCenter; });

            var aFacts = this.getModel("view").getProperty("/periodRecordsLoaded") ?
                (this.getModel("view").getProperty("/periodRecords") || []) :
                (oAttendanceModel.getProperty("/records") || []).concat(
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
            var mSummaries = (oViewModel.getProperty("/centerSummaries") || [])
                .reduce(function (mResult, oRow) {
                    var sCode = String(oRow.CenterCode || "").trim().toLowerCase();
                    var sName = String(oRow.CenterOffice || "").trim().toLowerCase();
                    if (sCode) { mResult[sCode] = oRow; }
                    if (sName) { mResult[sName] = oRow; }
                    return mResult;
                }, {});
            var aFilteredCenters = aMasterCenters.filter(function (oCenter) {
                var bZoneMatch = sZoneId === "all" || oCenter.zoneId === sZoneId;
                var bSearchMatch = !sSearch || String(oCenter.name || "").toLowerCase().includes(sSearch) || String(oCenter.code || "").toLowerCase().includes(sSearch);
                return bZoneMatch && bSearchMatch;
            }).map(function (oCenter) {
                var aCenterRecords = aRecords.filter(function (oRecord) { return oRecord.centerId === oCenter.id; });
                var oSummary = mSummaries[String(oCenter.code || "").toLowerCase()] ||
                    mSummaries[String(oCenter.name || "").toLowerCase()] || {};
                var bHasRecords = aCenterRecords.length > 0;
                var iPresent = bHasRecords ? this._countStatuses(aCenterRecords, PRESENT_STATUSES) : this._number(oSummary.PresentCount);
                var iLate = bHasRecords ? this._countStatuses(aCenterRecords, ["Retardo"]) : this._number(oSummary.LateCount);
                var iAbsent = bHasRecords ? this._countStatuses(aCenterRecords, ["Ausente"]) : this._number(oSummary.AbsenceCount);
                var iOutside = bHasRecords ? aCenterRecords.filter(isOutsideRecord).length : this._number(oSummary.OutOfZoneCount);
                var iIncidents = bHasRecords ? aCenterRecords.filter(isIncidentRecord).length :
                    (this._number(oSummary.IncidentCount) || iLate + iAbsent + iOutside);
                var iUsers = bHasRecords ? new Set(aCenterRecords.map(function (oRecord) { return oRecord.employeeId; }).filter(Boolean)).size : this._number(oSummary.UsersCount);
                var iRecords = bHasRecords ? aCenterRecords.length : this._number(oSummary.EvaluatedCount);
                var iRateBase = iRecords || iUsers;
                var nAttendance = bHasRecords ? Number((iPresent * 100 / iRecords).toFixed(1)) :
                    this._number(oSummary.AttendancePct);
                return Object.assign({}, oCenter, {
                    users: iUsers,
                    records: iRecords,
                    present: iPresent,
                    late: iLate,
                    absent: iAbsent,
                    outside: iOutside,
                    incidents: iIncidents,
                    attendance: nAttendance,
                    lateRate: iRateBase ? Number((iLate * 100 / iRateBase).toFixed(1)) : 0,
                    absentRate: iRateBase ? Number((iAbsent * 100 / iRateBase).toFixed(1)) : 0,
                    outsideRate: iRateBase ? Number((iOutside * 100 / iRateBase).toFixed(1)) : 0
                });
            }.bind(this));
            var oStats = aFilteredCenters.reduce(function (oResult, oCenter) {
                oResult.centers += oCenter.records > 0 ? 1 : 0;
                oResult.users += Number(oCenter.users) || 0;
                oResult.present += Number(oCenter.present) || 0;
                oResult.incidents += Number(oCenter.incidents) || 0;
                return oResult;
            }, { centers: 0, users: 0, present: 0, incidents: 0 });

            oViewModel.setProperty("/centers", aFilteredCenters);
            oViewModel.setProperty("/stats", oStats);
        },

        _countStatuses: function (aRecords, aStatuses) {
            return aRecords.filter(function (oRecord) {
                return aStatuses.indexOf(normalizedRecordStatus(oRecord)) >= 0;
            }).length;
        },

        onFilterChange: function (oEvent) {
            this.getModel("view").setProperty("/zoneId", oEvent.getSource().getSelectedKey());
            this._applyFilters();
        },

        onPeriodChange: function () { this._reloadCenterData(); },

        onSearch: function (oEvent) {
            this.getModel("view").setProperty("/search", oEvent.getParameter("newValue"));
            this._applyFilters();
        },

        onCenterPress: function (oEvent) {
            var oListItem = oEvent.getParameter("listItem");
            var oContext = oListItem && oListItem.getBindingContext("view");
            var oCenter = oContext && oContext.getObject();

            if (oCenter && oCenter.id) {
                this._navigateToCenter(oCenter);
            }
        },

        onCenterChartSelect: function (oEvent) {
            var aSelected = oEvent.getParameter("data") || [];
            var sCenterName = aSelected[0] && aSelected[0].data &&
                aSelected[0].data.Centro;
            var oCenter = (this.getModel("view").getProperty("/centers") || [])
                .find(function (oItem) {
                    return oItem.name === sCenterName;
                });

            if (oCenter && oCenter.id) {
                this._navigateToCenter(oCenter);
            }
        },

        _navigateToCenter: function (oCenter) {
            var oViewModel = this.getModel("view");

            this.getModel("attendance").setProperty("/centerNavigationContext", {
                centerId: oCenter.id,
                center: Object.assign({}, oCenter),
                periodType: oViewModel.getProperty("/granularity") || "week",
                referenceDate: oViewModel.getProperty("/referenceDate")
            });
            this.navTo("center", { centerId: oCenter.id });
        },

        onNavOverview: function () { this.navTo("overview"); }
    });
});
