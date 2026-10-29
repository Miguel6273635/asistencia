sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageBox",
  "sap/m/MessageToast",
  "sap/ui/model/json/JSONModel",
  "sap/ui/core/Fragment",
  "../model/IdentityService",
  "../model/EmployeeService",
  "../model/AttendanceService",
  "../model/Diagnostics"
], function (Controller, MessageBox, MessageToast, JSONModel, Fragment, IdentityService, EmployeeService, AttendanceService, Diagnostics) {
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

  var ACTION_CODES = {
    CHECK_IN: "P10",
    MEAL_START: "P15",
    MEAL_END: "P25",
    CHECK_OUT: "P20"
  };

  function normalizeClock(value) {
    var text = String(value || "").trim();
    var duration = text.match(/^PT(\d+)H(\d+)M/i);
    var clock = text.match(/(\d{1,2}):(\d{2})/);
    if (duration) {
      return String(duration[1]).padStart(2, "0") + ":" + String(duration[2]).padStart(2, "0");
    }
    return clock ? String(clock[1]).padStart(2, "0") + ":" + clock[2] : "";
  }

  function clockMinutes(value) {
    var clock = normalizeClock(value);
    var parts = clock.split(":");
    return clock ? Number(parts[0]) * 60 + Number(parts[1]) : null;
  }

  function shiftOverlapsWindow(startMinutes, endMinutes, windowStart, windowEnd) {
    if (startMinutes === null || endMinutes === null) {
      return false;
    }

    var normalizedEnd = endMinutes <= startMinutes ? endMinutes + 1440 : endMinutes;
    return [-1440, 0, 1440, 2880].some(function (dayOffset) {
      var normalizedWindowStart = windowStart + dayOffset;
      var normalizedWindowEnd = windowEnd + dayOffset;
      return startMinutes < normalizedWindowEnd && normalizedEnd > normalizedWindowStart;
    });
  }

  function normalizeWords(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  }

  function dayCode(value) {
    var normalized = normalizeWords(value).replace(/[^A-Z]/g, "");
    var names = {
      L: 1, LU: 1, LUN: 1, LUNES: 1,
      M: 2, MA: 2, MAR: 2, MARTES: 2,
      X: 3, MI: 3, MIE: 3, MIERCOLES: 3,
      J: 4, JU: 4, JUE: 4, JUEVES: 4,
      V: 5, VI: 5, VIE: 5, VIERNES: 5,
      S: 6, SA: 6, SAB: 6, SABADO: 6,
      D: 0, DO: 0, DOM: 0, DOMINGO: 0
    };
    return names[normalized];
  }

  function dayMatches(specification, date) {
    var spec = normalizeWords(specification).replace(/\bA\b/g, "-");
    var current = date.getDay();
    if (!spec || /TODOS|DIARIO/.test(spec)) { return true; }
    if (/LUNES\s*-\s*VIERNES|L\s*-\s*V/.test(spec) && current >= 1 && current <= 5) { return true; }
    var range = spec.match(/(LUNES|MARTES|MIERCOLES|JUEVES|VIERNES|SABADO|DOMINGO|L|M|X|J|V|S|D)\s*-\s*(LUNES|MARTES|MIERCOLES|JUEVES|VIERNES|SABADO|DOMINGO|L|M|X|J|V|S|D)/);
    if (range) {
      var start = dayCode(range[1]);
      var end = dayCode(range[2]);
      if (start <= end) { return current >= start && current <= end; }
      return current >= start || current <= end;
    }
    return spec.split(/[\s,\/]+/).some(function (token) {
      return dayCode(token) === current;
    });
  }

  function rangeForToday(detail, date) {
    var text = String(detail || "");
    var matcher = /(?:^|[·;|])\s*([^·;|]*?)\s*(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/g;
    var match;
    var fallback = null;
    while ((match = matcher.exec(text)) !== null) {
      fallback = fallback || { start: normalizeClock(match[2]), end: normalizeClock(match[3]) };
      if (dayMatches(match[1], date)) {
        return { start: normalizeClock(match[2]), end: normalizeClock(match[3]) };
      }
    }
    return fallback;
  }

  function explicitFalse(value) {
    return ["0", "N", "NO", "FALSE", "DENEGADO", "NO AUTORIZADO"].indexOf(normalizeWords(value).trim()) >= 0;
  }

  function isTravelStatus(value) {
    return /VIAJE|TRAVEL|COMISION/.test(normalizeWords(value));
  }

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
      if (this._lateJustificationDialogPromise) {
        this._lateJustificationDialogPromise.then(function (dialog) {
          dialog.destroy();
        });
        this._lateJustificationDialogPromise = null;
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
        return this._loadSchedule(currentEmployee).then(function () {
          return this._loadHistory(currentEmployee);
        }.bind(this));
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

    _loadSchedule: function (employee) {
      var attendanceModel = this.getView().getModel("attendance");
      var dataSource = this.getOwnerComponent().getManifestEntry("/sap.app/dataSources/attendanceOData");

      return EmployeeService.readSchedule(dataSource.uri, employee).then(function (schedule) {
        var currentDate = new Date();
        var detailRange = rangeForToday(schedule && schedule.detail, currentDate);
        var resolved = {
          code: schedule && schedule.code || employee.scheduleCode || "",
          name: schedule && schedule.name || employee.schedule || "",
          detail: schedule && schedule.detail || employee.scheduleDetail || "",
          start: detailRange && detailRange.start || normalizeClock(schedule && schedule.workStart || employee.workStart),
          end: detailRange && detailRange.end || normalizeClock(schedule && schedule.workEnd || employee.workEnd),
          mealStart: normalizeClock(schedule && schedule.mealStart || employee.mealStart),
          mealEnd: normalizeClock(schedule && schedule.mealEnd || employee.mealEnd)
        };
        attendanceModel.setProperty("/schedule", resolved);
        if (resolved.name) { attendanceModel.setProperty("/employee/schedule", resolved.name); }
        if (resolved.code) { attendanceModel.setProperty("/employee/scheduleCode", resolved.code); }
        if (resolved.detail) { attendanceModel.setProperty("/employee/scheduleDetail", resolved.detail); }
        Diagnostics.info("SCHEDULE", "Horario aplicable al día actual", resolved);
        this._evaluateAttendanceContext();
        return resolved;
      }.bind(this));
    },

    onIdentitySubmit: function () {
      var appModel = this.getView().getModel("app");
      var value = String(appModel.getProperty("/identityInput") || "").trim();
      var identity = { personalNumber: "", email: "", device: "" };

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

    _loadHistory: function (employee, rejectOnError) {
      var appModel = this.getView().getModel("app");
      var attendanceModel = this.getView().getModel("attendance");
      var dataSource = this.getOwnerComponent().getManifestEntry("/sap.app/dataSources/attendanceOData");
      var now = new Date();
      var enterDate = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
      var identity = this._activeIdentity || IdentityService.getActiveIdentity() || {};
      var historyIdentifier = identity.personalNumber || identity.email || employee.id;
      Diagnostics.info("FLOW", "Iniciando consulta del historial", {
        serviceRoot: dataSource.uri,
        identifier: historyIdentifier,
        dateFrom: enterDate.replace(/-/g, "")
      });

      appModel.setProperty("/historyLoading", true);
      appModel.setProperty("/historyError", "");
      return AttendanceService.readHistory(dataSource.uri, historyIdentifier, enterDate, employee.id).then(function (history) {
        Diagnostics.info("FLOW", "Historial listo para la interfaz", history);
        attendanceModel.setProperty("/history", history);
        this._applyTodayFromHistory(history);
        return history;
      }.bind(this)).catch(function (error) {
        Diagnostics.error("FLOW", "No fue posible cargar el historial", error);
        appModel.setProperty("/historyError", error.message);
        if (rejectOnError) {
          throw error;
        }
        return [];
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
      model.setProperty("/today/status", today.status || "");
      model.setProperty("/today/isLate", Boolean(today.isLate));
      model.setProperty("/today/isTravel", Boolean(today.isTravel));
      model.setProperty("/today/nextAction", nextAction);
      this._evaluateAttendanceContext();
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
        this._evaluateAttendanceContext(now);
      }.bind(this);

      update();
      this._clockInterval = setInterval(update, 30000);
    },

    _evaluateAttendanceContext: function (now) {
      var model = this.getView().getModel("attendance");
      if (!model) { return; }

      var MEAL_WINDOW_START = 12 * 60;
      var MEAL_WINDOW_END = 14 * 60;
      var current = now || new Date();
      var currentMinutes = current.getHours() * 60 + current.getMinutes();
      var schedule = model.getProperty("/schedule") || {};
      var employee = model.getProperty("/employee") || {};
      var startMinutes = clockMinutes(schedule.start);
      var endMinutes = clockMinutes(schedule.end);
      var hasEntry = model.getProperty("/today/entry") && model.getProperty("/today/entry") !== "—";
      var hasMealStart = model.getProperty("/today/mealStart") && model.getProperty("/today/mealStart") !== "—";
      var hasMealEnd = model.getProperty("/today/mealEnd") && model.getProperty("/today/mealEnd") !== "—";
      var hasExit = model.getProperty("/today/exit") && model.getProperty("/today/exit") !== "—";
      var isMealWindowRestricted = shiftOverlapsWindow(startMinutes, endMinutes, MEAL_WINDOW_START, MEAL_WINDOW_END);
      var isWithinMealWindow = currentMinutes >= MEAL_WINDOW_START && currentMinutes <= MEAL_WINDOW_END;
      var nextAction = "CHECK_IN";

      if (hasEntry) {
        if (hasExit) {
          nextAction = null;
        } else if (isMealWindowRestricted) {
          if (!isWithinMealWindow) {
            nextAction = "CHECK_OUT";
          } else if (!hasMealStart) {
            nextAction = "MEAL_START";
          } else if (!hasMealEnd) {
            nextAction = "MEAL_END";
          } else {
            nextAction = "CHECK_OUT";
          }
        } else if (!hasMealStart) {
          nextAction = "MEAL_START";
        } else if (!hasMealEnd) {
          nextAction = "MEAL_END";
        } else {
          nextAction = "CHECK_OUT";
        }
      }

      var historyTravel = Boolean(model.getProperty("/today/isTravel"));
      var employeeTravel = [employee.status, employee.statusDescription, employee.registerType]
        .some(isTravelStatus);
      var isLateNow = !hasEntry && startMinutes !== null && currentMinutes > startMinutes;
      var isEarlyExit = nextAction === "CHECK_OUT" && endMinutes !== null && currentMinutes < endMinutes;
      var mealStartAllowed = !isMealWindowRestricted || isWithinMealWindow;
      var mealEndAllowed = !isMealWindowRestricted || isWithinMealWindow;
      var scheduleLabel = schedule.start && schedule.end ? schedule.start + "–" + schedule.end : "";
      var messageType = "Information";
      var message = scheduleLabel ? "Horario de hoy: " + scheduleLabel + "." : "SAP no expuso las horas del turno; se validará la secuencia de marcajes.";

      if (historyTravel || employeeTravel) {
        message = "Viaje de trabajo identificado. Los marcajes se envían sin solicitar ubicación.";
        messageType = "Information";
      } else if (isLateNow && nextAction === "CHECK_IN") {
        message = "Entrada tarde";
        messageType = "Warning";
      } else if (hasEntry && isMealWindowRestricted && currentMinutes < MEAL_WINDOW_START) {
        message = "La comida se habilitará de 12:00 a 14:00. Por ahora puedes registrar la salida.";
        messageType = "Information";
      } else if (hasEntry && isMealWindowRestricted && currentMinutes > MEAL_WINDOW_END && (!hasMealStart || !hasMealEnd)) {
        message = "La ventana de comida terminó a las 14:00. Solo puedes registrar la salida.";
        messageType = "Warning";
      } else if (hasEntry && isMealWindowRestricted && isWithinMealWindow && (nextAction === "MEAL_START" || nextAction === "MEAL_END")) {
        message = "Horario de comida disponible de 12:00 a 14:00.";
        messageType = "Information";
      } else if (hasEntry && !isMealWindowRestricted && (nextAction === "MEAL_START" || nextAction === "MEAL_END")) {
        message = "Este turno no coincide con la ventana diurna de comida; el marcaje de comida es libre.";
        messageType = "Information";
      } else if (isEarlyExit) {
        message = "Salida temprana: el horario termina a las " + schedule.end + ". Confirma antes de registrar.";
        messageType = "Warning";
      }

      model.setProperty("/today/nextAction", nextAction);
      model.setProperty("/today/isLateNow", isLateNow);
      model.setProperty("/today/isEarlyExit", isEarlyExit);
      model.setProperty("/today/isTravel", historyTravel || employeeTravel);
      model.setProperty("/today/isMealWindowRestricted", isMealWindowRestricted);
      model.setProperty("/today/isWithinMealWindow", isWithinMealWindow);
      model.setProperty("/today/mealStartAllowed", mealStartAllowed);
      model.setProperty("/today/mealEndAllowed", mealEndAllowed);
      model.setProperty("/today/checkInText", isLateNow ? "Registrar entrada tarde" : "Registrar entrada");
      model.setProperty("/today/checkOutText", isEarlyExit ? "Salida temprana" : "Registrar salida");
      model.setProperty("/today/validationMessage", message);
      model.setProperty("/today/validationType", messageType);
      model.setProperty("/today/scheduleLabel", scheduleLabel);
      this._updateActionUI();
    },

    _isActionAuthorized: function (action) {
      var model = this.getView().getModel("attendance");
      var employee = model.getProperty("/employee") || {};
      var expectedCode = String(employee.registerType || "").trim().toUpperCase();

      if (explicitFalse(employee.authorisedRegister)) {
        return false;
      }
      if (action === "MEAL_START" && model.getProperty("/today/mealStartAllowed") === false) {
        return false;
      }
      if (action === "MEAL_END" && model.getProperty("/today/mealEndAllowed") === false) {
        return false;
      }
      if (action === "CHECK_OUT" && model.getProperty("/today/isMealWindowRestricted") === true &&
          model.getProperty("/today/isWithinMealWindow") === false) {
        return true;
      }
      if (expectedCode && Object.keys(ACTION_CODES).some(function (key) { return ACTION_CODES[key] === expectedCode; })) {
        return ACTION_CODES[action] === expectedCode;
      }
      return true;
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

    onOpenLateJustification: function () {
      var model = this.getView().getModel("attendance");
      var justification = model.getProperty("/today/lateJustification") || {};
      this._lateJustificationSnapshot = JSON.parse(JSON.stringify(justification));
      model.setProperty("/today/lateJustification/error", "");
      this._getLateJustificationDialog().then(function (dialog) {
        dialog.open();
      });
    },

    _getLateJustificationDialog: function () {
      if (!this._lateJustificationDialogPromise) {
        this._lateJustificationDialogPromise = Fragment.load({
          id: this.getView().getId(),
          name: "com.mitsu.checkin.view.fragments.LateJustificationDialog",
          controller: this
        }).then(function (dialog) {
          this.getView().addDependent(dialog);
          return dialog;
        }.bind(this));
      }
      return this._lateJustificationDialogPromise;
    },

    onLateJustificationChange: function () {
      this.getView().getModel("attendance").setProperty("/today/lateJustification/error", "");
    },

    onSaveLateJustification: function () {
      var model = this.getView().getModel("attendance");
      var reason = String(model.getProperty("/today/lateJustification/reason") || "").trim();

      if (!reason) {
        model.setProperty("/today/lateJustification/error", "Selecciona el motivo del retraso.");
        return;
      }

      model.setProperty("/today/lateJustification/reason", reason);
      model.setProperty("/today/lateJustification/comment", String(model.getProperty("/today/lateJustification/comment") || "").trim());
      model.setProperty("/today/lateJustification/saved", true);
      model.setProperty("/today/lateJustification/error", "");
      model.setProperty("/today/lateJustificationButtonText", "Editar justificación");
      this._lateJustificationSnapshot = null;
      this._getLateJustificationDialog().then(function (dialog) {
        dialog.close();
      });
      MessageToast.show("Justificación guardada");
    },

    onCancelLateJustification: function () {
      if (this._lateJustificationSnapshot) {
        this.getView().getModel("attendance").setProperty("/today/lateJustification", this._lateJustificationSnapshot);
      }
      this._lateJustificationSnapshot = null;
      this._getLateJustificationDialog().then(function (dialog) {
        dialog.close();
      });
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

      if (!this._isActionAuthorized(action)) {
        MessageToast.show("Este marcaje todavía no está autorizado por el horario o por SAP");
        return;
      }

      var isLateEntry = action === "CHECK_IN" && Boolean(model.getProperty("/today/isLateNow"));
      var isEarlyExit = action === "CHECK_OUT" && Boolean(model.getProperty("/today/isEarlyExit"));
      if (isLateEntry && !model.getProperty("/today/lateJustification/saved")) {
        MessageToast.show("Agrega la justificación del retraso antes de registrar la entrada");
        this.onOpenLateJustification();
        return;
      }
      var confirmationText = config.title + "?";
      if (isLateEntry) {
        confirmationText = "La entrada se registrará como tardía. ¿Deseas continuar?";
      } else if (isEarlyExit) {
        confirmationText = "Tu horario aún no termina. ¿Deseas registrar una salida temprana?";
      }

      MessageBox.confirm(confirmationText, {
        title: isEarlyExit ? "Confirmar salida temprana" : (isLateEntry ? "Confirmar entrada tarde" : "Confirmar marcaje"),
        emphasizedAction: MessageBox.Action.OK,
        onClose: function (result) {
          if (result === MessageBox.Action.OK) {
            this.getView().getModel("app").setProperty("/busy", true);
            this._register(action);
          }
        }.bind(this)
      });
    },

    _register: function (action) {
      var dataSource = this.getOwnerComponent().getManifestEntry("/sap.app/dataSources/attendanceOData");
      var employee = this.getView().getModel("attendance").getProperty("/employee");
      var config = ACTION_CONFIG[action];
      var wasLateEntry = action === "CHECK_IN" && Boolean(this.getView().getModel("attendance").getProperty("/today/isLateNow"));
      var wasEarlyExit = action === "CHECK_OUT" && Boolean(this.getView().getModel("attendance").getProperty("/today/isEarlyExit"));
      var lateJustification = this.getView().getModel("attendance").getProperty("/today/lateJustification") || {};
      Diagnostics.info("FLOW", "Enviando marcaje a SAP", {
        action: action,
        serviceRoot: dataSource.uri,
        employeeId: employee && employee.id,
        isLate: wasLateEntry,
        isEarlyExit: wasEarlyExit,
        lateJustification: wasLateEntry ? lateJustification : null,
        coordinates: null
      });
      AttendanceService.mark(dataSource.uri, action, employee, this._activeIdentity && this._activeIdentity.device, {
        isLate: wasLateEntry,
        isEarlyExit: wasEarlyExit,
        lateJustification: wasLateEntry ? lateJustification : null
      }).then(function (result) {
        Diagnostics.info("FLOW", "SAP respondió al POST; se confirmará el marcaje en el historial", {
          action: action,
          sapStatus: result.sapStatus,
          sapMessage: result.sapMessage,
          sapEntity: result.sapEntity
        });
        return this._confirmMarkInHistory(employee, config.field, 3).then(function (registeredValue) {
          return {
            result: result,
            registeredValue: registeredValue
          };
        });
      }.bind(this)).then(function (confirmation) {
        this.getView().getModel("app").setProperty("/busy", false);
        this._updateActionUI();
        Diagnostics.info("FLOW", "Marcaje confirmado en AttendanceHistorySet", confirmation);
        MessageToast.show(wasEarlyExit ? "Salida temprana registrada" : (wasLateEntry ? "Entrada tarde registrada" : config.title + " correctamente"));
      }.bind(this)).catch(function (error) {
        Diagnostics.error("FLOW", "No fue posible registrar el marcaje", error);
        this.getView().getModel("app").setProperty("/busy", false);
        MessageBox.error("No fue posible registrar el evento en SAP. " + error.message);
      }.bind(this));
    },

    _confirmMarkInHistory: function (employee, field, attemptsRemaining) {
      return this._loadHistory(employee, true).then(function () {
        var registeredValue = this.getView().getModel("attendance").getProperty("/today/" + field);
        if (registeredValue && registeredValue !== "—") {
          return registeredValue;
        }

        if (attemptsRemaining <= 1) {
          throw new Error("SAP respondió al POST, pero el marcaje no aparece en AttendanceHistorySet. Revisa StatusReq y Message en la respuesta del POST.");
        }

        return new Promise(function (resolve) {
          setTimeout(resolve, 700);
        }).then(function () {
          return this._confirmMarkInHistory(employee, field, attemptsRemaining - 1);
        }.bind(this));
      }.bind(this));
    },

    _updateActionUI: function () {
      var model = this.getView().getModel("attendance");
      if (!model) { return; }
      var update = function () {
        var action = model.getProperty("/today/nextAction");
        this.byId("checkInAction").setEnabled(action === "CHECK_IN" && this._isActionAuthorized("CHECK_IN"));
        this.byId("mealStartAction").setEnabled(action === "MEAL_START" && this._isActionAuthorized("MEAL_START"));
        this.byId("mealEndAction").setEnabled(action === "MEAL_END" && this._isActionAuthorized("MEAL_END"));
        this.byId("checkOutAction").setEnabled(action === "CHECK_OUT" && this._isActionAuthorized("CHECK_OUT"));

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

    onHistory: function () {
      MessageToast.show("El historial completo se habilitará al conectar el servicio SAP");
    }
  });
});
