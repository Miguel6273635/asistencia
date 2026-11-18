sap.ui.define([
  "./Diagnostics"
], function (Diagnostics) {
  "use strict";

  var EVENT_CODES = {
    CHECK_IN: "P10",
    MEAL_START: "P15",
    MEAL_END: "P25",
    CHECK_OUT: "P20"
  };

  var LOCATION_CAPTURE_TIMEOUT_MS = 25000;
  var LOCATION_MAX_AGE_MS = 15000;
  var LOCATION_MAX_ACCURACY_METERS = 250;

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

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function localDate(date) {
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  }

  function localTime(date) {
    return pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
  }

  function geolocationError(error) {
    if (!error) {
      return "No fue posible obtener la ubicación del dispositivo.";
    }
    if (error.code === 1) {
      return "No se autorizó el acceso a la ubicación. Permite la ubicación del sitio para registrar el marcaje.";
    }
    if (error.code === 2) {
      return "El dispositivo no pudo determinar la ubicación actual. Verifica que la ubicación esté activada.";
    }
    if (error.code === 3) {
      return "La consulta de ubicación agotó el tiempo de espera. Intenta nuevamente.";
    }
    return error.message || "No fue posible obtener la ubicación del dispositivo.";
  }

  function captureLocation() {
    return new Promise(function (resolve, reject) {
      if (!window.isSecureContext) {
        reject(new Error("La ubicación solamente está disponible mediante una conexión HTTPS segura."));
        return;
      }
      if (!navigator.geolocation) {
        reject(new Error("Este navegador no permite obtener la ubicación del dispositivo."));
        return;
      }

      var watchId = null;
      var timeoutId = null;
      var completed = false;
      var bestLocation = null;
      var lastError = null;

      function cleanup() {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (watchId !== null) {
          navigator.geolocation.clearWatch(watchId);
          watchId = null;
        }
      }

      function finishWithError(message, details) {
        if (completed) { return; }
        completed = true;
        cleanup();
        Diagnostics.error("LOCATION", message, details || {});
        reject(new Error(message));
      }

      function finishWithLocation(location) {
        if (completed) { return; }
        completed = true;
        cleanup();
        Diagnostics.info("LOCATION", "Ubicación actual y precisa obtenida para el marcaje", location);
        resolve(location);
      }

      function mapPosition(position) {
        var latitude = Number(position && position.coords && position.coords.latitude);
        var longitude = Number(position && position.coords && position.coords.longitude);
        var accuracy = Number(position && position.coords && position.coords.accuracy);
        var timestamp = Number(position && position.timestamp) || Date.now();

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          return null;
        }

        return {
          latitude: latitude.toFixed(8),
          longitude: longitude.toFixed(8),
          accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : Number.MAX_SAFE_INTEGER,
          capturedAt: new Date(timestamp).toISOString(),
          ageMs: Math.max(0, Date.now() - timestamp),
          geoStatus: ""
        };
      }

      function onPosition(position) {
        var location = mapPosition(position);
        if (!location) {
          Diagnostics.warn("LOCATION", "El dispositivo devolvió coordenadas inválidas; se esperará otra lectura", {});
          return;
        }

        Diagnostics.info("LOCATION", "Lectura de ubicación recibida del dispositivo", location);

        if (location.ageMs > LOCATION_MAX_AGE_MS) {
          Diagnostics.warn("LOCATION", "Se descartó una ubicación antigua", location);
          return;
        }

        if (!bestLocation || location.accuracy < bestLocation.accuracy) {
          bestLocation = location;
        }

        if (location.accuracy <= LOCATION_MAX_ACCURACY_METERS) {
          finishWithLocation(location);
        }
      }

      function onPositionError(error) {
        lastError = error;
        Diagnostics.warn("LOCATION", "El dispositivo reportó un problema al consultar la ubicación", {
          code: error && error.code,
          message: geolocationError(error)
        });

        if (error && error.code === 1) {
          finishWithError(geolocationError(error), error);
        }
      }

      timeoutId = window.setTimeout(function () {
        if (bestLocation) {
          finishWithError(
            "La ubicación actual tiene una precisión aproximada de " + bestLocation.accuracy +
              " m. Para evitar enviar una ubicación incorrecta no se registró el marcaje. Activa la ubicación precisa o el GPS del dispositivo e intenta nuevamente.",
            bestLocation
          );
          return;
        }
        finishWithError(geolocationError(lastError), lastError || {});
      }, LOCATION_CAPTURE_TIMEOUT_MS);

      try {
        watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
          enableHighAccuracy: true,
          timeout: LOCATION_CAPTURE_TIMEOUT_MS,
          maximumAge: 0
        });
      } catch (error) {
        finishWithError(error.message || "No fue posible iniciar la consulta de ubicación del dispositivo.", error);
      }
    });
  }

  function odataResults(payload) {
    if (payload && payload.d && Array.isArray(payload.d.results)) {
      return payload.d.results;
    }
    if (payload && Array.isArray(payload.value)) {
      return payload.value;
    }
    return [];
  }

  function odataEntity(payload) {
    if (payload && payload.d && typeof payload.d === "object" && !Array.isArray(payload.d.results)) {
      return payload.d;
    }
    return payload || {};
  }

  function validateMarkResponse(payload) {
    var entity = odataEntity(payload);
    var status = String(entity.StatusReq || "").trim().toUpperCase();
    var message = String(entity.Message || "").trim();
    if (status !== "OK") {
      throw new Error(message || ("SAP no confirmó el marcaje (StatusReq: " + (status || "vacío") + ")."));
    }

    return {
      entity: entity,
      status: status,
      message: message
    };
  }

  function validateJustificationResponse(payload) {
    var entity = odataEntity(payload);
    var status = String(entity.Status || "").trim().toUpperCase();
    var message = String(entity.Message || "").trim();
    if (["S", "OK"].indexOf(status) < 0) {
      throw new Error(message || ("SAP no confirmó la justificación (Status: " + (status || "vacío") + ")."));
    }

    return {
      entity: entity,
      status: status,
      message: message
    };
  }

  function employeeValue(employee, properties, fallback) {
    var raw = employee && employee.raw || {};
    var source = employee || {};
    var value = "";

    properties.some(function (property) {
      var candidate = source[property];
      if (candidate === undefined || candidate === null || String(candidate).trim() === "") {
        candidate = raw[property];
      }
      if (candidate !== undefined && candidate !== null && String(candidate).trim() !== "") {
        value = String(candidate).trim();
        return true;
      }
      return false;
    });

    return value || fallback || "";
  }

  function centerOfficeCode(employee) {
    var explicitCode = employeeValue(employee, [
      "centerOfficeCode", "CenterCode", "PersonnelArea", "WorkCenterCode", "PlantCode", "Werks"
    ]);
    var center = employeeValue(employee, ["center", "CenterOffice"]);
    var knownCenters = {
      "OFICINAS GENERALES": "ML01",
      "OFICINAS CANCUN": "ML02",
      "OFICINAS CANCÚN": "ML02",
      "OFICINAS GUADALAJARA": "ML03",
      "OFICINAS MONTERREY": "ML04",
      "OFICINAS QUERETARO": "ML05",
      "OFICINAS QUERÉTARO": "ML05",
      "PLANTA 1": "ML06"
    };

    if (/^ML\d+$/i.test(explicitCode)) {
      return explicitCode.toUpperCase();
    }

    return knownCenters[String(center || "").trim().toUpperCase()] ||
      employeeValue(employee, ["centerCode"], center);
  }

  function buildJustificationPayload(employee, action, justification, now) {
    var reason = String(justification.reason || "").trim();

    return {
      PersonalNumber: employeeValue(employee, ["id", "PersonalNumber", "PersonnelNumber"]),
      WorkDate: localDate(now),
      RegisterHourLate: localTime(now),
      RegisterType: EVENT_CODES[action],
      IncidentType: reason,
      ReasonType: reason,
      Comment: String(justification.comment || "").trim(),
      Id_log: "",
      Status: "",
      Message: "",
      Istimepay: justification.recoverTime ? "X" : ""
    };
  }

  function isPostDebugEnabled() {
    var expression = /(?:[?&#])debugPost=([^&#]*)/i;
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

    return candidates.filter(Boolean).some(function (candidate) {
      var match = String(candidate).match(expression);
      return match && /^(1|true|yes)$/i.test(decodeURIComponent(match[1]));
    });
  }

  function debugPostRequest(entitySet, url, payload, flowId) {
    if (!isPostDebugEnabled()) {
      return;
    }

    var snapshot = JSON.parse(JSON.stringify(payload));
    window.checkinPostTrace = window.checkinPostTrace || [];
    window.checkinLastPost = {
      timestamp: new Date().toISOString(),
      flowId: flowId || "",
      entitySet: entitySet,
      method: "POST",
      url: url,
      payload: snapshot
    };
    window.checkinPostTrace.push(Object.assign({
      direction: "request"
    }, window.checkinLastPost));

    console.group("[CHECKIN][POST][" + entitySet + "] solicitud");
    console.log("Flujo:", flowId || "sin identificador");
    console.log("URL:", url);
    console.log("Método:", "POST");
    console.log("Payload:", snapshot);
    console.log("Payload JSON:", JSON.stringify(snapshot, null, 2));
    console.trace("Punto donde se envía POST " + entitySet);
    console.groupEnd();

    debugger;
  }

  function debugPostResponse(entitySet, response, body, flowId) {
    if (!isPostDebugEnabled()) {
      return;
    }

    var headers = {};
    response.headers.forEach(function (value, key) {
      headers[key] = value;
    });

    var parsedBody = body;
    if (body) {
      try {
        parsedBody = JSON.parse(body);
      } catch (ignore) {
        parsedBody = body;
      }
    }

    window.checkinLastPostResponse = {
      timestamp: new Date().toISOString(),
      flowId: flowId || "",
      entitySet: entitySet,
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      url: response.url,
      headers: headers,
      body: parsedBody
    };
    window.checkinPostTrace.push(Object.assign({
      direction: "response"
    }, window.checkinLastPostResponse));

    console.group("[CHECKIN][POST][" + entitySet + "] respuesta");
    console.log("Flujo:", flowId || "sin identificador");
    console.log("HTTP:", response.status, response.statusText);
    console.log("URL final:", response.url);
    console.log("Headers:", headers);
    console.log("Body:", parsedBody);
    console.groupEnd();
  }

  function normalizeDate(value) {
    var text = String(value || "").trim();
    var ticks = text.match(/^\/Date\((\d+)/);
    if (ticks) {
      return localDate(new Date(Number(ticks[1])));
    }

    if (/^\d{8}$/.test(text)) {
      return text.slice(0, 4) + "-" + text.slice(4, 6) + "-" + text.slice(6, 8);
    }

    return text.slice(0, 10);
  }

  function normalizeTime(value) {
    var text = String(value || "").trim();
    if (!text || text === "00:00:00" || text === "00:00" || text === "0000-00-00") {
      return "—";
    }
    var duration = text.match(/^PT(\d+)H(\d+)M(\d+)S$/i);
    if (duration) {
      return pad(duration[1]) + ":" + pad(duration[2]);
    }
    return text.slice(0, 5) || "—";
  }

  function displayDate(isoDate) {
    var parts = String(isoDate || "").split("-");
    return parts.length === 3 ? parts[2] + "/" + parts[1] + "/" + parts[0] : isoDate;
  }

  function minutes(time) {
    var parts = String(time || "").split(":");
    return parts.length >= 2 ? Number(parts[0]) * 60 + Number(parts[1]) : 0;
  }

  function workedHours(day) {
    if (day.entry === "—" || day.exit === "—") {
      return day.entry === "—" ? "—" : "En curso";
    }
    var total = minutes(day.exit) - minutes(day.entry);
    if (day.mealStart !== "—" && day.mealEnd !== "—") {
      total -= Math.max(0, minutes(day.mealEnd) - minutes(day.mealStart));
    }
    return pad(Math.floor(total / 60)) + ":" + pad(total % 60);
  }

  function samePersonalNumber(left, right) {
    var leftValue = String(left || "").trim();
    var rightValue = String(right || "").trim();

    if (!leftValue || !rightValue) {
      return false;
    }

    if (leftValue === rightValue) {
      return true;
    }

    if (/^\d+$/.test(leftValue) && /^\d+$/.test(rightValue)) {
      return leftValue.replace(/^0+/, "") === rightValue.replace(/^0+/, "");
    }

    return false;
  }

  function nonNegativeInteger(value, field) {
    var text = String(value === undefined || value === null ? "" : value).trim();
    var number = Number(text);
    if (!/^\d{1,6}$/.test(text) || !Number.isSafeInteger(number) || number < 0) {
      throw new Error("ProcessingDelaysSet devolvió " + field + " inválido.");
    }
    return number;
  }

  function sapBoolean(value) {
    var normalized = String(value || "").trim().toUpperCase();
    return value === true || ["X", "1", "TRUE", "SI", "SÍ", "YES"].indexOf(normalized) >= 0;
  }

  function attendanceStatus(record, day) {
    var source = String(record.DayStatus || record.DescriptionStatus || record.Status || "").trim();
    var normalized = source.toUpperCase();
    if (/VIAJE|TRAVEL|COMISI[ÓO]N/.test(normalized)) { return "Viaje de trabajo"; }
    if (/RETARDO|TARDE|LATE/.test(normalized) || sapBoolean(record.IsLate)) { return "Entrada tarde"; }
    if (/AUSENTE|ABSENT/.test(normalized) || sapBoolean(record.IsAbsent)) { return "Ausente"; }
    if (/INCOMPLET/.test(normalized) || sapBoolean(record.IsIncomplete)) { return "Incompleto"; }
    if (source) { return source; }
    if (day.exit !== "—") { return "Jornada finalizada"; }
    if (day.entry !== "—") { return "Jornada en curso"; }
    return "Sin marcajes";
  }

  function previousIsoDate(isoDate) {
    var parts = String(isoDate || "").split("-").map(Number);
    var date = new Date(parts[0], parts[1] - 1, parts[2] - 1, 12, 0, 0, 0);
    return localDate(date);
  }

  function isOvernightSchedule(value) {
    var matcher = /(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/g;
    var match;
    while ((match = matcher.exec(String(value || ""))) !== null) {
      if (Number(match[3]) * 60 + Number(match[4]) < Number(match[1]) * 60 + Number(match[2])) {
        return true;
      }
    }
    return false;
  }

  function mapHistory(records, fallbackScheduleDetail) {
    var days = {};
    records.forEach(function (record) {
      var workDate = String(record.WorkDate || "").trim();
      var sourceDate = workDate && workDate !== "00000000" ? workDate : (record.EnterDate || record.DateFrom);
      var date = normalizeDate(sourceDate);
      if (!date || date === "0000-00-00") {
        return;
      }
      if (!days[date]) {
        days[date] = {
          date: displayDate(date),
          isoDate: date,
          entry: "—",
          mealStart: "—",
          mealEnd: "—",
          exit: "—",
          hours: "—",
          status: "Sin marcajes",
          dayStatus: "",
          isLate: false,
          isTravel: false,
          isHomeOffice: false,
          typeSession: "",
          sessionDateFrom: "",
          sessionDateTo: "",
          employee: {
            id: String(record.PersonalNumber || "").trim(),
            name: String(record.FullName || "").trim(),
            email: String(record.Email || "").trim(),
            center: String(record.CenterOffice || "").trim(),
            centerCode: String(record.CenterCode || "").trim(),
            zone: String(record.Zone || "").trim(),
            scheduleCode: String(record.Schedule || "").trim(),
            schedule: String(record.ScheduleDescription || record.Schedule || "").trim(),
            scheduleDetail: String(record.ScheduleDetail || fallbackScheduleDetail || "").trim(),
            position: String(record.Position || "").trim()
          },
          rawRecords: []
        };
      }

      days[date].rawRecords.push(record);
      days[date].dayStatus = String(record.DayStatus || days[date].dayStatus || "").trim();

      var time = normalizeTime(record.EnterHour);
      if (record.RegisterType === EVENT_CODES.CHECK_IN) { days[date].entry = time; }
      if (record.RegisterType === EVENT_CODES.MEAL_START) { days[date].mealStart = time; }
      if (record.RegisterType === EVENT_CODES.MEAL_END) { days[date].mealEnd = time; }
      if (record.RegisterType === EVENT_CODES.CHECK_OUT) { days[date].exit = time; }

      var p10Time = normalizeTime(record.P10Time);
      var p15Time = normalizeTime(record.P15Time);
      var p25Time = normalizeTime(record.P25Time);
      var p20Time = normalizeTime(record.P20Time);

      if (p10Time !== "—") { days[date].entry = p10Time; }
      if (p15Time !== "—") { days[date].mealStart = p15Time; }
      if (p25Time !== "—") { days[date].mealEnd = p25Time; }
      if (p20Time !== "—") { days[date].exit = p20Time; }

      var netHours = normalizeTime(record.NetHours);
      if (netHours !== "—") {
        days[date].hours = netHours;
      }

      days[date].isLate = days[date].isLate || sapBoolean(record.IsLate) || /RETARDO|TARDE|LATE/i.test(String(record.DayStatus || ""));
      days[date].isTravel = days[date].isTravel || /VIAJE|TRAVEL|COMISI[ÓO]N/i.test(String(record.DayStatus || record.DescriptionStatus || record.Status || ""));
      days[date].isHomeOffice = days[date].isHomeOffice || /HOME\s*OFFIC|HOME\s*OFFICE|REMOT[OA]|TELETRABAJO/i.test(String(record.DayStatus || record.DescriptionStatus || record.Status || ""));
      var recordTypeSession = String(record.TypeSession || "").trim().toUpperCase();
      if (recordTypeSession === "VN" || days[date].isTravel) {
        days[date].typeSession = "VN";
      } else if (recordTypeSession === "HO" || days[date].isHomeOffice) {
        days[date].typeSession = "HO";
      } else if (recordTypeSession === "PR") {
        days[date].typeSession = "PR";
      }
      if (days[date].typeSession) {
        days[date].sessionDateFrom = normalizeDate(record.DateFrom) || days[date].sessionDateFrom;
        days[date].sessionDateTo = normalizeDate(record.DateTo) || days[date].sessionDateTo;
      }
      days[date].status = attendanceStatus(record, days[date]);

    });

    Object.keys(days).sort().forEach(function (key) {
      var current = days[key];
      var previous = days[previousIsoDate(key)];
      var detail = previous && previous.employee.scheduleDetail || current.employee.scheduleDetail || fallbackScheduleDetail;
      if (!previous || previous.entry === "—" || previous.exit !== "—" || current.entry !== "—" ||
          !isOvernightSchedule(detail)) {
        return;
      }

      ["mealStart", "mealEnd", "exit"].forEach(function (field) {
        if (previous[field] === "—" && current[field] !== "—") {
          previous[field] = current[field];
          current[field] = "—";
        }
      });
      previous.rawRecords = previous.rawRecords.concat(current.rawRecords || []);
      if (!previous.typeSession && current.typeSession) { previous.typeSession = current.typeSession; }
      if (!previous.dayStatus && current.dayStatus) { previous.dayStatus = current.dayStatus; }
      if (current.entry === "—" && current.mealStart === "—" && current.mealEnd === "—" && current.exit === "—" && !current.dayStatus) {
        delete days[key];
      }
    });

    return Object.keys(days).sort().reverse().map(function (key) {
      var day = days[key];
      if (day.hours === "—") {
        day.hours = workedHours(day);
      }
      if (day.isTravel) {
        day.status = "Viaje de trabajo";
      } else if (day.isLate) {
        day.status = "Entrada tarde";
      } else if (day.exit !== "—") {
        day.status = "Jornada finalizada";
      } else if (day.entry !== "—") {
        day.status = "Jornada en curso";
      }
      return day;
    });
  }

  function requestCsrfToken(serviceRoot) {
    var requestId = Diagnostics.request("GET", serviceRoot, {
      purpose: "Solicitar token CSRF",
      headers: { Accept: "application/json", "X-CSRF-Token": "Fetch" }
    });
    return fetch(serviceRoot, {
      method: "GET",
      credentials: "same-origin",
      headers: {
        "Accept": "application/json",
        "X-CSRF-Token": "Fetch"
      }
    }).then(function (response) {
      return response.text().then(function (body) {
        Diagnostics.response(requestId, response.status, response.statusText, body, {
          contentType: response.headers.get("content-type"),
          finalUrl: response.url,
          csrfTokenReceived: Boolean(response.headers.get("X-CSRF-Token"))
        });
        if (!response.ok) {
          throw new Error("No fue posible solicitar el token CSRF (HTTP " + response.status + ")");
        }
        var token = response.headers.get("X-CSRF-Token");
        if (!token) {
          throw new Error("SAP no devolvió el token CSRF");
        }
        return token;
      });
    }).catch(function (error) {
      Diagnostics.error("CSRF", "Falló la solicitud del token CSRF", error, requestId);
      throw error;
    });
  }

  function postEntity(root, token, entitySet, payload, flowId) {
    var url = root + entitySet;
    var requestId = Diagnostics.request("POST", url, {
      flowId: flowId,
      entitySet: entitySet,
      payload: payload,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": "[REDACTADO]"
      }
    });

    debugPostRequest(entitySet, url, payload, flowId);

    return fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": token
      },
      body: JSON.stringify(payload)
    }).then(function (response) {
      return response.text().then(function (body) {
        debugPostResponse(entitySet, response, body, flowId);
        Diagnostics.response(requestId, response.status, response.statusText, body, {
          flowId: flowId,
          entitySet: entitySet,
          contentType: response.headers.get("content-type"),
          finalUrl: response.url
        });
        if (!response.ok) {
          throw new Error(entitySet + " respondió con HTTP " + response.status + ": " + body);
        }

        var parsedResponse = {};
        if (body) {
          try {
            parsedResponse = JSON.parse(body);
          } catch (parseError) {
            Diagnostics.error("PARSE", entitySet + " no devolvió JSON válido", parseError, requestId);
            parsedResponse = { rawBody: body };
          }
        }

        return {
          payload: parsedResponse,
          requestId: requestId
        };
      });
    }).catch(function (error) {
      Diagnostics.error("POST", "Falló POST " + entitySet, error, requestId);
      throw error;
    });
  }

  return {
    eventCode: function (action) {
      return EVENT_CODES[action];
    },

    captureLocation: captureLocation,

    registerBusinessTrip: function (serviceRoot, employee, dateFromValue, dateToValue, device, locationValue) {
      var now = new Date();
      var enterDate = localDate(now);
      var dateFrom = normalizeDate(dateFromValue);
      var dateTo = normalizeDate(dateToValue);
      var flowId = "BUSINESS-TRIP-" + now.getTime() + "-" + String(employee && employee.id || "SIN-PERNR");

      if (!dateFrom || !dateTo) {
        return Promise.reject(new Error("Las fechas de inicio y fin del viaje son obligatorias."));
      }
      if (dateFrom > dateTo) {
        return Promise.reject(new Error("La fecha inicial del viaje no puede ser posterior a la fecha final."));
      }

      var location = locationValue || {};
      var payload = {
        PersonalNumber: employee.id,
        RegisterType: "P10",
        FullName: employee.name,
        Email: employee.email || "",
        EnterDate: enterDate,
        EnterHour: localTime(now),
        Chanel: "BTP",
        Device: device || "",
        TypeSession: "VN",
        Latitude: String(location.latitude || ""),
        Longitude: String(location.longitude || ""),
        GeoStatus: String(location.geoStatus || ""),
        IsLate: "",
        Id_log: "",
        StatusReq: "",
        Message: "",
        DateFrom: dateFrom,
        DateTo: dateTo
      };
      var root = resolveServiceRoot(serviceRoot);

      Diagnostics.info("BUSINESS_TRIP", "Flujo de viaje de negocios preparado", {
        flowId: flowId,
        attendanceRecord: payload
      });

      return requestCsrfToken(root).then(function (token) {
        return postEntity(root, token, "AttendanceRecordSet", payload, flowId);
      }).then(function (postResult) {
        var validation = validateMarkResponse(postResult.payload);
        return {
          success: true,
          flowId: flowId,
          payload: payload,
          response: postResult.payload,
          sapEntity: validation.entity,
          sapStatus: validation.status,
          sapMessage: validation.message,
          registeredAt: now
        };
      });
    },

    mark: function (serviceRoot, action, employee, device, options) {
      var now = new Date();
      var enterDate = localDate(now);
      var flowId = "MARK-" + now.getTime() + "-" + String(employee && employee.id || "SIN-PERNR");
      var markOptions = options || {};
      var location = markOptions.location || {};
      var justification = markOptions.lateJustification || {};
      var earlyExitJustification = markOptions.earlyExitJustification || {};
      var typeSession = String(markOptions.typeSession || "PR").trim().toUpperCase();
      if (["PR", "HO", "VN"].indexOf(typeSession) < 0) {
        typeSession = "PR";
      }
      var dateFrom = normalizeDate(markOptions.dateFrom) || enterDate;
      var dateTo = normalizeDate(markOptions.dateTo) || enterDate;
      if (typeSession !== "VN") {
        dateFrom = enterDate;
        dateTo = enterDate;
      }
      if (dateFrom > dateTo) {
        return Promise.reject(new Error("La fecha inicial de la modalidad no puede ser posterior a la fecha final."));
      }
      var payload = {
        PersonalNumber: employee.id,
        RegisterType: EVENT_CODES[action],
        FullName: employee.name,
        Email: employee.email || "",
        EnterDate: enterDate,
        EnterHour: localTime(now),
        Chanel: "BTP",
        Device: device || "",
        TypeSession: typeSession,
        Latitude: String(location.latitude || ""),
        Longitude: String(location.longitude || ""),
        GeoStatus: String(location.geoStatus || ""),
        IsLate: "",
        Id_log: "",
        StatusReq: "",
        Message: "",
        DateFrom: dateFrom,
        DateTo: dateTo
      };
      if (typeSession === "HO") {
        delete payload.Latitude;
        delete payload.Longitude;
      }
      var shouldPostJustification = !markOptions.isFourthLate && (
        (action === "CHECK_IN" && markOptions.isLate && justification.saved) ||
        (action === "CHECK_OUT" && markOptions.isEarlyExit && earlyExitJustification.saved)
      );
      var selectedJustification = action === "CHECK_OUT" ? earlyExitJustification : justification;
      if (shouldPostJustification && ["Personal", "Laboral"].indexOf(String(selectedJustification.reason || "").trim()) < 0) {
        return Promise.reject(new Error("La justificación requiere motivo Personal o Laboral."));
      }
      if (shouldPostJustification && !String(selectedJustification.comment || "").trim()) {
        return Promise.reject(new Error("La justificación requiere un comentario."));
      }
      if (shouldPostJustification && String(selectedJustification.comment || "").trim().length > 500) {
        return Promise.reject(new Error("El comentario de la justificación no puede exceder 500 caracteres."));
      }
      var justificationPayload = shouldPostJustification
        ? buildJustificationPayload(employee, action, selectedJustification, now)
        : null;
      var root = resolveServiceRoot(serviceRoot);

      Diagnostics.info("MARK", "Flujo de marcaje preparado", {
        flowId: flowId,
        postsEsperados: shouldPostJustification ? 2 : 1,
        attendanceRecord: payload,
        justificationLog: justificationPayload
      });
      return requestCsrfToken(root).then(function (token) {
        return postEntity(root, token, "AttendanceRecordSet", payload, flowId).then(function (postResult) {
          var validation = validateMarkResponse(postResult.payload);
          if (justificationPayload) {
            justificationPayload.Id_log = String(validation.entity.Id_log || validation.entity.IdLog || "").trim();
          }
          Diagnostics.mapping("AttendanceRecordSet", postResult.payload, {
            flowId: flowId,
            success: true,
            registeredAt: now,
            sapStatus: validation.status,
            sapMessage: validation.message
          }, postResult.requestId);

          return {
            success: true,
            flowId: flowId,
            payload: payload,
            response: postResult.payload,
            sapEntity: validation.entity,
            sapStatus: validation.status,
            sapMessage: validation.message,
            registeredAt: now,
            justification: null
          };
        }).then(function (markResult) {
          if (!justificationPayload) {
            return markResult;
          }

          Diagnostics.info("MARK", "AttendanceRecordSet aceptado; se enviará JustificationLogSet", {
            flowId: flowId,
            payload: justificationPayload
          });

          return postEntity(
            root,
            token,
            "JustificationLogSet",
            justificationPayload,
            flowId
          ).then(function (postResult) {
            var validation = validateJustificationResponse(postResult.payload);
            Diagnostics.mapping("JustificationLogSet", postResult.payload, {
              flowId: flowId,
              success: true,
              sapStatus: validation.status,
              sapMessage: validation.message
            }, postResult.requestId);

            markResult.justification = {
              success: true,
              payload: justificationPayload,
              response: postResult.payload,
              sapEntity: validation.entity,
              sapStatus: validation.status,
              sapMessage: validation.message
            };
            return markResult;
          }).catch(function (error) {
            error.attendanceRecorded = true;
            error.attendanceResult = markResult;
            error.flowId = flowId;
            throw error;
          });
        });
      }).catch(function (error) {
        Diagnostics.error("MARK", "Falló el flujo de registro de asistencia", error);
        throw error;
      });
    },

    readDelays: function (serviceRoot, personalNumber, dateValue) {
      var root = resolveServiceRoot(serviceRoot);
      var date = dateValue || new Date();
      var year = date.getFullYear();
      var month = pad(date.getMonth() + 1);
      var period = String(year) + month;
      var lastDay = pad(new Date(year, date.getMonth() + 1, 0).getDate());
      var normalizedNumber = String(personalNumber || "").trim();
      var numberForFilter = /^\d+$/.test(normalizedNumber)
        ? (normalizedNumber.replace(/^0+/, "") || "0")
        : normalizedNumber;
      var filter = "DateFrom eq '" + period + "01' and DateTo eq '" + period + lastDay +
        "' and PersonalNumber eq '" + numberForFilter.replace(/'/g, "''") + "'";
      var url = root + "ProcessingDelaysSet?$filter=" + encodeURIComponent(filter) + "&$format=json";
      var requestId = Diagnostics.request("GET", url, {
        entitySet: "ProcessingDelaysSet",
        filter: filter,
        period: period
      });

      if (!normalizedNumber) {
        return Promise.reject(new Error("No existe número de nómina para consultar ProcessingDelaysSet."));
      }

      return fetch(url, {
        method: "GET",
        credentials: "same-origin",
        headers: { "Accept": "application/json" }
      }).then(function (response) {
        return response.text().then(function (body) {
          Diagnostics.response(requestId, response.status, response.statusText, body, {
            contentType: response.headers.get("content-type"),
            finalUrl: response.url
          });
          if (!response.ok) {
            throw new Error("ProcessingDelaysSet respondió con HTTP " + response.status + ".");
          }
          var payload;
          try {
            payload = body ? JSON.parse(body) : {};
          } catch (parseError) {
            throw new Error("ProcessingDelaysSet devolvió una respuesta que no es JSON.");
          }
          var rows = odataResults(payload);
          if (!rows.length) {
            return {
              period: period,
              totalDelays: 0,
              totalAbsences: 0,
              lastUpdate: "",
              lastHourUpdate: ""
            };
          }
          var matches = rows.filter(function (row) {
            return samePersonalNumber(row.PersonalNumber, normalizedNumber) &&
              String(row.Period || "").trim() === period;
          });
          if (matches.length !== 1) {
            throw new Error("ProcessingDelaysSet no devolvió un registro único para el empleado y mes consultados.");
          }
          return {
            period: period,
            totalDelays: nonNegativeInteger(matches[0].TotalDelays, "TotalDelays"),
            totalAbsences: nonNegativeInteger(matches[0].TotalAbsences, "TotalAbsences"),
            lastUpdate: String(matches[0].LastUpdate || "").trim(),
            lastHourUpdate: String(matches[0].LastHourUpdate || "").trim()
          };
        });
      }).catch(function (error) {
        Diagnostics.error("DELAYS", "Falló la consulta de ProcessingDelaysSet", error, requestId);
        throw error;
      });
    },

    readHistory: function (serviceRoot, identifier, selectedDate, expectedPersonalNumber, options) {
      var root = resolveServiceRoot(serviceRoot);
      var dateFrom = String(selectedDate || "").trim().replace(/-/g, "").replace(/'/g, "''");
      var settings = options || {};
      var dateTo = String(settings.dateTo || "").trim().replace(/-/g, "").replace(/'/g, "''");

      function requestHistory(identifierToSend, requestPurpose, filterField) {
        var safeIdentifier = String(identifierToSend || "").trim().replace(/'/g, "''");
        var field = filterField === "Email" ? "Email" : "PersonalNumber";
        var filter = field + " eq '" + safeIdentifier + "' and DateFrom eq '" + dateFrom + "'";
        if (dateTo) {
          filter += " and DateTo eq '" + dateTo + "'";
        }
        var url = root + "AttendanceHistorySet?$filter=" + encodeURIComponent(filter) + "&$format=json";
        var requestId = Diagnostics.request("GET", url, {
          entitySet: "AttendanceHistorySet",
          purpose: requestPurpose,
          filterField: field,
          filter: filter,
          identifier: identifierToSend,
          dateFrom: dateFrom,
          dateTo: dateTo,
          expectedPersonalNumber: expectedPersonalNumber
        });

        return fetch(url, {
          method: "GET",
          credentials: "same-origin",
          headers: { "Accept": "application/json" }
        }).then(function (response) {
          return response.text().then(function (body) {
            Diagnostics.response(requestId, response.status, response.statusText, body, {
              contentType: response.headers.get("content-type"),
              finalUrl: response.url
            });
            if (!response.ok) {
              throw new Error("AttendanceHistorySet respondió con HTTP " + response.status + ". Filtro: " + filter);
            }

            var payload;
            try {
              payload = body ? JSON.parse(body) : {};
            } catch (parseError) {
              Diagnostics.error("PARSE", "AttendanceHistorySet no devolvió JSON válido", parseError, requestId);
              throw new Error("AttendanceHistorySet devolvió una respuesta que no es JSON");
            }

            return {
              identifier: identifierToSend,
              payload: payload,
              records: odataResults(payload),
              requestId: requestId
            };
          });
        }).catch(function (error) {
          Diagnostics.error("HISTORY", "Falló la consulta de AttendanceHistorySet", error, requestId);
          throw error;
        });
      }

      function recordsForEmployee(result) {
        if (!expectedPersonalNumber) {
          return result.records;
        }
        return result.records.filter(function (record) {
          return samePersonalNumber(record.PersonalNumber, expectedPersonalNumber);
        });
      }

      var primaryFilterField = settings.filterField || (String(identifier || "").indexOf("@") >= 0 ? "Email" : "PersonalNumber");

      return requestHistory(identifier, "Consulta principal por correo o nómina ingresada", primaryFilterField).then(function (primaryResult) {
        var primaryEmployeeRecords = recordsForEmployee(primaryResult);

        Diagnostics.info("HISTORY", "Resultado de la consulta principal del historial", {
          identifierSentToSap: identifier,
          expectedPersonalNumber: expectedPersonalNumber,
          receivedCount: primaryResult.records.length,
          employeeCount: primaryEmployeeRecords.length,
          receivedPersonalNumbers: primaryResult.records.map(function (record) {
            return String(record.PersonalNumber || "").trim();
          })
        });

        if (primaryEmployeeRecords.length || !expectedPersonalNumber || samePersonalNumber(identifier, expectedPersonalNumber)) {
          return {
            result: primaryResult,
            employeeRecords: primaryEmployeeRecords
          };
        }

        Diagnostics.info("HISTORY", "La consulta por correo no incluyó al empleado activo; se consultará su nómina", {
          originalIdentifier: identifier,
          fallbackPersonalNumber: expectedPersonalNumber,
          dateFrom: dateFrom
        });

        return requestHistory(expectedPersonalNumber, "Consulta de respaldo por nómina del empleado", "PersonalNumber").then(function (fallbackResult) {
          return {
            result: fallbackResult,
            employeeRecords: recordsForEmployee(fallbackResult)
          };
        });
      }).then(function (resolvedHistory) {
        var history = mapHistory(resolvedHistory.employeeRecords, settings.scheduleDetail);
        Diagnostics.mapping("AttendanceHistorySet", resolvedHistory.result.payload, history, resolvedHistory.result.requestId);
        return history;
      });
    }
  };
});
