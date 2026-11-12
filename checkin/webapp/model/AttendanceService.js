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

  var LOCATION_CAPTURE_TIMEOUT_MS = 20000;
  var LOCATION_MAX_AGE_MS = 15000;
  var LOCATION_MAX_ACCURACY_METERS = 200;

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
    var rejectedStatuses = ["E", "A", "X", "ERROR", "FAIL", "FAILED", "REJECTED"];

    if (rejectedStatuses.indexOf(status) >= 0) {
      throw new Error(message || ("SAP rechazó el marcaje con estatus " + status));
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
    var rejectedStatuses = ["E", "A", "X", "ERROR", "FAIL", "FAILED", "REJECTED"];

    if (rejectedStatuses.indexOf(status) >= 0) {
      throw new Error(message || ("SAP rechazó la justificación con estatus " + status));
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

  function lateJustificationPayload(employee, justification, now) {
    var reason = String(justification.reason || "").trim();

    return {
      PersonalNumber: employeeValue(employee, ["id", "PersonalNumber", "PersonnelNumber"]),
      WorkDate: localDate(now),
      RegisterHourLate: localTime(now),
      RegisterType: EVENT_CODES.CHECK_IN,
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

  function mapHistory(records) {
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
            scheduleDetail: String(record.ScheduleDetail || "").trim(),
            position: String(record.Position || "").trim()
          },
          rawRecords: []
        };
      }

      days[date].rawRecords.push(record);

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
      }
      if (days[date].typeSession) {
        days[date].sessionDateFrom = normalizeDate(record.DateFrom) || days[date].sessionDateFrom;
        days[date].sessionDateTo = normalizeDate(record.DateTo) || days[date].sessionDateTo;
      }
      days[date].status = attendanceStatus(record, days[date]);

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

    mark: function (serviceRoot, action, employee, device, options) {
      var now = new Date();
      var enterDate = localDate(now);
      var flowId = "MARK-" + now.getTime() + "-" + String(employee && employee.id || "SIN-PERNR");
      var markOptions = options || {};
      var location = markOptions.location || {};
      var justification = markOptions.lateJustification || {};
      var earlyExitJustification = markOptions.earlyExitJustification || {};
      var typeSession = String(markOptions.typeSession || "").trim().toUpperCase();
      if (["HO", "VN"].indexOf(typeSession) < 0) {
        typeSession = "";
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
      var justificationMessage = "";
      if (action === "CHECK_OUT" && markOptions.isEarlyExit && earlyExitJustification.saved) {
        justificationMessage = "JUSTIFICACION SALIDA ANTICIPADA | Motivo: " + String(earlyExitJustification.reason || "").trim();
        if (String(earlyExitJustification.comment || "").trim()) {
          justificationMessage += " | Comentario: " + String(earlyExitJustification.comment).trim();
        }
        justificationMessage += " | Recupera tiempo: " + (earlyExitJustification.recoverTime ? "Si" : "No");
        justificationMessage = justificationMessage.slice(0, 255);
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
        IsLate: action === "CHECK_IN" && markOptions.isLate ? "X" : "",
        Id_log: "",
        StatusReq: "",
        Message: justificationMessage,
        DateFrom: dateFrom,
        DateTo: dateTo
      };
      var shouldPostLateJustification = action === "CHECK_IN" &&
        markOptions.isLate && justification.saved;
      var justificationPayload = shouldPostLateJustification
        ? lateJustificationPayload(employee, justification, now)
        : null;
      var root = resolveServiceRoot(serviceRoot);

      Diagnostics.info("MARK", "Flujo de marcaje preparado", {
        flowId: flowId,
        postsEsperados: shouldPostLateJustification ? 2 : 1,
        attendanceRecord: payload,
        justificationLog: justificationPayload
      });
      return requestCsrfToken(root).then(function (token) {
        return postEntity(root, token, "AttendanceRecordSet", payload, flowId).then(function (postResult) {
          var validation = validateMarkResponse(postResult.payload);
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
        var history = mapHistory(resolvedHistory.employeeRecords);
        Diagnostics.mapping("AttendanceHistorySet", resolvedHistory.result.payload, history, resolvedHistory.result.requestId);
        return history;
      });
    }
  };
});
