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

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function localDate(date) {
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  }

  function localTime(date) {
    return pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
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

  function isPostDebugEnabled() {
    var params = new URLSearchParams(window.location.search || "");
    return /^(1|true|yes)$/i.test(String(params.get("debugPost") || ""));
  }

  function debugPostRequest(url, payload) {
    if (!isPostDebugEnabled()) {
      return;
    }

    var snapshot = JSON.parse(JSON.stringify(payload));
    window.checkinLastPost = {
      timestamp: new Date().toISOString(),
      method: "POST",
      url: url,
      payload: snapshot
    };

    console.group("[CHECKIN][POST] AttendanceRecordSet - solicitud");
    console.log("URL:", url);
    console.log("Método:", "POST");
    console.log("Payload:", snapshot);
    console.log("Payload JSON:", JSON.stringify(snapshot, null, 2));
    console.trace("Punto donde se envía el POST");
    console.groupEnd();

    debugger;
  }

  function debugPostResponse(response, body) {
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
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      url: response.url,
      headers: headers,
      body: parsedBody
    };

    console.group("[CHECKIN][POST] AttendanceRecordSet - respuesta");
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

  return {
    eventCode: function (action) {
      return EVENT_CODES[action];
    },

    mark: function (serviceRoot, action, employee, device, options) {
      var now = new Date();
      var markOptions = options || {};
      var justification = markOptions.lateJustification || {};
      var justificationMessage = "";
      if (action === "CHECK_IN" && markOptions.isLate && justification.saved) {
        justificationMessage = "JUSTIFICACION RETRASO | Motivo: " + String(justification.reason || "").trim();
        if (String(justification.comment || "").trim()) {
          justificationMessage += " | Comentario: " + String(justification.comment).trim();
        }
        justificationMessage += " | Recupera tiempo: " + (justification.recoverTime ? "Si" : "No");
        justificationMessage = justificationMessage.slice(0, 255);
      }
      var payload = {
        PersonalNumber: employee.id,
        RegisterType: EVENT_CODES[action],
        FullName: employee.name,
        Email: employee.email || "",
        EnterDate: localDate(now),
        EnterHour: localTime(now),
        Chanel: "BTP",
        Device: device || "",
        Latitude: "",
        Longitude: "",
        GeoStatus: "",
        IsLate: action === "CHECK_IN" && markOptions.isLate ? "X" : "",
        Id_log: "",
        StatusReq: "",
        Message: justificationMessage
      };
      var root = String(serviceRoot || "").replace(/\/?$/, "/");

      Diagnostics.info("MARK", "Payload preparado para AttendanceRecordSet", payload);
      return requestCsrfToken(root).then(function (token) {
        var url = root + "AttendanceRecordSet";
        var requestId = Diagnostics.request("POST", url, {
          entitySet: "AttendanceRecordSet",
          payload: payload,
          headers: { Accept: "application/json", "Content-Type": "application/json", "X-CSRF-Token": "[REDACTADO]" }
        });

        debugPostRequest(url, payload);

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
            debugPostResponse(response, body);
            Diagnostics.response(requestId, response.status, response.statusText, body, {
              contentType: response.headers.get("content-type"),
              finalUrl: response.url
            });
            if (!response.ok) {
              throw new Error("AttendanceRecordSet respondió con HTTP " + response.status + ": " + body);
            }
            var parsedResponse = {};
            if (body) {
              try {
                parsedResponse = JSON.parse(body);
              } catch (parseError) {
                Diagnostics.error("PARSE", "AttendanceRecordSet no devolvió JSON válido", parseError, requestId);
                parsedResponse = { rawBody: body };
              }
            }
            var validation = validateMarkResponse(parsedResponse);
            Diagnostics.mapping("AttendanceRecordSet", parsedResponse, {
              success: true,
              registeredAt: now,
              sapStatus: validation.status,
              sapMessage: validation.message
            }, requestId);
            return {
              payload: parsedResponse,
              validation: validation
            };
          });
        }).then(function (result) {
          return {
            success: true,
            payload: payload,
            response: result.payload,
            sapEntity: result.validation.entity,
            sapStatus: result.validation.status,
            sapMessage: result.validation.message,
            registeredAt: now
          };
        });
      }).catch(function (error) {
        Diagnostics.error("MARK", "Falló el registro de asistencia", error);
        throw error;
      });
    },

    readHistory: function (serviceRoot, identifier, selectedDate, expectedPersonalNumber) {
      var root = String(serviceRoot || "").replace(/\/?$/, "/");
      var dateFrom = String(selectedDate || "").trim().replace(/-/g, "").replace(/'/g, "''");

      function requestHistory(identifierToSend, requestPurpose, filterField) {
        var safeIdentifier = String(identifierToSend || "").trim().replace(/'/g, "''");
        var field = filterField === "Email" ? "Email" : "PersonalNumber";
        var filter = field + " eq '" + safeIdentifier + "' and DateFrom eq '" + dateFrom + "'";
        var url = root + "AttendanceHistorySet?$filter=" + encodeURIComponent(filter) + "&$format=json";
        var requestId = Diagnostics.request("GET", url, {
          entitySet: "AttendanceHistorySet",
          purpose: requestPurpose,
          filterField: field,
          filter: filter,
          identifier: identifierToSend,
          dateFrom: dateFrom,
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

      var primaryFilterField = String(identifier || "").indexOf("@") >= 0 ? "Email" : "PersonalNumber";

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
