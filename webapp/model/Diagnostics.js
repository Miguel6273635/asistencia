sap.ui.define([], function () {
    "use strict";

    function copy(value) {
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (error) {
            return value;
        }
    }

    function group(category, screen, stage, detail) {
        var sLabel = "[Monitor][" + category + "][" + screen + "][" + stage + "]";
        if (console.groupCollapsed) {
            console.groupCollapsed(sLabel);
            console.info(copy(detail));
            console.groupEnd();
        } else {
            console.info(sLabel, copy(detail));
        }
    }

    return {
        filters: function (screen, stage, detail) {
            group("FILTERS", screen, stage, detail);
        },

        upload: function (stage, detail) {
            group("EMPLOYEE-UPLOAD", "Usuarios", stage, detail);
        },

        request: function (stage, detail) {
            group("ODATA", "API", stage, detail);
        },

        error: function (category, error, detail) {
            console.error("[Monitor][" + category + "][ERROR]", error, copy(detail));
        }
    };
});
