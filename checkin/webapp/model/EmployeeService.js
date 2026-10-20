sap.ui.define([], function () {
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

      return fetch(url, {
        method: "GET",
        credentials: "same-origin",
        headers: { "Accept": "application/json" }
      }).then(function (response) {
        if (!response.ok) {
          throw new Error("EmployeeSet respondió con HTTP " + response.status);
        }
        return response.json();
      }).then(function (payload) {
        var results = odataResults(payload);
        if (!results.length) {
          throw new Error("No se encontró el empleado " + lookupValue);
        }
        return mapEmployee(results[0], identity.personalNumber);
      });
    }
  };
});
