sap.ui.define([], function () {
    "use strict";

    function parseDate(vValue) {
        if (vValue instanceof Date && !isNaN(vValue.getTime())) {
            return new Date(vValue.getFullYear(), vValue.getMonth(), vValue.getDate());
        }
        var sValue = String(vValue || "").trim();
        var aParts;
        if (/^\d{4}-\d{2}-\d{2}$/.test(sValue)) {
            aParts = sValue.split("-").map(Number);
            return new Date(aParts[0], aParts[1] - 1, aParts[2]);
        }
        if (/^\d{8}$/.test(sValue)) {
            return new Date(Number(sValue.slice(0, 4)), Number(sValue.slice(4, 6)) - 1, Number(sValue.slice(6, 8)));
        }
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(sValue)) {
            aParts = sValue.split("/").map(Number);
            return new Date(aParts[2], aParts[1] - 1, aParts[0]);
        }
        return null;
    }

    function toKey(oDate) {
        return [oDate.getFullYear(), String(oDate.getMonth() + 1).padStart(2, "0"), String(oDate.getDate()).padStart(2, "0")].join("-");
    }

    function startOfWeek(oDate) {
        var oStart = new Date(oDate.getFullYear(), oDate.getMonth(), oDate.getDate());
        var iDay = oStart.getDay() || 7;
        oStart.setDate(oStart.getDate() - iDay + 1);
        return oStart;
    }

    function endOfPeriod(oStart, sGranularity) {
        var oEnd = new Date(oStart.getTime());
        if (sGranularity === "week") {
            oEnd.setDate(oEnd.getDate() + 6);
        } else if (sGranularity === "month") {
            oEnd = new Date(oStart.getFullYear(), oStart.getMonth() + 1, 0);
        } else if (sGranularity === "year") {
            oEnd = new Date(oStart.getFullYear(), 11, 31);
        }
        return oEnd;
    }

    function getPeriod(sGranularity, vReferenceDate) {
        var oReference = parseDate(vReferenceDate) || new Date();
        var oStart;
        if (sGranularity === "month") {
            oStart = new Date(oReference.getFullYear(), oReference.getMonth(), 1);
        } else if (sGranularity === "year") {
            oStart = new Date(oReference.getFullYear(), 0, 1);
        } else {
            oStart = startOfWeek(oReference);
            sGranularity = "week";
        }
        var oEnd = endOfPeriod(oStart, sGranularity);
        return {
            granularity: sGranularity,
            start: oStart,
            end: oEnd,
            label: "Hace " + String(oStart.getDate()).padStart(2, "0") + "/" + String(oStart.getMonth() + 1).padStart(2, "0") +
                " - " + String(oEnd.getDate()).padStart(2, "0") + "/" + String(oEnd.getMonth() + 1).padStart(2, "0") + "/" + oEnd.getFullYear()
        };
    }

    function filterRecords(aRecords, oPeriod) {
        return (aRecords || []).filter(function (oRecord) {
            var oDate = parseDate(oRecord.workDate || oRecord.dateISO || oRecord.date);
            return oDate && oDate >= oPeriod.start && oDate <= oPeriod.end;
        });
    }

    function getTrendBuckets(oPeriod) {
        var aBuckets = [];
        var oCursor = new Date(oPeriod.start.getTime());
        var aMonths = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
        while (oCursor <= oPeriod.end) {
            aBuckets.push({ key: toKey(oCursor), label: oCursor.getDate() + " " + aMonths[oCursor.getMonth()] });
            if (oPeriod.granularity === "year") {
                oCursor = new Date(oCursor.getFullYear(), oCursor.getMonth() + 1, 1);
            } else {
                oCursor.setDate(oCursor.getDate() + 1);
            }
        }
        return aBuckets;
    }

    function getBucketKey(vDate, sGranularity) {
        var oDate = parseDate(vDate);
        if (!oDate) { return ""; }
        return sGranularity === "year" ? toKey(new Date(oDate.getFullYear(), oDate.getMonth(), 1)) : toKey(oDate);
    }

    return {
        parseDate: parseDate,
        toKey: toKey,
        getPeriod: getPeriod,
        filterRecords: filterRecords,
        getTrendBuckets: getTrendBuckets,
        getBucketKey: getBucketKey
    };
});
