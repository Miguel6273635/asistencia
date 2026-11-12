sap.ui.define([], function () {
    "use strict";

    function text(vValue) {
        return vValue === null || vValue === undefined ? "" : String(vValue).trim();
    }

    function registerCode(oRow) {
        return text(oRow && (oRow.TypeRegister || oRow.RegisterType)).toUpperCase();
    }

    function description(oRow) {
        return [
            oRow && oRow.TypeRegisterDescrip,
            oRow && oRow.RegisterTypeDescription,
            oRow && oRow.IncidentType,
            oRow && oRow.ReasonType,
            oRow && oRow.DescriptionStatus,
            oRow && oRow.JustificationStatus
        ].map(text).filter(Boolean).join(" ").toUpperCase();
    }

    function isLate(oRow) {
        var sDescription = description(oRow);
        return /RETARD|LATE|ENTRADA/.test(sDescription) || (registerCode(oRow) === "P10" && !/SALIDA/.test(sDescription));
    }

    function isEarlyExit(oRow) {
        var sDescription = description(oRow);
        return /SALIDA\s*ANTICIP|EARLY/.test(sDescription) || (registerCode(oRow) === "P20" && !/ENTRADA/.test(sDescription));
    }

    function matches(oRow, sType) {
        return sType === "early" ? isEarlyExit(oRow) : isLate(oRow);
    }

    return {
        text: text,
        registerCode: registerCode,
        description: description,
        isLate: isLate,
        isEarlyExit: isEarlyExit,
        matches: matches
    };
});
