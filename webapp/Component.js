sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/Device",
    "com/mitsu/monitorasistencia/model/models"
], function (UIComponent, Device, models) {
    "use strict";

    return UIComponent.extend("com.mitsu.monitorasistencia.Component", {
        metadata: {
            manifest: "json",
            interfaces: ["sap.ui.core.IAsyncContentCreation"]
        },

        init: function () {
            UIComponent.prototype.init.apply(this, arguments);
            this.setModel(models.createDeviceModel(), "device");
            this.getRouter().initialize();
        }
    });
});
