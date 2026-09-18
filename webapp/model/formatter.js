sap.ui.define([], function () {
    "use strict";

    return {
        statusState: function (sStatus) {
            var mStates = {
                Presente: "Success",
                Activo: "Success",
                Retardo: "Warning",
                "Atención media": "Warning",
                Ausente: "Error",
                "Fuera de zona": "Error",
                "Viaje de trabajo": "Information",
                Vacaciones: "Success",
                Paternidad: "Information",
                "Home office": "Information",
                Inactivo: "None",
                Incompleto: "Information"
            };
            return mStates[sStatus] || "None";
        },

        activeText: function (bActive) {
            return bActive ? "Activo" : "Inactivo";
        },

        activeState: function (bActive) {
            return bActive ? "Success" : "None";
        },

        percentState: function (fValue) {
            if (fValue >= 90) {
                return "Success";
            }
            if (fValue >= 80) {
                return "Warning";
            }
            return "Error";
        }
    };
});
