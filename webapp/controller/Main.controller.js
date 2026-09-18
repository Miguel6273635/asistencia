sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "sap/ui/model/json/JSONModel"
], function (BaseController, JSONModel) {
    "use strict";

    return BaseController.extend("com.mitsu.monitorasistencia.controller.Main", {
        onInit: function () {
            var bRunningInLaunchpad = typeof sap !== "undefined" && sap.ushell && sap.ushell.Container;

            this.setModel(new JSONModel({
                sideExpanded: true,
                showAppHeader: !bRunningInLaunchpad
            }), "ui");

            this.getRouter().attachRouteMatched(this._onRouteMatched, this);
        },

        onToggleSideNavigation: function () {
            var oUiModel = this.getModel("ui");
            oUiModel.setProperty("/sideExpanded", !oUiModel.getProperty("/sideExpanded"));
        },

        onNavigationItemSelect: function (oEvent) {
            var sKey = oEvent.getParameter("item").getKey();
            var mRoutes = {
                overview: ["overview", {}],
                shifts: ["shifts", {}],
                records: ["records", { employeeId: "all" }],
                map: ["map", {}],
                users: ["users", {}],
                centers: ["centers", { zoneId: "all" }],
                settings: ["settings", {}]
            };

            if (sKey === "toggleMenu") {
                this.onToggleSideNavigation();
                setTimeout(function () {
                    this.byId("navigationList").setSelectedKey(this._sSelectedKey === "settings" ? "" : this._sSelectedKey);
                    this.byId("fixedNavigationList").setSelectedKey(this._sSelectedKey === "settings" ? "settings" : "");
                }.bind(this), 0);
                return;
            }

            if (mRoutes[sKey]) {
                this.navTo(mRoutes[sKey][0], mRoutes[sKey][1]);
            }
        },

        _onRouteMatched: function (oEvent) {
            var sRouteName = oEvent.getParameter("name");
            var mSelectedKeys = {
                overview: "overview",
                shifts: "shifts",
                records: "records",
                map: "map",
                mapZone: "map",
                mapUser: "map",
                users: "users",
                userPerformance: "users",
                centers: "centers",
                center: "centers",
                settings: "settings"
            };

            var sSelectedKey = mSelectedKeys[sRouteName] || "overview";
            this._sSelectedKey = sSelectedKey;
            this.byId("navigationList").setSelectedKey(sSelectedKey === "settings" ? "" : sSelectedKey);
            this.byId("fixedNavigationList").setSelectedKey(sSelectedKey === "settings" ? "settings" : "");
        }
    });
});
