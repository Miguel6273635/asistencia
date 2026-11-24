sap.ui.define([], function () {
    "use strict";

    function dayStatusText(sStatus) {
        var sNormalized = String(sStatus || "").trim().toUpperCase();

        if (
            ["OFICINA CENTRAL", "HOME OFFIC", "HOME OFFICE"]
                .indexOf(sNormalized) >= 0
        ) {
            return "HOME OFFICE";
        }
 if (/^VIAJE/.test(sNormalized)) {
            return "Viaje de trabajo";
        }
        return sStatus || "Sin estatus del día";
    }

    return {
        dayStatusText: dayStatusText,

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
                "HOME OFFICE": "Information",
                Inactivo: "None",
                Incompleto: "Information"
            };

            return mStates[dayStatusText(sStatus)] || "None";
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