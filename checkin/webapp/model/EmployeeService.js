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

  function mapEmployee(record, personalNumber) {
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
      schedule: firstValue(record, ["Shift", "Hourly", "ScheduleText", "WorkSchedule", "ShiftText", "Schedule"], ""),
      email: firstValue(record, ["Email", "EMail", "Mail"]),
      zone: firstValue(record, ["Zone"]),
      status: firstValue(record, ["Status"]),
      statusDescription: firstValue(record, ["DescriptionStatus"]),
      registerType: firstValue(record, ["RegisterType"]),
      authorisedRegister: firstValue(record, ["AuthorisedRegister"]),
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
         var employee = mapEmployee(results[0], identity.personalNumber);
        Diagnostics.mapping("EmployeeSet", payload, employee, requestId);
        return employee;
      }).catch(function (error) {
        Diagnostics.error("EMPLOYEE", "Falló la consulta o el mapeo de EmployeeSet", error, requestId);
        throw error;
      });
    }
  };
});
