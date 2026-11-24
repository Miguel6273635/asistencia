sap.ui.define([], function () {
  "use strict";

  // sap.app.id de checkin con "/" en lugar de "."
  var APP_MODULE_PATH = "com/mitsu/checkin";
  var DEFAULT_SERVICE_PATH = "sap/opu/odata/sap/ZHMC_ATTENDANCE_MONITORING_SRV/";

  /**
   * Carpeta desde donde UI5 cargó la app (NO window.location):
   * - Work Zone:  /<guid>.mitsucheckin.commitsucheckin/~<hash>~/
   * - HTML5 Apps: /mitsu.checkin.commitsucheckin-0.1.31/
   * - BAS local:  /
   */
  function appRoot() {
    var toUrl = sap.ui.require && sap.ui.require.toUrl;
    if (typeof toUrl !== "function") {
      return "/";
    }
    return new URL(sap.ui.require.toUrl(APP_MODULE_PATH) + "/", document.baseURI).pathname;
  }

  return {
    /**
     * Convierte cualquier service root ("/sap/opu/...", "sap/opu/...",
     * "/cp.portal/sap/opu/...", vacío) en uno relativo a esta app, para que la
     * petición pase por el xs-app.json de checkin.
     */
    resolve: function (serviceRoot) {
      var root = String(serviceRoot || "").trim();
      var index = root.indexOf("sap/opu/odata/");
      var servicePath = index >= 0 ? root.slice(index) : DEFAULT_SERVICE_PATH;
      return appRoot() + servicePath.replace(/\/?$/, "/");
    }
  };
});