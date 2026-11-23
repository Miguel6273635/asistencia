sap.ui.define([], function () {
  "use strict";

  var BLOCKED_RELATIONS = {
    "01": "VACACIONES",
    "03": "INCAPACIDAD",
    "05": "CUMPLEAÑOS",
    "06": "SANCIONADO",
    "07": "BAJA"
  };

  function normalize(value) {
    return String(value || "").trim().toUpperCase();
  }

  function relationCode(employee) {
    var raw = employee && employee.raw || {};
    var code = normalize(employee && employee.relationJob || raw.RelationJob).split(/\s+/)[0];
    return /^\d$/.test(code) ? "0" + code : code;
  }

  function relation(employee) {
    var raw = employee && employee.raw || {};
    var code = relationCode(employee);
    var description = String(
      employee && employee.relationJobDescription ||
      raw.RelationJobDescription ||
      raw.RelationDescription ||
      BLOCKED_RELATIONS[code] ||
      code
    ).trim();

    return {
      code: code,
      description: description,
      homeOffice: code === "02",
      businessTrip: code === "04",
      blocked: Boolean(BLOCKED_RELATIONS[code])
    };
  }

  function classifyEmployee(employee) {
    var current = employee || {};
    var raw = current.raw || {};
    var status = normalize(current.status || raw.Status);
    var group = normalize(current.groupPerson || raw.GroupPerson);
    var channel = normalize(current.authorisedRegister || raw.AuthorisedRegister);
    var employeeRelation = relation(current);
    var active = status === "3";
    var confidence = group === "X";
    var unionized = group === "Y";
    var appChannel = channel === "APP" || channel === "AMBOS";
    var viewOnly = channel === "BTP";
    var reason = "";

    if (employeeRelation.blocked) {
      reason = "No puedes registrar asistencia. Estatus laboral: " + employeeRelation.description + ".";
    } else if (unionized && (employeeRelation.homeOffice || employeeRelation.businessTrip)) {
      reason = "El personal sindicalizado solo registra asistencia presencial (entrada y salida). " +
        "SAP indica " + employeeRelation.description + "; solicita la revisión del estatus a Recursos Humanos.";
    } else if (!active) {
      reason = "Empleado no activo: " + String(current.statusDescription || raw.DescriptionStatus || status || "sin estatus") + ".";
    } else if (!confidence && !unionized) {
      reason = "SAP no devolvió GroupPerson X o Y para este empleado.";
    } else if (viewOnly) {
      reason = "Tu asistencia se registra mediante el monitor BTP; aquí solo puedes consultar tus datos.";
    } else if (!appChannel) {
      reason = "SAP no autorizó el registro de asistencia desde la aplicación. Consulta con Recursos Humanos.";
    }

    return {
      enabled: !reason && active && (confidence || unionized) && appChannel,
      active: active,
      group: group,
      confidence: confidence,
      unionized: unionized,
      channel: channel,
      appChannel: appChannel,
      viewOnly: viewOnly,
      relation: employeeRelation,
      reason: reason
    };
  }

  function allowedModalities(employee) {
    var policy = classifyEmployee(employee);
    if (!policy.enabled) { return []; }
    if (policy.unionized) { return ["PR"]; }
    if (policy.relation.homeOffice) { return ["HO"]; }
    if (policy.relation.businessTrip) { return ["VN"]; }
    return policy.confidence ? ["PR", "HO", "VN"] : ["PR"];
  }

  function clockSeconds(value) {
    var match = String(value || "").trim().match(/^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/);
    var hour;
    if (!match) { return null; }
    hour = Number(match[1]);
    if (hour > 23) { return null; }
    return hour * 3600 + Number(match[2]) * 60 + Number(match[3] || 0);
  }

  function formatClock(seconds) {
    if (!Number.isFinite(seconds)) { return "--:--"; }
    return pad(Math.floor(seconds / 3600)) + ":" + pad(Math.floor((seconds % 3600) / 60));
  }

  /**
   * TimeFoodSchedule define la ventana autorizada por SAP.
   * TimeFood es solamente una duración de referencia; nunca limita P25.
   */
  function foodSchedule(employee) {
    var current = employee || {};
    var raw = current.raw || {};
    var scheduleValue = String(current.timeFoodSchedule || raw.TimeFoodSchedule || "").trim();
    var durationValue = String(current.timeFood || raw.TimeFood || "").trim();
    var range = scheduleValue.match(/^(\d{1,2}:[0-5]\d(?::[0-5]\d)?)\s*[-–—]\s*(\d{1,2}:[0-5]\d(?::[0-5]\d)?)$/);
    var startSeconds;
    var endSeconds;
    var duration;
    var hours;
    var minutes;
    var durationMinutes = null;

    if (!scheduleValue) {
      return { valid: false, reason: "SAP no devolvió TimeFoodSchedule para este empleado." };
    }
    if (!range) {
      return { valid: false, reason: "TimeFoodSchedule no tiene el formato HH:MM:SS - HH:MM:SS." };
    }
    startSeconds = clockSeconds(range[1]);
    endSeconds = clockSeconds(range[2]);
    if (startSeconds === null || endSeconds === null || endSeconds <= startSeconds) {
      return { valid: false, reason: "El horario final de comida debe ser posterior al inicial." };
    }

    duration = durationValue.match(/^(\d{1,3})\s*[- ]\s*hrs?\s*\/\s*(\d{1,2})\s*[- ]\s*mins?$/i);
    if (duration) {
      hours = Number(duration[1]);
      minutes = Number(duration[2]);
      if (minutes <= 59 && hours * 60 + minutes > 0 && hours * 60 + minutes <= 24 * 60) {
        durationMinutes = hours * 60 + minutes;
      }
    }

    return {
      valid: true,
      startSeconds: startSeconds,
      endSeconds: endSeconds,
      startText: formatClock(startSeconds),
      endText: formatClock(endSeconds),
      description: formatClock(startSeconds) + " a " + formatClock(endSeconds),
      durationMinutes: durationMinutes,
      durationText: durationMinutes === null ? "No especificado" :
        (Math.floor(durationMinutes / 60) > 0
          ? Math.floor(durationMinutes / 60) + " h" + (durationMinutes % 60 ? " " + (durationMinutes % 60) + " min" : "")
          : durationMinutes + " min")
    };
  }

  function allowsMealEvents(employee, typeSession) {
    var policy = classifyEmployee(employee);
    var session = normalize(typeSession);
    return policy.enabled && policy.confidence && (session === "PR" || session === "HO");
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function isoDate(date) {
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  }

  function clockMinutes(value) {
    var match = String(value || "").match(/(\d{1,2}):(\d{2})/);
    if (!match) { return null; }
    var hour = Number(match[1]);
    var minute = Number(match[2]);
    return hour < 24 && minute < 60 ? hour * 60 + minute : null;
  }

  function shiftBounds(schedule, value) {
    var now = value || new Date();
    var startMinutes = clockMinutes(schedule && schedule.start);
    var endMinutes = clockMinutes(schedule && schedule.end);
    var start;
    var end;
    var overnight;

    if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) {
      return { valid: false, reason: "SAP no devolvió un horario de inicio y fin válido para hoy." };
    }

    start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(endMinutes / 60), endMinutes % 60, 0, 0);
    overnight = endMinutes < startMinutes;

    if (overnight) {
      end.setDate(end.getDate() + 1);
      if (now.getTime() < start.getTime() - 15 * 60000 && now.getTime() <= end.getTime() - 24 * 60 * 60000 + 4 * 60 * 60000) {
        start.setDate(start.getDate() - 1);
        end.setDate(end.getDate() - 1);
      }
    }

    return {
      valid: true,
      start: start,
      end: end,
      opens: new Date(start.getTime() - 15 * 60000),
      lateAfter: new Date(start.getTime() + 10 * 60000),
      overnight: overnight,
      workDate: isoDate(start)
    };
  }

  function startOfWeek(value) {
    var date = new Date((value || new Date()).getTime());
    var offset = (date.getDay() + 6) % 7;
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    return date;
  }

  function endOfWeek(value) {
    var date = startOfWeek(value);
    date.setDate(date.getDate() + 6);
    return date;
  }

  function monthRange(value) {
    var date = value || new Date();
    return {
      from: new Date(date.getFullYear(), date.getMonth(), 1),
      to: new Date(date.getFullYear(), date.getMonth() + 1, 0)
    };
  }

  function isHomeOfficeUsedThisWeek(history, value) {
    var now = value || new Date();
    var from = isoDate(startOfWeek(now));
    var to = isoDate(endOfWeek(now));
    var today = isoDate(now);
    return (history || []).some(function (day) {
      var status = normalize(day.dayStatus || day.status);
      return day.isoDate >= from && day.isoDate <= to && day.isoDate !== today &&
        (day.typeSession === "HO" || day.isHomeOffice || /HOME\s*OFFIC|REMOT|TELETRABAJO/.test(status));
    });
  }

  function isAbsenceStatus(value) {
    return /^(AUSENTE|INASISTENCIA|FALTA)$/.test(normalize(value));
  }

  function delayCycle(totalDelays) {
    var total = Number(totalDelays);
    if (!Number.isSafeInteger(total) || total < 0) {
      return { valid: false, totalDelays: null, fourthOnNextLate: false };
    }
    return {
      valid: true,
      totalDelays: total,
      delaysInCycle: total % 4,
      nextDelay: total + 1,
      fourthOnNextLate: total % 4 === 3
    };
  }

  return {
    classifyEmployee: classifyEmployee,
    allowedModalities: allowedModalities,
    foodSchedule: foodSchedule,
    allowsMealEvents: allowsMealEvents,
    shiftBounds: shiftBounds,
    startOfWeek: startOfWeek,
    endOfWeek: endOfWeek,
    monthRange: monthRange,
    isoDate: isoDate,
    isHomeOfficeUsedThisWeek: isHomeOfficeUsedThisWeek,
    isAbsenceStatus: isAbsenceStatus,
    delayCycle: delayCycle
  };
});
