sap.ui.define([], function () {
  "use strict";

  // Identidad temporal. Más adelante se llenará directamente con el login de BTP.
  var activeIdentity = {
    personalNumber: "",
    email: "",
    device: "BTP-Web"
  };

  return {
    getActiveIdentity: function () {
      return Object.assign({}, activeIdentity);
    },

    setAuthenticatedIdentity: function (identity) {
      activeIdentity = Object.assign({
        personalNumber: "",
        email: "",
        device: "BTP-Web"
      }, identity || {});
    },

    clearIdentity: function () {
      activeIdentity = {
        personalNumber: "",
        email: "",
        device: "BTP-Web"
      };
    },

    hasActiveIdentity: function () {
      return Boolean(activeIdentity.personalNumber || activeIdentity.email);
    }
  };
});
