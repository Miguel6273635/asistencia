sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "com/mitsu/monitorasistencia/model/periodHelper",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], function (BaseController, periodHelper, JSONModel, MessageBox, MessageToast) {
    "use strict";

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
        var aEnd = aRanges[aRanges.length - 1].match(/[-–]\s*(\d{1,2}:\d{2})/);
        var iScheduledEnd = aEnd ? clockMinutes(aEnd[1]) : null;
        return iScheduledEnd !== null && iExit < iScheduledEnd;
    }

    function isApproved(oRecord) {
        var sStatus = String(oRecord.approvalStatus || "").trim().toLowerCase();
        return oRecord.justificationApproved === true || ["aprobado", "aprobada", "approved", "aceptado", "aceptada"].indexOf(sStatus) >= 0;
    }

    return BaseController.extend("com.mitsu.monitorasistencia.controller.Justifications", {
        onInit: function () {
            this.setModel(new JSONModel({
                type: "late",
                title: "Revisión de retardos",
                subtitle: "Valida las justificaciones enviadas por los colaboradores.",
                periodLabel: "",
                count: 0,
                pendingCount: 0,
                search: "",
                rows: [],
                filteredRows: []
            }), "review");
            this.getRouter().getRoute("lateJustifications").attachPatternMatched(this._onRouteMatched, this);
            this.getRouter().getRoute("earlyExitJustifications").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function (oEvent) {
            var sType = oEvent.getParameter("name") === "earlyExitJustifications" ? "early" : "late";
            this.getModel("attendance").dataLoaded().then(function () {
                this._loadRows(sType);
            }.bind(this));
        },

        _loadRows: function (sType) {
            var oAttendanceModel = this.getModel("attendance");
            var oContext = oAttendanceModel.getProperty("/justificationContext") || {};
            var oStart = periodHelper.parseDate(oContext.start);
            var oEnd = periodHelper.parseDate(oContext.end);
            var aEmployees = oAttendanceModel.getProperty("/employees") || [];
            var mEmployees = {};
            aEmployees.forEach(function (oEmployee) { mEmployees[oEmployee.id] = oEmployee; });

            var aRecords = oAttendanceModel.getProperty("/records") || [];
            var aHistory = oAttendanceModel.getProperty("/userPerformanceHistory") || [];
            var aSourceRecords = aRecords.map(function (oRecord, iSourceIndex) {
                return { record: oRecord, sourceIndex: iSourceIndex, sourceCollection: "records" };
            }).concat(aHistory.map(function (oRecord, iSourceIndex) {
                return { record: oRecord, sourceIndex: iSourceIndex, sourceCollection: "userPerformanceHistory" };
            }));
            var aRows = aSourceRecords.filter(function (oItem) {
                var oDate = periodHelper.parseDate(oItem.record.workDate || oItem.record.dateISO || oItem.record.date);
                var bInPeriod = !oStart || !oEnd || (oDate && oDate >= oStart && oDate <= oEnd);
                var bMatchesType = sType === "late" ?
                    (oItem.record.status === "Retardo" || oItem.record.isLate === true) :
                    isEarlyExit(oItem.record);
                return bInPeriod && bMatchesType;
            }).map(function (oItem) {
                var oRecord = oItem.record;
                var oEmployee = mEmployees[oRecord.employeeId] || {};
                var sJustification = oRecord.justification || oRecord.message || oRecord.observation || "";
                var bApproved = isApproved(oRecord);
                return {
                    sourceIndex: oItem.sourceIndex,
                    sourceCollection: oItem.sourceCollection,
                    employeeId: oRecord.employeeId,
                    employee: oRecord.employee || oEmployee.name || "Sin nombre",
                    personalNumber: oEmployee.employeeNumber || oEmployee.personalNumber || String(oRecord.employeeId || "").replace(/^employee-/, ""),
                    date: oRecord.date || oRecord.workDate || "—",
                    center: oRecord.centerName || oRecord.center || "Sin centro",
                    schedule: oRecord.scheduled || oRecord.shift || "Sin horario",
                    eventTime: sType === "late" ? (oRecord.entry || "—") : (oRecord.exit || "—"),
                    justification: sJustification || "Sin justificación registrada",
                    hasJustification: Boolean(sJustification),
                    approved: bApproved,
                    approvalText: bApproved ? "Aprobada" : (sJustification ? "Pendiente" : "Sin justificación"),
                    approvalState: bApproved ? "Success" : (sJustification ? "Warning" : "None")
                };
            });

            var oReviewModel = this.getModel("review");
            oReviewModel.setProperty("/type", sType);
            oReviewModel.setProperty("/title", sType === "late" ? "Revisión de retardos" : "Revisión de salidas anticipadas");
            oReviewModel.setProperty("/subtitle", sType === "late" ?
                "Consulta cada llegada tardía y acepta la justificación del colaborador." :
                "Consulta cada salida antes del horario y acepta la justificación del colaborador.");
            oReviewModel.setProperty("/periodLabel", oContext.label || "Periodo actual");
            oReviewModel.setProperty("/rows", aRows);
            oReviewModel.setProperty("/filteredRows", aRows);
            oReviewModel.setProperty("/search", "");
            this._updateCounts();
        },

        _updateCounts: function () {
            var aRows = this.getModel("review").getProperty("/rows") || [];
            this.getModel("review").setProperty("/count", aRows.length);
            this.getModel("review").setProperty("/pendingCount", aRows.filter(function (oRow) {
                return oRow.hasJustification && !oRow.approved;
            }).length);
        },

        onSearch: function (oEvent) {
            var sQuery = String(oEvent.getParameter("newValue") || oEvent.getParameter("query") || "").trim().toLowerCase();
            var aRows = this.getModel("review").getProperty("/rows") || [];
            this.getModel("review").setProperty("/filteredRows", !sQuery ? aRows : aRows.filter(function (oRow) {
                return [oRow.employee, oRow.personalNumber, oRow.center, oRow.justification].some(function (sValue) {
                    return String(sValue || "").toLowerCase().indexOf(sQuery) >= 0;
                });
            }));
        },

        onApprove: function (oEvent) {
            var oRow = oEvent.getSource().getBindingContext("review").getObject();
            MessageBox.confirm("¿Deseas aceptar la justificación de " + oRow.employee + "?", {
                title: "Aceptar justificación",
                emphasizedAction: MessageBox.Action.OK,
                onClose: function (sAction) {
                    if (sAction !== MessageBox.Action.OK) { return; }
                    var sCollectionPath = "/" + oRow.sourceCollection;
                    var aRecords = this.getModel("attendance").getProperty(sCollectionPath) || [];
                    var oRecord = aRecords[oRow.sourceIndex];
                    if (oRecord) {
                        oRecord.justificationApproved = true;
                        oRecord.approvalStatus = "Aprobada";
                        this.getModel("attendance").refresh(true);
                    }
                    oRow.approved = true;
                    oRow.approvalText = "Aprobada";
                    oRow.approvalState = "Success";
                    this.getModel("review").refresh(true);
                    this._updateCounts();
                    MessageToast.show("Justificación aceptada para esta sesión");
                }.bind(this)
            });
        },

        onEmployeePress: function (oEvent) {
            var oRow = oEvent.getSource().getBindingContext("review").getObject();
            if (oRow.employeeId) { this.navTo("userPerformance", { employeeId: oRow.employeeId }); }
        },

        onBack: function () {
            this.navTo("overview");
        }
    });
});
