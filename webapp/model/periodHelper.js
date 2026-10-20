sap.ui.define([], function () {
    "use strict";

    var MONTHS = [
        "ene", "feb", "mar", "abr", "may", "jun",
        "jul", "ago", "sep", "oct", "nov", "dic"
    ];

    function normalizeDate(oDate) {
        if (!(oDate instanceof Date) || isNaN(oDate.getTime())) {
            return null;
        }

        return new Date(
            oDate.getFullYear(),
            oDate.getMonth(),
            oDate.getDate()
        );
    }

    function parseDate(vDate) {
        if (!vDate) {
            return null;
        }

        if (vDate instanceof Date) {
            return normalizeDate(vDate);
        }

        var sValue = String(vDate).trim();
        var aMatch;

        // yyyy-MM-dd
        aMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sValue);

        if (aMatch) {
            return normalizeDate(new Date(
                Number(aMatch[1]),
                Number(aMatch[2]) - 1,
                Number(aMatch[3])
            ));
        }

        // dd/MM/yyyy
        aMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(sValue);

        if (aMatch) {
            return normalizeDate(new Date(
                Number(aMatch[3]),
                Number(aMatch[2]) - 1,
                Number(aMatch[1])
            ));
        }

        var oFallback = new Date(sValue);

        return normalizeDate(oFallback);
    }

    function toKey(vDate) {
        var oDate = parseDate(vDate);

        if (!oDate) {
            return "";
        }

        var sYear = String(oDate.getFullYear());
        var sMonth = String(oDate.getMonth() + 1).padStart(2, "0");
        var sDay = String(oDate.getDate()).padStart(2, "0");

        return sYear + "-" + sMonth + "-" + sDay;
    }

    function cloneDate(oDate) {
        return new Date(
            oDate.getFullYear(),
            oDate.getMonth(),
            oDate.getDate()
        );
    }

    function startOfWeek(oDate) {
        var oResult = cloneDate(oDate);
        var iDay = oResult.getDay();

        // Semana lunes-domingo
        var iDifference = iDay === 0 ? -6 : 1 - iDay;

        oResult.setDate(oResult.getDate() + iDifference);

        return oResult;
    }

    function endOfWeek(oDate) {
        var oResult = startOfWeek(oDate);
        oResult.setDate(oResult.getDate() + 6);

        return oResult;
    }

    function formatDayMonth(oDate) {
        return String(oDate.getDate()).padStart(2, "0") +
            " " +
            MONTHS[oDate.getMonth()];
    }

    function getPeriod(sGranularity, vReferenceDate) {
        var oReferenceDate = parseDate(vReferenceDate) || new Date();
        var oStart;
        var oEnd;
        var sLabel;

        switch (sGranularity) {
        case "month":
            oStart = new Date(
                oReferenceDate.getFullYear(),
                oReferenceDate.getMonth(),
                1
            );

            oEnd = new Date(
                oReferenceDate.getFullYear(),
                oReferenceDate.getMonth() + 1,
                0
            );

            sLabel =
                MONTHS[oReferenceDate.getMonth()] +
                " " +
                oReferenceDate.getFullYear();

            break;

        case "year":
            oStart = new Date(
                oReferenceDate.getFullYear(),
                0,
                1
            );

            oEnd = new Date(
                oReferenceDate.getFullYear(),
                11,
                31
            );

            sLabel = String(oReferenceDate.getFullYear());

            break;

        case "week":
        default:
            sGranularity = "week";

            oStart = startOfWeek(oReferenceDate);
            oEnd = endOfWeek(oReferenceDate);

            sLabel =
                formatDayMonth(oStart) +
                " - " +
                formatDayMonth(oEnd) +
                " " +
                oEnd.getFullYear();

            break;
        }

        return {
            granularity: sGranularity,
            referenceDate: oReferenceDate,
            startDate: oStart,
            endDate: oEnd,
            startKey: toKey(oStart),
            endKey: toKey(oEnd),
            label: sLabel
        };
    }

    function filterRecords(aRecords, oPeriod) {
        if (!Array.isArray(aRecords) || !oPeriod) {
            return [];
        }

        var oStart = parseDate(oPeriod.startDate);
        var oEnd = parseDate(oPeriod.endDate);

        if (!oStart || !oEnd) {
            return [];
        }

        return aRecords.filter(function (oRecord) {
            var oDate = parseDate(oRecord.date);

            return oDate &&
                oDate.getTime() >= oStart.getTime() &&
                oDate.getTime() <= oEnd.getTime();
        });
    }

    function getBucketKey(vDate, sGranularity) {
        var oDate = parseDate(vDate);

        if (!oDate) {
            return "";
        }

        if (sGranularity === "year") {
            return oDate.getFullYear() +
                "-" +
                String(oDate.getMonth() + 1).padStart(2, "0");
        }

        if (sGranularity === "month") {
            return toKey(startOfWeek(oDate));
        }

        return toKey(oDate);
    }

    function getTrendBuckets(oPeriod) {
        if (!oPeriod) {
            return [];
        }

        var aBuckets = [];
        var oStart = parseDate(oPeriod.startDate);
        var oEnd = parseDate(oPeriod.endDate);
        var oCursor;

        if (!oStart || !oEnd) {
            return [];
        }

        if (oPeriod.granularity === "year") {
            for (var iMonth = 0; iMonth < 12; iMonth += 1) {
                aBuckets.push({
                    key: oStart.getFullYear() +
                        "-" +
                        String(iMonth + 1).padStart(2, "0"),
                    label: MONTHS[iMonth]
                });
            }

            return aBuckets;
        }

        if (oPeriod.granularity === "month") {
            oCursor = startOfWeek(oStart);

            while (oCursor.getTime() <= oEnd.getTime()) {
                var oWeekEnd = new Date(oCursor);
                oWeekEnd.setDate(oWeekEnd.getDate() + 6);

                aBuckets.push({
                    key: toKey(oCursor),
                    label:
                        formatDayMonth(oCursor) +
                        " - " +
                        formatDayMonth(oWeekEnd)
                });

                oCursor.setDate(oCursor.getDate() + 7);
            }

            return aBuckets;
        }

        oCursor = cloneDate(oStart);

        while (oCursor.getTime() <= oEnd.getTime()) {
            aBuckets.push({
                key: toKey(oCursor),
                label: formatDayMonth(oCursor)
            });

            oCursor.setDate(oCursor.getDate() + 1);
        }

        return aBuckets;
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