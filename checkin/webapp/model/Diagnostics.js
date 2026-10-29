sap.ui.define([], function () {
  "use strict";

  var STORAGE_KEY = "checkin.debug";
  var MAX_ENTRIES = 250;
  var sequence = 0;
  var entries = [];
  var params = new URLSearchParams(window.location.search || "");
  var requestedDebug = params.get("debug");
  var breakMode = String(params.get("debugBreak") || "").toLowerCase();

  if (requestedDebug !== null) {
    try {
      window.localStorage.setItem(STORAGE_KEY, /^(1|true|yes|checkin)$/i.test(requestedDebug) ? "true" : "false");
    } catch (ignore) {
      // El diagnóstico sigue funcionando durante esta carga aunque localStorage no esté disponible.
    }
  }

  function isEnabled() {
    if (requestedDebug !== null) {
      return /^(1|true|yes|checkin)$/i.test(requestedDebug);
    }
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "true";
    } catch (ignore) {
      return false;
    }
  }

  function copy(value) {
    if (value === undefined) { return undefined; }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (ignore) {
      return String(value);
    }
  }

  function timestamp() {
    return new Date().toISOString();
  }

  function checkpoint(stage) {
    if (!isEnabled()) { return; }
    if (breakMode === "all" || breakMode === String(stage || "").toLowerCase()) {
      // Abre DevTools antes de usar debugBreak para que el navegador se detenga aquí.
      debugger;
    }
  }

  function add(level, category, message, details, requestId) {
    if (!isEnabled()) { return; }
    var entry = {
      time: timestamp(),
      level: level,
      category: category,
      message: message,
      requestId: requestId || "",
      details: copy(details)
    };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) { entries.shift(); }

    var label = "[CHECKIN][" + category + "]" + (requestId ? "[" + requestId + "]" : "") + " " + message;
    var method = level === "error" ? "error" : (level === "warn" ? "warn" : "info");
    if (console.groupCollapsed) {
      console.groupCollapsed(label);
      console[method](entry);
      console.groupEnd();
    } else {
      console[method](label, entry);
    }
  }

  function startRequest(method, url, details) {
    sequence += 1;
    var requestId = "REQ-" + String(sequence).padStart(3, "0");
    add("info", "HTTP", method + " " + url, details, requestId);
    checkpoint("request");
    return requestId;
  }

  function response(requestId, status, statusText, rawBody, details) {
    add(status >= 400 ? "error" : "info", "HTTP", "Respuesta HTTP " + status + " " + (statusText || ""), {
      rawBody: rawBody,
      metadata: details || {}
    }, requestId);
    checkpoint("response");
  }

  function mapping(name, rawValue, mappedValue, requestId) {
    add("info", "MAP", name + " antes y después del mapeo", {
      raw: rawValue,
      mapped: mappedValue
    }, requestId);
    checkpoint("map");
  }

  function error(category, message, errorValue, requestId) {
    add("error", category, message, {
      name: errorValue && errorValue.name,
      message: errorValue && errorValue.message,
      stack: errorValue && errorValue.stack
    }, requestId);
    checkpoint("error");
  }

  var api = {
    isEnabled: isEnabled,
    request: startRequest,
    response: response,
    mapping: mapping,
    info: function (category, message, details, requestId) {
      add("info", category, message, details, requestId);
    },
    warn: function (category, message, details, requestId) {
      add("warn", category, message, details, requestId);
    },
    error: error,
    checkpoint: checkpoint,
    getEntries: function () { return copy(entries); },
    clear: function () {
      entries = [];
      if (console.clear) { console.clear(); }
    },
    enable: function () {
      window.localStorage.setItem(STORAGE_KEY, "true");
      console.info("[CHECKIN] Diagnóstico activado. Recarga la página.");
    },
    disable: function () {
      window.localStorage.setItem(STORAGE_KEY, "false");
      console.info("[CHECKIN] Diagnóstico desactivado. Recarga la página.");
    },
    help: function () {
      console.info("[CHECKIN] Usa ?debug=true para logs. Agrega &debugBreak=request|response|map|error|all para pausar con DevTools abierto. Consulta window.checkinDebug.getEntries().");
    }
  };

  window.checkinDebug = api;
  if (isEnabled()) {
    console.info("[CHECKIN] Modo diagnóstico activo", {
      href: window.location.href,
      origin: window.location.origin,
      pathname: window.location.pathname,
      breakMode: breakMode || "desactivado"
    });
    api.help();
  }

  return api;
});
