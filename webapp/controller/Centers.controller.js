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
                referenceDate: "2026-08-31",
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

        onToggleCenterStatus: function (oEvent) {
            var oViewCenter = oEvent.getSource().getBindingContext("view").getObject();
            var aCenters = this.getModel("attendance").getProperty("/centers") || [];
            var oCenter = aCenters.find(function (oItem) { return oItem.id === oViewCenter.id; });
            if (!oCenter) { return; }
            oCenter.active = !oCenter.active;
            this.getModel("attendance").refresh(true);
            this._applyFilters();
            MessageToast.show(oCenter.name + (oCenter.active ? " fue activado" : " fue dado de baja"));
        },

        onOpenCenterDialog: function () {
            this.byId("newCenterName").setValue("");
            this.byId("newCenterCode").setValue("");
            this.byId("newCenterLocation").setValue("");
            this.byId("newCenterZone").setSelectedKey("norte");
            this.byId("centerDialog").open();
        },

        onCloseCenterDialog: function () { this.byId("centerDialog").close(); },

        onSaveCenter: function () {
            var sName = this.byId("newCenterName").getValue().trim();
            var sCode = this.byId("newCenterCode").getValue().trim();
            var sZoneId = this.byId("newCenterZone").getSelectedKey();
            var sLocation = this.byId("newCenterLocation").getValue().trim();
            if (!sName || !sCode || !sZoneId || sZoneId === "all") {
                MessageToast.show("Captura nombre, código y zona");
                return;
            }

            var oAttendanceModel = this.getModel("attendance");
            var oZone = (oAttendanceModel.getProperty("/zones") || []).find(function (oItem) { return oItem.id === sZoneId; });
            var aCenters = oAttendanceModel.getProperty("/centers") || [];
            aCenters.push({
                id: sName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-"),
                name: sName,
                code: sCode.toUpperCase(),
                zoneId: sZoneId,
                zone: oZone.name,
                users: 0,
                present: 0,
                late: 0,
                absent: 0,
                attendance: 0,
                active: true,
                location: sLocation
            });
            oAttendanceModel.refresh(true);
            this.onCloseCenterDialog();
            this._applyFilters();
            MessageToast.show("Centro de trabajo creado");
        },

        onNavOverview: function () { this.navTo("overview"); }
    });
});
