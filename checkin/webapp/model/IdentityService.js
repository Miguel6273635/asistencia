sap.ui.define([], function () {
  "use strict";

  // Identidad fija para las pruebas actuales.
  var TEST_IDENTITY = Object.freeze({
    personalNumber: "00004281",
    email: "",
    device: "BTP-Web"
  });

  // Esta variable se llenará con los datos entregados por el login de BTP.
  var authenticatedIdentity = {
    personalNumber: "",
    email: "",
    device: "BTP-Web"
  };

  var useTestIdentity = true;

  return {
    getActiveIdentity: function () {
      return useTestIdentity ? Object.assign({}, TEST_IDENTITY) : Object.assign({}, authenticatedIdentity);
    },

    setAuthenticatedIdentity: function (identity) {
      authenticatedIdentity = Object.assign({}, authenticatedIdentity, identity || {});
      useTestIdentity = false;
    },

    useTestIdentity: function () {
      useTestIdentity = true;
    },

    isTestMode: function () {
      return useTestIdentity;
    }
  };
});
