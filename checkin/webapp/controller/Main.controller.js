sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageBox",
  "sap/m/MessageToast",
  "../model/AttendanceService"
], function (Controller, MessageBox, MessageToast, AttendanceService) {
  "use strict";

  var ACTION_CONFIG = {
    CHECK_IN: { title: "Registrar entrada", next: "MEAL_START", field: "entry" },
    MEAL_START: { title: "Iniciar comida", next: "MEAL_END", field: "mealStart" },
    MEAL_END: { title: "Finalizar comida", next: "CHECK_OUT", field: "mealEnd" },
    CHECK_OUT: { title: "Registrar salida", next: null, field: "exit" }
  };

  return Controller.extend("com.mitsu.checkin.controller.Main", {
    onInit: function () {
      this._updateActionUI();
    },

    onPrimaryAction: function () {
      var model = this.getView().getModel("attendance");
      var action = model.getProperty("/today/nextAction");
      var config = ACTION_CONFIG[action];
      if (!config) {
        MessageToast.show("La jornada ya está finalizada");
        return;
      }

      MessageBox.confirm(config.title + " usando tu ubicación actual?", {
        title: "Confirmar marcaje",
        emphasizedAction: MessageBox.Action.OK,
        onClose: function (result) {
          if (result === MessageBox.Action.OK) {
            this._requestLocationAndMark(action);
          }
        }.bind(this)
      });
    },

    _requestLocationAndMark: function (action) {
      var appModel = this.getView().getModel("app");
      appModel.setProperty("/busy", true);

      if (!navigator.geolocation) {
        appModel.setProperty("/busy", false);
        MessageBox.error("Este dispositivo no permite obtener la ubicación.");
        return;
      }

      navigator.geolocation.getCurrentPosition(
        function (position) { this._register(action, position); }.bind(this),
        function () {
          appModel.setProperty("/busy", false);
          MessageBox.error("Activa el permiso de ubicación para realizar el marcaje.");
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
      );
    },

    _register: function (action, position) {
      AttendanceService.mark(action, position).then(function (result) {
        var model = this.getView().getModel("attendance");
        var config = ACTION_CONFIG[action];
        var time = result.registeredAt.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
        model.setProperty("/today/" + config.field, time);
        model.setProperty("/today/nextAction", config.next);
        model.setProperty("/today/status", config.next ? "Jornada activa" : "Jornada finalizada");
        model.setProperty("/today/lastUpdate", time);
        this.getView().getModel("app").setProperty("/busy", false);
        this._updateActionUI();
        MessageToast.show(config.title + " correctamente");
      }.bind(this)).catch(function () {
        this.getView().getModel("app").setProperty("/busy", false);
        MessageBox.error("No fue posible registrar el evento. Intenta nuevamente.");
      }.bind(this));
    },

    _updateActionUI: function () {
      var model = this.getView().getModel("attendance");
      if (!model) { return; }
      var update = function () {
        var action = model.getProperty("/today/nextAction");
        var button = this.byId("primaryAction");
        var labels = {
          CHECK_IN: "Registrar entrada",
          MEAL_START: "Iniciar comida",
          MEAL_END: "Finalizar comida",
          CHECK_OUT: "Registrar salida"
        };
        button.setText(labels[action] || "Jornada finalizada");
        button.setEnabled(Boolean(action));
      }.bind(this);

      if (model.getProperty("/today")) {
        update();
      } else {
        model.attachRequestCompleted(update, this, { once: true });
      }
    },

    onRefreshLocation: function () {
      MessageToast.show("La ubicación se valida al confirmar cada marcaje");
    }
  });
});
