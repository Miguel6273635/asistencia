sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "sap/m/MessageToast"
], function (BaseController, MessageToast) {
    "use strict";

    return BaseController.extend("com.mitsu.monitorasistencia.controller.Settings", {
        onSave: function () {
            MessageToast.show("Configuración guardada localmente");
        },

        onReset: function () {
            this.getModel("attendance").setProperty("/configuration", {
                lateTolerance: 10,
                earlyEntry: 20,
                automaticAbsence: "10:00",
                refreshMinutes: 5
            });
            MessageToast.show("Valores restablecidos");
        },

        onNavOverview: function () {
            this.navTo("overview");
        }
    });
});
