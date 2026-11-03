sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/Device",
    "com/mitsu/monitorasistencia/model/models",
    "com/mitsu/monitorasistencia/model/MonitorData"
], function (UIComponent, Device, models, MonitorData) {
    "use strict";

    return UIComponent.extend("com.mitsu.monitorasistencia.Component", {
        metadata: {
            manifest: "json",
            interfaces: ["sap.ui.core.IAsyncContentCreation"]
        },

        init: function () {
            UIComponent.prototype.init.apply(this, arguments);
            this.setModel(models.createDeviceModel(), "device");
            var oAttendanceModel = this.getModel("attendance");
            oAttendanceModel.setData(MonitorData.emptyMonitorData());
            oAttendanceModel.setProperty("/serviceState/loading", true);

            this.reloadAttendanceData().finally(function () {
                this.getRouter().initialize();
            }.bind(this));
        },

        reloadAttendanceData: function () {
            var oAttendanceModel = this.getModel("attendance");
            oAttendanceModel.setProperty("/serviceState/loading", true);
            return MonitorData.loadMonitorData("SEMANA 43").then(function (oResult) {
                oAttendanceModel.setData(oResult.data);
                if (oResult.errors.length) {
                    console.warn("Algunos EntitySet no pudieron cargarse", oResult.errors);
                }
            }).catch(function (oError) {
                console.error("No fue posible cargar el Monitor desde SAP", oError);
                oAttendanceModel.setData(MonitorData.emptyMonitorData(oError.message || String(oError)));
            });
        }
    });
});
