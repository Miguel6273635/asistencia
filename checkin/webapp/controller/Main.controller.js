sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageBox",
  "sap/m/MessageToast",
  "sap/ui/model/json/JSONModel",
  "sap/ui/core/Fragment",
  "../model/IdentityService",
  "../model/EmployeeService",
  "../model/AttendanceService",
  "../model/AttendancePolicy",
  "../model/Diagnostics"
], function (Controller, MessageBox, MessageToast, JSONModel, Fragment, IdentityService, EmployeeService, AttendanceService, AttendancePolicy, Diagnostics) {
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

  function relationJobBlock(employee) {
    var policy = AttendancePolicy.classifyEmployee(employee || {});
    var currentRelation = policy.relation;

    return {
      blocked: currentRelation.blocked,
      code: currentRelation.code,
      description: currentRelation.description,
      message: currentRelation.blocked ? policy.reason : ""
    };
  }

  function effectiveRelationJobBlock(employee, hasEntryToday) {
    var relationBlock = relationJobBlock(employee);

    relationBlock.continuationAllowed = false;
    return relationBlock;
  }

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
       if (normalized === "PR" || normalized === "HO" || normalized === "VN") {
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

  function relationJobSessionCode(employee) {
    var currentEmployee = employee || {};
    var rawEmployee = currentEmployee.raw || {};
    var code = String(currentEmployee.relationJob || rawEmployee.RelationJob || "").trim();
    var description = currentEmployee.relationJobDescription ||
      rawEmployee.RelationJobDescription ||
      rawEmployee.RelationDescription ||
      "";

    if (/^\d$/.test(code)) {
      code = "0" + code;
    }
    if (code === "02") {
      return "HO";
    }
    if (code === "04") {
      return "VN";
    }
    return workSessionCode([description]);
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
        // Estos campos también deben limpiarse cuando SAP los devuelve vacíos;
        // así una actualización nunca conserva un bloqueo anterior por error.
        currentEmployee.relationJob = employee.relationJob || "";
        currentEmployee.relationJobDescription = employee.relationJobDescription || "";
        ["status", "statusDescription", "groupPerson", "groupPersonDescription",
          "authorisedRegister", "typeSession", "dayStatus", "dateFrom", "dateTo",
          "timeFoodSchedule", "timeFood"].forEach(function (property) {
          currentEmployee[property] = employee[property] || "";
        });
        attendanceModel.setProperty("/employee", currentEmployee);
        attendanceModel.setProperty("/employeePolicy", AttendancePolicy.classifyEmployee(currentEmployee));
        appModel.setProperty("/employeeSource", "odata");
        appModel.setProperty("/requiresIdentity", false);
        return this._loadSchedule(currentEmployee).then(function () {
          return Promise.all([
            this._loadHistory(currentEmployee),
            this._loadDelays(currentEmployee)
          ]);
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
          mealEnd: normalizeClock(schedule && schedule.mealEnd || employee.mealEnd),
          timeFoodSchedule: schedule && schedule.timeFoodSchedule || employee.timeFoodSchedule || "",
          timeFood: schedule && schedule.timeFood || employee.timeFood || ""
        };
        attendanceModel.setProperty("/schedule", resolved);
        if (resolved.name) { attendanceModel.setProperty("/employee/schedule", resolved.name); }
        if (resolved.code) { attendanceModel.setProperty("/employee/scheduleCode", resolved.code); }
        if (resolved.detail) { attendanceModel.setProperty("/employee/scheduleDetail", resolved.detail); }
        if (resolved.timeFoodSchedule) { attendanceModel.setProperty("/employee/timeFoodSchedule", resolved.timeFoodSchedule); }
        if (resolved.timeFood) { attendanceModel.setProperty("/employee/timeFood", resolved.timeFood); }
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
      var dateFrom = AttendancePolicy.isoDate(AttendancePolicy.startOfWeek(now));
      var dateTo = localIsoDate(now);
      var activeShift = AttendancePolicy.shiftBounds(attendanceModel.getProperty("/schedule") || {}, now);
      if (activeShift.valid && activeShift.workDate < dateFrom) {
        dateFrom = activeShift.workDate;
      }
      var identity = this._activeIdentity || IdentityService.getActiveIdentity() || {};
      // EmployeeSet ya resolvió la nómina del colaborador. El historial debe
      // consultarse directamente con ese PersonalNumber, no nuevamente por correo.
      var historyIdentifier = employee.id || identity.personalNumber || identity.email;
      Diagnostics.info("FLOW", "Iniciando consulta del historial", {
        configuredServiceRoot: dataSource.uri,
        serviceRoot: serviceRoot,
        identifier: historyIdentifier,
        filterField: employee.id ? "PersonalNumber" : (String(historyIdentifier).indexOf("@") >= 0 ? "Email" : "PersonalNumber"),
        dateFrom: dateFrom.replace(/-/g, ""),
        dateTo: dateTo.replace(/-/g, "")
      });

      appModel.setProperty("/historyLoading", true);
      appModel.setProperty("/historyError", "");
      return AttendanceService.readHistory(
        serviceRoot,
        historyIdentifier,
        dateFrom,
        employee.id,
        { dateTo: dateTo, scheduleDetail: employee.scheduleDetail || attendanceModel.getProperty("/schedule/detail") }
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

    _loadDelays: function (employee, rejectOnError) {
      var appModel = this.getView().getModel("app");
      var attendanceModel = this.getView().getModel("attendance");
      var dataSource = this.getOwnerComponent().getManifestEntry("/sap.app/dataSources/attendanceOData");
      var serviceRoot = resolveServiceRoot(dataSource.uri);
      var queryDate = new Date();
      var activeShift = AttendancePolicy.shiftBounds(attendanceModel.getProperty("/schedule") || {}, queryDate);
      if (activeShift.valid) {
        var parts = activeShift.workDate.split("-").map(Number);
        queryDate = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
      }

      attendanceModel.setProperty("/today/delaysLoaded", false);
      appModel.setProperty("/delaysError", "");
      return AttendanceService.readDelays(serviceRoot, employee.id, queryDate).then(function (summary) {
        attendanceModel.setProperty("/delays", summary);
        attendanceModel.setProperty("/today/delaysLoaded", true);
        this._evaluateAttendanceContext();
        return summary;
      }.bind(this)).catch(function (error) {
        attendanceModel.setProperty("/today/delaysLoaded", false);
        appModel.setProperty("/delaysError", error.message);
        Diagnostics.error("DELAYS", "No fue posible cargar el total mensual de retardos", error);
        this._evaluateAttendanceContext();
        if (rejectOnError) { throw error; }
        return null;
      }.bind(this));
    },

    _refreshPolicyState: function () {
      var attendanceModel = this.getView().getModel("attendance");
      var dataSource = this.getOwnerComponent().getManifestEntry("/sap.app/dataSources/attendanceOData");
      var serviceRoot = resolveServiceRoot(dataSource.uri);
      var identity = IdentityService.getActiveIdentity();
      var savedModality = {
        typeSession: attendanceModel.getProperty("/today/typeSession"),
        confirmed: attendanceModel.getProperty("/today/workModalityConfirmed"),
        dateFrom: attendanceModel.getProperty("/today/sessionDateFrom"),
        dateTo: attendanceModel.getProperty("/today/sessionDateTo")
      };

      return EmployeeService.readEmployee(serviceRoot, identity).then(function (employee) {
        var currentEmployee = attendanceModel.getProperty("/employee") || {};
        Object.keys(employee).forEach(function (property) {
          currentEmployee[property] = employee[property];
        });
        attendanceModel.setProperty("/employee", currentEmployee);
        attendanceModel.setProperty("/employeePolicy", AttendancePolicy.classifyEmployee(currentEmployee));
        return this._loadSchedule(currentEmployee).then(function () {
          return Promise.all([
            this._loadHistory(currentEmployee, true),
            this._loadDelays(currentEmployee, true)
          ]).then(function () {
            var hasEntry = attendanceModel.getProperty("/today/entry") &&
              attendanceModel.getProperty("/today/entry") !== "—";
            if (!hasEntry && savedModality.confirmed) {
              attendanceModel.setProperty("/today/typeSession", savedModality.typeSession);
              attendanceModel.setProperty("/today/workModalityConfirmed", true);
              attendanceModel.setProperty("/today/sessionDateFrom", savedModality.dateFrom);
              attendanceModel.setProperty("/today/sessionDateTo", savedModality.dateTo);
            }
            this._evaluateAttendanceContext();
            return currentEmployee;
          }.bind(this));
        }.bind(this));
      }.bind(this));
    },

    _markStorageKey: function (action, employee) {
      var employeeId = String(employee && (employee.id || employee.email) || "").trim().toLowerCase();
      var now = new Date();
      var model = this.getView().getModel("attendance");
      var activeShift = AttendancePolicy.shiftBounds(model && model.getProperty("/schedule") || {}, now);
      var workDate = activeShift.valid ? activeShift.workDate : localIsoDate(now);
      return "mitsu.checkin.sent." + workDate + "." + employeeId + "." + action;
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
      var current = new Date();
      var activeShift = AttendancePolicy.shiftBounds(model.getProperty("/schedule") || {}, current);
      var todayIso = activeShift.valid ? activeShift.workDate : localIsoDate(current);
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
      model.setProperty("/today/dayStatus", today.dayStatus || "");
      model.setProperty("/today/isLate", Boolean(today.isLate));
      model.setProperty("/today/isTravel", Boolean(today.isTravel));
      model.setProperty("/today/businessTripRegistered", Boolean(
        today.typeSession === "VN" ||
        today.isTravel ||
        this._rememberedMark("BUSINESS_TRIP", employee)
      ));
      model.setProperty("/today/isHomeOffice", Boolean(today.isHomeOffice));
      model.setProperty("/today/typeSession", today.typeSession || "");
      model.setProperty("/today/sessionDateFrom", today.sessionDateFrom || "");
      model.setProperty("/today/sessionDateTo", today.sessionDateTo || "");
      model.setProperty("/today/workModalityConfirmed", entry !== "—");
      model.setProperty("/today/homeOfficeUsedThisWeek", AttendancePolicy.isHomeOfficeUsedThisWeek(history, new Date()));
      model.setProperty("/today/isAbsence", AttendancePolicy.isAbsenceStatus(today.dayStatus || today.status));
      model.setProperty("/today/isFourthLateRecorded", Boolean(
        this._rememberedMark("FOURTH_LATE", employee) ||
        AttendancePolicy.isAbsenceStatus(today.dayStatus || today.status)
      ));
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

      var current = now || new Date();
      var currentSeconds = current.getHours() * 3600 + current.getMinutes() * 60 + current.getSeconds();
      var schedule = model.getProperty("/schedule") || {};
      var employee = model.getProperty("/employee") || {};
      var policy = AttendancePolicy.classifyEmployee(employee);
      var mealSchedule = AttendancePolicy.foodSchedule(employee);
      var shift = AttendancePolicy.shiftBounds(schedule, current);
      var hasEntry = model.getProperty("/today/entry") && model.getProperty("/today/entry") !== "—";
      var hasMealStart = model.getProperty("/today/mealStart") && model.getProperty("/today/mealStart") !== "—";
      var hasMealEnd = model.getProperty("/today/mealEnd") && model.getProperty("/today/mealEnd") !== "—";
      var hasExit = model.getProperty("/today/exit") && model.getProperty("/today/exit") !== "—";
      var isWithinMealWindow = mealSchedule.valid &&
        currentSeconds >= mealSchedule.startSeconds && currentSeconds <= mealSchedule.endSeconds;
      var assignedTypeSession = relationJobSessionCode(employee);
      var historyTravel = Boolean(model.getProperty("/today/isTravel"));
      var historyHomeOffice = Boolean(model.getProperty("/today/isHomeOffice"));
      var automaticModality = assignedTypeSession ||
        (historyTravel ? "VN" : "") ||
        (historyHomeOffice ? "HO" : "") ||
        (policy.unionized ? "PR" : "");
      var modalityConfirmed = Boolean(model.getProperty("/today/workModalityConfirmed")) || Boolean(automaticModality) || Boolean(hasEntry);
      var confirmedTypeSession = String(model.getProperty("/today/typeSession") || "").trim().toUpperCase();
      var typeSession = automaticModality || (modalityConfirmed && ["PR", "HO", "VN"].indexOf(confirmedTypeSession) >= 0
        ? confirmedTypeSession : "");
      var delaysLoaded = Boolean(model.getProperty("/today/delaysLoaded"));
      var delayCycle = AttendancePolicy.delayCycle(model.getProperty("/delays/totalDelays"));
      var isLateNow = !hasEntry && shift.valid && current.getTime() > shift.lateAfter.getTime();
      var isFourthLate = isLateNow && delaysLoaded && delayCycle.valid && delayCycle.fourthOnNextLate;
      var isFourthLateRecorded = Boolean(model.getProperty("/today/isFourthLateRecorded"));
      var isAbsence = Boolean(model.getProperty("/today/isAbsence"));
      var attendanceBlocked = isAbsence || isFourthLateRecorded;
      var isTravel;
      var isHomeOffice;
      var todayDate = localIsoDate(current);
      var sessionDateFrom;
      var sessionDateTo;

      if (isFourthLate && !hasEntry) {
        typeSession = "PR";
        modalityConfirmed = true;
      }
      if (hasEntry && !typeSession) {
        typeSession = "PR";
      }
      isTravel = typeSession === "VN";
      isHomeOffice = typeSession === "HO";

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

      var hasMealEvents = AttendancePolicy.allowsMealEvents(employee, typeSession);
      var nextAction = "CHECK_IN";
      if (hasEntry) {
        if (hasExit || attendanceBlocked || typeSession === "VN") {
          nextAction = null;
        } else if (!hasMealEvents) {
          nextAction = "CHECK_OUT";
        } else if (isWithinMealWindow && !hasMealStart) {
          nextAction = "MEAL_START";
        } else if (isWithinMealWindow && hasMealStart && !hasMealEnd) {
          nextAction = "MEAL_END";
        } else {
          nextAction = "CHECK_OUT";
        }
      }

      var forceLateTest = isLateTestEnabled(this);
      isLateNow = typeSession !== "VN" && !hasEntry && (forceLateTest || isLateNow);
      isFourthLate = isLateNow && delaysLoaded && delayCycle.valid && delayCycle.fourthOnNextLate;
      if (isFourthLate && !hasEntry) {
        typeSession = "PR";
        modalityConfirmed = true;
        isTravel = false;
        isHomeOffice = false;
      }
      var homeOfficeQuotaBlocked = isHomeOffice && !hasEntry && Boolean(model.getProperty("/today/homeOfficeUsedThisWeek"));
      var canCheckOut = typeSession !== "VN" && hasEntry && !hasExit && !attendanceBlocked;
      var isEarlyExit = canCheckOut && shift.valid && current.getTime() < shift.end.getTime();
      var mealStartAllowed = hasMealEvents && mealSchedule.valid && isWithinMealWindow &&
        !attendanceBlocked && hasEntry && !hasExit && !hasMealStart;
      var mealEndAllowed = hasMealEvents && mealSchedule.valid && isWithinMealWindow &&
        !attendanceBlocked && hasEntry && !hasExit && hasMealStart && !hasMealEnd;
      var isCheckInAllowed = shift.valid && current.getTime() >= shift.opens.getTime() &&
        current.getTime() < shift.end.getTime() && !attendanceBlocked && !homeOfficeQuotaBlocked &&
        (delaysLoaded || !isLateNow);
      var scheduleLabel = schedule.start && schedule.end ? schedule.start + "–" + schedule.end : "";
      var messageType = "Information";
      var message = scheduleLabel ? "Horario de hoy: " + scheduleLabel + "." : "SAP no expuso las horas del turno.";

      if (!policy.enabled) {
        message = policy.reason;
        messageType = policy.viewOnly ? "Information" : "Error";
      } else if (attendanceBlocked) {
        message = "Tu jornada está bloqueada por inasistencia o cuarto retardo. No se admiten más marcaciones.";
        messageType = "Error";
      } else if (!shift.valid) {
        message = shift.reason;
        messageType = "Error";
      } else if (!hasEntry && current.getTime() < shift.opens.getTime()) {
        message = "La entrada se habilita 15 minutos antes del inicio del turno.";
        messageType = "Information";
      } else if (!hasEntry && current.getTime() >= shift.end.getTime()) {
        message = "Tu horario de labores terminó. Ya no puedes registrar una entrada para esta jornada.";
        messageType = "Error";
      } else if (!hasEntry && isLateNow && !delaysLoaded) {
        message = "No fue posible validar el total mensual de retardos. Actualiza los datos antes de registrar.";
        messageType = "Error";
      } else if (forceLateTest && isLateNow && nextAction === "CHECK_IN") {
        message = "MODO DE PRUEBA: la entrada tardía está forzada temporalmente.";
        messageType = "Warning";
      } else if (typeSession === "VN") {
        message = hasEntry ? "Viaje de negocios registrado. No se requieren más marcaciones." :
          "Viaje de negocios vigente. Registra únicamente la entrada P10 con el periodo autorizado.";
        messageType = "Information";
      } else if (homeOfficeQuotaBlocked) {
        message = "Ya utilizaste Home Office esta semana. Selecciona otra modalidad.";
        messageType = "Error";
      } else if (policy.unionized) {
        message = "Personal sindicalizado: únicamente se registran Entrada y Salida presencial.";
        messageType = "Information";
      } else if (isFourthLate && nextAction === "CHECK_IN") {
        message = "Esta entrada corresponde al cuarto retardo del ciclo. Solo se enviará P10 y la jornada quedará bloqueada por inasistencia.";
        messageType = "Warning";
      } else if (isLateNow && nextAction === "CHECK_IN") {
        message = "La tolerancia terminó 10 minutos después del inicio. Esta entrada se considera retardo.";
        messageType = "Warning";
      } else if (hasEntry && hasMealEvents && !mealSchedule.valid) {
        message = mealSchedule.reason + " Puedes continuar con Entrada y Salida, pero P15 y P25 permanecerán deshabilitados.";
        messageType = "Warning";
      } else if (hasEntry && hasMealEvents && currentSeconds < mealSchedule.startSeconds) {
        message = "La comida se habilitará de " + mealSchedule.description + ". Por ahora puedes registrar la salida.";
        messageType = "Information";
      } else if (hasEntry && hasMealEvents && currentSeconds > mealSchedule.endSeconds && (!hasMealStart || !hasMealEnd)) {
        message = "La ventana de comida terminó a las " + mealSchedule.endText + ". Solo puedes registrar la salida.";
        messageType = "Warning";
      } else if (hasEntry && hasMealEvents && isWithinMealWindow && (nextAction === "MEAL_START" || nextAction === "MEAL_END")) {
        message = "Horario de comida disponible de " + mealSchedule.description +
          ". Tiempo asignado: " + mealSchedule.durationText +
          ". La marcación usa la hora actual del dispositivo.";
        messageType = "Information";
      } else if (typeSession === "HO") {
        message = "Home Office vigente. Registra Entrada, Inicio de comida, Fin de comida y Salida; no se solicitará ubicación GPS.";
        messageType = "Information";
      } else if (isEarlyExit) {
        message = "Salida temprana: el horario termina a las " + schedule.end + ". Confirma antes de registrar.";
        messageType = "Warning";
      }

      model.setProperty("/today/nextAction", nextAction);
      model.setProperty("/today/isLateNow", isLateNow);
      model.setProperty("/today/isFourthLate", isFourthLate);
      model.setProperty("/today/isAttendanceBlocked", attendanceBlocked);
      model.setProperty("/today/isCheckInAllowed", isCheckInAllowed);
      model.setProperty("/today/isEarlyExit", isEarlyExit);
      model.setProperty("/today/canCheckOut", canCheckOut);
      model.setProperty("/today/isTravel", typeSession === "VN");
      model.setProperty("/today/isHomeOffice", typeSession === "HO");
      model.setProperty("/today/typeSession", typeSession);
      if (automaticModality) {
        model.setProperty("/today/workModalityConfirmed", true);
      }
      if (isFourthLate) {
        model.setProperty("/today/workModalityConfirmed", true);
      }
      model.setProperty("/today/workModalityText", typeSession === "VN" ? "Viaje de negocios" : (typeSession === "HO" ? "Home Office" : (typeSession === "PR" ? "Presencial" : "Pendiente")));
      model.setProperty("/today/sessionDateFrom", sessionDateFrom);
      model.setProperty("/today/sessionDateTo", sessionDateTo);
      model.setProperty("/today/hasMealEvents", hasMealEvents);
      model.setProperty("/today/isMealWindowRestricted", hasMealEvents);
      model.setProperty("/today/isWithinMealWindow", isWithinMealWindow);
      model.setProperty("/today/mealStartAllowed", mealStartAllowed);
      model.setProperty("/today/mealEndAllowed", mealEndAllowed);
      model.setProperty("/today/isMealScheduleValid", mealSchedule.valid);
      model.setProperty("/today/mealScheduleText", mealSchedule.valid ? mealSchedule.description : "");
      model.setProperty("/today/mealDurationText", mealSchedule.valid ? mealSchedule.durationText : "");
      model.setProperty("/today/checkInText", isLateNow ? "Registrar entrada tarde" : "Registrar entrada");
      model.setProperty("/today/checkOutText", isEarlyExit ? "Salida temprana" : "Registrar salida");
      model.setProperty("/today/isRelationBlocked", policy.relation.blocked);
      model.setProperty("/today/relationBlockMessage", policy.relation.blocked ? policy.reason : "");
      model.setProperty("/today/isEmployeeEnabled", policy.enabled);
      model.setProperty("/today/homeOfficeQuotaBlocked", homeOfficeQuotaBlocked);
      model.setProperty("/employeePolicy", policy);
      model.setProperty("/today/validationMessage", message);
      model.setProperty("/today/validationType", messageType);
      model.setProperty("/today/scheduleLabel", scheduleLabel);
      this._updateActionUI();
    },

    _isActionAuthorized: function (action) {
      var model = this.getView().getModel("attendance");
      var employee = model.getProperty("/employee") || {};
      var policy = AttendancePolicy.classifyEmployee(employee);

      if (!policy.enabled || model.getProperty("/today/isAttendanceBlocked")) {
        return false;
      }
      var typeSession = String(model.getProperty("/today/typeSession") || "").trim().toUpperCase();
      if (typeSession === "VN") {
        return false;
      }
      if (action === "CHECK_IN" && !model.getProperty("/today/isCheckInAllowed")) { return false; }
      if (action === "CHECK_OUT" && model.getProperty("/today/canCheckOut")) {
        return true;
      }
      if ((action === "MEAL_START" || action === "MEAL_END") && !model.getProperty("/today/hasMealEvents")) {
        return false;
      }
      if (action === "MEAL_START" && model.getProperty("/today/mealStartAllowed") === false) {
        return false;
      }
      if (action === "MEAL_END" && model.getProperty("/today/mealEndAllowed") === false) {
        return false;
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

    onRegisterBusinessTrip: function () {
      var model = this.getView().getModel("attendance");

      if (model.getProperty("/today/businessTripRegistered")) {
        MessageToast.show("El viaje de negocios ya fue registrado");
        return;
      }

      this._openWorkModalityDialog("BUSINESS_TRIP");
    },

    _openWorkModalityDialog: function (pendingAction) {
      var model = this.getView().getModel("attendance");
      var typeSession = String(model.getProperty("/today/typeSession") || "").trim().toUpperCase();
      var assignedTypeSession = relationJobSessionCode(model.getProperty("/employee") || {});
      var isBusinessTrip = typeSession === "VN" || assignedTypeSession === "VN";

      if (isBusinessTrip) {
        typeSession = "VN";
      }
      if (assignedTypeSession === "HO") {
        typeSession = "HO";
      }
      model.setProperty("/today/workModalityLocked", assignedTypeSession === "VN" || assignedTypeSession === "HO");

      model.setProperty("/today/workModalityDraft", {
        typeSession: ["PR", "HO", "VN"].indexOf(typeSession) >= 0 ? typeSession : "PR",
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
      var employee = model.getProperty("/employee") || {};
      var allowedModalities = AttendancePolicy.allowedModalities(employee);
      var error = "";

      if (["PR", "HO", "VN"].indexOf(typeSession) < 0) {
        error = "Selecciona una modalidad válida.";
      } else if (allowedModalities.indexOf(typeSession) < 0) {
        error = "Esta modalidad no corresponde al grupo o situación laboral del empleado.";
      } else if (typeSession === "HO" && model.getProperty("/today/homeOfficeUsedThisWeek")) {
        error = "Ya utilizaste Home Office esta semana. Solo se permite un día por semana.";
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
      this._evaluateAttendanceContext();
      this._updateActionUI();

      Diagnostics.info("MODALITY", "Modalidad confirmada antes del marcaje", {
        typeSession: typeSession,
        dateFrom: dateFrom,
        dateTo: dateTo
      });

      var pendingAction = this._pendingActionAfterModality || "CHECK_IN";
      this._pendingActionAfterModality = null;
      this._getWorkModalityDialog().then(function (dialog) {
        dialog.close();
        if (typeSession === "VN") {
          window.setTimeout(function () {
            this._registerBusinessTrip();
          }.bind(this), 0);
          return;
        }
        window.setTimeout(function () {
          this._confirmAction(pendingAction);
        }.bind(this), 0);
      }.bind(this));
    },

    _registerBusinessTrip: function (policyRefreshed) {
      var appModel = this.getView().getModel("app");
      var attendanceModel = this.getView().getModel("attendance");

      if (!policyRefreshed) {
        appModel.setProperty("/busy", true);
        return this._refreshPolicyState().then(function () {
          if (attendanceModel.getProperty("/today/typeSession") !== "VN" ||
              !attendanceModel.getProperty("/today/isCheckInAllowed")) {
            throw new Error(attendanceModel.getProperty("/today/validationMessage") ||
              "La entrada de viaje ya no está autorizada.");
          }
          return this._registerBusinessTrip(true);
        }.bind(this)).catch(function (error) {
          MessageBox.error("No fue posible autorizar el viaje con información fresca de SAP. " +
            (error.message || "Actualiza los datos e intenta nuevamente."));
        }).finally(function () {
          if (!this._markRequestInProgress) { appModel.setProperty("/busy", false); }
        }.bind(this));
      }

      var employee = attendanceModel.getProperty("/employee") || {};
      var dateFrom = normalizeIsoDateValue(attendanceModel.getProperty("/today/sessionDateFrom"));
      var dateTo = normalizeIsoDateValue(attendanceModel.getProperty("/today/sessionDateTo"));
      var dataSource = this.getOwnerComponent().getManifestEntry("/sap.app/dataSources/attendanceOData");
      var serviceRoot = resolveServiceRoot(dataSource.uri);

      if (this._markRequestInProgress) {
        MessageToast.show("Ya existe un registro en proceso");
        return Promise.resolve();
      }
      if (!employee.id || !dateFrom || !dateTo) {
        MessageBox.error("No se puede registrar el viaje porque faltan el colaborador o las fechas del periodo.");
        return Promise.resolve();
      }
      if (dateFrom > dateTo) {
        MessageBox.error("La fecha inicial del viaje no puede ser posterior a la fecha final.");
        return Promise.resolve();
      }
      if (!AttendancePolicy.classifyEmployee(employee).enabled || !attendanceModel.getProperty("/today/isCheckInAllowed")) {
        MessageBox.error(attendanceModel.getProperty("/today/validationMessage") || "La entrada de viaje no está autorizada en este momento.");
        return Promise.resolve();
      }

      this._markRequestInProgress = true;
      appModel.setProperty("/busy", true);
      Diagnostics.info("BUSINESS_TRIP", "Enviando viaje de negocios a SAP", {
        employeeId: employee.id,
        registerType: "P10",
        typeSession: "VN",
        dateFrom: dateFrom,
        dateTo: dateTo
      });

      return AttendanceService.captureLocation().then(function (location) {
        return AttendanceService.registerBusinessTrip(
          serviceRoot,
          employee,
          dateFrom,
          dateTo,
          this._activeIdentity && this._activeIdentity.device,
          location
        );
      }.bind(this)).then(function (result) {
        var sapStatus = String(result.sapStatus || "").trim().toUpperCase();
        if (sapStatus !== "OK") {
          throw new Error(result.sapMessage || "SAP no confirmó el viaje de negocios.");
        }

        var optimisticValue = localClock(result.registeredAt || new Date());
        attendanceModel.setProperty("/today/entry", optimisticValue);
        attendanceModel.setProperty("/today/businessTripRegistered", true);
        this._rememberMark("CHECK_IN", employee, optimisticValue);
        this._rememberMark("BUSINESS_TRIP", employee, localIsoDate(new Date()));
        this._evaluateAttendanceContext();
        MessageToast.show("Viaje de negocios registrado correctamente", { duration: 4000 });
        return result;
      }.bind(this)).catch(function (error) {
        Diagnostics.error("BUSINESS_TRIP", "No fue posible registrar el viaje de negocios", error);
        MessageBox.error("No fue posible registrar el viaje de negocios en SAP. " +
          (error.message || "Error no especificado"));
      }).finally(function () {
        this._markRequestInProgress = false;
        appModel.setProperty("/busy", false);
        this._updateActionUI();
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
      var comment = String(model.getProperty("/today/lateJustification/comment") || "").trim();

      if (["Personal", "Laboral"].indexOf(reason) < 0) {
        model.setProperty("/today/lateJustification/error", "Selecciona el motivo del retraso.");
        return;
      }
      if (!comment) {
        model.setProperty("/today/lateJustification/error", "Escribe un comentario para justificar el retraso.");
        return;
      }
      if (comment.length > 500) {
        model.setProperty("/today/lateJustification/error", "El comentario no puede exceder 500 caracteres.");
        return;
      }

      model.setProperty("/today/lateJustification/reason", reason);
      model.setProperty("/today/lateJustification/comment", comment);
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
      var comment = String(model.getProperty("/today/earlyExitJustification/comment") || "").trim();

      if (["Personal", "Laboral"].indexOf(reason) < 0) {
        model.setProperty("/today/earlyExitJustification/error", "Selecciona el motivo de la salida anticipada.");
        return;
      }
      if (!comment) {
        model.setProperty("/today/earlyExitJustification/error", "Escribe un comentario para justificar la salida anticipada.");
        return;
      }
      if (comment.length > 500) {
        model.setProperty("/today/earlyExitJustification/error", "El comentario no puede exceder 500 caracteres.");
        return;
      }

      model.setProperty("/today/earlyExitJustification/reason", reason);
      model.setProperty("/today/earlyExitJustification/comment", comment);
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
      var employeePolicy = AttendancePolicy.classifyEmployee(model.getProperty("/employee") || {});
      if (!employeePolicy.enabled) {
        MessageBox.error(employeePolicy.reason || "El empleado no está autorizado para registrar asistencia.", {
          title: employeePolicy.viewOnly ? "Consulta solamente" : "Marcaje no permitido"
        });
        return;
      }
      var hasEntry = Boolean(model.getProperty("/today/entry") && model.getProperty("/today/entry") !== "—");
      var relationBlock = effectiveRelationJobBlock(model.getProperty("/employee") || {}, hasEntry);
      if (relationBlock.blocked) {
        MessageBox.error(relationBlock.message, {
          title: "Marcaje no permitido"
        });
        return;
      }
      if (requestedAction === "CHECK_IN" && !model.getProperty("/today/workModalityConfirmed")) {
        this._openWorkModalityDialog(requestedAction);
        return;
      }
      var action = model.getProperty("/today/nextAction");
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
      var isFourthLate = Boolean(model.getProperty("/today/isFourthLate"));
      if (isLateEntry && !isFourthLate && !model.getProperty("/today/lateJustification/saved")) {
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
      if (isFourthLate) {
        confirmationText = "Esta será la cuarta tardanza del ciclo. Solo se enviará la entrada P10 y la jornada quedará bloqueada. ¿Deseas continuar?";
      } else if (isLateEntry) {
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


    _register: function (action, policyRefreshed) {

      var appModel = this.getView().getModel("app");
      var attendanceModel = this.getView().getModel("attendance");

      if (!policyRefreshed) {
        if (this._policyRefreshInProgress) {
          MessageToast.show("Se están validando tus datos con SAP");
          return Promise.resolve();
        }
        this._policyRefreshInProgress = true;
        appModel.setProperty("/busy", true);
        return this._refreshPolicyState().then(function () {
          var hasEntryNow = Boolean(attendanceModel.getProperty("/today/entry") && attendanceModel.getProperty("/today/entry") !== "—");
          var hasExitNow = Boolean(attendanceModel.getProperty("/today/exit") && attendanceModel.getProperty("/today/exit") !== "—");
          var checkoutAllowed = action === "CHECK_OUT" && hasEntryNow && !hasExitNow;
          if (!this._isActionAuthorized(action) ||
              (attendanceModel.getProperty("/today/nextAction") !== action && !checkoutAllowed)) {
            throw new Error(attendanceModel.getProperty("/today/validationMessage") ||
              "SAP actualizó la jornada y este marcaje ya no está permitido.");
          }
          if (action === "CHECK_IN" && attendanceModel.getProperty("/today/isLateNow") &&
              !attendanceModel.getProperty("/today/isFourthLate") &&
              !attendanceModel.getProperty("/today/lateJustification/saved")) {
            throw new Error("La entrada ahora se considera tardía. Captura su justificación antes de continuar.");
          }
          if (action === "CHECK_OUT" && attendanceModel.getProperty("/today/isEarlyExit") &&
              !attendanceModel.getProperty("/today/earlyExitJustification/saved")) {
            throw new Error("La salida ahora se considera anticipada. Captura su justificación antes de continuar.");
          }
          return this._register(action, true);
        }.bind(this)).catch(function (error) {
          MessageBox.error("No fue posible autorizar el marcaje con información fresca de SAP. " +
            (error.message || "Actualiza los datos e intenta nuevamente."));
        }).finally(function () {
          this._policyRefreshInProgress = false;
          if (!this._markRequestInProgress) {
            appModel.setProperty("/busy", false);
          }
        }.bind(this));
      }

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

      var hasEntry = Boolean(attendanceModel.getProperty("/today/entry") && attendanceModel.getProperty("/today/entry") !== "—");
      var relationBlock = effectiveRelationJobBlock(employee, hasEntry);
      if (relationBlock.blocked) {
        Diagnostics.warn("MARK", "Marcaje bloqueado por situación laboral", {
          employeeId: employee.id,
          relationJob: relationBlock.code,
          relationJobDescription: relationBlock.description,
          action: action
        });
        MessageBox.error(relationBlock.message, {
          title: "Marcaje no permitido"
        });
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

      if (["PR", "HO", "VN"].indexOf(typeSession) < 0) {
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

      var wasFourthLate = action === "CHECK_IN" &&
        Boolean(attendanceModel.getProperty("/today/isFourthLate"));

      if (wasFourthLate) {
        typeSession = "PR";
        sessionDateFrom = todayDate;
        sessionDateTo = todayDate;
      }

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
          isFourthLate: wasFourthLate,
          isEarlyExit: wasEarlyExit,
          typeSession: typeSession,
          dateFrom: sessionDateFrom,
          dateTo: sessionDateTo
        }
      );

      // Home Office no solicita ni evalúa GPS. En modalidad presencial se
      // conserva la captura de una ubicación reciente y precisa.
      var pLocation = typeSession === "HO"
        ? Promise.resolve({
          latitude: "",
          longitude: "",
          geoStatus: "",
          accuracy: null,
          skipped: true,
          reason: "HOME_OFFICE"
        })
        : AttendanceService.captureLocation();

      return pLocation

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
              typeSession: typeSession,
              locationSkipped: Boolean(location.skipped),
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
              isFourthLate: wasFourthLate,
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
          if (wasFourthLate) {
            attendanceModel.setProperty("/today/isFourthLateRecorded", true);
            this._rememberMark("FOURTH_LATE", employee, todayDate);
          }
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
          var successMessage = wasFourthLate
            ? "Cuarto retardo registrado; la jornada quedó bloqueada"
            : wasEarlyExit
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
              (action === "CHECK_OUT" ? "La salida" : "La entrada") +
              " sí quedó registrada, pero SAP no aceptó la justificación. " +
              "No vuelvas a registrar el movimiento. Detalle: " +
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
      var activeShift = AttendancePolicy.shiftBounds(attendanceModel.getProperty("/schedule") || {}, now);
      var todayIso = activeShift.valid ? activeShift.workDate : localIsoDate(now);
      var historyDateTo = localIsoDate(now) > todayIso ? localIsoDate(now) : todayIso;

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
              { dateTo: historyDateTo, scheduleDetail: employee.scheduleDetail || attendanceModel.getProperty("/schedule/detail") }
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
        var typeSession = String(model.getProperty("/today/typeSession") || "").trim().toUpperCase();
        var isTravel = typeSession === "VN";
        this.byId("businessTripAction").setEnabled(idle && isTravel &&
          !model.getProperty("/today/businessTripRegistered") &&
          Boolean(model.getProperty("/today/isCheckInAllowed")) &&
          Boolean(model.getProperty("/today/isEmployeeEnabled")));
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
          control.getItems()[3].setText(
            isTravel ? "No requerido" :
              (completed ? "Registrada" : (active ? "Siguiente" : "Pendiente"))
          );
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
