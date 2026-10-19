sap.ui.define([], function () {
  "use strict";

  var EVENT_CODES = {
    CHECK_IN: "P10",
    MEAL_START: "P15",
    MEAL_END: "P25",
    CHECK_OUT: "P20"
  };

  function createRequestId() {
    return "ATT-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  return {
    eventCode: function (action) {
      return EVENT_CODES[action];
    },

    mark: function (action, position) {
      var payload = {
        requestId: createRequestId(),
        action: action,
        eventCode: EVENT_CODES[action],
        deviceTimestamp: new Date().toISOString(),
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy
      };

      // Datos de prueba. Sustituir por POST /api/attendance/events al conectar SAP.
      return Promise.resolve({
        success: true,
        payload: payload,
        registeredAt: new Date()
      });
    }
  };
});
