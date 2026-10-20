sap.ui.define([], function () {
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

  function normalizeDate(value) {
    var text = String(value || "");
    var ticks = text.match(/^\/Date\((\d+)/);
    if (ticks) {
      return localDate(new Date(Number(ticks[1])));
    }
    return text.slice(0, 10);
  }

  function normalizeTime(value) {
    var text = String(value || "");
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

  function mapHistory(records) {
    var days = {};
    records.forEach(function (record) {
      var date = normalizeDate(record.EnterDate);
      if (!days[date]) {
        days[date] = {
          date: displayDate(date),
          isoDate: date,
          entry: "—",
          mealStart: "—",
          mealEnd: "—",
          exit: "—",
          hours: "—"
        };
      }

      var time = normalizeTime(record.EnterHour);
      if (record.RegisterType === EVENT_CODES.CHECK_IN) { days[date].entry = time; }
      if (record.RegisterType === EVENT_CODES.MEAL_START) { days[date].mealStart = time; }
      if (record.RegisterType === EVENT_CODES.MEAL_END) { days[date].mealEnd = time; }
      if (record.RegisterType === EVENT_CODES.CHECK_OUT) { days[date].exit = time; }

    });

    return Object.keys(days).sort().reverse().map(function (key) {
      var day = days[key];
      day.hours = workedHours(day);
      return day;
    });
  }

  function requestCsrfToken(serviceRoot) {
    return fetch(serviceRoot, {
      method: "GET",
      credentials: "same-origin",
      headers: {
        "Accept": "application/json",
        "X-CSRF-Token": "Fetch"
      }
    }).then(function (response) {
      if (!response.ok) {
        throw new Error("No fue posible solicitar el token CSRF (HTTP " + response.status + ")");
      }
      var token = response.headers.get("X-CSRF-Token");
      if (!token) {
        throw new Error("SAP no devolvió el token CSRF");
      }
      return token;
    });
  }

  return {
    eventCode: function (action) {
      return EVENT_CODES[action];
    },

    mark: function (serviceRoot, action, position, employee, device) {
      var now = new Date();
      var payload = {
        PersonalNumber: employee.id,
        RegisterType: EVENT_CODES[action],
        FullName: employee.name,
        Email: employee.email || "",
        EnterDate: localDate(now),
        EnterHour: localTime(now),
        Chanel: "SAP",
        Device: device || "BTP-Web",
        Latitude: Number(position.coords.latitude).toFixed(8),
        Longitude: Number(position.coords.longitude).toFixed(8),
        GeoStatus: "",
        IsLate: "",
        Id_log: "",
        StatusReq: "",
        Message: ""
      };
      var root = String(serviceRoot || "").replace(/\/?$/, "/");

      return requestCsrfToken(root).then(function (token) {
        return fetch(root + "AttendanceRecordSet", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-CSRF-Token": token
          },
          body: JSON.stringify(payload)
        });
      }).then(function (response) {
        if (!response.ok) {
          return response.text().then(function (body) {
            throw new Error("AttendanceRecordSet respondió con HTTP " + response.status + ": " + body);
          });
        }
        return response.text().then(function (body) {
          return {
            success: true,
            payload: payload,
            response: body ? JSON.parse(body) : {},
            registeredAt: now
          };
        });
      });
    },

    readHistory: function (serviceRoot, personalNumber, enterDate) {
      var root = String(serviceRoot || "").replace(/\/?$/, "/");
      var safeNumber = String(personalNumber || "").replace(/'/g, "''");
      var safeDate = String(enterDate || "").replace(/'/g, "''");
      var filter = "PersonalNumber eq '" + safeNumber + "' and EnterDate eq '" + safeDate + "'";
      var url = root + "AttendanceHistorySet?$filter=" + encodeURIComponent(filter) + "&$format=json";

      return fetch(url, {
        method: "GET",
        credentials: "same-origin",
        headers: { "Accept": "application/json" }
      }).then(function (response) {
        if (!response.ok) {
          throw new Error("AttendanceHistorySet respondió con HTTP " + response.status);
        }
        return response.json();
      }).then(function (payload) {
        return mapHistory(odataResults(payload));
      });
    }
  };
});
