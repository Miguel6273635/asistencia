sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageBox",
  "sap/m/MessageToast",
  "sap/ui/model/json/JSONModel",
  "../model/IdentityService",
  "../model/EmployeeService",
  "../model/AttendanceService",
  "../model/Diagnostics"
], function (Controller, MessageBox, MessageToast, JSONModel, IdentityService, EmployeeService, AttendanceService, Diagnostics) {
  "use strict";

  var ACTION_CONFIG = {
    CHECK_IN: { title: "Registrar entrada", display: "Entrada de jornada", icon: "sap-icon://log", next: "MEAL_START", field: "entry" },
    MEAL_START: { title: "Iniciar comida", display: "Inicio de comida", icon: "sap-icon://meal", next: "MEAL_END", field: "mealStart" },
    MEAL_END: { title: "Finalizar comida", display: "Fin de comida", icon: "sap-icon://meal", next: "CHECK_OUT", field: "mealEnd" },
    CHECK_OUT: { title: "Registrar salida", display: "Salida de jornada", icon: "sap-icon://log", next: null, field: "exit" }
  };

  var STEP_CONFIG = [
    { id: "stepEntry", field: "entry", action: "CHECK_IN", connector: "connectorEntry" },
    { id: "stepMealStart", field: "mealStart", action: "MEAL_START", connector: "connectorMealStart" },
    { id: "stepMealEnd", field: "mealEnd", action: "MEAL_END", connector: "connectorMealEnd" },
    { id: "stepExit", field: "exit", action: "CHECK_OUT" }
  ];

  return Controller.extend("com.mitsu.checkin.controller.Main", {
    onInit: function () {
      Diagnostics.info("UI", "Main.controller inicializado", {
        hasActiveIdentity: IdentityService.hasActiveIdentity()
      });
      this._selectedSection = "attendance";
      this.getView().setModel(new JSONModel({ sideExpanded: false }), "ui");
      this._updateActionUI();
      this._startClock();
      if (IdentityService.hasActiveIdentity()) {
        this.getView().getModel("app").setProperty("/requiresIdentity", false);
        this._loadEmployeeAfterInitialData(false);
      }
    },

    onExit: function () {
      if (this._clockInterval) {
        clearInterval(this._clockInterval);
      }
    },

    _loadEmployeeAfterInitialData: function (fromTemporaryAccess) {
      var attendanceModel = this.getView().getModel("attendance");
      if (attendanceModel.getProperty("/employee")) {
        this._loadEmployee(fromTemporaryAccess);
        return;
      }

      var onCompleted = function () {
        attendanceModel.detachRequestCompleted(onCompleted, this);
        this._loadEmployee(fromTemporaryAccess);
      }.bind(this);
      attendanceModel.attachRequestCompleted(onCompleted, this);
    },

    _loadEmployee: function (fromTemporaryAccess) {
      var appModel = this.getView().getModel("app");
      var attendanceModel = this.getView().getModel("attendance");
      var dataSource = this.getOwnerComponent().getManifestEntry("/sap.app/dataSources/attendanceOData");
      var identity = IdentityService.getActiveIdentity();
      Diagnostics.info("FLOW", "Iniciando consulta del empleado", {
        serviceRoot: dataSource.uri,
        identity: identity,
        temporaryAccess: Boolean(fromTemporaryAccess)
      });

      this._activeIdentity = identity;

      appModel.setProperty("/employeeLoading", true);
      appModel.setProperty("/employeeError", "");
      appModel.setProperty("/identityLookupError", "");

      return EmployeeService.readEmployee(dataSource.uri, identity).then(function (employee) {
        Diagnostics.info("FLOW", "Empleado recibido; se solicitará su historial", employee);
        var currentEmployee = attendanceModel.getProperty("/employee") || {};
        Object.keys(employee).forEach(function (property) {
          if (employee[property]) {
            currentEmployee[property] = employee[property];
          }
        });
        attendanceModel.setProperty("/employee", currentEmployee);
        appModel.setProperty("/employeeSource", "odata");
        appModel.setProperty("/requiresIdentity", false);
        this._loadHistory(currentEmployee);
      }.bind(this)).catch(function (error) {
        Diagnostics.error("FLOW", "No fue posible cargar el empleado", error);
        appModel.setProperty("/employeeSource", "error");
        if (fromTemporaryAccess) {
          IdentityService.clearIdentity();
          this._activeIdentity = null;
          appModel.setProperty("/identityLookupError", error.message);
          appModel.setProperty("/requiresIdentity", true);
        } else {
          appModel.setProperty("/employeeError", error.message);
        }
      }.bind(this)).finally(function () {
        appModel.setProperty("/employeeLoading", false);
      });
    },

    onIdentitySubmit: function () {
      var appModel = this.getView().getModel("app");
      var value = String(appModel.getProperty("/identityInput") || "").trim();
      var identity = { personalNumber: "", email: "", device: "BTP-Web" };

      if (!value) {
        appModel.setProperty("/identityLookupError", "Escribe el número de nómina o el correo del empleado.");
        return;
      }

      if (value.indexOf("@") >= 0) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          appModel.setProperty("/identityLookupError", "El correo no tiene un formato válido.");
          return;
        }
        identity.email = value.toLowerCase();
      } else {
        if (!/^\d{1,8}$/.test(value)) {
          appModel.setProperty("/identityLookupError", "La nómina debe contener solamente números y máximo 8 posiciones.");
          return;
        }
        identity.personalNumber = value.padStart(8, "0");
        appModel.setProperty("/identityInput", identity.personalNumber);
      }

      IdentityService.setAuthenticatedIdentity(identity);
      Diagnostics.info("IDENTITY", "Identidad temporal aceptada", identity);
      this._loadEmployeeAfterInitialData(true);
    },

    onIdentityInputLiveChange: function () {
      this.getView().getModel("app").setProperty("/identityLookupError", "");
    },

    onRefreshData: function () {
      var appModel = this.getView().getModel("app");

      if (!IdentityService.hasActiveIdentity()) {
        MessageToast.show("No hay un empleado activo para actualizar");
        return;
      }

      appModel.setProperty("/employeeError", "");
      appModel.setProperty("/historyError", "");
      MessageToast.show("Actualizando datos desde SAP");
      this._loadEmployee(false);
    },

    _loadHistory: function (employee) {
      var appModel = this.getView().getModel("app");
      var attendanceModel = this.getView().getModel("attendance");
      var dataSource = this.getOwnerComponent().getManifestEntry("/sap.app/dataSources/attendanceOData");
      var now = new Date();
      var enterDate = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
      Diagnostics.info("FLOW", "Iniciando consulta del historial", {
        serviceRoot: dataSource.uri,
        personalNumber: employee.id,
        enterDate: enterDate
      });

      appModel.setProperty("/historyLoading", true);
      appModel.setProperty("/historyError", "");
      AttendanceService.readHistory(dataSource.uri, employee.id, enterDate).then(function (history) {
        Diagnostics.info("FLOW", "Historial listo para la interfaz", history);
        attendanceModel.setProperty("/history", history);
        this._applyTodayFromHistory(history);
      }.bind(this)).catch(function (error) {
        Diagnostics.error("FLOW", "No fue posible cargar el historial", error);
        appModel.setProperty("/historyError", error.message);
      }).finally(function () {
        appModel.setProperty("/historyLoading", false);
      });
    },

    _applyTodayFromHistory: function (history) {
      var model = this.getView().getModel("attendance");
      var today = history[0] || {};
      var entry = today.entry || "—";
      var mealStart = today.mealStart || "—";
      var mealEnd = today.mealEnd || "—";
      var exit = today.exit || "—";
      var nextAction = "CHECK_IN";

      if (entry !== "—") { nextAction = "MEAL_START"; }
      if (mealStart !== "—") { nextAction = "MEAL_END"; }
      if (mealEnd !== "—") { nextAction = "CHECK_OUT"; }
      if (exit !== "—") { nextAction = null; }

      model.setProperty("/today/entry", entry);
      model.setProperty("/today/mealStart", mealStart);
      model.setProperty("/today/mealEnd", mealEnd);
      model.setProperty("/today/exit", exit);
      model.setProperty("/today/nextAction", nextAction);
      this._updateActionUI();
    },

    _startClock: function () {
      var update = function () {
        var attendanceModel = this.getView().getModel("attendance");
        var now = new Date();
        var dateText = now.toLocaleDateString("es-MX", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric"
        });
        attendanceModel.setProperty("/today/dateText", dateText.charAt(0).toUpperCase() + dateText.slice(1));
        attendanceModel.setProperty("/today/currentTime", now.toLocaleTimeString("es-MX", {
          hour: "2-digit",
          minute: "2-digit"
        }));
      }.bind(this);

      update();
      this._clockInterval = setInterval(update, 30000);
    },

    onNavigationItemSelect: function (event) {
      var key = event.getParameter("item").getKey();
      if (key === "toggleMenu") {
        var uiModel = this.getView().getModel("ui");
        uiModel.setProperty("/sideExpanded", !uiModel.getProperty("/sideExpanded"));
        setTimeout(function () {
          this.byId("navigationList").setSelectedKey(this._selectedSection);
        }.bind(this), 0);
        return;
      }
      this._showSection(key);
    },

    onShowAttendance: function () {
      this._showSection("attendance");
    },

    onShowProfile: function () {
      this._showSection("profile");
    },

    _showSection: function (section) {
      var attendanceSelected = section === "attendance";
      this.byId("attendanceView").setVisible(attendanceSelected);
      this.byId("profileView").setVisible(!attendanceSelected);
      this._selectedSection = attendanceSelected ? "attendance" : "profile";
      this.byId("navigationList").setSelectedKey(this._selectedSection);
    },

    onRequestProfileUpdate: function () {
      MessageToast.show("La solicitud de actualización se habilitará al conectar Recursos Humanos");
    },

    onCheckIn: function () {
      this._confirmAction("CHECK_IN");
    },

    onMealStart: function () {
      this._confirmAction("MEAL_START");
    },

    onMealEnd: function () {
      this._confirmAction("MEAL_END");
    },

    onCheckOut: function () {
      this._confirmAction("CHECK_OUT");
    },

    _confirmAction: function (requestedAction) {
      var model = this.getView().getModel("attendance");
      var action = model.getProperty("/today/nextAction");
      if (action !== requestedAction) {
        MessageToast.show("Completa primero el marcaje anterior");
        return;
      }
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
      Diagnostics.info("GEO", "Solicitando ubicación para el marcaje", { action: action });

      if (!navigator.geolocation) {
        appModel.setProperty("/busy", false);
        MessageBox.error("Este dispositivo no permite obtener la ubicación.");
        return;
      }

      navigator.geolocation.getCurrentPosition(
        function (position) { this._register(action, position); }.bind(this),
        function (error) {
          Diagnostics.error("GEO", "No fue posible obtener la ubicación", error);
          appModel.setProperty("/busy", false);
          MessageBox.error("Activa el permiso de ubicación para realizar el marcaje.");
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
      );
    },

    _register: function (action, position) {
      var dataSource = this.getOwnerComponent().getManifestEntry("/sap.app/dataSources/attendanceOData");
      var employee = this.getView().getModel("attendance").getProperty("/employee");
      Diagnostics.info("FLOW", "Enviando marcaje a SAP", {
        action: action,
        serviceRoot: dataSource.uri,
        employeeId: employee && employee.id,
        coordinates: position && position.coords ? {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy
        } : null
      });
      AttendanceService.mark(dataSource.uri, action, position, employee, this._activeIdentity.device).then(function (result) {
        var model = this.getView().getModel("attendance");
        var config = ACTION_CONFIG[action];
        var time = result.registeredAt.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
        model.setProperty("/today/" + config.field, time);
        model.setProperty("/today/nextAction", config.next);
        this.getView().getModel("app").setProperty("/busy", false);
        this._updateActionUI();
        this._loadHistory(employee);
        MessageToast.show(config.title + " correctamente");
      }.bind(this)).catch(function (error) {
        Diagnostics.error("FLOW", "No fue posible registrar el marcaje", error);
        this.getView().getModel("app").setProperty("/busy", false);
        MessageBox.error("No fue posible registrar el evento en SAP. " + error.message);
      }.bind(this));
    },

    _updateActionUI: function () {
      var model = this.getView().getModel("attendance");
      if (!model) { return; }
      var update = function () {
        var action = model.getProperty("/today/nextAction");
        this.byId("checkInAction").setEnabled(action === "CHECK_IN");
        this.byId("mealStartAction").setEnabled(action === "MEAL_START");
        this.byId("mealEndAction").setEnabled(action === "MEAL_END");
        this.byId("checkOutAction").setEnabled(action === "CHECK_OUT");

        STEP_CONFIG.forEach(function (step) {
          var control = this.byId(step.id);
          var value = model.getProperty("/today/" + step.field);
          var completed = value && value !== "—";
          var active = action === step.action;
          control.toggleStyleClass("complete", completed);
          control.toggleStyleClass("active", active);
          control.getItems()[3].setText(completed ? "Registrada" : (active ? "Siguiente" : "Pendiente"));
          if (step.connector) {
            this.byId(step.connector).toggleStyleClass("completeConnector", completed);
          }
        }.bind(this));
      }.bind(this);

      if (model.getProperty("/today")) {
        update();
      } else {
        model.attachRequestCompleted(update, this, { once: true });
      }
    },

    onRefreshLocation: function () {
      MessageToast.show("La ubicación se valida al confirmar cada marcaje");
    },

    onHistory: function () {
      MessageToast.show("El historial completo se habilitará al conectar el servicio SAP");
    }
  });
});
