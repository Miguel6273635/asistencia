sap.ui.define([
  "./Diagnostics"
], function (Diagnostics) {
  "use strict";

  var activeIdentity = {
    personalNumber: "",
    email: "",
    userName: "",
    displayName: "",
    device: "",
    source: ""
  };

  function text(value) {
    return String(value || "").trim();
  }

  function firstValue(source, properties) {
    var value = "";
    properties.some(function (property) {
      value = text(source && source[property]);
      return Boolean(value);
    });
    return value;
  }

  function normalizeIdentity(source, origin) {
    var payload = source || {};
    var email = firstValue(payload, ["email", "Email", "mail", "Mail"]);
    var userName = firstValue(payload, ["userName", "username", "user_name", "name", "id"]);
    var personalNumber = firstValue(payload, ["personalNumber", "PersonalNumber", "personnelNumber"]);
    var displayName = firstValue(payload, ["displayName", "fullName", "FullName"]);
    var firstName = firstValue(payload, ["firstName", "firstname", "given_name"]);
    var lastName = firstValue(payload, ["lastName", "lastname", "family_name"]);

    if (!displayName) {
      displayName = (firstName + " " + lastName).trim();
    }
    if (!email && userName.indexOf("@") >= 0) {
      email = userName;
    }

    if (!email && !personalNumber) {
      throw new Error("La sesión de SAP no proporcionó el correo ni el número de nómina del usuario. Solicita que el atributo email esté disponible en IAS/XSUAA.");
    }

    return {
      personalNumber: personalNumber,
      email: email.toLowerCase(),
      userName: userName,
      displayName: displayName,
      device: "",
      source: origin
    };
  }

  function shellIdentity() {
    try {
      var container = window.sap && window.sap.ushell && window.sap.ushell.Container;
      var user = container && typeof container.getUser === "function" && container.getUser();
      if (!user) { return null; }

      return normalizeIdentity({
        email: typeof user.getEmail === "function" ? user.getEmail() : "",
        userName: typeof user.getId === "function" ? user.getId() : "",
        displayName: typeof user.getFullName === "function" ? user.getFullName() : "",
        firstName: typeof user.getFirstName === "function" ? user.getFirstName() : "",
        lastName: typeof user.getLastName === "function" ? user.getLastName() : ""
      }, "sap-ushell");
    } catch (error) {
      Diagnostics.warn("IDENTITY", "El shell no proporcionó una identidad utilizable; se consultará user-api", {
        message: error.message
      });
      return null;
    }
  }

  function isDevelopmentHost() {
    var host = String(window.location.hostname || "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host.indexOf("applicationstudio.cloud.sap") >= 0;
  }

  function developmentIdentity() {
    var value = isDevelopmentHost() ? text(new URLSearchParams(window.location.search || "").get("testIdentity")) : "";
    if (!value) { return null; }

    return normalizeIdentity(value.indexOf("@") >= 0 ? { email: value } : { personalNumber: value.padStart(8, "0") }, "local-test-parameter");
  }

  function requestCurrentUser() {
    var url = "/user-api/currentUser";
    var requestId = Diagnostics.request("GET", url, {
      purpose: "Obtener identidad autenticada de SAP Build Work Zone"
    });

    return fetch(url, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" }
    }).then(function (response) {
      return response.text().then(function (body) {
        Diagnostics.response(requestId, response.status, response.statusText, body, {
          contentType: response.headers.get("content-type"),
          finalUrl: response.url
        });
        if (!response.ok) {
          if (response.status === 404 && isDevelopmentHost()) {
            throw new Error("La vista local de SAP Business Application Studio no contiene la sesión de Work Zone. Para probar localmente agrega ?testIdentity=tu-correo@empresa.com a la URL. En la aplicación desplegada el correo se obtiene automáticamente del login de Work Zone.");
          }
          throw new Error("No fue posible obtener el usuario autenticado de SAP (HTTP " + response.status + ").");
        }

        var payload;
        try {
          payload = body ? JSON.parse(body) : {};
        } catch (error) {
          throw new Error("SAP devolvió una identidad con formato inválido.");
        }
        return normalizeIdentity(payload, "sap-approuter-userapi");
      });
    }).catch(function (error) {
      Diagnostics.error("IDENTITY", "Falló la lectura del usuario autenticado", error, requestId);
      throw error;
    });
  }

  function setIdentity(identity) {
    activeIdentity = Object.assign({
      personalNumber: "",
      email: "",
      userName: "",
      displayName: "",
      device: "",
      source: ""
    }, identity || {});
    Diagnostics.info("IDENTITY", "Identidad activa establecida", {
      email: activeIdentity.email,
      personalNumber: activeIdentity.personalNumber,
      userName: activeIdentity.userName,
      source: activeIdentity.source
    });
    return Object.assign({}, activeIdentity);
  }

  return {
    loadAuthenticatedIdentity: function () {
      var localIdentity = developmentIdentity();
      var workZoneIdentity = shellIdentity();

      if (localIdentity) {
        return Promise.resolve(setIdentity(localIdentity));
      }
      if (workZoneIdentity) {
        return Promise.resolve(setIdentity(workZoneIdentity));
      }
      return requestCurrentUser().then(setIdentity);
    },

    getActiveIdentity: function () {
      return Object.assign({}, activeIdentity);
    },

    setAuthenticatedIdentity: setIdentity,

    clearIdentity: function () {
      activeIdentity = {
        personalNumber: "",
        email: "",
        userName: "",
        displayName: "",
        device: "",
        source: ""
      };
    },

    hasActiveIdentity: function () {
      return Boolean(activeIdentity.personalNumber || activeIdentity.email);
    }
  };
});
