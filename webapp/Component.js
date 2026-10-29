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

            var attendance = this.getModel("attendance");
            attendance.setData(MonitorData.emptyMonitorData());
            attendance.setProperty("/serviceState/loading", true);

            this.reloadAttendanceData().finally(function () {
                this.getRouter().initialize();
            }.bind(this));
        },

        // Se admite el periodo escogido por Overview.
        // ATENCION: MonitorData.ts aún debe aceptar ReferenceDate y validar PeriodType con SAP.
        reloadAttendanceData: function (periodType, referenceDate) {
            var attendance = this.getModel("attendance");
            attendance.setProperty("/serviceState/loading", true);

            return MonitorData.loadMonitorData(periodType || "SEMANA 43", referenceDate).then(function (result) {
                attendance.setData(result.data);
                if (result.errors && result.errors.length) {
                    console.warn("Algunos EntitySet no pudieron cargarse", result.errors);
                }
                return result;
            }).catch(function (error) {
                console.error("No fue posible cargar el Monitor desde SAP", error);
                attendance.setData(MonitorData.emptyMonitorData(error.message || String(error)));
                throw error;
            });
        }
    });
});
