/* sap.ui.define([
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

  function localIsoDate(date) {
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  }

  function localClock(date) {
    return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
  }

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

  function isHomeOfficeStatus(value) {
    return /HOME\s*OFFIC|HOME\s*OFFICE|REMOT[OA]|TELETRABAJO/.test(normalizeWords(value));
  }

  function normalizeIsoDateValue(value) {
    var text = String(value || "").trim();
    var ticks = text.match(/^\/Date\((\d+)/);

    if (ticks) {
      return localIsoDate(new Date(Number(ticks[1])));
    }
    if (/^\d{8}$/.test(text)) {
      return text.slice(0, 4) + "-" + text.slice(4, 6) + "-" + text.slice(6, 8);
    }
    return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : "";
  }

  function workSessionCode(values) {
    var directCode = "";
    var normalizedValues = (values || []).filter(function (value) {
      return value !== undefined && value !== null && String(value).trim() !== "";
    });

    normalizedValues.some(function (value) {
      var normalized = normalizeWords(value).trim();
      if (normalized === "HO" || normalized === "VN") {
        directCode = normalized;
        return true;
      }
      return false;
    });

    if (directCode) { return directCode; }
    if (normalizedValues.some(isTravelStatus)) { return "VN"; }
    if (normalizedValues.some(isHomeOfficeStatus)) { return "HO"; }
    return "";
  }

  function browserUrlCandidates() {
    var candidates = [window.location.href, document.referrer];

    try {
      candidates.push(window.parent.location.href);
    } catch (ignoreParent) {
      // El Launchpad puede estar en un origen distinto.
    }

    try {
      candidates.push(window.top.location.href);
    } catch (ignoreTop) {
      // El Launchpad puede estar en un origen distinto.
    }

    return candidates.filter(Boolean);
  }

  function enabledFlagValue(value) {
    var firstValue = Array.isArray(value) ? value[0] : value;
    return /^(1|true|yes)$/i.test(String(firstValue || ""));
  }

  function urlFlagEnabled(name) {
    var expression = new RegExp("(?:[?&#])" + name + "=([^&#]*)", "i");

    return browserUrlCandidates().some(function (candidate) {
      var match = String(candidate).match(expression);
      return match && enabledFlagValue(decodeURIComponent(match[1]));
    });
  }

  function isTestEnvironment() {
    return browserUrlCandidates().some(function (candidate) {
      try {
        var hostname = new URL(candidate, window.location.href).hostname.toLowerCase();
        return hostname === "localhost" ||
          hostname === "127.0.0.1" ||
          hostname.indexOf("qas") >= 0;
      } catch (ignoreInvalidUrl) {
        return false;
      }
    });
  }

  function isLateTestEnabled(controller) {
    var componentData = controller.getOwnerComponent().getComponentData() || {};
    var startupParameters = componentData.startupParameters || {};
    var requested = urlFlagEnabled("testLate") ||
      enabledFlagValue(startupParameters.testLate);

    return requested && isTestEnvironment();
  }

  function resolveServiceRoot(serviceRoot) {
    var configuredRoot = String(serviceRoot || "").trim();
    var cleanRoot;
    var componentRoot;
    var pathname;
    var directory;

    if (!configuredRoot) {
      return "";
    }

    if (/^(?:https?:)?\/\//i.test(configuredRoot) || configuredRoot.charAt(0) === "/") {
      return configuredRoot.replace(/\/?$/, "/");
    }

    cleanRoot = configuredRoot.replace(/^\.\//, "").replace(/^\/+/, "");

    try {
      componentRoot = sap.ui.require.toUrl("com/mitsu/checkin/");
      if (componentRoot) {
        return new URL(
          cleanRoot,
          new URL(componentRoot.replace(/\/?$/, "/"), window.location.href)
        ).toString().replace(/\/?$/, "/");
      }
    } catch (ignoreComponentRoot) {
      // Se conserva el respaldo basado en pathname para la ejecución local.
    }

    pathname = window.location.pathname || "/";
    directory = pathname.slice(0, pathname.lastIndexOf("/") + 1) || "/";

    if (directory === "/" || directory === "/test/" || directory.endsWith("/test/")) {
      return ("/" + cleanRoot).replace(/\/?$/, "/");
    }

    return (directory + cleanRoot).replace(/\/?$/, "/");
  }

  return Controller.extend("com.mitsu.checkin.controller.Main", {
    onInit: function () {
      Diagnostics.info("UI", "Main.controller inicializado", {
        hasActiveIdentity: IdentityService.hasActiveIdentity()
      });
      this._selectedSection = "attendance";
      this._markRequestInProgress = false;
      this.getView().setModel(new JSONModel({ sideExpanded: false }), "ui");
      this._updateActionUI();
      this._startClock();
      this.getView().getModel("app").setProperty("/requiresIdentity", false);
      if (IdentityService.hasActiveIdentity()) {
        this._loadEmployeeAfterInitialData(false);
      } else {
        this._initializeAuthenticatedIdentity();
      }
    },

    onAfterRendering: function () {
      if (this._initialLayoutSynchronized) {
        return;
      }

      this._initialLayoutSynchronized = true;
      this._layoutSyncTimers = [0, 150, 500].map(function (delay) {
        return window.setTimeout(function () {
          window.dispatchEvent(new Event("resize"));
        }, delay);
      });
    },

    _initializeAuthenticatedIdentity: function () {
      var appModel = this.getView().getModel("app");
      // La vista principal nunca se bloquea con una pantalla intermedia.
      // La identidad y el perfil se resuelven en segundo plano.
      appModel.setProperty("/requiresIdentity", false);
      appModel.setProperty("/identityLoading", true);
      appModel.setProperty("/identityLookupError", "");
      appModel.setProperty("/employeeError", "");
      appModel.setProperty("/employeeLoading", true);

      Diagnostics.info("IDENTITY", "Consultando el usuario de la sesión BTP", {});
      return IdentityService.loadAuthenticatedIdentity().then(function (identity) {
        this._activeIdentity = identity;
        appModel.setProperty("/requiresIdentity", false);
        Diagnostics.info("IDENTITY", "Se usará la identidad autenticada para consultar EmployeeSet", identity);
        return this._loadEmployeeAfterInitialData(false);
      }.bind(this)).catch(function (error) {
        Diagnostics.error("IDENTITY", "No fue posible iniciar con la identidad BTP", error);
        appModel.setProperty("/identityLookupError", error.message);
        appModel.setProperty("/employeeError", error.message);
        appModel.setProperty("/requiresIdentity", false);
        appModel.setProperty("/employeeLoading", false);
      }).finally(function () {
        appModel.setProperty("/identityLoading", false);
      });
    },

    onExit: function () {
      if (this._clockInterval) {
        clearInterval(this._clockInterval);
      }
      (this._layoutSyncTimers || []).forEach(function (timer) {
        window.clearTimeout(timer);
      });
      this._layoutSyncTimers = [];
      if (this._lateJustificationDialogPromise) {
        this._lateJustificationDialogPromise.then(function (dialog) {
          dialog.destroy();
        });
        this._lateJustificationDialogPromise = null;
      }
      if (this._earlyExitJustificationDialogPromise) {
        this._earlyExitJustificationDialogPromise.then(function (dialog) {
          dialog.destroy();
        });
        this._earlyExitJustificationDialogPromise = null;
      }
      if (this._workModalityDialogPromise) {
        this._workModalityDialogPromise.then(function (dialog) {
          dialog.destroy();
        });
        this._workModalityDialogPromise = null;
      }
    },

    _loadEmployeeAfterInitialData: function (fromTemporaryAccess) {
      var attendanceModel = this.getView().getModel("attendance");
      if (attendanceModel.getProperty("/employee")) {
        return this._loadEmployee(fromTemporaryAccess);
      }

      return new Promise(function (resolve, reject) {
        var onCompleted = function () {
          attendanceModel.detachRequestCompleted(onCompleted, this);
          this._loadEmployee(fromTemporaryAccess).then(resolve, reject);
        }.bind(this);
        attendanceModel.attachRequestCompleted(onCompleted, this);
      }.bind(this));
    },

    _loadEmployee: function (fromTemporaryAccess) {
      var appModel = this.getView().getModel("app");
      var attendanceModel = this.getView().getModel("attendance");
      var dataSource = this.getOwnerComponent().getManifestEntry("/sap.app/dataSources/attendanceOData");
      var serviceRoot = resolveServiceRoot(dataSource.uri);
      var identity = IdentityService.getActiveIdentity();
      Diagnostics.info("FLOW", "Iniciando consulta del empleado", {
        configuredServiceRoot: dataSource.uri,
        serviceRoot: serviceRoot,
        identity: identity,
        temporaryAccess: Boolean(fromTemporaryAccess)
      });

      this._activeIdentity = identity;

      appModel.setProperty("/employeeLoading", true);
      appModel.setProperty("/employeeError", "");
      appModel.setProperty("/identityLookupError", "");

      return EmployeeService.readEmployee(serviceRoot, identity).then(function (employee) {
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
          appModel.setProperty("/employeeError", error.message);
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
      var serviceRoot = resolveServiceRoot(dataSource.uri);

      return EmployeeService.readSchedule(serviceRoot, employee).then(function (schedule) {
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

    onRetryIdentity: function () {
      IdentityService.clearIdentity();
      this._initializeAuthenticatedIdentity();
    },

    onLogout: function () {
      MessageBox.confirm("¿Deseas cerrar la sesión de Work Zone?", {
        title: "Cerrar sesión",
        emphasizedAction: MessageBox.Action.OK,
        onClose: function (result) {
          if (result === MessageBox.Action.OK) {
            this._performLogout();
          }
        }.bind(this)
      });
    },

    _performLogout: function () {
      var container = window.sap && window.sap.ushell && window.sap.ushell.Container;

      IdentityService.clearIdentity();
      this._activeIdentity = null;
      this._markRequestInProgress = false;
      this.getView().getModel("app").setProperty("/busy", true);

      try {
        if (container && typeof container.logout === "function") {
          var logoutResult = container.logout();
          if (logoutResult && typeof logoutResult.catch === "function") {
            logoutResult.catch(function () {
              window.location.replace("/do/logout");
            });
          }
          return;
        }
      } catch (error) {
        Diagnostics.warn("IDENTITY", "El shell no pudo cerrar la sesión; se usará la ruta estándar", {
          message: error.message
        });
      }

      window.location.replace("/do/logout");
    },

    onRefreshData: function () {
      var appModel = this.getView().getModel("app");

      if (!IdentityService.hasActiveIdentity()) {
        this._initializeAuthenticatedIdentity();
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
      var serviceRoot = resolveServiceRoot(dataSource.uri);
      var now = new Date();
      var enterDate = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
      var identity = this._activeIdentity || IdentityService.getActiveIdentity() || {};
      var historyIdentifier = identity.personalNumber || identity.email || employee.id;
      Diagnostics.info("FLOW", "Iniciando consulta del historial", {
        configuredServiceRoot: dataSource.uri,
        serviceRoot: serviceRoot,
        identifier: historyIdentifier,
        dateFrom: enterDate.replace(/-/g, "")
      });

      appModel.setProperty("/historyLoading", true);
      appModel.setProperty("/historyError", "");
      return AttendanceService.readHistory(
        serviceRoot,
        historyIdentifier,
        enterDate,
        employee.id,
        { dateTo: enterDate }
      ).then(function (history) {
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

    _markStorageKey: function (action, employee) {
      var employeeId = String(employee && (employee.id || employee.email) || "").trim().toLowerCase();
      return "mitsu.checkin.sent." + localIsoDate(new Date()) + "." + employeeId + "." + action;
    },

    _rememberMark: function (action, employee, value) {
      try {
        window.sessionStorage.setItem(this._markStorageKey(action, employee), String(value || ""));
      } catch (error) {
        Diagnostics.warn("FLOW", "No fue posible guardar la protección local contra doble marcaje", {
          action: action,
          message: error.message
        });
      }
    },

    _rememberedMark: function (action, employee) {
      try {
        return window.sessionStorage.getItem(this._markStorageKey(action, employee)) || "";
      } catch (error) {
        return "";
      }
    },

    _applyTodayFromHistory: function (history) {
      var model = this.getView().getModel("attendance");
      var todayIso = localIsoDate(new Date());
      var today = history.filter(function (item) { return item.isoDate === todayIso; })[0] || {};
      var employee = model.getProperty("/employee") || {};
      var entry = today.entry || this._rememberedMark("CHECK_IN", employee) || "—";
      var mealStart = today.mealStart || this._rememberedMark("MEAL_START", employee) || "—";
      var mealEnd = today.mealEnd || this._rememberedMark("MEAL_END", employee) || "—";
      var exit = today.exit || this._rememberedMark("CHECK_OUT", employee) || "—";
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
      model.setProperty("/today/isHomeOffice", Boolean(today.isHomeOffice));
      model.setProperty("/today/typeSession", today.typeSession || "");
      model.setProperty("/today/sessionDateFrom", today.sessionDateFrom || "");
      model.setProperty("/today/sessionDateTo", today.sessionDateTo || "");
      model.setProperty("/today/workModalityConfirmed", entry !== "—");
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
      var historyHomeOffice = Boolean(model.getProperty("/today/isHomeOffice"));
      var employeeHomeOffice = [employee.typeSession, employee.dayStatus, employee.status, employee.statusDescription]
        .some(isHomeOfficeStatus);
      var modalityConfirmed = Boolean(model.getProperty("/today/workModalityConfirmed"));
      var confirmedTypeSession = String(model.getProperty("/today/typeSession") || "").trim().toUpperCase();
      var typeSession = modalityConfirmed && ["", "HO", "VN"].indexOf(confirmedTypeSession) >= 0
        ? confirmedTypeSession
        : workSessionCode([
          model.getProperty("/today/typeSession"),
          employee.typeSession,
          employee.dayStatus,
          employee.status,
          employee.statusDescription
        ]);
      var isTravel = modalityConfirmed
        ? typeSession === "VN"
        : (typeSession === "VN" || historyTravel || employeeTravel);
      var isHomeOffice = modalityConfirmed
        ? typeSession === "HO"
        : (typeSession === "HO" || historyHomeOffice || employeeHomeOffice);
      var todayDate = localIsoDate(current);
      var sessionDateFrom;
      var sessionDateTo;

      if (isTravel) {
        typeSession = "VN";
      } else if (isHomeOffice) {
        typeSession = "HO";
      } else {
        typeSession = "";
      }

      if (typeSession === "VN") {
        sessionDateFrom = modalityConfirmed
          ? (normalizeIsoDateValue(model.getProperty("/today/sessionDateFrom")) || normalizeIsoDateValue(employee.dateFrom) || todayDate)
          : (normalizeIsoDateValue(employee.dateFrom) || normalizeIsoDateValue(model.getProperty("/today/sessionDateFrom")) || todayDate);
        sessionDateTo = modalityConfirmed
          ? (normalizeIsoDateValue(model.getProperty("/today/sessionDateTo")) || normalizeIsoDateValue(employee.dateTo) || todayDate)
          : (normalizeIsoDateValue(employee.dateTo) || normalizeIsoDateValue(model.getProperty("/today/sessionDateTo")) || todayDate);
      } else {
        sessionDateFrom = todayDate;
        sessionDateTo = todayDate;
      }
      var forceLateTest = isLateTestEnabled(this);
      var isLateNow = !hasEntry && (forceLateTest ||
        (startMinutes !== null && currentMinutes > startMinutes));
      var canCheckOut = hasEntry && !hasExit;
      var isEarlyExit = canCheckOut && endMinutes !== null && currentMinutes < endMinutes;
      var mealStartAllowed = !isMealWindowRestricted || isWithinMealWindow;
      var mealEndAllowed = !isMealWindowRestricted || isWithinMealWindow;
      var scheduleLabel = schedule.start && schedule.end ? schedule.start + "–" + schedule.end : "";
      var messageType = "Information";
      var message = scheduleLabel ? "Horario de hoy: " + scheduleLabel + "." : "SAP no expuso las horas del turno; se validará la secuencia de marcajes.";

      if (forceLateTest && isLateNow && nextAction === "CHECK_IN") {
        message = "MODO DE PRUEBA: la entrada tardía está forzada temporalmente.";
        messageType = "Warning";
      } else if (typeSession === "VN") {
        message = "Viaje de negocios identificado. Se enviará TypeSession VN y el periodo autorizado a SAP.";
        messageType = "Information";
      } else if (typeSession === "HO") {
        message = "Home Office identificado. Se enviará TypeSession HO y la fecha del día a SAP.";
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
      model.setProperty("/today/canCheckOut", canCheckOut);
      model.setProperty("/today/isTravel", typeSession === "VN");
      model.setProperty("/today/isHomeOffice", typeSession === "HO");
      model.setProperty("/today/typeSession", typeSession);
      model.setProperty("/today/workModalityText", typeSession === "VN" ? "Viaje de negocios" : (typeSession === "HO" ? "Home Office" : "Presencial"));
      model.setProperty("/today/sessionDateFrom", sessionDateFrom);
      model.setProperty("/today/sessionDateTo", sessionDateTo);
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
      if (action === "CHECK_OUT" && model.getProperty("/today/canCheckOut")) {
        return true;
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

    _showSection: function (section) {
      this.byId("attendanceView").setVisible(true);
      this._selectedSection = "attendance";
      this.byId("navigationList").setSelectedKey(this._selectedSection);
    },

    onCheckIn: function () {
      this._confirmAction("CHECK_IN");
    },

    _openWorkModalityDialog: function (pendingAction) {
      var model = this.getView().getModel("attendance");
      var typeSession = String(model.getProperty("/today/typeSession") || "").trim().toUpperCase();
      var isBusinessTrip = typeSession === "VN";

      model.setProperty("/today/workModalityDraft", {
        typeSession: ["HO", "VN"].indexOf(typeSession) >= 0 ? typeSession : "",
        dateFrom: isBusinessTrip ? normalizeIsoDateValue(model.getProperty("/today/sessionDateFrom")) : "",
        dateTo: isBusinessTrip ? normalizeIsoDateValue(model.getProperty("/today/sessionDateTo")) : "",
        error: ""
      });
      this._pendingActionAfterModality = pendingAction || "CHECK_IN";

      this._getWorkModalityDialog().then(function (dialog) {
        dialog.open();
      });
    },

    _getWorkModalityDialog: function () {
      if (!this._workModalityDialogPromise) {
        this._workModalityDialogPromise = Fragment.load({
          id: this.getView().getId(),
          name: "com.mitsu.checkin.view.fragments.WorkModalityDialog",
          controller: this
        }).then(function (dialog) {
          this.getView().addDependent(dialog);
          return dialog;
        }.bind(this));
      }
      return this._workModalityDialogPromise;
    },

    onWorkModalityChange: function (event) {
      var model = this.getView().getModel("attendance");
      var source = event && event.getSource && event.getSource();

      if (source && source.getSelectedKey) {
        model.setProperty("/today/workModalityDraft/typeSession", source.getSelectedKey());
      }
      model.setProperty("/today/workModalityDraft/error", "");
    },

    onSaveWorkModality: function () {
      var model = this.getView().getModel("attendance");
      var draft = model.getProperty("/today/workModalityDraft") || {};
      var typeSession = String(draft.typeSession || "").trim().toUpperCase();
      var todayDate = localIsoDate(new Date());
      var dateFrom = normalizeIsoDateValue(draft.dateFrom);
      var dateTo = normalizeIsoDateValue(draft.dateTo);
      var error = "";

      if (["", "HO", "VN"].indexOf(typeSession) < 0) {
        error = "Selecciona una modalidad válida.";
      } else if (typeSession === "VN" && (!dateFrom || !dateTo)) {
        error = "Captura las fechas de inicio y fin del viaje de negocios.";
      } else if (typeSession === "VN" && dateFrom > dateTo) {
        error = "La fecha de inicio del viaje no puede ser posterior a la fecha final.";
      } else if (typeSession === "VN" && (todayDate < dateFrom || todayDate > dateTo)) {
        error = "La fecha actual debe encontrarse dentro del periodo del viaje de negocios.";
      }

      if (error) {
        model.setProperty("/today/workModalityDraft/error", error);
        return;
      }

      if (typeSession !== "VN") {
        dateFrom = todayDate;
        dateTo = todayDate;
      }

      model.setProperty("/today/typeSession", typeSession);
      model.setProperty("/today/isHomeOffice", typeSession === "HO");
      model.setProperty("/today/isTravel", typeSession === "VN");
      model.setProperty("/today/workModalityText", typeSession === "VN" ? "Viaje de negocios" : (typeSession === "HO" ? "Home Office" : "Presencial"));
      model.setProperty("/today/sessionDateFrom", dateFrom);
      model.setProperty("/today/sessionDateTo", dateTo);
      model.setProperty("/today/workModalityConfirmed", true);
      model.setProperty("/today/workModalityDraft/error", "");

      Diagnostics.info("MODALITY", "Modalidad confirmada antes del marcaje", {
        typeSession: typeSession,
        dateFrom: dateFrom,
        dateTo: dateTo
      });

      var pendingAction = this._pendingActionAfterModality || "CHECK_IN";
      this._pendingActionAfterModality = null;
      this._getWorkModalityDialog().then(function (dialog) {
        dialog.close();
        window.setTimeout(function () {
          this._confirmAction(pendingAction);
        }.bind(this), 0);
      }.bind(this));
    },

    onCancelWorkModality: function () {
      this._pendingActionAfterModality = null;
      this.getView().getModel("attendance").setProperty("/today/workModalityDraft/error", "");
      this._getWorkModalityDialog().then(function (dialog) {
        dialog.close();
      });
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
      MessageToast.show("Enviando entrada y justificación a SAP");
      this._register("CHECK_IN");
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

    onOpenEarlyExitJustification: function () {
      var model = this.getView().getModel("attendance");
      var justification = model.getProperty("/today/earlyExitJustification") || {};
      this._earlyExitJustificationSnapshot = JSON.parse(JSON.stringify(justification));
      model.setProperty("/today/earlyExitJustification/error", "");
      this._getEarlyExitJustificationDialog().then(function (dialog) {
        dialog.open();
      });
    },

    _getEarlyExitJustificationDialog: function () {
      if (!this._earlyExitJustificationDialogPromise) {
        this._earlyExitJustificationDialogPromise = Fragment.load({
          id: this.getView().getId(),
          name: "com.mitsu.checkin.view.fragments.EarlyExitJustificationDialog",
          controller: this
        }).then(function (dialog) {
          this.getView().addDependent(dialog);
          return dialog;
        }.bind(this));
      }
      return this._earlyExitJustificationDialogPromise;
    },

    onEarlyExitJustificationChange: function () {
      this.getView().getModel("attendance").setProperty("/today/earlyExitJustification/error", "");
    },

    onSaveEarlyExitJustification: function () {
      var model = this.getView().getModel("attendance");
      var reason = String(model.getProperty("/today/earlyExitJustification/reason") || "").trim();

      if (!reason) {
        model.setProperty("/today/earlyExitJustification/error", "Selecciona el motivo de la salida anticipada.");
        return;
      }

      model.setProperty("/today/earlyExitJustification/reason", reason);
      model.setProperty("/today/earlyExitJustification/comment", String(model.getProperty("/today/earlyExitJustification/comment") || "").trim());
      model.setProperty("/today/earlyExitJustification/saved", true);
      model.setProperty("/today/earlyExitJustification/error", "");
      model.setProperty("/today/earlyExitJustificationButtonText", "Editar justificación");
      this._earlyExitJustificationSnapshot = null;
      this._getEarlyExitJustificationDialog().then(function (dialog) {
        dialog.close();
      });
      MessageToast.show("Enviando justificación y salida a SAP");
      this._register("CHECK_OUT");
    },

    onCancelEarlyExitJustification: function () {
      if (this._earlyExitJustificationSnapshot) {
        this.getView().getModel("attendance").setProperty("/today/earlyExitJustification", this._earlyExitJustificationSnapshot);
      }
      this._earlyExitJustificationSnapshot = null;
      this._getEarlyExitJustificationDialog().then(function (dialog) {
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

      if (this._markRequestInProgress) {
        MessageToast.show(
          "Existe un marcaje en proceso de confirmación. " +
          "Evita enviarlo nuevamente."
        );
        return;
      }

      var model = this.getView().getModel("attendance");
      if (requestedAction === "CHECK_IN" && !model.getProperty("/today/workModalityConfirmed")) {
        this._openWorkModalityDialog(requestedAction);
        return;
      }
      var action = model.getProperty("/today/nextAction");
      var hasEntry = model.getProperty("/today/entry") && model.getProperty("/today/entry") !== "—";
      var hasExit = model.getProperty("/today/exit") && model.getProperty("/today/exit") !== "—";
      var checkoutWithoutMeal = requestedAction === "CHECK_OUT" && hasEntry && !hasExit;
      if (action !== requestedAction && !checkoutWithoutMeal) {
        MessageToast.show("Completa primero el marcaje anterior");
        return;
      }
      action = requestedAction;
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
      if (isEarlyExit && !model.getProperty("/today/earlyExitJustification/saved")) {
        MessageToast.show("Agrega la justificación antes de registrar la salida anticipada");
        this.onOpenEarlyExitJustification();
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
            this._register(action);
          }
        }.bind(this)
      });
    },


    _register: function (action) {

      var appModel = this.getView().getModel("app");
      var attendanceModel = this.getView().getModel("attendance");

      var dataSource = this.getOwnerComponent()
        .getManifestEntry("/sap.app/dataSources/attendanceOData");
      var serviceRoot = resolveServiceRoot(dataSource.uri);

      var employee = attendanceModel.getProperty("/employee");
      var config = ACTION_CONFIG[action];
      var registeredValue = config && attendanceModel.getProperty("/today/" + config.field);

      // Evitar múltiples POST simultáneos.
      if (this._markRequestInProgress) {
        MessageToast.show(
          "Ya existe un marcaje en proceso."
        );
        return;
      }

      if (!config || !employee || !employee.id) {
        MessageBox.error("No se puede registrar el evento porque el colaborador todavía no está identificado.");
        return Promise.resolve();
      }

      if (registeredValue && registeredValue !== "—") {
        MessageToast.show("Este marcaje ya está registrado. Se actualizarán los datos desde SAP.");
        this.onRefreshData();
        return Promise.resolve();
      }

      if ((action === "CHECK_OUT" && !attendanceModel.getProperty("/today/canCheckOut")) ||
          (action !== "CHECK_OUT" && attendanceModel.getProperty("/today/nextAction") !== action)) {
        MessageToast.show("El marcaje ya no corresponde al estado actual de la jornada");
        this.onRefreshData();
        return Promise.resolve();
      }

      if (!this._isActionAuthorized(action)) {
        MessageToast.show("Este marcaje no está autorizado por SAP");
        return Promise.resolve();
      }

      if (action === "CHECK_IN" && !attendanceModel.getProperty("/today/workModalityConfirmed")) {
        this._openWorkModalityDialog(action);
        return Promise.resolve();
      }

      var typeSession = String(attendanceModel.getProperty("/today/typeSession") || "").trim().toUpperCase();
      var sessionDateFrom = normalizeIsoDateValue(attendanceModel.getProperty("/today/sessionDateFrom"));
      var sessionDateTo = normalizeIsoDateValue(attendanceModel.getProperty("/today/sessionDateTo"));
      var todayDate = localIsoDate(new Date());

      if (["", "HO", "VN"].indexOf(typeSession) < 0) {
        MessageBox.error("La modalidad de trabajo recibida de SAP no es válida. Solo se acepta presencial, HO o VN.");
        return Promise.resolve();
      }

      if (typeSession !== "VN") {
        sessionDateFrom = todayDate;
        sessionDateTo = todayDate;
      } else {
        sessionDateFrom = sessionDateFrom || todayDate;
        sessionDateTo = sessionDateTo || todayDate;
        if (sessionDateFrom > sessionDateTo) {
          MessageBox.error("El inicio del viaje de negocios no puede ser posterior a su fecha de finalización.");
          return Promise.resolve();
        }
        if (todayDate < sessionDateFrom || todayDate > sessionDateTo) {
          MessageBox.error("La fecha actual no se encuentra dentro del periodo autorizado para el viaje de negocios.");
          return Promise.resolve();
        }
      }

      this._markRequestInProgress = true;
      appModel.setProperty("/busy", true);

      var wasLateEntry = action === "CHECK_IN" &&
        Boolean(attendanceModel.getProperty("/today/isLateNow"));

      var wasEarlyExit = action === "CHECK_OUT" &&
        Boolean(attendanceModel.getProperty("/today/isEarlyExit"));

      var lateJustification =
        attendanceModel.getProperty(
          "/today/lateJustification"
        ) || {};

      var earlyExitJustification =
        attendanceModel.getProperty(
          "/today/earlyExitJustification"
        ) || {};

      Diagnostics.info(
        "FLOW",
        "Iniciando proceso de marcaje",
        {
          action: action,
          employeeId: employee && employee.id,
          isLate: wasLateEntry,
          isEarlyExit: wasEarlyExit,
          typeSession: typeSession,
          dateFrom: sessionDateFrom,
          dateTo: sessionDateTo
        }
      );

      // Primero recuperar ubicación.
      return AttendanceService.captureLocation()

        .then(function (location) {

          location = location || {};

          // La ubicación es informativa para el usuario.
          // SAP determina GeoStatus.
          if (location.warning) {

            Diagnostics.warn(
              "LOCATION",
              "Advertencia de ubicación",
              {
                message: location.warning,
                accuracy: location.accuracy
              }
            );

            MessageToast.show(
              location.warning,
              { duration: 5000 }
            );
          }

          Diagnostics.info(
            "FLOW",
            "Enviando marcaje a SAP",
            {
              action: action,
              employeeId: employee && employee.id,
              hasLocation: Boolean(
                location.latitude &&
                location.longitude
              ),
              accuracy: location.accuracy
            }
          );

          return AttendanceService.mark(
            serviceRoot,
            action,
            employee,
            this._activeIdentity &&
            this._activeIdentity.device,
            {
              isLate: wasLateEntry,
              isEarlyExit: wasEarlyExit,
              lateJustification: wasLateEntry
                ? lateJustification
                : null,
              earlyExitJustification: wasEarlyExit
                ? earlyExitJustification
                : null,
              typeSession: typeSession,
              dateFrom: sessionDateFrom,
              dateTo: sessionDateTo,
              location: location
            }
          );

        }.bind(this))

        .then(function (result) {

          var sapStatus = String(
            result.sapStatus || ""
          ).trim().toUpperCase();

          if (sapStatus !== "OK") {
            throw new Error(
              result.sapMessage ||
              "SAP no confirmó el marcaje."
            );
          }

          var optimisticValue = localClock(result.registeredAt || new Date());
          attendanceModel.setProperty("/today/" + config.field, optimisticValue);
          this._rememberMark(action, employee, optimisticValue);
          this._evaluateAttendanceContext();

          Diagnostics.info(
            "MARK",
            "Marcaje confirmado por SAP",
            {
              flowId: result.flowId,
              action: action,
              postsCompleted: result.justification ? 2 : 1,
              sapStatus: sapStatus,
              sapMessage: result.sapMessage,
              sapGeoStatus: result.sapGeoStatus,
              sapEntity: result.sapEntity,
              justification: result.justification
            }
          );

          // Mensaje de éxito basado en la respuesta SAP.
          var successMessage = wasEarlyExit
            ? "Salida temprana registrada"
            : (
              wasLateEntry
                ? "Entrada tarde registrada con su justificación"
                : config.title + " correctamente"
            );

          MessageToast.show(successMessage, {
            duration: 4000
          });

          // Actualización del historial independiente.
          this._confirmMarkInHistory(
            employee,
            config.field,
            3
          ).then(function (confirmation) {

            if (confirmation.confirmed) {

              Diagnostics.info(
                "HISTORY",
                "Marcaje visible en AttendanceHistorySet",
                confirmation
              );

            } else {

              Diagnostics.warn(
                "HISTORY",
                "SAP confirmó el marcaje, pero " +
                "el historial aún no lo refleja.",
                confirmation
              );

              MessageToast.show(
                "Marcaje aceptado por SAP. " +
                "El historial todavía no está actualizado.",
                { duration: 6000 }
              );
            }

          }).catch(function (historyError) {

            Diagnostics.warn(
              "HISTORY",
              "No fue posible actualizar el historial",
              {
                message: historyError.message
              }
            );

            MessageToast.show(
              "Marcaje aceptado por SAP. " +
              "Actualiza los datos para consultar el historial.",
              { duration: 6000 }
            );

          }).finally(function () {

            // Recuperar las acciones según el historial.
            this._markRequestInProgress = false;
            this._updateActionUI();

          }.bind(this));

          return result;

        }.bind(this))

        .catch(function (error) {

          if (error.attendanceRecorded && error.attendanceResult) {
            var partialResult = error.attendanceResult;
            var partialValue = localClock(partialResult.registeredAt || new Date());

            attendanceModel.setProperty("/today/" + config.field, partialValue);
            this._rememberMark(action, employee, partialValue);
            this._evaluateAttendanceContext();

            Diagnostics.error(
              "FLOW",
              "AttendanceRecordSet fue aceptado, pero falló JustificationLogSet",
              {
                flowId: error.flowId || partialResult.flowId,
                action: action,
                attendanceResult: partialResult,
                message: error.message
              }
            );

            MessageBox.error(
              "La entrada sí quedó registrada, pero SAP no aceptó la justificación. " +
              "No vuelvas a registrar la entrada. Detalle: " +
              (error.message || "Error no especificado")
            );

            this._markRequestInProgress = false;
            this._updateActionUI();
            return;
          }

          Diagnostics.error(
            "FLOW",
            "No fue posible confirmar el marcaje",
            error
          );

          var message = error.message ||
            "Ocurrió un problema durante el marcaje.";

          if (
            error.name === "RequestTimeoutError" ||
            error.name === "UnconfirmedMarkError" ||
            error.status === 504
          ) {

            MessageBox.warning(
              "No fue posible confirmar el resultado " +
              "del marcaje. " +
              "Consulta el historial antes de volver " +
              "a registrarlo. Detalle: " + message
            );

          } else {

            MessageBox.error(
              "No fue posible registrar el evento en SAP. " +
              message
            );
          }

          this._markRequestInProgress = false;

        }.bind(this))

        .finally(function () {

          appModel.setProperty("/busy", false);

        });
    },


    _confirmMarkInHistory: function (
      employee,
      field,
      attemptsRemaining
    ) {

      var attendanceModel =
        this.getView().getModel("attendance");

      var appModel =
        this.getView().getModel("app");

      var dataSource = this.getOwnerComponent()
        .getManifestEntry(
          "/sap.app/dataSources/attendanceOData"
        );
      var serviceRoot = resolveServiceRoot(dataSource.uri);

      var now = new Date();
      var todayIso = localIsoDate(now);

      var identity = this._activeIdentity ||
        IdentityService.getActiveIdentity() || {};

      var historyIdentifier =
        identity.personalNumber ||
        identity.email ||
        employee.id;

      var delays = [1500, 3000, 5000];

      var maxAttempts = Math.max(
        1,
        Math.min(attemptsRemaining || 3, delays.length)
      );

      var lastError = null;

      appModel.setProperty("/historyLoading", true);

      function wait(ms) {
        return new Promise(function (resolve) {
          window.setTimeout(resolve, ms);
        });
      }

      var checkAttempt = function (attempt) {

        return wait(delays[attempt - 1])
          .then(function () {

            Diagnostics.info(
              "HISTORY",
              "Verificando marcaje en historial",
              {
                attempt: attempt,
                maxAttempts: maxAttempts,
                employeeId: employee.id,
                field: field,
                date: todayIso
              }
            );

            return AttendanceService.readHistory(
              serviceRoot,
              historyIdentifier,
              todayIso,
              employee.id,
              { dateTo: todayIso }
            );

          })
          .then(function (history) {

            var today = history.filter(function (day) {
              return day.isoDate === todayIso;
            })[0];

            var registeredValue =
              today && today[field];

            var confirmed = Boolean(
              registeredValue &&
              registeredValue !== "—"
            );

            if (confirmed) {

              // Aplicar datos solamente cuando
              // el marcaje esperado está visible.
              attendanceModel.setProperty(
                "/history",
                history
              );

              this._applyTodayFromHistory(history);

              appModel.setProperty(
                "/historyError",
                ""
              );

              return {
                confirmed: true,
                registeredValue: registeredValue,
                attempts: attempt
              };
            }

            if (attempt < maxAttempts) {
              return checkAttempt(attempt + 1);
            }

            return {
              confirmed: false,
              registeredValue: null,
              attempts: attempt,
              reason: "NOT_VISIBLE_YET"
            };

          }.bind(this))
          .catch(function (error) {

            lastError = error;

            Diagnostics.warn(
              "HISTORY",
              "No fue posible verificar el marcaje",
              {
                attempt: attempt,
                message: error.message
              }
            );

            if (attempt < maxAttempts) {
              return checkAttempt(attempt + 1);
            }

            return {
              confirmed: false,
              registeredValue: null,
              attempts: attempt,
              reason: "HISTORY_REQUEST_FAILED",
              message: lastError.message
            };

          });

      }.bind(this);

      return checkAttempt(1).finally(function () {

        appModel.setProperty(
          "/historyLoading",
          false
        );

      });
    },

    _updateActionUI: function () {
      var model = this.getView().getModel("attendance");
      if (!model) { return; }
      var update = function () {
        var action = model.getProperty("/today/nextAction");
        var idle = !this._markRequestInProgress;
        this.byId("checkInAction").setEnabled(idle && action === "CHECK_IN" && this._isActionAuthorized("CHECK_IN"));
        this.byId("mealStartAction").setEnabled(idle && action === "MEAL_START" && this._isActionAuthorized("MEAL_START"));
        this.byId("mealEndAction").setEnabled(idle && action === "MEAL_END" && this._isActionAuthorized("MEAL_END"));
        this.byId("checkOutAction").setEnabled(idle && Boolean(model.getProperty("/today/canCheckOut")) && this._isActionAuthorized("CHECK_OUT"));

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
 */

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

  function localIsoDate(date) {
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  }

  function localClock(date) {
    return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
  }

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

  function isHomeOfficeStatus(value) {
    return /HOME\s*OFFIC|HOME\s*OFFICE|REMOT[OA]|TELETRABAJO/.test(normalizeWords(value));
  }

  function normalizeIsoDateValue(value) {
    var text = String(value || "").trim();
    var ticks = text.match(/^\/Date\((\d+)/);

    if (ticks) {
      return localIsoDate(new Date(Number(ticks[1])));
    }
    if (/^\d{8}$/.test(text)) {
      return text.slice(0, 4) + "-" + text.slice(4, 6) + "-" + text.slice(6, 8);
    }
    return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : "";
  }

  function workSessionCode(values) {
    var directCode = "";
    var normalizedValues = (values || []).filter(function (value) {
      return value !== undefined && value !== null && String(value).trim() !== "";
    });

    normalizedValues.some(function (value) {
      var normalized = normalizeWords(value).trim();
      if (normalized === "HO" || normalized === "VN") {
        directCode = normalized;
        return true;
      }
      return false;
    });

    if (directCode) { return directCode; }
    if (normalizedValues.some(isTravelStatus)) { return "VN"; }
    if (normalizedValues.some(isHomeOfficeStatus)) { return "HO"; }
    return "";
  }

  function browserUrlCandidates() {
    var candidates = [window.location.href, document.referrer];

    try {
      candidates.push(window.parent.location.href);
    } catch (ignoreParent) {
      // El Launchpad puede estar en un origen distinto.
    }

    try {
      candidates.push(window.top.location.href);
    } catch (ignoreTop) {
      // El Launchpad puede estar en un origen distinto.
    }

    return candidates.filter(Boolean);
  }

  function enabledFlagValue(value) {
    var firstValue = Array.isArray(value) ? value[0] : value;
    return /^(1|true|yes)$/i.test(String(firstValue || ""));
  }

  function urlFlagEnabled(name) {
    var expression = new RegExp("(?:[?&#])" + name + "=([^&#]*)", "i");

    return browserUrlCandidates().some(function (candidate) {
      var match = String(candidate).match(expression);
      return match && enabledFlagValue(decodeURIComponent(match[1]));
    });
  }

  function isTestEnvironment() {
    return browserUrlCandidates().some(function (candidate) {
      try {
        var hostname = new URL(candidate, window.location.href).hostname.toLowerCase();
        return hostname === "localhost" ||
          hostname === "127.0.0.1" ||
          hostname.indexOf("qas") >= 0;
      } catch (ignoreInvalidUrl) {
        return false;
      }
    });
  }

  function isLateTestEnabled(controller) {
    var componentData = controller.getOwnerComponent().getComponentData() || {};
    var startupParameters = componentData.startupParameters || {};
    var requested = urlFlagEnabled("testLate") ||
      enabledFlagValue(startupParameters.testLate);

    return requested && isTestEnvironment();
  }

  function resolveServiceRoot(serviceRoot) {
    var configuredRoot = String(serviceRoot || "").trim();
    var cleanRoot;
    var componentRoot;
    var pathname;
    var directory;

    if (!configuredRoot) {
      return "";
    }

    if (/^(?:https?:)?\/\//i.test(configuredRoot) || configuredRoot.charAt(0) === "/") {
      return configuredRoot.replace(/\/?$/, "/");
    }

    cleanRoot = configuredRoot.replace(/^\.\//, "").replace(/^\/+/, "");

    try {
      componentRoot = sap.ui.require.toUrl("com/mitsu/checkin/");
      if (componentRoot) {
        return new URL(
          cleanRoot,
          new URL(componentRoot.replace(/\/?$/, "/"), window.location.href)
        ).toString().replace(/\/?$/, "/");
      }
    } catch (ignoreComponentRoot) {
      // Se conserva el respaldo basado en pathname para la ejecución local.
    }

    pathname = window.location.pathname || "/";
    directory = pathname.slice(0, pathname.lastIndexOf("/") + 1) || "/";

    if (directory === "/" || directory === "/test/" || directory.endsWith("/test/")) {
      return ("/" + cleanRoot).replace(/\/?$/, "/");
    }

    return (directory + cleanRoot).replace(/\/?$/, "/");
  }

  return Controller.extend("com.mitsu.checkin.controller.Main", {
    onInit: function () {
      Diagnostics.info("UI", "Main.controller inicializado", {
        hasActiveIdentity: IdentityService.hasActiveIdentity()
      });
      this._selectedSection = "attendance";
      this._markRequestInProgress = false;
      this.getView().setModel(new JSONModel({ sideExpanded: false }), "ui");
      this._updateActionUI();
      this._startClock();
      this.getView().getModel("app").setProperty("/requiresIdentity", false);
      if (IdentityService.hasActiveIdentity()) {
        this._loadEmployeeAfterInitialData(false);
      } else {
        this._initializeAuthenticatedIdentity();
      }
    },

    onAfterRendering: function () {
      if (this._initialLayoutSynchronized) {
        return;
      }

      this._initialLayoutSynchronized = true;
      this._layoutSyncTimers = [0, 150, 500].map(function (delay) {
        return window.setTimeout(function () {
          window.dispatchEvent(new Event("resize"));
        }, delay);
      });
    },

    _initializeAuthenticatedIdentity: function () {
      var appModel = this.getView().getModel("app");
      // La vista principal nunca se bloquea con una pantalla intermedia.
      // La identidad y el perfil se resuelven en segundo plano.
      appModel.setProperty("/requiresIdentity", false);
      appModel.setProperty("/identityLoading", true);
      appModel.setProperty("/identityLookupError", "");
      appModel.setProperty("/employeeError", "");
      appModel.setProperty("/employeeLoading", true);

      Diagnostics.info("IDENTITY", "Consultando el usuario de la sesión BTP", {});
      return IdentityService.loadAuthenticatedIdentity().then(function (identity) {
        this._activeIdentity = identity;
        appModel.setProperty("/requiresIdentity", false);
        Diagnostics.info("IDENTITY", "Se usará la identidad autenticada para consultar EmployeeSet", identity);
        return this._loadEmployeeAfterInitialData(false);
      }.bind(this)).catch(function (error) {
        Diagnostics.error("IDENTITY", "No fue posible iniciar con la identidad BTP", error);
        appModel.setProperty("/identityLookupError", error.message);
        appModel.setProperty("/employeeError", error.message);
        appModel.setProperty("/requiresIdentity", false);
        appModel.setProperty("/employeeLoading", false);
      }).finally(function () {
        appModel.setProperty("/identityLoading", false);
      });
    },

    onExit: function () {
      if (this._clockInterval) {
        clearInterval(this._clockInterval);
      }
      (this._layoutSyncTimers || []).forEach(function (timer) {
        window.clearTimeout(timer);
      });
      this._layoutSyncTimers = [];
      if (this._lateJustificationDialogPromise) {
        this._lateJustificationDialogPromise.then(function (dialog) {
          dialog.destroy();
        });
        this._lateJustificationDialogPromise = null;
      }
      if (this._earlyExitJustificationDialogPromise) {
        this._earlyExitJustificationDialogPromise.then(function (dialog) {
          dialog.destroy();
        });
        this._earlyExitJustificationDialogPromise = null;
      }
      if (this._workModalityDialogPromise) {
        this._workModalityDialogPromise.then(function (dialog) {
          dialog.destroy();
        });
        this._workModalityDialogPromise = null;
      }
    },

    _loadEmployeeAfterInitialData: function (fromTemporaryAccess) {
      var attendanceModel = this.getView().getModel("attendance");
      if (attendanceModel.getProperty("/employee")) {
        return this._loadEmployee(fromTemporaryAccess);
      }

      return new Promise(function (resolve, reject) {
        var onCompleted = function () {
          attendanceModel.detachRequestCompleted(onCompleted, this);
          this._loadEmployee(fromTemporaryAccess).then(resolve, reject);
        }.bind(this);
        attendanceModel.attachRequestCompleted(onCompleted, this);
      }.bind(this));
    },

    _loadEmployee: function (fromTemporaryAccess) {
      var appModel = this.getView().getModel("app");
      var attendanceModel = this.getView().getModel("attendance");
      var dataSource = this.getOwnerComponent().getManifestEntry("/sap.app/dataSources/attendanceOData");
      var serviceRoot = resolveServiceRoot(dataSource.uri);
      var identity = IdentityService.getActiveIdentity();
      Diagnostics.info("FLOW", "Iniciando consulta del empleado", {
        configuredServiceRoot: dataSource.uri,
        serviceRoot: serviceRoot,
        identity: identity,
        temporaryAccess: Boolean(fromTemporaryAccess)
      });

      this._activeIdentity = identity;

      appModel.setProperty("/employeeLoading", true);
      appModel.setProperty("/employeeError", "");
      appModel.setProperty("/identityLookupError", "");

      return EmployeeService.readEmployee(serviceRoot, identity).then(function (employee) {
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
          appModel.setProperty("/employeeError", error.message);
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
      var serviceRoot = resolveServiceRoot(dataSource.uri);

      return EmployeeService.readSchedule(serviceRoot, employee).then(function (schedule) {
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

    onRetryIdentity: function () {
      IdentityService.clearIdentity();
      this._initializeAuthenticatedIdentity();
    },

    onLogout: function () {
      MessageBox.confirm("¿Deseas cerrar la sesión de Work Zone?", {
        title: "Cerrar sesión",
        emphasizedAction: MessageBox.Action.OK,
        onClose: function (result) {
          if (result === MessageBox.Action.OK) {
            this._performLogout();
          }
        }.bind(this)
      });
    },

    _performLogout: function () {
      var container = window.sap && window.sap.ushell && window.sap.ushell.Container;

      IdentityService.clearIdentity();
      this._activeIdentity = null;
      this._markRequestInProgress = false;
      this.getView().getModel("app").setProperty("/busy", true);

      try {
        if (container && typeof container.logout === "function") {
          var logoutResult = container.logout();
          if (logoutResult && typeof logoutResult.catch === "function") {
            logoutResult.catch(function () {
              window.location.replace("/do/logout");
            });
          }
          return;
        }
      } catch (error) {
        Diagnostics.warn("IDENTITY", "El shell no pudo cerrar la sesión; se usará la ruta estándar", {
          message: error.message
        });
      }

      window.location.replace("/do/logout");
    },

    onRefreshData: function () {
      var appModel = this.getView().getModel("app");

      if (!IdentityService.hasActiveIdentity()) {
        this._initializeAuthenticatedIdentity();
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
      var serviceRoot = resolveServiceRoot(dataSource.uri);
      var now = new Date();
      var enterDate = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
      var identity = this._activeIdentity || IdentityService.getActiveIdentity() || {};
      // EmployeeSet ya resolvió la nómina del colaborador. El historial debe
      // consultarse directamente con ese PersonalNumber, no nuevamente por correo.
      var historyIdentifier = employee.id || identity.personalNumber || identity.email;
      Diagnostics.info("FLOW", "Iniciando consulta del historial", {
        configuredServiceRoot: dataSource.uri,
        serviceRoot: serviceRoot,
        identifier: historyIdentifier,
        filterField: employee.id ? "PersonalNumber" : (String(historyIdentifier).indexOf("@") >= 0 ? "Email" : "PersonalNumber"),
        dateFrom: enterDate.replace(/-/g, ""),
        dateTo: enterDate.replace(/-/g, "")
      });

      appModel.setProperty("/historyLoading", true);
      appModel.setProperty("/historyError", "");
      return AttendanceService.readHistory(
        serviceRoot,
        historyIdentifier,
        enterDate,
        employee.id,
        { dateTo: enterDate }
      ).then(function (history) {
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

    _markStorageKey: function (action, employee) {
      var employeeId = String(employee && (employee.id || employee.email) || "").trim().toLowerCase();
      return "mitsu.checkin.sent." + localIsoDate(new Date()) + "." + employeeId + "." + action;
    },

    _rememberMark: function (action, employee, value) {
      try {
        window.sessionStorage.setItem(this._markStorageKey(action, employee), String(value || ""));
      } catch (error) {
        Diagnostics.warn("FLOW", "No fue posible guardar la protección local contra doble marcaje", {
          action: action,
          message: error.message
        });
      }
    },

    _rememberedMark: function (action, employee) {
      try {
        return window.sessionStorage.getItem(this._markStorageKey(action, employee)) || "";
      } catch (error) {
        return "";
      }
    },

    _applyTodayFromHistory: function (history) {
      var model = this.getView().getModel("attendance");
      var todayIso = localIsoDate(new Date());
      var today = history.filter(function (item) { return item.isoDate === todayIso; })[0] || {};
      var employee = model.getProperty("/employee") || {};
      var entry = today.entry || this._rememberedMark("CHECK_IN", employee) || "—";
      var mealStart = today.mealStart || this._rememberedMark("MEAL_START", employee) || "—";
      var mealEnd = today.mealEnd || this._rememberedMark("MEAL_END", employee) || "—";
      var exit = today.exit || this._rememberedMark("CHECK_OUT", employee) || "—";
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
      model.setProperty("/today/isHomeOffice", Boolean(today.isHomeOffice));
      model.setProperty("/today/typeSession", today.typeSession || "");
      model.setProperty("/today/sessionDateFrom", today.sessionDateFrom || "");
      model.setProperty("/today/sessionDateTo", today.sessionDateTo || "");
      model.setProperty("/today/workModalityConfirmed", entry !== "—");
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
      var historyHomeOffice = Boolean(model.getProperty("/today/isHomeOffice"));
      var employeeHomeOffice = [employee.typeSession, employee.dayStatus, employee.status, employee.statusDescription]
        .some(isHomeOfficeStatus);
      var modalityConfirmed = Boolean(model.getProperty("/today/workModalityConfirmed"));
      var confirmedTypeSession = String(model.getProperty("/today/typeSession") || "").trim().toUpperCase();
      var typeSession = modalityConfirmed && ["", "HO", "VN"].indexOf(confirmedTypeSession) >= 0
        ? confirmedTypeSession
        : workSessionCode([
          model.getProperty("/today/typeSession"),
          employee.typeSession,
          employee.dayStatus,
          employee.status,
          employee.statusDescription
        ]);
      var isTravel = modalityConfirmed
        ? typeSession === "VN"
        : (typeSession === "VN" || historyTravel || employeeTravel);
      var isHomeOffice = modalityConfirmed
        ? typeSession === "HO"
        : (typeSession === "HO" || historyHomeOffice || employeeHomeOffice);
      var todayDate = localIsoDate(current);
      var sessionDateFrom;
      var sessionDateTo;

      if (isTravel) {
        typeSession = "VN";
      } else if (isHomeOffice) {
        typeSession = "HO";
      } else {
        typeSession = "";
      }

      if (typeSession === "VN") {
        sessionDateFrom = modalityConfirmed
          ? (normalizeIsoDateValue(model.getProperty("/today/sessionDateFrom")) || normalizeIsoDateValue(employee.dateFrom) || todayDate)
          : (normalizeIsoDateValue(employee.dateFrom) || normalizeIsoDateValue(model.getProperty("/today/sessionDateFrom")) || todayDate);
        sessionDateTo = modalityConfirmed
          ? (normalizeIsoDateValue(model.getProperty("/today/sessionDateTo")) || normalizeIsoDateValue(employee.dateTo) || todayDate)
          : (normalizeIsoDateValue(employee.dateTo) || normalizeIsoDateValue(model.getProperty("/today/sessionDateTo")) || todayDate);
      } else {
        sessionDateFrom = todayDate;
        sessionDateTo = todayDate;
      }
      var forceLateTest = isLateTestEnabled(this);
      var isLateNow = !hasEntry && (forceLateTest ||
        (startMinutes !== null && currentMinutes > startMinutes));
      var canCheckOut = hasEntry && !hasExit;
      var isEarlyExit = canCheckOut && endMinutes !== null && currentMinutes < endMinutes;
      var mealStartAllowed = !isMealWindowRestricted || isWithinMealWindow;
      var mealEndAllowed = !isMealWindowRestricted || isWithinMealWindow;
      var scheduleLabel = schedule.start && schedule.end ? schedule.start + "–" + schedule.end : "";
      var messageType = "Information";
      var message = scheduleLabel ? "Horario de hoy: " + scheduleLabel + "." : "SAP no expuso las horas del turno; se validará la secuencia de marcajes.";

      if (forceLateTest && isLateNow && nextAction === "CHECK_IN") {
        message = "MODO DE PRUEBA: la entrada tardía está forzada temporalmente.";
        messageType = "Warning";
      } else if (typeSession === "VN") {
        message = "Viaje de negocios identificado. Se enviará TypeSession VN y el periodo autorizado a SAP.";
        messageType = "Information";
      } else if (typeSession === "HO") {
        message = "Home Office identificado. Se enviará TypeSession HO y la fecha del día a SAP.";
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
      model.setProperty("/today/canCheckOut", canCheckOut);
      model.setProperty("/today/isTravel", typeSession === "VN");
      model.setProperty("/today/isHomeOffice", typeSession === "HO");
      model.setProperty("/today/typeSession", typeSession);
      model.setProperty("/today/workModalityText", typeSession === "VN" ? "Viaje de negocios" : (typeSession === "HO" ? "Home Office" : "Presencial"));
      model.setProperty("/today/sessionDateFrom", sessionDateFrom);
      model.setProperty("/today/sessionDateTo", sessionDateTo);
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
      if (action === "CHECK_OUT" && model.getProperty("/today/canCheckOut")) {
        return true;
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

    _showSection: function (section) {
      this.byId("attendanceView").setVisible(true);
      this._selectedSection = "attendance";
      this.byId("navigationList").setSelectedKey(this._selectedSection);
    },

    onCheckIn: function () {
      this._confirmAction("CHECK_IN");
    },

    _openWorkModalityDialog: function (pendingAction) {
      var model = this.getView().getModel("attendance");
      var typeSession = String(model.getProperty("/today/typeSession") || "").trim().toUpperCase();
      var isBusinessTrip = typeSession === "VN";

      model.setProperty("/today/workModalityDraft", {
        typeSession: ["HO", "VN"].indexOf(typeSession) >= 0 ? typeSession : "",
        dateFrom: isBusinessTrip ? normalizeIsoDateValue(model.getProperty("/today/sessionDateFrom")) : "",
        dateTo: isBusinessTrip ? normalizeIsoDateValue(model.getProperty("/today/sessionDateTo")) : "",
        error: ""
      });
      this._pendingActionAfterModality = pendingAction || "CHECK_IN";

      this._getWorkModalityDialog().then(function (dialog) {
        dialog.open();
      });
    },

    _getWorkModalityDialog: function () {
      if (!this._workModalityDialogPromise) {
        this._workModalityDialogPromise = Fragment.load({
          id: this.getView().getId(),
          name: "com.mitsu.checkin.view.fragments.WorkModalityDialog",
          controller: this
        }).then(function (dialog) {
          this.getView().addDependent(dialog);
          return dialog;
        }.bind(this));
      }
      return this._workModalityDialogPromise;
    },

    onWorkModalityChange: function (event) {
      var model = this.getView().getModel("attendance");
      var source = event && event.getSource && event.getSource();

      if (source && source.getSelectedKey) {
        model.setProperty("/today/workModalityDraft/typeSession", source.getSelectedKey());
      }
      model.setProperty("/today/workModalityDraft/error", "");
    },

    onSaveWorkModality: function () {
      var model = this.getView().getModel("attendance");
      var draft = model.getProperty("/today/workModalityDraft") || {};
      var typeSession = String(draft.typeSession || "").trim().toUpperCase();
      var todayDate = localIsoDate(new Date());
      var dateFrom = normalizeIsoDateValue(draft.dateFrom);
      var dateTo = normalizeIsoDateValue(draft.dateTo);
      var error = "";

      if (["", "HO", "VN"].indexOf(typeSession) < 0) {
        error = "Selecciona una modalidad válida.";
      } else if (typeSession === "VN" && (!dateFrom || !dateTo)) {
        error = "Captura las fechas de inicio y fin del viaje de negocios.";
      } else if (typeSession === "VN" && dateFrom > dateTo) {
        error = "La fecha de inicio del viaje no puede ser posterior a la fecha final.";
      } else if (typeSession === "VN" && (todayDate < dateFrom || todayDate > dateTo)) {
        error = "La fecha actual debe encontrarse dentro del periodo del viaje de negocios.";
      }

      if (error) {
        model.setProperty("/today/workModalityDraft/error", error);
        return;
      }

      if (typeSession !== "VN") {
        dateFrom = todayDate;
        dateTo = todayDate;
      }

      model.setProperty("/today/typeSession", typeSession);
      model.setProperty("/today/isHomeOffice", typeSession === "HO");
      model.setProperty("/today/isTravel", typeSession === "VN");
      model.setProperty("/today/workModalityText", typeSession === "VN" ? "Viaje de negocios" : (typeSession === "HO" ? "Home Office" : "Presencial"));
      model.setProperty("/today/sessionDateFrom", dateFrom);
      model.setProperty("/today/sessionDateTo", dateTo);
      model.setProperty("/today/workModalityConfirmed", true);
      model.setProperty("/today/workModalityDraft/error", "");

      Diagnostics.info("MODALITY", "Modalidad confirmada antes del marcaje", {
        typeSession: typeSession,
        dateFrom: dateFrom,
        dateTo: dateTo
      });

      var pendingAction = this._pendingActionAfterModality || "CHECK_IN";
      this._pendingActionAfterModality = null;
      this._getWorkModalityDialog().then(function (dialog) {
        dialog.close();
        window.setTimeout(function () {
          this._confirmAction(pendingAction);
        }.bind(this), 0);
      }.bind(this));
    },

    onCancelWorkModality: function () {
      this._pendingActionAfterModality = null;
      this.getView().getModel("attendance").setProperty("/today/workModalityDraft/error", "");
      this._getWorkModalityDialog().then(function (dialog) {
        dialog.close();
      });
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
      MessageToast.show("Enviando entrada y justificación a SAP");
      this._register("CHECK_IN");
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

    onOpenEarlyExitJustification: function () {
      var model = this.getView().getModel("attendance");
      var justification = model.getProperty("/today/earlyExitJustification") || {};
      this._earlyExitJustificationSnapshot = JSON.parse(JSON.stringify(justification));
      model.setProperty("/today/earlyExitJustification/error", "");
      this._getEarlyExitJustificationDialog().then(function (dialog) {
        dialog.open();
      });
    },

    _getEarlyExitJustificationDialog: function () {
      if (!this._earlyExitJustificationDialogPromise) {
        this._earlyExitJustificationDialogPromise = Fragment.load({
          id: this.getView().getId(),
          name: "com.mitsu.checkin.view.fragments.EarlyExitJustificationDialog",
          controller: this
        }).then(function (dialog) {
          this.getView().addDependent(dialog);
          return dialog;
        }.bind(this));
      }
      return this._earlyExitJustificationDialogPromise;
    },

    onEarlyExitJustificationChange: function () {
      this.getView().getModel("attendance").setProperty("/today/earlyExitJustification/error", "");
    },

    onSaveEarlyExitJustification: function () {
      var model = this.getView().getModel("attendance");
      var reason = String(model.getProperty("/today/earlyExitJustification/reason") || "").trim();

      if (!reason) {
        model.setProperty("/today/earlyExitJustification/error", "Selecciona el motivo de la salida anticipada.");
        return;
      }

      model.setProperty("/today/earlyExitJustification/reason", reason);
      model.setProperty("/today/earlyExitJustification/comment", String(model.getProperty("/today/earlyExitJustification/comment") || "").trim());
      model.setProperty("/today/earlyExitJustification/saved", true);
      model.setProperty("/today/earlyExitJustification/error", "");
      model.setProperty("/today/earlyExitJustificationButtonText", "Editar justificación");
      this._earlyExitJustificationSnapshot = null;
      this._getEarlyExitJustificationDialog().then(function (dialog) {
        dialog.close();
      });
      MessageToast.show("Enviando justificación y salida a SAP");
      this._register("CHECK_OUT");
    },

    onCancelEarlyExitJustification: function () {
      if (this._earlyExitJustificationSnapshot) {
        this.getView().getModel("attendance").setProperty("/today/earlyExitJustification", this._earlyExitJustificationSnapshot);
      }
      this._earlyExitJustificationSnapshot = null;
      this._getEarlyExitJustificationDialog().then(function (dialog) {
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

      if (this._markRequestInProgress) {
        MessageToast.show(
          "Existe un marcaje en proceso de confirmación. " +
          "Evita enviarlo nuevamente."
        );
        return;
      }

      var model = this.getView().getModel("attendance");
      if (requestedAction === "CHECK_IN" && !model.getProperty("/today/workModalityConfirmed")) {
        this._openWorkModalityDialog(requestedAction);
        return;
      }
      var action = model.getProperty("/today/nextAction");
      var hasEntry = model.getProperty("/today/entry") && model.getProperty("/today/entry") !== "—";
      var hasExit = model.getProperty("/today/exit") && model.getProperty("/today/exit") !== "—";
      var checkoutWithoutMeal = requestedAction === "CHECK_OUT" && hasEntry && !hasExit;
      if (action !== requestedAction && !checkoutWithoutMeal) {
        MessageToast.show("Completa primero el marcaje anterior");
        return;
      }
      action = requestedAction;
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
      if (isEarlyExit && !model.getProperty("/today/earlyExitJustification/saved")) {
        MessageToast.show("Agrega la justificación antes de registrar la salida anticipada");
        this.onOpenEarlyExitJustification();
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
            this._register(action);
          }
        }.bind(this)
      });
    },


    _register: function (action) {

      var appModel = this.getView().getModel("app");
      var attendanceModel = this.getView().getModel("attendance");

      var dataSource = this.getOwnerComponent()
        .getManifestEntry("/sap.app/dataSources/attendanceOData");
      var serviceRoot = resolveServiceRoot(dataSource.uri);

      var employee = attendanceModel.getProperty("/employee");
      var config = ACTION_CONFIG[action];
      var registeredValue = config && attendanceModel.getProperty("/today/" + config.field);

      // Evitar múltiples POST simultáneos.
      if (this._markRequestInProgress) {
        MessageToast.show(
          "Ya existe un marcaje en proceso."
        );
        return;
      }

      if (!config || !employee || !employee.id) {
        MessageBox.error("No se puede registrar el evento porque el colaborador todavía no está identificado.");
        return Promise.resolve();
      }

      if (registeredValue && registeredValue !== "—") {
        MessageToast.show("Este marcaje ya está registrado. Se actualizarán los datos desde SAP.");
        this.onRefreshData();
        return Promise.resolve();
      }

      if ((action === "CHECK_OUT" && !attendanceModel.getProperty("/today/canCheckOut")) ||
          (action !== "CHECK_OUT" && attendanceModel.getProperty("/today/nextAction") !== action)) {
        MessageToast.show("El marcaje ya no corresponde al estado actual de la jornada");
        this.onRefreshData();
        return Promise.resolve();
      }

      if (!this._isActionAuthorized(action)) {
        MessageToast.show("Este marcaje no está autorizado por SAP");
        return Promise.resolve();
      }

      if (action === "CHECK_IN" && !attendanceModel.getProperty("/today/workModalityConfirmed")) {
        this._openWorkModalityDialog(action);
        return Promise.resolve();
      }

      var typeSession = String(attendanceModel.getProperty("/today/typeSession") || "").trim().toUpperCase();
      var sessionDateFrom = normalizeIsoDateValue(attendanceModel.getProperty("/today/sessionDateFrom"));
      var sessionDateTo = normalizeIsoDateValue(attendanceModel.getProperty("/today/sessionDateTo"));
      var todayDate = localIsoDate(new Date());

      if (["", "HO", "VN"].indexOf(typeSession) < 0) {
        MessageBox.error("La modalidad de trabajo recibida de SAP no es válida. Solo se acepta presencial, HO o VN.");
        return Promise.resolve();
      }

      if (typeSession !== "VN") {
        sessionDateFrom = todayDate;
        sessionDateTo = todayDate;
      } else {
        sessionDateFrom = sessionDateFrom || todayDate;
        sessionDateTo = sessionDateTo || todayDate;
        if (sessionDateFrom > sessionDateTo) {
          MessageBox.error("El inicio del viaje de negocios no puede ser posterior a su fecha de finalización.");
          return Promise.resolve();
        }
        if (todayDate < sessionDateFrom || todayDate > sessionDateTo) {
          MessageBox.error("La fecha actual no se encuentra dentro del periodo autorizado para el viaje de negocios.");
          return Promise.resolve();
        }
      }

      this._markRequestInProgress = true;
      appModel.setProperty("/busy", true);

      var wasLateEntry = action === "CHECK_IN" &&
        Boolean(attendanceModel.getProperty("/today/isLateNow"));

      var wasEarlyExit = action === "CHECK_OUT" &&
        Boolean(attendanceModel.getProperty("/today/isEarlyExit"));

      var lateJustification =
        attendanceModel.getProperty(
          "/today/lateJustification"
        ) || {};

      var earlyExitJustification =
        attendanceModel.getProperty(
          "/today/earlyExitJustification"
        ) || {};

      Diagnostics.info(
        "FLOW",
        "Iniciando proceso de marcaje",
        {
          action: action,
          employeeId: employee && employee.id,
          isLate: wasLateEntry,
          isEarlyExit: wasEarlyExit,
          typeSession: typeSession,
          dateFrom: sessionDateFrom,
          dateTo: sessionDateTo
        }
      );

      // Primero recuperar ubicación.
      return AttendanceService.captureLocation()

        .then(function (location) {

          location = location || {};

          // La ubicación es informativa para el usuario.
          // SAP determina GeoStatus.
          if (location.warning) {

            Diagnostics.warn(
              "LOCATION",
              "Advertencia de ubicación",
              {
                message: location.warning,
                accuracy: location.accuracy
              }
            );

            MessageToast.show(
              location.warning,
              { duration: 5000 }
            );
          }

          Diagnostics.info(
            "FLOW",
            "Enviando marcaje a SAP",
            {
              action: action,
              employeeId: employee && employee.id,
              hasLocation: Boolean(
                location.latitude &&
                location.longitude
              ),
              accuracy: location.accuracy
            }
          );

          return AttendanceService.mark(
            serviceRoot,
            action,
            employee,
            this._activeIdentity &&
            this._activeIdentity.device,
            {
              isLate: wasLateEntry,
              isEarlyExit: wasEarlyExit,
              lateJustification: wasLateEntry
                ? lateJustification
                : null,
              earlyExitJustification: wasEarlyExit
                ? earlyExitJustification
                : null,
              typeSession: typeSession,
              dateFrom: sessionDateFrom,
              dateTo: sessionDateTo,
              location: location
            }
          );

        }.bind(this))

        .then(function (result) {

          var sapStatus = String(
            result.sapStatus || ""
          ).trim().toUpperCase();

          if (sapStatus !== "OK") {
            throw new Error(
              result.sapMessage ||
              "SAP no confirmó el marcaje."
            );
          }

          var optimisticValue = localClock(result.registeredAt || new Date());
          attendanceModel.setProperty("/today/" + config.field, optimisticValue);
          this._rememberMark(action, employee, optimisticValue);
          this._evaluateAttendanceContext();

          Diagnostics.info(
            "MARK",
            "Marcaje confirmado por SAP",
            {
              flowId: result.flowId,
              action: action,
              postsCompleted: result.justification ? 2 : 1,
              sapStatus: sapStatus,
              sapMessage: result.sapMessage,
              sapGeoStatus: result.sapGeoStatus,
              sapEntity: result.sapEntity,
              justification: result.justification
            }
          );

          // Mensaje de éxito basado en la respuesta SAP.
          var successMessage = wasEarlyExit
            ? "Salida temprana registrada"
            : (
              wasLateEntry
                ? "Entrada tarde registrada con su justificación"
                : config.title + " correctamente"
            );

          MessageToast.show(successMessage, {
            duration: 4000
          });

          // Actualización del historial independiente.
          this._confirmMarkInHistory(
            employee,
            config.field,
            3
          ).then(function (confirmation) {

            if (confirmation.confirmed) {

              Diagnostics.info(
                "HISTORY",
                "Marcaje visible en AttendanceHistorySet",
                confirmation
              );

            } else {

              Diagnostics.warn(
                "HISTORY",
                "SAP confirmó el marcaje, pero " +
                "el historial aún no lo refleja.",
                confirmation
              );

              MessageToast.show(
                "Marcaje aceptado por SAP. " +
                "El historial todavía no está actualizado.",
                { duration: 6000 }
              );
            }

          }).catch(function (historyError) {

            Diagnostics.warn(
              "HISTORY",
              "No fue posible actualizar el historial",
              {
                message: historyError.message
              }
            );

            MessageToast.show(
              "Marcaje aceptado por SAP. " +
              "Actualiza los datos para consultar el historial.",
              { duration: 6000 }
            );

          }).finally(function () {

            // Recuperar las acciones según el historial.
            this._markRequestInProgress = false;
            this._updateActionUI();

          }.bind(this));

          return result;

        }.bind(this))

        .catch(function (error) {

          if (error.attendanceRecorded && error.attendanceResult) {
            var partialResult = error.attendanceResult;
            var partialValue = localClock(partialResult.registeredAt || new Date());

            attendanceModel.setProperty("/today/" + config.field, partialValue);
            this._rememberMark(action, employee, partialValue);
            this._evaluateAttendanceContext();

            Diagnostics.error(
              "FLOW",
              "AttendanceRecordSet fue aceptado, pero falló JustificationLogSet",
              {
                flowId: error.flowId || partialResult.flowId,
                action: action,
                attendanceResult: partialResult,
                message: error.message
              }
            );

            MessageBox.error(
              "La entrada sí quedó registrada, pero SAP no aceptó la justificación. " +
              "No vuelvas a registrar la entrada. Detalle: " +
              (error.message || "Error no especificado")
            );

            this._markRequestInProgress = false;
            this._updateActionUI();
            return;
          }

          Diagnostics.error(
            "FLOW",
            "No fue posible confirmar el marcaje",
            error
          );

          var message = error.message ||
            "Ocurrió un problema durante el marcaje.";

          if (
            error.name === "RequestTimeoutError" ||
            error.name === "UnconfirmedMarkError" ||
            error.status === 504
          ) {

            MessageBox.warning(
              "No fue posible confirmar el resultado " +
              "del marcaje. " +
              "Consulta el historial antes de volver " +
              "a registrarlo. Detalle: " + message
            );

          } else {

            MessageBox.error(
              "No fue posible registrar el evento en SAP. " +
              message
            );
          }

          this._markRequestInProgress = false;

        }.bind(this))

        .finally(function () {

          appModel.setProperty("/busy", false);

        });
    },


    _confirmMarkInHistory: function (
      employee,
      field,
      attemptsRemaining
    ) {

      var attendanceModel =
        this.getView().getModel("attendance");

      var appModel =
        this.getView().getModel("app");

      var dataSource = this.getOwnerComponent()
        .getManifestEntry(
          "/sap.app/dataSources/attendanceOData"
        );
      var serviceRoot = resolveServiceRoot(dataSource.uri);

      var now = new Date();
      var todayIso = localIsoDate(now);

      var identity = this._activeIdentity ||
        IdentityService.getActiveIdentity() || {};

      var historyIdentifier =
        employee.id ||
        identity.personalNumber ||
        identity.email;

      var delays = [1500, 3000, 5000];

      var maxAttempts = Math.max(
        1,
        Math.min(attemptsRemaining || 3, delays.length)
      );

      var lastError = null;

      appModel.setProperty("/historyLoading", true);

      function wait(ms) {
        return new Promise(function (resolve) {
          window.setTimeout(resolve, ms);
        });
      }

      var checkAttempt = function (attempt) {

        return wait(delays[attempt - 1])
          .then(function () {

            Diagnostics.info(
              "HISTORY",
              "Verificando marcaje en historial",
              {
                attempt: attempt,
                maxAttempts: maxAttempts,
                employeeId: employee.id,
                field: field,
                date: todayIso
              }
            );

            return AttendanceService.readHistory(
              serviceRoot,
              historyIdentifier,
              todayIso,
              employee.id,
              { dateTo: todayIso }
            );

          })
          .then(function (history) {

            var today = history.filter(function (day) {
              return day.isoDate === todayIso;
            })[0];

            var registeredValue =
              today && today[field];

            var confirmed = Boolean(
              registeredValue &&
              registeredValue !== "—"
            );

            if (confirmed) {

              // Aplicar datos solamente cuando
              // el marcaje esperado está visible.
              attendanceModel.setProperty(
                "/history",
                history
              );

              this._applyTodayFromHistory(history);

              appModel.setProperty(
                "/historyError",
                ""
              );

              return {
                confirmed: true,
                registeredValue: registeredValue,
                attempts: attempt
              };
            }

            if (attempt < maxAttempts) {
              return checkAttempt(attempt + 1);
            }

            return {
              confirmed: false,
              registeredValue: null,
              attempts: attempt,
              reason: "NOT_VISIBLE_YET"
            };

          }.bind(this))
          .catch(function (error) {

            lastError = error;

            Diagnostics.warn(
              "HISTORY",
              "No fue posible verificar el marcaje",
              {
                attempt: attempt,
                message: error.message
              }
            );

            if (attempt < maxAttempts) {
              return checkAttempt(attempt + 1);
            }

            return {
              confirmed: false,
              registeredValue: null,
              attempts: attempt,
              reason: "HISTORY_REQUEST_FAILED",
              message: lastError.message
            };

          });

      }.bind(this);

      return checkAttempt(1).finally(function () {

        appModel.setProperty(
          "/historyLoading",
          false
        );

      });
    },

    _updateActionUI: function () {
      var model = this.getView().getModel("attendance");
      if (!model) { return; }
      var update = function () {
        var action = model.getProperty("/today/nextAction");
        var idle = !this._markRequestInProgress;
        this.byId("checkInAction").setEnabled(idle && action === "CHECK_IN" && this._isActionAuthorized("CHECK_IN"));
        this.byId("mealStartAction").setEnabled(idle && action === "MEAL_START" && this._isActionAuthorized("MEAL_START"));
        this.byId("mealEndAction").setEnabled(idle && action === "MEAL_END" && this._isActionAuthorized("MEAL_END"));
        this.byId("checkOutAction").setEnabled(idle && Boolean(model.getProperty("/today/canCheckOut")) && this._isActionAuthorized("CHECK_OUT"));

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
