/* sap.ui.define([

    "com/mitsu/monitorasistencia/controller/BaseController",
    "sap/ui/model/json/JSONModel"
], function (BaseController, JSONModel) {
    "use strict";

    return BaseController.extend("com.mitsu.monitorasistencia.controller.Main", {
        onInit: function () {
            var bRunningInLaunchpad = typeof sap !== "undefined" && sap.ushell && sap.ushell.Container;

            this.setModel(new JSONModel({
                sideExpanded: true,
                showAppHeader: !bRunningInLaunchpad,
                showGlobalClock: true,
                clockWeekday: "",
                clockDate: "",
                clockTime: "--:--",
                clockSeconds: "--",
                clockZone: "América/Mexico_City"
            }), "ui");

            this.getRouter().attachRouteMatched(this._onRouteMatched, this);
            this._updateClock();
            this._iClockTimer = setInterval(this._updateClock.bind(this), 1000);
        },

        onExit: function () {
            if (this._iClockTimer) {
                clearInterval(this._iClockTimer);
                this._iClockTimer = null;
            }

            this.getRouter().detachRouteMatched(this._onRouteMatched, this);
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
            var bIsJustificationDetail = sRouteName === "lateJustifications" ||
                sRouteName === "earlyExitJustifications";
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
                settings: "settings"
            };

            var sSelectedKey = mSelectedKeys[sRouteName] || "overview";
            this._sSelectedKey = sSelectedKey;
            this.getModel("ui").setProperty("/showGlobalClock", !bIsJustificationDetail);
            this.byId("navigationList").setSelectedKey(sSelectedKey === "settings" ? "" : sSelectedKey);
            this.byId("fixedNavigationList").setSelectedKey(sSelectedKey === "settings" ? "settings" : "");
        },

        _updateClock: function () {
            var oUiModel = this.getModel("ui");
            var oNow = new Date();
            var sTimeZone = "America/Mexico_City";
            var sWeekday;
            var sDate;
            var aTimeParts;
            var mTimeParts = {};

            if (!oUiModel) {
                return;
            }

            sWeekday = new Intl.DateTimeFormat("es-MX", {
                weekday: "long",
                timeZone: sTimeZone
            }).format(oNow);

            sDate = new Intl.DateTimeFormat("es-MX", {
                day: "2-digit",
                month: "long",
                year: "numeric",
                timeZone: sTimeZone
            }).format(oNow);

            aTimeParts = new Intl.DateTimeFormat("es-MX", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
                timeZone: sTimeZone
            }).formatToParts(oNow);

            aTimeParts.forEach(function (oPart) {
                mTimeParts[oPart.type] = oPart.value;
            });

            oUiModel.setProperty("/clockWeekday", this._capitalize(sWeekday));
            oUiModel.setProperty("/clockDate", sDate);
            oUiModel.setProperty("/clockTime", (mTimeParts.hour || "00") + ":" + (mTimeParts.minute || "00"));
            oUiModel.setProperty("/clockSeconds", mTimeParts.second || "00");
        },

        _capitalize: function (sValue) {
            return sValue ? sValue.charAt(0).toUpperCase() + sValue.slice(1) : "";
        }
    });
});
 */
