sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "com/mitsu/monitorasistencia/model/periodHelper",
    "com/mitsu/monitorasistencia/model/AttendanceApi",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], function (BaseController, periodHelper, AttendanceApi, JSONModel, MessageBox, MessageToast) {
    "use strict";

    function compactDate(oDate) {
        return oDate.getFullYear() + String(oDate.getMonth() + 1).padStart(2, "0") + String(oDate.getDate()).padStart(2, "0");
    }

    function displayDate(sValue) {
        var sDate = String(sValue || "").replace(/[^0-9]/g, "").slice(0, 8);
        return /^\d{8}$/.test(sDate) ? sDate.slice(6, 8) + "/" + sDate.slice(4, 6) + "/" + sDate.slice(0, 4) : "—";
    }

    function decisionState(sValue) {
        var sDecision = String(sValue || "").trim().toUpperCase();
        if (/APROB|ACEPT|APPROV|^A$/.test(sDecision)) { return "approved"; }
        if (/RECHAZ|REJECT|^R$/.test(sDecision)) { return "rejected"; }
        return "pending";
    }

    function safeText(vValue) {
        return vValue === null || vValue === undefined ? "" : String(vValue).trim();
    }

    return BaseController.extend("com.mitsu.monitorasistencia.controller.Justifications", {
        onInit: function () {
            this._attendanceApi = new AttendanceApi();
            this._requestInProgress = false;
            this.setModel(new JSONModel({
                type: "late", title: "Revisión de retardos",
                subtitle: "Valida las justificaciones enviadas por los colaboradores.",
                periodLabel: "", dateFrom: "", dateTo: "", count: 0, pendingCount: 0,
                search: "", busy: false, error: "", rows: [], filteredRows: []
            }), "review");
            this.getRouter().getRoute("lateJustifications").attachPatternMatched(this._onRouteMatched, this);
            this.getRouter().getRoute("earlyExitJustifications").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function (oEvent) {
            var sType = oEvent.getParameter("name") === "earlyExitJustifications" ? "early" : "late";
            this.getModel("attendance").dataLoaded().then(function () { return this._loadRows(sType); }.bind(this));
        },

        _resolvePeriod: function () {
            var oContext = this.getModel("attendance").getProperty("/justificationContext") || {};
            var oStart = periodHelper.parseDate(oContext.start);
            var oEnd = periodHelper.parseDate(oContext.end);
            if (!oStart || !oEnd) {
                oEnd = new Date();
                oStart = new Date(oEnd.getFullYear(), oEnd.getMonth(), 1);
            }
            return {
                from: compactDate(oStart), to: compactDate(oEnd),
                label: oContext.label || (displayDate(compactDate(oStart)) + " – " + displayDate(compactDate(oEnd)))
            };
        },

        _loadRows: function (sType) {
            var oPeriod = this._resolvePeriod();
            var oReviewModel = this.getModel("review");
            oReviewModel.setProperty("/busy", true);
            oReviewModel.setProperty("/error", "");
            oReviewModel.setProperty("/type", sType);
            oReviewModel.setProperty("/title", sType === "late" ? "Revisión de retardos" : "Revisión de salidas anticipadas");
            oReviewModel.setProperty("/subtitle", sType === "late" ?
                "Consulta cada llegada tardía y acepta o rechaza la justificación del colaborador." :
                "Consulta cada salida antes del horario y acepta o rechaza la justificación del colaborador.");
            oReviewModel.setProperty("/periodLabel", oPeriod.label);
            oReviewModel.setProperty("/dateFrom", oPeriod.from);
            oReviewModel.setProperty("/dateTo", oPeriod.to);
            // eslint-disable-next-line no-console
            console.info("[Monitor][JUSTIFICATIONS][LOAD]", { type: sType, period: oPeriod });

            return this._attendanceApi.getProcessingJustifications(oPeriod.from, oPeriod.to).then(function (aRows) {
                var aEmployees = this.getModel("attendance").getProperty("/employees") || [];
                var aCenters = this.getModel("attendance").getProperty("/centers") || [];
                var mEmployees = {};
                var mCenters = {};
                aEmployees.forEach(function (oEmployee) {
                    mEmployees[String(oEmployee.number || oEmployee.employeeNumber || "").trim()] = oEmployee;
                });
                aCenters.forEach(function (oCenter) { mCenters[String(oCenter.code || "").trim()] = oCenter; });
                var sRequiredRegister = sType === "late" ? "P10" : "P20";
                var aMapped = aRows.filter(function (oRow) {
                    return safeText(oRow.TypeRegister).toUpperCase() === sRequiredRegister;
                }).map(function (oRow, iIndex) {
                    var sNumber = safeText(oRow.PersonalNumber);
                    var oEmployee = mEmployees[sNumber] || {};
                    var sCenterCode = safeText(oRow.CenterOffice);
                    var oCenter = mCenters[sCenterCode] || {};
                    var sDecision = decisionState(oRow.DecisionRH);
                    var sJustification = safeText(oRow.DescriptionStatus) || safeText(oRow.ReasonType) ||
                        safeText(oRow.IncidentType) || safeText(oRow.JustificationStatus);
                    return {
                        id: sNumber + "-" + safeText(oRow.DateJustification) + "-" + sRequiredRegister + "-" + iIndex,
                        employeeId: oEmployee.id || (sNumber ? "employee-" + sNumber : ""),
                        employee: safeText(oRow.FullName) || safeText(oEmployee.name) || sNumber || "Sin nombre",
                        personalNumber: sNumber, date: displayDate(oRow.DateJustification),
                        center: safeText(oCenter.name) || sCenterCode || "Sin centro",
                        schedule: safeText(oEmployee.shift) || safeText(oEmployee.schedule) || "—", eventTime: "—",
                        justification: sJustification || "Sin justificación registrada", hasJustification: Boolean(sJustification),
                        commentsRH: safeText(oRow.CommentsRH),
                        decision: sDecision,
                        approvalText: sDecision === "approved" ? "Aprobada" : (sDecision === "rejected" ? "Rechazada" : "Pendiente"),
                        approvalState: sDecision === "approved" ? "Success" : (sDecision === "rejected" ? "Error" : "Warning"),
                        raw: oRow
                    };
                });
                oReviewModel.setProperty("/rows", aMapped);
                oReviewModel.setProperty("/filteredRows", aMapped);
                oReviewModel.setProperty("/search", "");
                this._updateCounts();
            }.bind(this)).catch(function (oError) {
                var sMessage = oError && oError.message ? oError.message : String(oError);
                oReviewModel.setProperty("/error", sMessage);
                oReviewModel.setProperty("/rows", []);
                oReviewModel.setProperty("/filteredRows", []);
                this._updateCounts();
                MessageBox.error("No fue posible consultar las justificaciones en SAP. " + sMessage);
            }.bind(this)).finally(function () { oReviewModel.setProperty("/busy", false); });
        },

        _updateCounts: function () {
            var aRows = this.getModel("review").getProperty("/rows") || [];
            this.getModel("review").setProperty("/count", aRows.length);
            this.getModel("review").setProperty("/pendingCount", aRows.filter(function (oRow) { return oRow.decision === "pending"; }).length);
        },

        onSearch: function (oEvent) {
            var sQuery = String(oEvent.getParameter("newValue") || oEvent.getParameter("query") || "").trim().toLowerCase();
            var aRows = this.getModel("review").getProperty("/rows") || [];
            this.getModel("review").setProperty("/filteredRows", !sQuery ? aRows : aRows.filter(function (oRow) {
                return [oRow.employee, oRow.personalNumber, oRow.center, oRow.justification, oRow.commentsRH].some(function (sValue) {
                    return String(sValue || "").toLowerCase().indexOf(sQuery) >= 0;
                });
            }));
        },

        onApprove: function (oEvent) { this._confirmDecision(oEvent.getSource().getBindingContext("review").getObject(), "APROBADA"); },
        onReject: function (oEvent) { this._confirmDecision(oEvent.getSource().getBindingContext("review").getObject(), "RECHAZADA"); },

        _confirmDecision: function (oRow, sDecisionRH) {
            var bApprove = sDecisionRH === "APROBADA";
            if (this._requestInProgress) { MessageToast.show("Espera a que termine la solicitud actual"); return; }
            if (oRow.decision !== "pending") { MessageToast.show("La justificación ya tiene una decisión registrada"); return; }
            MessageBox.confirm("¿Deseas " + (bApprove ? "aceptar" : "rechazar") + " la justificación de " + oRow.employee + "?", {
                title: bApprove ? "Aceptar justificación" : "Rechazar justificación",
                emphasizedAction: MessageBox.Action.OK,
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) { this._submitDecision(oRow, sDecisionRH); }
                }.bind(this)
            });
        },

        _submitDecision: function (oRow, sDecisionRH) {
            var oRaw = oRow.raw || {};
            var oPayload = {
                PersonalNumber: safeText(oRaw.PersonalNumber), FullName: safeText(oRaw.FullName),
                CenterOffice: safeText(oRaw.CenterOffice), Zone: safeText(oRaw.Zone), Base: safeText(oRaw.Base),
                DateJustification: safeText(oRaw.DateJustification), TypeRegister: safeText(oRaw.TypeRegister),
                TypeRegisterDescrip: safeText(oRaw.TypeRegisterDescrip), IncidentType: safeText(oRaw.IncidentType),
                ReasonType: safeText(oRaw.ReasonType), JustificationStatus: safeText(oRaw.JustificationStatus),
                DescriptionStatus: safeText(oRaw.DescriptionStatus), Email: safeText(oRaw.Email),
                DecisionRH: sDecisionRH, CommentsRH: safeText(oRow.commentsRH) || safeText(oRaw.CommentsRH)
            };
            this._requestInProgress = true;
            this.getModel("review").setProperty("/busy", true);
            return this._attendanceApi.submitJustificationDecision(oPayload).then(function () {
                MessageToast.show(sDecisionRH === "APROBADA" ? "Justificación aceptada" : "Justificación rechazada");
                return this._loadRows(this.getModel("review").getProperty("/type"));
            }.bind(this)).catch(function (oError) {
                MessageBox.error("SAP no pudo procesar la decisión. " + (oError.message || String(oError)));
            }).finally(function () {
                this._requestInProgress = false;
                this.getModel("review").setProperty("/busy", false);
            }.bind(this));
        },

        onEmployeePress: function (oEvent) {
            var oRow = oEvent.getSource().getBindingContext("review").getObject();
            if (oRow.employeeId) { this.navTo("userPerformance", { employeeId: oRow.employeeId }); }
        },
        onBack: function () { this.navTo("overview"); }
    });
});
