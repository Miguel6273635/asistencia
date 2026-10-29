sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "com/mitsu/monitorasistencia/model/periodHelper",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast"
], function (BaseController, periodHelper, JSONModel, MessageToast) {
    "use strict";

    var PRESENT_STATUSES = ["Presente", "Home office", "Viaje de trabajo"];
    var INCIDENT_STATUSES = ["Retardo", "Ausente", "Fuera de zona", "Incompleto"];
    var MONTH_NAMES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    var OPERATIONAL_ZONES = [
        { id: "centro", name: "Zona Centro" },
        { id: "norte", name: "Zona Norte" },
        { id: "sur", name: "Zona Sur" },
        { id: "este", name: "Zona Este" },
        { id: "oeste", name: "Zona Oeste" }
    ];

    function buildMonthOptions() {
        return MONTH_NAMES.map(function (sMonth, iIndex) {
            return { key: String(iIndex + 1).padStart(2, "0"), text: sMonth };
        });
    }

    function buildYearOptions() {
        var iCurrentYear = new Date().getFullYear();
        var aYears = [];
        var iYear;
        for (iYear = iCurrentYear - 10; iYear <= iCurrentYear + 10; iYear += 1) {
            aYears.push({ key: String(iYear), text: String(iYear) });
        }
        return aYears;
    }

    function recordDate(oRecord) {
        return oRecord.workDate || oRecord.dateISO || oRecord.date;
    }

    function clockMinutes(sValue) {
        var aMatch = String(sValue || "").match(/(\d{1,2}):(\d{2})/);
        return aMatch ? Number(aMatch[1]) * 60 + Number(aMatch[2]) : null;
    }

    function isEarlyExit(oRecord) {
        if (oRecord.isEarlyExit === true || String(oRecord.isEarlyExit || "").toUpperCase() === "X") {
            return true;
        }
        var iExit = clockMinutes(oRecord.exit);
        var aRanges = String(oRecord.scheduled || "").match(/\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}/g) || [];
        if (iExit === null || !aRanges.length) { return false; }
        var aEndMatch = aRanges[aRanges.length - 1].match(/[-–]\s*(\d{1,2}:\d{2})/);
        var iScheduledEnd = aEndMatch ? clockMinutes(aEndMatch[1]) : null;
        return iScheduledEnd !== null && iExit < iScheduledEnd;
    }

    return BaseController.extend("com.mitsu.monitorasistencia.controller.Overview", {
        onInit: function () {
            this.setModel(new JSONModel({
                granularity: "week",
                referenceDate: "2026-10-25",
                weekReferenceDate: "2026-10-25",
                referenceMonth: "10",
                referenceYear: "2026",
                monthOptions: buildMonthOptions(),
                yearOptions: buildYearOptions(),
                periodLabel: "",
                scheduleId: "",
                status: "all",
                zoneSummaries: [],
                zoneInefficiency: [],
                incidentTrend: [],
                criticalCenters: [],
                lateReviewCount: 0,
                earlyExitReviewCount: 0,
                overviewSummary: {
                    attendance: "0.0",
                    attendanceDescription: "0 presentes de 0 registros evaluados",
                    incidents: 0,
                    incidentsDescription: "0 retardos · 0 ausencias · 0 fuera de zona",
                    criticalZone: "Sin datos",
                    criticalZoneDescription: "0.0% de ineficiencia operativa",
                    targetGap: "0.0 pp",
                    targetGapDescription: "Sin registros en el periodo"
                },
                priorityText: "No hay incidencias para el periodo seleccionado."
            }), "view");
            this.getRouter().getRoute("overview").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            this.getModel("attendance").dataLoaded().then(function () {
                this._syncReferenceSelectors();
                this._refreshDashboard();
            }.bind(this));
        },

        _syncReferenceSelectors: function () {
            var oViewModel = this.getModel("view");
            var oReference = periodHelper.parseDate(oViewModel.getProperty("/referenceDate"));
            if (!oReference) { return; }
            oViewModel.setProperty("/referenceMonth", String(oReference.getMonth() + 1).padStart(2, "0"));
            oViewModel.setProperty("/referenceYear", String(oReference.getFullYear()));
        },

        _setReferenceFromSelectors: function () {
            var oViewModel = this.getModel("view");
            var sYear = String(oViewModel.getProperty("/referenceYear") || new Date().getFullYear());
            var sMonth = String(oViewModel.getProperty("/referenceMonth") || "01").padStart(2, "0");
            var sGranularity = oViewModel.getProperty("/granularity");
            oViewModel.setProperty("/referenceDate", sGranularity === "year" ? sYear + "-01-01" : sYear + "-" + sMonth + "-01");
        },

        _getPeriod: function () {
            var oViewModel = this.getModel("view");
            var sReferenceDate = oViewModel.getProperty("/referenceDate");
            if (!periodHelper.parseDate(sReferenceDate)) {
                sReferenceDate = this._getLatestRecordDate();
                oViewModel.setProperty("/referenceDate", sReferenceDate);
            }
            var oPeriod = periodHelper.getPeriod(
                oViewModel.getProperty("/granularity"),
                sReferenceDate
            );
            oViewModel.setProperty("/periodLabel", oPeriod.label);
            return oPeriod;
        },

        _getLatestRecordDate: function () {
            var oAttendanceModel = this.getModel("attendance");
            var aRecords = (oAttendanceModel.getProperty("/records") || []).concat(
                oAttendanceModel.getProperty("/userPerformanceHistory") || []
            );
            var aDates = aRecords.map(function (oRecord) {
                return periodHelper.parseDate(recordDate(oRecord));
            }).filter(Boolean).sort(function (a, b) {
                return b.getTime() - a.getTime();
            });
            return periodHelper.toKey(aDates[0] || new Date(2026, 7, 31));
        },

        _getEnrichedRecords: function (oPeriod) {
            var oAttendanceModel = this.getModel("attendance");
            var aEmployees = oAttendanceModel.getProperty("/employees") || [];
            var aCenters = oAttendanceModel.getProperty("/centers") || [];
            var mEmployees = {};
            var mCentersById = {};
            var mCentersByName = {};
            var sScheduleId = this.getModel("view").getProperty("/scheduleId") || "";
            var sStatus = this.getModel("view").getProperty("/status") || "all";

            aEmployees.forEach(function (oEmployee) { mEmployees[oEmployee.id] = oEmployee; });
            aCenters.forEach(function (oCenter) {
                mCentersById[oCenter.id] = oCenter;
                mCentersByName[String(oCenter.name || "").toLowerCase()] = oCenter;
            });

            var aFacts = (oAttendanceModel.getProperty("/records") || []).concat(
                oAttendanceModel.getProperty("/userPerformanceHistory") || []
            );

            return periodHelper.filterRecords(aFacts, oPeriod)
                .map(function (oRecord) {
                    var oEmployee = mEmployees[oRecord.employeeId] || {};
                    var oCenter = mCentersById[oEmployee.centerId] || mCentersByName[String(oRecord.center || "").toLowerCase()] || {};
                    return Object.assign({}, oRecord, {
                        employeeId: oRecord.employeeId || oEmployee.id,
                        scheduleId: oEmployee.scheduleId || "",
                        centerId: oEmployee.centerId || oCenter.id || "",
                        centerName: oCenter.name || oRecord.center || "Sin centro",
                        zoneId: oEmployee.zoneId || oCenter.zoneId || "sin-zona",
                        zoneName: oCenter.zone || "Sin zona"
                    });
                })
                .filter(function (oRecord) {
                    var bSchedule = !sScheduleId || oRecord.scheduleId === sScheduleId;
                    var bStatus = sStatus === "all" ||
                        (sStatus === "present" && PRESENT_STATUSES.indexOf(oRecord.status) >= 0) ||
                        (sStatus === "late" && oRecord.status === "Retardo") ||
                        (sStatus === "absent" && oRecord.status === "Ausente") ||
                        (sStatus === "outside" && oRecord.status === "Fuera de zona");
                    return bSchedule && bStatus;
                });
        },

        _refreshDashboard: function () {
            var oSapOverview = this.getModel("attendance").getProperty("/sapOverview");
            var oPeriod = this._getPeriod();
            var aRecords = this._getEnrichedRecords(oPeriod);
            var bUsesDefaultFilters = !this.getModel("view").getProperty("/scheduleId") &&
                this.getModel("view").getProperty("/status") === "all" &&
                this.getModel("view").getProperty("/granularity") === "week" &&
                this._sapOverviewMatchesPeriod(oPeriod);
            if (oSapOverview && bUsesDefaultFilters) {
                var aCompletedSapZones = this._completeZoneSummaries(oSapOverview.zoneSummaries || []);
                this.getModel("view").setProperty("/zoneSummaries", aCompletedSapZones);
                this.getModel("view").setProperty("/zoneInefficiency", this._zoneInefficiencyFromSummaries(aCompletedSapZones));
                this.getModel("view").setProperty("/incidentTrend", this._buildTrend(aRecords, oPeriod));
                this.getModel("view").setProperty("/criticalCenters", oSapOverview.criticalCenters || []);
                this.getModel("view").setProperty("/overviewSummary", oSapOverview.overviewSummary || {});
                this.getModel("view").setProperty("/priorityText", oSapOverview.priorityText || "");
                this._updateReviewCounts(aRecords);
                this._configureCharts();
                return;
            }
            var aZones = this._getOperationalZones();
            var aCenters = this.getModel("attendance").getProperty("/centers") || [];
            var aZoneSummaries = aZones.map(function (oZone) {
                var aZoneRecords = aRecords.filter(function (oRecord) { return oRecord.zoneId === oZone.id; });
                var iPresent = this._countStatuses(aZoneRecords, PRESENT_STATUSES);
                var iLate = this._countStatuses(aZoneRecords, ["Retardo"]);
                var iAbsent = this._countStatuses(aZoneRecords, ["Ausente"]);
                var iOutside = this._countStatuses(aZoneRecords, ["Fuera de zona"]);
                var iTotal = aZoneRecords.length;
                var nAttendance = iTotal ? iPresent * 100 / iTotal : 0;
                var nInefficiency = iTotal ? (iLate + iAbsent + iOutside) * 100 / iTotal : 0;
                var oRisk = this._getRisk(nInefficiency, iTotal);
                var iUsers = new Set(aZoneRecords.map(function (oRecord) { return oRecord.employeeId; }).filter(Boolean)).size;
                var iCenters = new Set(aZoneRecords.map(function (oRecord) { return oRecord.centerId; }).filter(Boolean)).size;

                return {
                    zoneId: oZone.id,
                    zone: String(oZone.name || "").replace(/^Zona\s+/i, ""),
                    name: oZone.name,
                    centers: iCenters,
                    users: iUsers,
                    meta: iCenters + " centros con registros · " + iUsers + " usuarios",
                    total: iTotal,
                    present: iPresent,
                    late: iLate,
                    absent: iAbsent,
                    outside: iOutside,
                    attendance: nAttendance.toFixed(1),
                    inefficiency: nInefficiency.toFixed(1),
                    incidentSummary: iLate + " retardos · " + iAbsent + " ausencias · " + iOutside + " fuera de zona",
                    inefficiencyText: nInefficiency.toFixed(1) + "% ineficiencia",
                    riskText: oRisk.text,
                    state: oRisk.state
                };
            }.bind(this));

            this.getModel("view").setProperty("/zoneSummaries", aZoneSummaries);
            this.getModel("view").setProperty("/zoneInefficiency", aZoneSummaries.map(function (oZone) {
                return {
                    zoneId: oZone.zoneId,
                    zone: oZone.zone,
                    lateRate: oZone.total ? Number((oZone.late * 100 / oZone.total).toFixed(1)) : 0,
                    absentRate: oZone.total ? Number((oZone.absent * 100 / oZone.total).toFixed(1)) : 0
                };
            }));
            this.getModel("view").setProperty("/incidentTrend", this._buildTrend(aRecords, oPeriod));
            this.getModel("view").setProperty("/criticalCenters", this._buildCriticalCenters(aRecords, aCenters));
            this.getModel("view").setProperty("/overviewSummary", this._buildSummary(aRecords, aZoneSummaries));

            var aCritical = this.getModel("view").getProperty("/criticalCenters") || [];
            var oSummary = this.getModel("view").getProperty("/overviewSummary");
            this.getModel("view").setProperty("/priorityText", aCritical.length ?
                "Revisar " + oSummary.criticalZone + " y " + aCritical.slice(0, 2).map(function (oCenter) { return oCenter.center; }).join(" y ") + "; concentran la mayor ineficiencia del periodo." :
                "No hay incidencias para el periodo seleccionado.");
            this._updateReviewCounts(aRecords);
            this._configureCharts();
        },

        _sapOverviewMatchesPeriod: function (oPeriod) {
            var aRows = (this.getModel("attendance").getProperty("/sapZoneSummaries") || []).concat(
                this.getModel("attendance").getProperty("/sapIncidentTrend") || []
            );
            return aRows.some(function (oRow) {
                var oDate = periodHelper.parseDate(oRow.ReferenceDate || oRow.TrendDate || oRow.DateFrom);
                return oDate && oDate >= oPeriod.start && oDate <= oPeriod.end;
            });
        },

        _completeZoneSummaries: function (aSummaries) {
            var aZones = this._getOperationalZones();
            return aZones.map(function (oZone) {
                var sZoneName = String(oZone.name || "").replace(/^Zona\s+/i, "").trim().toLowerCase();
                var oExisting = aSummaries.find(function (oSummary) {
                    return oSummary.zoneId === oZone.id || String(oSummary.zone || "").trim().toLowerCase() === sZoneName;
                });
                if (oExisting) { return oExisting; }
                return {
                    zoneId: oZone.id,
                    zone: String(oZone.name || "").replace(/^Zona\s+/i, ""),
                    name: oZone.name,
                    centers: 0,
                    users: 0,
                    meta: "0 centros con registros · 0 jornadas",
                    total: 0,
                    present: 0,
                    late: 0,
                    absent: 0,
                    outside: 0,
                    attendance: "0.0",
                    inefficiency: "0.0",
                    incidentSummary: "0 retardos · 0 ausencias · 0 fuera de zona",
                    inefficiencyText: "0.0% de ineficiencia",
                    riskText: "Sin datos",
                    state: "None"
                };
            });
        },

        _getOperationalZones: function () {
            var aConfigured = (this.getModel("attendance").getProperty("/zones") || []).filter(function (oZone) {
                return oZone.id !== "all";
            });
            var mZones = {};
            OPERATIONAL_ZONES.concat(aConfigured).forEach(function (oZone) {
                var sName = String(oZone.name || "").replace(/^Zona\s+/i, "").trim().toLowerCase();
                var sId = String(oZone.id || sName).trim().toLowerCase();
                if (!sName) { return; }
                mZones[sName] = mZones[sName] || { id: sId, name: /^Zona\s+/i.test(oZone.name || "") ? oZone.name : "Zona " + oZone.name };
            });
            return OPERATIONAL_ZONES.map(function (oZone) {
                return mZones[String(oZone.name).replace(/^Zona\s+/i, "").toLowerCase()] || oZone;
            }).concat(Object.keys(mZones).filter(function (sName) {
                return !OPERATIONAL_ZONES.some(function (oZone) {
                    return String(oZone.name).replace(/^Zona\s+/i, "").toLowerCase() === sName;
                });
            }).map(function (sName) { return mZones[sName]; }));
        },

        _zoneInefficiencyFromSummaries: function (aSummaries) {
            return aSummaries.map(function (oZone) {
                var iTotal = Number(oZone.total || oZone.users || 0);
                return {
                    zoneId: oZone.zoneId,
                    zone: oZone.zone,
                    lateRate: oZone.lateRate !== undefined ? Number(oZone.lateRate) : (iTotal ? Number(oZone.late || 0) * 100 / iTotal : 0),
                    absentRate: oZone.absentRate !== undefined ? Number(oZone.absentRate) : (iTotal ? Number(oZone.absent || 0) * 100 / iTotal : 0)
                };
            });
        },

        _updateReviewCounts: function (aRecords) {
            this.getModel("view").setProperty("/lateReviewCount", aRecords.filter(function (oRecord) {
                return oRecord.status === "Retardo" || oRecord.isLate === true;
            }).length);
            this.getModel("view").setProperty("/earlyExitReviewCount", aRecords.filter(isEarlyExit).length);
        },

        _countStatuses: function (aRecords, aStatuses) {
            return aRecords.filter(function (oRecord) { return aStatuses.indexOf(oRecord.status) >= 0; }).length;
        },

        _getRisk: function (nInefficiency, iTotal) {
            if (!iTotal) { return { text: "Sin datos", state: "None" }; }
            if (nInefficiency >= 25) { return { text: "Riesgo alto", state: "Error" }; }
            if (nInefficiency >= 15) { return { text: "Atención", state: "Warning" }; }
            return { text: "Riesgo menor", state: "Success" };
        },

        _buildSummary: function (aRecords, aZoneSummaries) {
            var iPresent = this._countStatuses(aRecords, PRESENT_STATUSES);
            var iLate = this._countStatuses(aRecords, ["Retardo"]);
            var iAbsent = this._countStatuses(aRecords, ["Ausente"]);
            var iOutside = this._countStatuses(aRecords, ["Fuera de zona"]);
            var iIncidents = this._countStatuses(aRecords, INCIDENT_STATUSES);
            var iTotal = aRecords.length;
            var nAttendance = iTotal ? iPresent * 100 / iTotal : 0;
            var oCriticalZone = aZoneSummaries.filter(function (oZone) { return oZone.total > 0; }).sort(function (a, b) {
                return Number(b.inefficiency) - Number(a.inefficiency);
            })[0];
            var nGap = iTotal ? nAttendance - 90 : 0;

            return {
                attendance: nAttendance.toFixed(1),
                attendanceDescription: iPresent + " presentes de " + iTotal + " registros evaluados",
                incidents: iIncidents,
                incidentsDescription: iLate + " retardos · " + iAbsent + " ausencias · " + iOutside + " fuera de zona",
                criticalZone: oCriticalZone ? oCriticalZone.name : "Sin datos",
                criticalZoneDescription: (oCriticalZone ? oCriticalZone.inefficiency : "0.0") + "% de ineficiencia operativa",
                targetGap: (nGap > 0 ? "+" : "") + nGap.toFixed(1) + " pp",
                targetGapDescription: iTotal ? "Diferencia frente a la meta de 90%" : "Sin registros en el periodo"
            };
        },

        _buildCriticalCenters: function (aRecords, aCenters) {
            var mCenters = {};
            aCenters.forEach(function (oCenter) { mCenters[oCenter.id] = Object.assign({}, oCenter, { records: [] }); });
            aRecords.forEach(function (oRecord) {
                if (mCenters[oRecord.centerId]) { mCenters[oRecord.centerId].records.push(oRecord); }
            });

            return Object.keys(mCenters).map(function (sCenterId) {
                var oCenter = mCenters[sCenterId];
                var iTotal = oCenter.records.length;
                var iIncidents = this._countStatuses(oCenter.records, INCIDENT_STATUSES);
                var nInefficiency = iTotal ? iIncidents * 100 / iTotal : 0;
                var oRisk = this._getRisk(nInefficiency, iTotal);
                return {
                    id: oCenter.id,
                    center: oCenter.name,
                    zone: oCenter.zone,
                    incidents: iIncidents,
                    inefficiency: nInefficiency.toFixed(1) + "%",
                    attendance: (iTotal ? this._countStatuses(oCenter.records, PRESENT_STATUSES) * 100 / iTotal : 0).toFixed(1) + "%",
                    status: oRisk.text,
                    state: oRisk.state,
                    total: iTotal
                };
            }.bind(this)).filter(function (oCenter) {
                return oCenter.total > 0 && oCenter.incidents > 0;
            }).sort(function (a, b) {
                return parseFloat(b.inefficiency) - parseFloat(a.inefficiency);
            }).slice(0, 8);
        },

        _buildTrend: function (aRecords, oPeriod) {
            var aBuckets = periodHelper.getTrendBuckets(oPeriod).map(function (oBucket) {
                return Object.assign({}, oBucket, { late: 0, absent: 0, outsideZone: 0 });
            });
            var mBuckets = {};
            aBuckets.forEach(function (oBucket) { mBuckets[oBucket.key] = oBucket; });
            aRecords.forEach(function (oRecord) {
                var sKey = periodHelper.getBucketKey(recordDate(oRecord), oPeriod.granularity);
                if (!mBuckets[sKey]) { return; }
                if (oRecord.status === "Retardo") { mBuckets[sKey].late += 1; }
                if (oRecord.status === "Ausente") { mBuckets[sKey].absent += 1; }
                if (oRecord.status === "Fuera de zona") { mBuckets[sKey].outsideZone += 1; }
            });
            return aBuckets.map(function (oBucket) {
                return { day: oBucket.label, late: oBucket.late, absent: oBucket.absent, outsideZone: oBucket.outsideZone };
            });
        },

        _configureCharts: function () {
            var oInefficiencyChart = this.byId("inefficiencyChart");
            var oIncidentTrendChart = this.byId("incidentTrendChart");
            var aZoneInefficiency = this.getModel("view").getProperty("/zoneInefficiency") || [];
            var aIncidentTrend = this.getModel("view").getProperty("/incidentTrend") || [];
            var nMaximumInefficiency = aZoneInefficiency.reduce(function (nMaximum, oZone) {
                return Math.max(nMaximum, Number(oZone.absentRate || 0) + Number(oZone.lateRate || 0));
            }, 0);
            var nInefficiencyAxisMaximum = Math.max(20, Math.ceil((nMaximumInefficiency + 0.1) / 5) * 5);
            var nMaximumIncident = aIncidentTrend.reduce(function (nMaximum, oDay) {
                return Math.max(nMaximum, Number(oDay.late || 0), Number(oDay.absent || 0), Number(oDay.outsideZone || 0));
            }, 0);
            var nIncidentAxisMaximum = Math.max(5, Math.ceil((nMaximumIncident * 1.15) / 5) * 5);

            if (oInefficiencyChart) {
                oInefficiencyChart.setVizProperties({
                    general: {
                        background: { color: "#FFFFFF" },
                        layout: { padding: 0 }
                    },
                    title: { visible: false },
                    legend: {
                        visible: true,
                        position: "right",
                        alignment: "center",
                        label: { style: { color: "#233548", fontSize: "11px" } }
                    },
                    plotArea: {
                        colorPalette: ["#C00000", "#E9730C"],
                        drawingEffect: "normal",
                        dataLabel: {
                            visible: true,
                            formatString: "0.0",
                            position: "inside",
                            hideWhenOverlap: false,
                            showTotal: true,
                            style: { fontWeight: "bold" }
                        },
                        gridline: { visible: true, color: "#D9E2EA" }
                    },
                    valueAxis: {
                        title: { visible: false },
                        label: { visible: true, formatString: "0.0" },
                        scale: { fixedRange: true, minValue: 0, maxValue: nInefficiencyAxisMaximum }
                    },
                    categoryAxis: {
                        title: { visible: false },
                        label: { visible: true, forceToShowAll: true, style: { color: "#233548", fontWeight: "bold" } }
                    },
                    interaction: { selectability: { mode: "EXCLUSIVE" } },
                    tooltip: { visible: true }
                });
            }
            if (oIncidentTrendChart) {
                oIncidentTrendChart.setVizProperties({
                    general: {
                        background: { color: "#FFFFFF" },
                        layout: { padding: 0 }
                    },
                    title: { visible: false },
                    legend: {
                        visible: true,
                        position: "right",
                        alignment: "center",
                        label: { style: { color: "#233548", fontSize: "11px" } }
                    },
                    plotArea: {
                        colorPalette: ["#E9730C", "#C00000", "#7858D7"],
                        drawingEffect: "normal",
                        dataLabel: {
                            visible: true,
                            formatString: "0",
                            position: "above",
                            hideWhenOverlap: false,
                            style: { fontWeight: "bold" }
                        },
                        marker: { visible: true, size: 7 },
                        lineSize: 2,
                        gridline: { visible: true, color: "#D9E2EA" }
                    },
                    valueAxis: {
                        title: { visible: false },
                        label: { visible: true, formatString: "0" },
                        scale: { fixedRange: true, minValue: 0, maxValue: nIncidentAxisMaximum }
                    },
                    categoryAxis: {
                        title: { visible: false },
                        label: { visible: true, forceToShowAll: true, style: { color: "#233548" } }
                    },
                    interaction: { selectability: { mode: "NONE" } },
                    tooltip: { visible: true }
                });
            }
        },

        onPeriodChange: function () { this._refreshDashboard(); },

        onGranularityChange: function (oEvent) {
            var oViewModel = this.getModel("view");
            var sGranularity = oEvent.getSource().getSelectedKey();
            oViewModel.setProperty("/granularity", sGranularity);
            if (sGranularity === "week") {
                oViewModel.setProperty("/referenceDate", oViewModel.getProperty("/weekReferenceDate") || this._getLatestRecordDate());
                this._syncReferenceSelectors();
            } else {
                this._setReferenceFromSelectors();
            }
            this._refreshDashboard();
        },

        onReferenceDateChange: function (oEvent) {
            var oDate = oEvent.getSource().getDateValue();
            if (oEvent.getParameter("valid") === false || !oDate) {
                oDate = periodHelper.parseDate(this.getModel("view").getProperty("/weekReferenceDate")) || new Date();
            }
            var sValue = periodHelper.toKey(oDate);
            this.getModel("view").setProperty("/referenceDate", sValue);
            this.getModel("view").setProperty("/weekReferenceDate", sValue);
            this._syncReferenceSelectors();
            this._refreshDashboard();
        },

        onReferenceMonthChange: function (oEvent) {
            this.getModel("view").setProperty("/referenceMonth", oEvent.getSource().getSelectedKey());
            this._setReferenceFromSelectors();
            this._refreshDashboard();
        },

        onReferenceYearChange: function (oEvent) {
            this.getModel("view").setProperty("/referenceYear", oEvent.getSource().getSelectedKey());
            this._setReferenceFromSelectors();
            this._refreshDashboard();
        },

        onZonePress: function (oEvent) {
            this.navTo("centers", { zoneId: oEvent.getSource().data("zoneId") });
        },

        onZoneChartSelect: function (oEvent) {
            var aSelected = oEvent.getParameter("data") || [];
            var sZoneName = aSelected[0] && aSelected[0].data && aSelected[0].data.Zona;
            var oZone = (this.getModel("view").getProperty("/zoneSummaries") || []).find(function (oItem) {
                return oItem.zone === sZoneName;
            });
            if (oZone) { this.navTo("centers", { zoneId: oZone.zoneId }); }
        },

        onCriticalCenterPress: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("view");
            var sCenterId = oContext && oContext.getProperty("id");
            if (sCenterId) { this.navTo("center", { centerId: sCenterId }); }
        },

        onApplyFilters: function () {
            if (this.getModel("view").getProperty("/granularity") !== "week") {
                this._setReferenceFromSelectors();
            }
            this._refreshDashboard();
            MessageToast.show("Datos actualizados para " + this.getModel("view").getProperty("/periodLabel"));
        },

        _openJustificationReview: function (sType) {
            var oPeriod = this._getPeriod();
            this.getModel("attendance").setProperty("/justificationContext", {
                type: sType,
                start: periodHelper.toKey(oPeriod.start),
                end: periodHelper.toKey(oPeriod.end),
                label: oPeriod.label
            });
            this.navTo(sType === "late" ? "lateJustifications" : "earlyExitJustifications");
        },

        onLateReviewPress: function () {
            this._openJustificationReview("late");
        },

        onEarlyExitReviewPress: function () {
            this._openJustificationReview("early");
        }
    });
});
