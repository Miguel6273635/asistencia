sap.ui.define([
  "./Diagnostics"
], function (Diagnostics) {
  "use strict";

  function firstValue(record, properties, fallback) {
    var value;
    properties.some(function (property) {
      if (record[property] !== undefined && record[property] !== null && String(record[property]).trim() !== "") {
        value = String(record[property]).trim();
        return true;
      }
      return false;
    });
    return value || fallback || "";
  }

  function employeeName(record) {
    var fullName = firstValue(record, [
      "FullName", "CompleteName", "EmployeeName", "Name", "PersonalName"
    ]);

    if (fullName) {
      return fullName;
    }

    return [
      firstValue(record, ["FirstName", "GivenName", "Names"]),
      firstValue(record, ["LastName", "PaternalLastName", "FatherLastName"]),
      firstValue(record, ["SecondLastName", "MaternalLastName", "MotherLastName"])
    ].filter(Boolean).join(" ");
  }

  function initials(name) {
    return String(name || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(function (part) { return part.charAt(0).toUpperCase(); })
      .join("") || "US";
  }

  function mapEmployee(record, personalNumber, email) {
    var name = employeeName(record);
    return {
      id: firstValue(record, ["PersonalNumber", "PersonnelNumber", "Pernr", "EmployeeNumber", "EmployeeId"], personalNumber),
      name: name || "Colaborador",
      initials: initials(name),
      role: firstValue(record, ["RoleName", "Role", "EmployeeType"], "Colaborador Mitsubishi"),
      position: firstValue(record, ["PositionName", "Position", "JobName", "Job", "Occupation"], "Colaborador"),
      center: firstValue(record, ["CenterOffice", "WorkCenterName", "CenterName", "WorkCenter", "PlantName", "Plant", "Center", "Base"], "Centro no asignado"),
      centerCode: firstValue(record, ["Base", "Zone", "WorkCenterCode", "CenterCode", "PlantCode", "Werks"], ""),
      address: firstValue(record, ["WorkCenterAddress", "CenterAddress", "Address", "Base"], ""),
      schedule: firstValue(record, ["Hourly", "ScheduleDescription", "Shift", "ScheduleText", "WorkSchedule", "ShiftText", "Schedule"], ""),
      scheduleCode: firstValue(record, ["ScheduleCode", "Schedule", "Rule", "Shift"], ""),
      scheduleDetail: firstValue(record, ["ScheduleDetail", "DescriptionWork", "WorkScheduleDetail"], ""),
      workStart: firstValue(record, ["WorkInit", "WorkStart", "StartTime"], ""),
      workEnd: firstValue(record, ["WorkEnd", "EndTime"], ""),
      mealStart: firstValue(record, ["MealInit", "MealStart", "BreakInit", "BreakStart", "LunchStart"], ""),
      mealEnd: firstValue(record, ["MealEnd", "BreakEnd", "LunchEnd", "PauseEnd"], ""),
      email: firstValue(record, ["Email", "EMail", "Mail"], email),
      zone: firstValue(record, ["Zone"]),
      status: firstValue(record, ["Status"]),
      statusDescription: firstValue(record, ["DescriptionStatus"]),
      registerType: firstValue(record, ["RegisterType"]),
      authorisedRegister: firstValue(record, ["AuthorisedRegister"]),
      raw: record
    };
  }

  function sameText(left, right) {
    return String(left || "").trim().toUpperCase() === String(right || "").trim().toUpperCase();
  }

  function scheduleScore(record, employee) {
    var code = firstValue(record, ["Rule", "Schedule", "ScheduleCode"]);
    var description = firstValue(record, ["ScheduleDescription", "DescriptionWork", "Schedule"]);
    var score = 0;

    if (employee.scheduleCode && sameText(code, employee.scheduleCode)) { score += 20; }
    if (employee.schedule && sameText(description, employee.schedule)) { score += 12; }
    if (employee.schedule && sameText(code, employee.schedule)) { score += 8; }
    if (employee.scheduleCode && sameText(description, employee.scheduleCode)) { score += 5; }
    return score;
  }

  function mapSchedule(record, employee) {
    return {
      code: firstValue(record, ["Rule", "Schedule", "ScheduleCode"], employee.scheduleCode),
      name: firstValue(record, ["ScheduleDescription", "Schedule", "DescriptionWork"], employee.schedule),
      detail: firstValue(record, ["ScheduleDetail", "DescriptionWork"], employee.scheduleDetail),
      workStart: firstValue(record, ["WorkInit", "WorkStart", "StartTime"], employee.workStart),
      workEnd: firstValue(record, ["WorkEnd", "EndTime"], employee.workEnd),
      mealStart: firstValue(record, ["MealInit", "MealStart", "BreakInit", "BreakStart", "LunchStart"], employee.mealStart),
      mealEnd: firstValue(record, ["MealEnd", "BreakEnd", "LunchEnd", "PauseEnd"], employee.mealEnd),
      raw: record
    };
  }

  function odataResults(payload) {
    if (payload && payload.d && Array.isArray(payload.d.results)) {
      return payload.d.results;
    }
    if (payload && payload.d && typeof payload.d === "object") {
      return [payload.d];
    }
    if (payload && Array.isArray(payload.value)) {
      return payload.value;
    }
    return [];
  }

  return {
    readEmployee: function (serviceRoot, identity) {
      var root = String(serviceRoot || "");
      var lookupField = identity.personalNumber ? "PersonalNumber" : "Email";
      var lookupValue = identity.personalNumber || identity.email;
      var safeLookupValue = String(lookupValue || "").replace(/'/g, "''");
      var filter = lookupField + " eq '" + safeLookupValue + "'";
      var url = root.replace(/\/?$/, "/") + "EmployeeSet?$filter=" + encodeURIComponent(filter) + "&$format=json";

      if (!safeLookupValue) {
        return Promise.reject(new Error("No existe número de nómina ni correo para consultar EmployeeSet"));
      }

      var requestId = Diagnostics.request("GET", url, {
        entitySet: "EmployeeSet",
        filter: filter,
        lookupField: lookupField,
        lookupValue: lookupValue
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
            throw new Error("EmployeeSet respondió con HTTP " + response.status + ". Ruta: " + url.split("?")[0]);
          }
          try {
            return body ? JSON.parse(body) : {};
          } catch (parseError) {
            Diagnostics.error("PARSE", "EmployeeSet no devolvió JSON válido", parseError, requestId);
            throw new Error("EmployeeSet devolvió una respuesta que no es JSON");
          }
        });
      }).then(function (payload) {
        var results = odataResults(payload);
        if (!results.length) {
          throw new Error("No se encontró el empleado " + lookupValue);
        }
        var employee = mapEmployee(results[0], identity.personalNumber, identity.email);
        Diagnostics.mapping("EmployeeSet", payload, employee, requestId);
        return employee;
      }).catch(function (error) {
        Diagnostics.error("EMPLOYEE", "Falló la consulta o el mapeo de EmployeeSet", error, requestId);
        throw error;
      });
    },

    readSchedule: function (serviceRoot, employee) {
      var root = String(serviceRoot || "").replace(/\/?$/, "/");
      var url = root + "CatalogScheduleSet?$format=json";
      var requestId = Diagnostics.request("GET", url, {
        entitySet: "CatalogScheduleSet",
        purpose: "Resolver el horario real del empleado",
        employeeScheduleCode: employee && employee.scheduleCode,
        employeeSchedule: employee && employee.schedule
      });

      if (!employee) {
        return Promise.resolve(null);
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
            throw new Error("CatalogScheduleSet respondió con HTTP " + response.status);
          }
          try {
            return body ? JSON.parse(body) : {};
          } catch (parseError) {
            throw new Error("CatalogScheduleSet devolvió una respuesta que no es JSON");
          }
        });
      }).then(function (payload) {
        var results = odataResults(payload);
        var ranked = results.map(function (record) {
          return { record: record, score: scheduleScore(record, employee) };
        }).sort(function (left, right) {
          return right.score - left.score;
        });
        var selected = ranked.length && ranked[0].score > 0 ? ranked[0].record : null;
        var schedule = mapSchedule(selected || {}, employee);

        Diagnostics.mapping("CatalogScheduleSet", payload, {
          selectedScore: ranked.length ? ranked[0].score : 0,
          schedule: schedule
        }, requestId);
        return schedule;
      }).catch(function (error) {
        Diagnostics.error("SCHEDULE", "No fue posible resolver CatalogScheduleSet", error, requestId);
        return mapSchedule({}, employee);
      });
    }
  };
});
