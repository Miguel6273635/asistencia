sap.ui.define([
  "sap/ui/core/UIComponent",
 "sap/ui/model/json/JSONModel",
  "./model/Diagnostics"
], function (UIComponent, JSONModel, Diagnostics) {
  "use strict";

  return UIComponent.extend("com.mitsu.checkin.Component", {
    metadata: { manifest: "json" },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);

        var dataSource = this.getManifestEntry("/sap.app/dataSources/attendanceOData") || {};
      Diagnostics.info("BOOT", "Aplicación Checkin iniciada", {
        applicationVersion: this.getManifestEntry("/sap.app/applicationVersion/version"),
        serviceRoot: dataSource.uri,
        href: window.location.href,
        origin: window.location.origin,
        pathname: window.location.pathname
      });
      
      this.setModel(new JSONModel({
        busy: false,
        employeeLoading: false,
        employeeSource: "none",
        employeeError: "",
        requiresIdentity: true,
        identityInput: "",
        identityLookupError: "",
        historyLoading: false,
        historyError: ""
      }), "app");
    }
  });
});
