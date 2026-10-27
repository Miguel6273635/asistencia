sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "com/mitsu/monitorasistencia/model/formatter",
    "com/mitsu/monitorasistencia/model/periodHelper",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast"
], function (BaseController, formatter, periodHelper, JSONModel, MessageToast) {
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
                referenceDate: "2026-10-25",
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
                if (oCenter.source === "sap") {
                    return Object.assign({}, oCenter, {
                        records: oCenter.evaluated || oCenter.users || 0
                    });
                }
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
            if (this.getModel("attendance").getProperty("/serviceState/live")) {
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

        onCenterPress: function (oEvent) {
            var oCenter = oEvent.getParameter("listItem").getBindingContext("view").getObject();
            this.navTo("center", { centerId: oCenter.id });
        },

        onCenterChartSelect: function (oEvent) {
            var aSelected = oEvent.getParameter("data") || [];
            var sCenterName = aSelected[0] && aSelected[0].data && aSelected[0].data.Centro;
            var oCenter = (this.getModel("view").getProperty("/centers") || []).find(function (oItem) { return oItem.name === sCenterName; });
            if (oCenter) { this.navTo("center", { centerId: oCenter.id }); }
        },

        onToggleCenterStatus: function () {
            MessageToast.show("CenterOfficeSummarySet está disponible sólo para consulta; SAP aún no expone el alta o baja de centros.");
        },

        onOpenCenterDialog: function () {
            MessageToast.show("SAP aún no expone un servicio para crear centros; la pantalla permanece en modo consulta.");
        },

        onCloseCenterDialog: function () { this.byId("centerDialog").close(); },

        onSaveCenter: function () {
            MessageToast.show("No se enviaron cambios: falta el endpoint de mantenimiento de centros en SAP.");
        },

        onNavOverview: function () { this.navTo("overview"); }
    });
});
