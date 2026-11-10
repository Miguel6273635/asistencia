sap.ui.define([
  "./Diagnostics"
], function (Diagnostics) {
  "use strict";

  var CURRENT_USER_TIMEOUT_MS = 10000;
  var DEVELOPMENT_IDENTITY_STORAGE_KEY = "mitsu.checkin.developmentIdentity";

  var activeIdentity = {
    personalNumber: "",
    email: "",
    userName: "",
    displayName: "",
    device: "BTP-Web",
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
      device: "BTP-Web",
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

  function storedDevelopmentIdentity() {
    if (!isDevelopmentHost()) { return null; }
    try {
      var stored = JSON.parse(window.sessionStorage.getItem(DEVELOPMENT_IDENTITY_STORAGE_KEY) || "null");
      return stored ? normalizeIdentity(stored, "local-session-storage") : null;
    } catch (error) {
      Diagnostics.warn("IDENTITY", "No fue posible recuperar la identidad local guardada", {
        message: error.message
      });
      return null;
    }
  }

  function requestCurrentUser() {
    // Debe ser relativa al prefijo de la aplicación HTML5. Una diagonal inicial
    // enviaría la petición a la raíz del Launchpad y omitiría el xs-app.json de Checkin.
    var url = "user-api/currentUser";
    var requestId = Diagnostics.request("GET", url, {
      purpose: "Obtener identidad autenticada de SAP Build Work Zone"
    });
    var abortController = typeof AbortController === "function" ? new AbortController() : null;
    var timeoutId = window.setTimeout(function () {
      if (abortController) {
        abortController.abort();
      }
    }, CURRENT_USER_TIMEOUT_MS);

    return fetch(url, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: abortController ? abortController.signal : undefined
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
      if (error && error.name === "AbortError") {
        error = new Error("La consulta del usuario de Work Zone agotó el tiempo de espera. En BAS agrega ?testIdentity=correo@empresa.com o ?testIdentity=numeroNomina a la URL.");
      }
      Diagnostics.error("IDENTITY", "Falló la lectura del usuario autenticado", error, requestId);
      throw error;
    }).finally(function () {
      window.clearTimeout(timeoutId);
    });
  }

  function setIdentity(identity) {
    activeIdentity = Object.assign({
      personalNumber: "",
      email: "",
      userName: "",
      displayName: "",
      device: "BTP-Web",
      source: ""
    }, identity || {});
    Diagnostics.info("IDENTITY", "Identidad activa establecida", {
      email: activeIdentity.email,
      personalNumber: activeIdentity.personalNumber,
      userName: activeIdentity.userName,
      source: activeIdentity.source
    });
    if (isDevelopmentHost()) {
      try {
        window.sessionStorage.setItem(DEVELOPMENT_IDENTITY_STORAGE_KEY, JSON.stringify(activeIdentity));
      } catch (storageError) {
        Diagnostics.warn("IDENTITY", "No fue posible conservar la identidad local", {
          message: storageError.message
        });
      }
    }
    return Object.assign({}, activeIdentity);
  }

  return {
    loadAuthenticatedIdentity: function () {
      var localIdentity = developmentIdentity();
      var workZoneIdentity = shellIdentity();
      var savedDevelopmentIdentity = storedDevelopmentIdentity();

      if (localIdentity) {
        return Promise.resolve(setIdentity(localIdentity));
      }
      if (workZoneIdentity) {
        return Promise.resolve(setIdentity(workZoneIdentity));
      }
      if (savedDevelopmentIdentity) {
        return Promise.resolve(setIdentity(savedDevelopmentIdentity));
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
        device: "BTP-Web",
        source: ""
      };
      if (isDevelopmentHost()) {
        try {
          window.sessionStorage.removeItem(DEVELOPMENT_IDENTITY_STORAGE_KEY);
        } catch (ignoreStorageError) {
          // La limpieza de la sesión local es opcional.
        }
      }
    },

    hasActiveIdentity: function () {
      return Boolean(activeIdentity.personalNumber || activeIdentity.email);
    }
  };
});
