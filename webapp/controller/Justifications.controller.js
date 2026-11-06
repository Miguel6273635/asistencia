/*
sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "com/mitsu/monitorasistencia/model/periodHelper",
    "com/mitsu/monitorasistencia/model/justificationHelper",
    "com/mitsu/monitorasistencia/model/AttendanceApi",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], function (BaseController, periodHelper, justificationHelper, AttendanceApi, JSONModel, MessageBox, MessageToast) {
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
                periodLabel: "", dateFrom: "", dateTo: "", count: 0, pendingCount: 0, resolvedCount: 0,
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
            if (!oContext.start || !oContext.end) {
                try {
                    oContext = JSON.parse(window.sessionStorage.getItem("monitor.justificationContext") || "{}") || {};
                } catch (oStorageError) {
                    console.warn("[Monitor][JUSTIFICATIONS][CONTEXT][READ]", oStorageError);
                    oContext = {};
                }
            }
            var oStart = periodHelper.parseDate(oContext.start);
            var oEnd = periodHelper.parseDate(oContext.end);
            if (!oStart || !oEnd) {
                oEnd = new Date();
                oStart = new Date(oEnd.getFullYear(), oEnd.getMonth(), oEnd.getDate());
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

            return Promise.all([
                this._attendanceApi.getProcessingJustifications(oPeriod.from, oPeriod.to),
                this._attendanceApi.getEmployees().catch(function (oError) {
                    console.warn("[Monitor][JUSTIFICATIONS][EMPLOYEES][FALLBACK]", oError);
                    return [];
                })
            ]).then(function (aResults) {
                var aRows = aResults[0] || [];
                var aSapEmployees = aResults[1] || [];
                var aEmployees = (this.getModel("attendance").getProperty("/employees") || []).concat(aSapEmployees);
                var aCenters = this.getModel("attendance").getProperty("/centers") || [];
                var mEmployees = {};
                var mCenters = {};
                aEmployees.forEach(function (oEmployee) {
                    var sNumber = String(oEmployee.PersonalNumber || oEmployee.PersonnelNumber ||
                        oEmployee.number || oEmployee.employeeNumber || oEmployee.id || "").trim();
                    if (sNumber) { mEmployees[sNumber] = oEmployee; }
                });
                aCenters.forEach(function (oCenter) { mCenters[String(oCenter.code || "").trim()] = oCenter; });
                var aMapped = aRows.filter(function (oRow) {
                    return justificationHelper.matches(oRow, sType);
                }).map(function (oRow, iIndex) {
                    var sNumber = safeText(oRow.PersonalNumber);
                    var oEmployee = mEmployees[sNumber] || {};
                    var sCenterCode = safeText(oRow.CenterOffice);
                    var oCenter = mCenters[sCenterCode] || {};
                    var sDecision = decisionState(oRow.DecisionRH);
                    var sCommentsLog = safeText(oRow.CommentsLog);
                    var sJustification = safeText(oRow.ReasonType) || safeText(oRow.IncidentType) ||
                        safeText(oRow.DescriptionStatus) || safeText(oRow.JustificationStatus);
                    var sEventTime = safeText(oRow.EnterHour) || safeText(oRow.EventTime) ||
                        safeText(oRow.RegisterHour) || safeText(oRow.Hour) || safeText(oRow.TimeRegister) || "—";
                    return {
                        id: sNumber + "-" + safeText(oRow.DateJustification) + "-" + justificationHelper.registerCode(oRow) + "-" + iIndex,
                        employeeId: oEmployee.id || (sNumber ? "employee-" + sNumber : ""),
                          employee: safeText(oRow.FullName) || safeText(oEmployee.FullName) ||
                              safeText(oEmployee.name) || sNumber || "Sin nombre",
                        personalNumber: sNumber, date: displayDate(oRow.DateJustification),
                        center: safeText(oCenter.name) || sCenterCode || "Sin centro",
                          schedule: safeText(oEmployee.Shift) || safeText(oEmployee.Hourly) ||
                              safeText(oEmployee.shift) || safeText(oEmployee.scheduledetail) || "—", eventTime: sEventTime,
                        justification: sJustification || "Sin clasificación registrada",
                        commentsLog: sCommentsLog,
                        hasJustification: Boolean(sCommentsLog),
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
            this.getModel("review").setProperty("/resolvedCount", aRows.filter(function (oRow) { return oRow.decision !== "pending"; }).length);
        },

        onSearch: function (oEvent) {
            var sQuery = String(oEvent.getParameter("newValue") || oEvent.getParameter("query") || "").trim().toLowerCase();
            var aRows = this.getModel("review").getProperty("/rows") || [];
            this.getModel("review").setProperty("/filteredRows", !sQuery ? aRows : aRows.filter(function (oRow) {
                return [oRow.employee, oRow.personalNumber, oRow.center, oRow.justification, oRow.commentsLog, oRow.commentsRH].some(function (sValue) {
                    return String(sValue || "").toLowerCase().indexOf(sQuery) >= 0;
                });
            }));
        },

        onRefresh: function () {
            this._loadRows(this.getModel("review").getProperty("/type") || "late");
        },

        onApprove: function (oEvent) { this._confirmDecision(oEvent.getSource().getBindingContext("review").getObject(), "A"); },
        onReject: function (oEvent) { this._confirmDecision(oEvent.getSource().getBindingContext("review").getObject(), "R"); },

        onShowJustification: function (oEvent) {
            var oRow = oEvent.getSource().getBindingContext("review").getObject();
            MessageBox.information(oRow.commentsLog || "El colaborador no capturó comentarios de justificación.", {
                title: "Justificación de " + oRow.employee,
                details: "Incidencia: " + oRow.justification + "\nFecha: " + oRow.date + "\nCentro: " + oRow.center
            });
        },

        _confirmDecision: function (oRow, sDecisionRH) {
            var bApprove = sDecisionRH === "A";
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
                CommentsLog: safeText(oRaw.CommentsLog),
                DecisionRH: sDecisionRH, CommentsRH: safeText(oRow.commentsRH) || safeText(oRaw.CommentsRH),
                StatusRequest: safeText(oRaw.StatusRequest), MessageRequest: safeText(oRaw.MessageRequest)
            };
            this._requestInProgress = true;
            this.getModel("review").setProperty("/busy", true);
            return this._attendanceApi.submitJustificationDecision(oPayload).then(function () {
                MessageToast.show(sDecisionRH === "A" ? "Justificación aceptada" : "Justificación rechazada");
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
*/
sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "com/mitsu/monitorasistencia/model/periodHelper",
    "com/mitsu/monitorasistencia/model/justificationHelper",
    "com/mitsu/monitorasistencia/model/AttendanceApi",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], function (BaseController, periodHelper, justificationHelper, AttendanceApi, JSONModel, MessageBox, MessageToast) {
    "use strict";

    function compactDate(oDate) {
        return oDate.getFullYear() + String(oDate.getMonth() + 1).padStart(2, "0") + String(oDate.getDate()).padStart(2, "0");
    }

    function displayDate(sValue) {
        var sDate = String(sValue || "").replace(/[^0-9]/g, "").slice(0, 8);
        return /^\d{8}$/.test(sDate) ? sDate.slice(6, 8) + "/" + sDate.slice(4, 6) + "/" + sDate.slice(0, 4) : "—";
    }

    function displayTime(sValue) {
        var sOriginal = String(sValue || "").trim();
        var sTime = sOriginal.replace(/[^0-9]/g, "");

        if (!sOriginal) { return "—"; }
        if (sTime.length === 5) { sTime = "0" + sTime; }
        if (!/^\d{6}$/.test(sTime)) { return sOriginal; }

        var iHour = Number(sTime.slice(0, 2));
        var iMinute = Number(sTime.slice(2, 4));
        var iSecond = Number(sTime.slice(4, 6));
        if (iHour > 23 || iMinute > 59 || iSecond > 59) { return sOriginal; }

        var sPeriod = iHour < 12 ? "AM" : "PM";
        var iDisplayHour = iHour % 12 || 12;
        return String(iDisplayHour).padStart(2, "0") + ":" +
            String(iMinute).padStart(2, "0") + ":" +
            String(iSecond).padStart(2, "0") + " " + sPeriod;
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
                periodLabel: "", dateFrom: "", dateTo: "", count: 0, pendingCount: 0, resolvedCount: 0,
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
            if (!oContext.start || !oContext.end) {
                try {
                    oContext = JSON.parse(window.sessionStorage.getItem("monitor.justificationContext") || "{}") || {};
                } catch (oStorageError) {
                    console.warn("[Monitor][JUSTIFICATIONS][CONTEXT][READ]", oStorageError);
                    oContext = {};
                }
            }
            var oStart = periodHelper.parseDate(oContext.start);
            var oEnd = periodHelper.parseDate(oContext.end);
            if (!oStart || !oEnd) {
                oEnd = new Date();
                oStart = new Date(oEnd.getFullYear(), oEnd.getMonth(), oEnd.getDate());
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

            return Promise.all([
                this._attendanceApi.getProcessingJustifications(oPeriod.from, oPeriod.to),
                this._attendanceApi.getEmployees().catch(function (oError) {
                    console.warn("[Monitor][JUSTIFICATIONS][EMPLOYEES][FALLBACK]", oError);
                    return [];
                })
            ]).then(function (aResults) {
                var aRows = aResults[0] || [];
                var aSapEmployees = aResults[1] || [];
                var aEmployees = (this.getModel("attendance").getProperty("/employees") || []).concat(aSapEmployees);
                var aCenters = this.getModel("attendance").getProperty("/centers") || [];
                var mEmployees = {};
                var mCenters = {};
                aEmployees.forEach(function (oEmployee) {
                    var sNumber = String(oEmployee.PersonalNumber || oEmployee.PersonnelNumber ||
                        oEmployee.number || oEmployee.employeeNumber || oEmployee.id || "").trim();
                    if (sNumber) { mEmployees[sNumber] = oEmployee; }
                });
                aCenters.forEach(function (oCenter) { mCenters[String(oCenter.code || "").trim()] = oCenter; });
                var aMapped = aRows.filter(function (oRow) {
                    return justificationHelper.matches(oRow, sType);
                }).map(function (oRow, iIndex) {
                    var sNumber = safeText(oRow.PersonalNumber);
                    var oEmployee = mEmployees[sNumber] || {};
                    var sCenterCode = safeText(oRow.CenterOffice);
                    var oCenter = mCenters[sCenterCode] || {};
                    // ProcessingJustificationsSet devuelve la resolución efectiva en
                    // DescriptionStatus/JustificationStatus. DecisionRH es el campo de
                    // entrada del POST y puede regresar vacío aun después de resolverla.
                    var sDecision = decisionState(
                        safeText(oRow.DescriptionStatus) ||
                        safeText(oRow.JustificationStatus) ||
                        safeText(oRow.DecisionRH)
                    );
                    var sCommentsLog = safeText(oRow.CommentsLog);
                    var sJustification = safeText(oRow.ReasonType) || safeText(oRow.IncidentType) ||
                        safeText(oRow.DescriptionStatus) || safeText(oRow.JustificationStatus);
                    var sEntryTime = safeText(oRow.EnterHour) || safeText(oRow.EventTime) ||
                        safeText(oRow.RegisterHour) || safeText(oRow.Hour) || safeText(oRow.TimeRegister) || "—";
                    var sExitTime = safeText(oRow.ExitHour) || safeText(oRow.ExitTime) ||
                        safeText(oRow.DepartureTime) || safeText(oRow.P20Time) || "—";
                    return {
                        id: sNumber + "-" + safeText(oRow.DateJustification) + "-" + justificationHelper.registerCode(oRow) + "-" + iIndex,
                        employeeId: oEmployee.id || (sNumber ? "employee-" + sNumber : ""),
                          employee: safeText(oRow.FullName) || safeText(oEmployee.FullName) ||
                              safeText(oEmployee.name) || sNumber || "Sin nombre",
                        personalNumber: sNumber, date: displayDate(oRow.DateJustification),
                        center: safeText(oCenter.name) || sCenterCode || "Sin centro",
                          schedule: safeText(oRow.ScheduleDetail) || safeText(oEmployee.ScheduleDetail) ||
                              safeText(oEmployee.scheduleDetail) || safeText(oEmployee.Shift) ||
                              safeText(oEmployee.Hourly) || safeText(oEmployee.shift) ||
                              safeText(oEmployee.schedule) || "—",
                        entryTime: displayTime(sEntryTime),
                        exitTime: displayTime(sExitTime),
                        justification: sJustification || "Sin clasificación registrada",
                        commentsLog: sCommentsLog,
                        hasJustification: Boolean(sCommentsLog),
                        commentsRH: safeText(oRow.CommentsRH),
                        commentsRHState: "None",
                        decision: sDecision,
                        approvalText: sDecision === "approved" ? "Aprobado" : (sDecision === "rejected" ? "Rechazado" : "Pendiente"),
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
            this.getModel("review").setProperty("/resolvedCount", aRows.filter(function (oRow) { return oRow.decision !== "pending"; }).length);
        },

        onSearch: function (oEvent) {
            var sQuery = String(oEvent.getParameter("newValue") || oEvent.getParameter("query") || "").trim().toLowerCase();
            var aRows = this.getModel("review").getProperty("/rows") || [];
            this.getModel("review").setProperty("/filteredRows", !sQuery ? aRows : aRows.filter(function (oRow) {
                return [oRow.employee, oRow.personalNumber, oRow.center, oRow.justification, oRow.commentsLog, oRow.commentsRH].some(function (sValue) {
                    return String(sValue || "").toLowerCase().indexOf(sQuery) >= 0;
                });
            }));
        },

        onRefresh: function () {
            this._loadRows(this.getModel("review").getProperty("/type") || "late");
        },

        onApprove: function (oEvent) { this._confirmDecision(oEvent.getSource().getBindingContext("review").getObject(), "A"); },
        onReject: function (oEvent) { this._confirmDecision(oEvent.getSource().getBindingContext("review").getObject(), "R"); },

        onCommentsRHChange: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("review");
            if (oContext) {
                var sValue = oEvent.getParameter("value");
                oContext.getModel().setProperty(oContext.getPath() + "/commentsRH", sValue);
                oContext.getModel().setProperty(
                    oContext.getPath() + "/commentsRHState",
                    safeText(sValue) ? "None" : "Error"
                );
            }
        },

        onShowJustification: function (oEvent) {
            var oRow = oEvent.getSource().getBindingContext("review").getObject();
            MessageBox.information(oRow.commentsLog || "El colaborador no capturó comentarios de justificación.", {
                title: "Justificación de " + oRow.employee,
                details: "Incidencia: " + oRow.justification + "\nFecha: " + oRow.date + "\nCentro: " + oRow.center
            });
        },

        _confirmDecision: function (oRow, sDecisionRH) {
            var bApprove = sDecisionRH === "A";
            if (this._requestInProgress) { MessageToast.show("Espera a que termine la solicitud actual"); return; }
            if (oRow.decision !== "pending") { MessageToast.show("La justificación ya tiene una decisión registrada"); return; }
            if (!safeText(oRow.commentsRH)) {
                oRow.commentsRHState = "Error";
                this.getModel("review").refresh(true);
                MessageBox.warning("El comentario de RH es obligatorio para aprobar o rechazar la justificación.");
                return;
            }
            oRow.commentsRHState = "None";
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
                CommentsLog: safeText(oRaw.CommentsLog),
                DecisionRH: sDecisionRH, CommentsRH: safeText(oRow.commentsRH) || safeText(oRaw.CommentsRH),
                StatusRequest: safeText(oRaw.StatusRequest), MessageRequest: safeText(oRaw.MessageRequest)
            };
            this._requestInProgress = true;
            this.getModel("review").setProperty("/busy", true);
            return this._attendanceApi.submitJustificationDecision(oPayload).then(function () {
                MessageToast.show(sDecisionRH === "A" ? "Justificación aceptada" : "Justificación rechazada");
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