/* 
sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/Device"
], function (BaseController, JSONModel, Device) {
    "use strict";

    return BaseController.extend("com.mitsu.monitorasistencia.controller.Main", {
        onInit: function () {
            var bRunningInLaunchpad = typeof sap !== "undefined" && sap.ushell && sap.ushell.Container;

            this.setModel(new JSONModel({
                sideExpanded: !Device.system.phone && Device.resize.width >= 1280,
                showAppHeader: !bRunningInLaunchpad,
                showGlobalClock: true,
                clockWeekday: "",
                clockDate: "",
                clockTime: "--:--",
                clockSeconds: "--",
                clockZone: "América/Mexico_City"
            }), "ui");

            this.getRouter().attachRouteMatched(this._onRouteMatched, this);
            this._fnDeviceResize = this._onDeviceResize.bind(this);
            Device.resize.attachHandler(this._fnDeviceResize);
            this._updateClock();
            this._iClockTimer = setInterval(this._updateClock.bind(this), 1000);
        },

        onExit: function () {
            if (this._iClockTimer) {
                clearInterval(this._iClockTimer);
                this._iClockTimer = null;
            }

            this.getRouter().detachRouteMatched(this._onRouteMatched, this);
            if (this._fnDeviceResize) {
                Device.resize.detachHandler(this._fnDeviceResize);
                this._fnDeviceResize = null;
            }
        },

        _onDeviceResize: function (oEvent) {
            if (oEvent.width < 1280 && this.getModel("ui").getProperty("/sideExpanded")) {
                this.getModel("ui").setProperty("/sideExpanded", false);
            }
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
            var bIsJustificationDetail = sRouteName === "lateJustifications" ||
                sRouteName === "earlyExitJustifications";
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
                settings: "settings"
            };

            var sSelectedKey = mSelectedKeys[sRouteName] || "overview";
            this._sSelectedKey = sSelectedKey;
            this.getModel("ui").setProperty("/showGlobalClock", !bIsJustificationDetail);
            this.byId("navigationList").setSelectedKey(sSelectedKey === "settings" ? "" : sSelectedKey);
            this.byId("fixedNavigationList").setSelectedKey(sSelectedKey === "settings" ? "settings" : "");
        },

        _updateClock: function () {
            var oUiModel = this.getModel("ui");
            var oNow = new Date();
            var sTimeZone = "America/Mexico_City";
            var sWeekday;
            var sDate;
            var aTimeParts;
            var mTimeParts = {};

            if (!oUiModel) {
                return;
            }

            sWeekday = new Intl.DateTimeFormat("es-MX", {
                weekday: "long",
                timeZone: sTimeZone
            }).format(oNow);

            sDate = new Intl.DateTimeFormat("es-MX", {
                day: "2-digit",
                month: "long",
                year: "numeric",
                timeZone: sTimeZone
            }).format(oNow);

            aTimeParts = new Intl.DateTimeFormat("es-MX", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
                timeZone: sTimeZone
            }).formatToParts(oNow);

            aTimeParts.forEach(function (oPart) {
                mTimeParts[oPart.type] = oPart.value;
            });

            oUiModel.setProperty("/clockWeekday", this._capitalize(sWeekday));
            oUiModel.setProperty("/clockDate", sDate);
            oUiModel.setProperty("/clockTime", (mTimeParts.hour || "00") + ":" + (mTimeParts.minute || "00"));
            oUiModel.setProperty("/clockSeconds", mTimeParts.second || "00");
        },

        _capitalize: function (sValue) {
            return sValue ? sValue.charAt(0).toUpperCase() + sValue.slice(1) : "";
        }
    });
});
 *//* 
sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "sap/ui/model/json/JSONModel"
], function (BaseController, JSONModel) {
    "use strict";

    return BaseController.extend("com.mitsu.monitorasistencia.controller.Main", {
        onInit: function () {
            var bRunningInLaunchpad = typeof sap !== "undefined" && sap.ushell && sap.ushell.Container;

            this.setModel(new JSONModel({
                sideExpanded: false,
                showAppHeader: !bRunningInLaunchpad,
                showGlobalClock: true,
                clockWeekday: "",
                clockDate: "",
                clockTime: "--:--",
                clockSeconds: "--",
                clockZone: "América/Mexico_City"
            }), "ui");

            this.getRouter().attachRouteMatched(this._onRouteMatched, this);
            this._updateClock();
            this._iClockTimer = setInterval(this._updateClock.bind(this), 1000);
        },

        onExit: function () {
            if (this._iClockTimer) {
                clearInterval(this._iClockTimer);
                this._iClockTimer = null;
            }

            this.getRouter().detachRouteMatched(this._onRouteMatched, this);
        },

        onToggleSideNavigation: function () {
            this.getModel("ui").setProperty("/sideExpanded", false);
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
            var bIsJustificationDetail = sRouteName === "lateJustifications" ||
                sRouteName === "earlyExitJustifications";
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
                settings: "settings"
            };

            var sSelectedKey = mSelectedKeys[sRouteName] || "overview";
            this._sSelectedKey = sSelectedKey;
            this.getModel("ui").setProperty("/showGlobalClock", !bIsJustificationDetail);
            this.byId("navigationList").setSelectedKey(sSelectedKey === "settings" ? "" : sSelectedKey);
            this.byId("fixedNavigationList").setSelectedKey(sSelectedKey === "settings" ? "settings" : "");
        },

        _updateClock: function () {
            var oUiModel = this.getModel("ui");
            var oNow = new Date();
            var sTimeZone = "America/Mexico_City";
            var sWeekday;
            var sDate;
            var aTimeParts;
            var mTimeParts = {};

            if (!oUiModel) {
                return;
            }

            sWeekday = new Intl.DateTimeFormat("es-MX", {
                weekday: "long",
                timeZone: sTimeZone
            }).format(oNow);

            sDate = new Intl.DateTimeFormat("es-MX", {
                day: "2-digit",
                month: "long",
                year: "numeric",
                timeZone: sTimeZone
            }).format(oNow);

            aTimeParts = new Intl.DateTimeFormat("es-MX", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
                timeZone: sTimeZone
            }).formatToParts(oNow);

            aTimeParts.forEach(function (oPart) {
                mTimeParts[oPart.type] = oPart.value;
            });

            oUiModel.setProperty("/clockWeekday", this._capitalize(sWeekday));
            oUiModel.setProperty("/clockDate", sDate);
            oUiModel.setProperty("/clockTime", (mTimeParts.hour || "00") + ":" + (mTimeParts.minute || "00"));
            oUiModel.setProperty("/clockSeconds", mTimeParts.second || "00");
        },

        _capitalize: function (sValue) {
            return sValue ? sValue.charAt(0).toUpperCase() + sValue.slice(1) : "";
        }
    });
});

 */
sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "sap/ui/model/json/JSONModel"
], function (BaseController, JSONModel) {
    "use strict";

    return BaseController.extend("com.mitsu.monitorasistencia.controller.Main", {
        onInit: function () {
            var bRunningInLaunchpad = typeof sap !== "undefined" && sap.ushell && sap.ushell.Container;

            this.setModel(new JSONModel({
                sideExpanded: false,
                showAppHeader: !bRunningInLaunchpad,
                showGlobalClock: true,
                clockWeekday: "",
                clockDate: "",
                clockTime: "--:--",
                clockSeconds: "--",
                clockZone: "América/Mexico_City"
            }), "ui");

            this.getRouter().attachRouteMatched(this._onRouteMatched, this);
            this._updateClock();
            this._iClockTimer = setInterval(this._updateClock.bind(this), 1000);
        },

        onExit: function () {
            if (this._iClockTimer) {
                clearInterval(this._iClockTimer);
                this._iClockTimer = null;
            }

            this.getRouter().detachRouteMatched(this._onRouteMatched, this);
        },

        onToggleSideNavigation: function () {
            var oUiModel = this.getModel("ui");
            var bExpanded = !oUiModel.getProperty("/sideExpanded");

            oUiModel.setProperty("/sideExpanded", bExpanded);
            this.byId("toolPage").setSideExpanded(bExpanded);
            this.byId("sideNavigation").setExpanded(bExpanded);
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
            var bIsJustificationDetail = sRouteName === "lateJustifications" ||
                 sRouteName === "earlyExitJustifications" ||
                sRouteName === "fourthLateJustifications" ||
                sRouteName === "noAttendance";
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
                settings: "settings"
            };

            var sSelectedKey = mSelectedKeys[sRouteName] || "overview";
            this._sSelectedKey = sSelectedKey;
            this.getModel("ui").setProperty("/showGlobalClock", !bIsJustificationDetail);
            this.byId("navigationList").setSelectedKey(sSelectedKey === "settings" ? "" : sSelectedKey);
            this.byId("fixedNavigationList").setSelectedKey(sSelectedKey === "settings" ? "settings" : "");
        },

        _updateClock: function () {
            var oUiModel = this.getModel("ui");
            var oNow = new Date();
            var sTimeZone = "America/Mexico_City";
            var sWeekday;
            var sDate;
            var aTimeParts;
            var mTimeParts = {};

            if (!oUiModel) {
                return;
            }

            sWeekday = new Intl.DateTimeFormat("es-MX", {
                weekday: "long",
                timeZone: sTimeZone
            }).format(oNow);

            sDate = new Intl.DateTimeFormat("es-MX", {
                day: "2-digit",
                month: "long",
                year: "numeric",
                timeZone: sTimeZone
            }).format(oNow);

            aTimeParts = new Intl.DateTimeFormat("es-MX", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
                timeZone: sTimeZone
            }).formatToParts(oNow);

            aTimeParts.forEach(function (oPart) {
                mTimeParts[oPart.type] = oPart.value;
            });

            oUiModel.setProperty("/clockWeekday", this._capitalize(sWeekday));
            oUiModel.setProperty("/clockDate", sDate);
            oUiModel.setProperty("/clockTime", (mTimeParts.hour || "00") + ":" + (mTimeParts.minute || "00"));
            oUiModel.setProperty("/clockSeconds", mTimeParts.second || "00");
        },

        _capitalize: function (sValue) {
            return sValue ? sValue.charAt(0).toUpperCase() + sValue.slice(1) : "";
        }
    });
});
