
sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "com/mitsu/monitorasistencia/model/periodHelper",
    "com/mitsu/monitorasistencia/model/AttendanceApi",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], function (
    BaseController,
    periodHelper,
    AttendanceApi,
    JSONModel,
    MessageBox,
    MessageToast
) {
    "use strict";

    function text(value) {
        return value === null || value === undefined
            ? ""
            : String(value).trim();
    }

    function numberKey(value) {
        return text(value).replace(/^0+(?=\d)/, "");
    }

    function dateKey(date) {
        return String(date.getFullYear()) +
            String(date.getMonth() + 1).padStart(2, "0") +
            String(date.getDate()).padStart(2, "0");
    }

    function displayDate(value) {
        var date = text(value).replace(/[^0-9]/g, "").slice(0, 8);

        return /^\d{8}$/.test(date)
            ? date.slice(6, 8) + "/" +
              date.slice(4, 6) + "/" +
              date.slice(0, 4)
            : "—";
    }

    function decisionState(value) {
        var decision = text(value).toUpperCase();

        if (/APROB|ACEPT|APPROV|^A$/.test(decision)) {
            return "approved";
        }

        if (/RECHAZ|REJECT|^R$/.test(decision)) {
            return "rejected";
        }

        return "pending";
    }

    function timeValue(value) {
        var raw = text(value);
        var match;

        if (!raw) {
            return "—";
        }

        match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw);

        if (match) {
            return match[1].padStart(2, "0") + ":" + match[2];
        }

        match = /^PT(\d+)H(\d+)M/.exec(raw);

        if (match) {
            return match[1].padStart(2, "0") +
                ":" + match[2].padStart(2, "0");
        }

        return "—";
    }

    return BaseController.extend(
        "com.mitsu.monitorasistencia.controller.Justifications",
        {
            onInit: function () {
                this._api = new AttendanceApi();
                this._requestSequence = 0;
                this._decisionInProgress = false;
                this._clockTimer = null;

                this.setModel(new JSONModel({
                    type: "late",
                    title: "Revisión de retardos",
                    subtitle: "",
                    periodLabel: "",

                    dateFrom: "",
                    dateTo: "",

                    clockDate: "",
                    clockTime: "",
                    clockSeconds: "",
                    clockDay: "",
                    clockZone: "Hora local",

                    busy: false,
                    error: "",
                    hasError: false,
                    loadingText: "Preparando consulta...",
                    lastRefreshText: "Pendiente de consulta",

                    count: 0,
                    pendingCount: 0,
                    resolvedCount: 0,
                    approvedCount: 0,
                    rejectedCount: 0,
                    visibleCount: 0,

                    search: "",
                    hasUnsavedComments: false,
                    rows: [],
                    filteredRows: []
                }), "review");

                this.getRouter()
                    .getRoute("lateJustifications")
                    .attachPatternMatched(
                        this._onRouteMatched,
                        this
                    );

                this.getRouter()
                    .getRoute("earlyExitJustifications")
                    .attachPatternMatched(
                        this._onRouteMatched,
                        this
                    );

                this._startClock();
            },

            onExit: function () {
                if (this._clockTimer !== null) {
                    clearInterval(this._clockTimer);
                    this._clockTimer = null;
                }

                this._requestSequence += 1;
            },

            // ======================================
            // RELOJ
            // ======================================

            _startClock: function () {
                this._updateClock();

                this._clockTimer = setInterval(
                    this._updateClock.bind(this),
                    1000
                );
            },

            _updateClock: function () {
                var now = new Date();
                var model = this.getModel("review");

                if (!model) {
                    return;
                }

                var day = now.toLocaleDateString("es-MX", {
                    weekday: "long"
                });

                var date = now.toLocaleDateString("es-MX", {
                    day: "2-digit",
                    month: "long",
                    year: "numeric"
                });

                var hours = now.toLocaleTimeString("es-MX", {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false
                });

                model.setProperty(
                    "/clockDay",
                    day.charAt(0).toUpperCase() + day.slice(1)
                );

                model.setProperty("/clockDate", date);
                model.setProperty("/clockTime", hours);
                model.setProperty(
                    "/clockSeconds",
                    String(now.getSeconds()).padStart(2, "0")
                );

                model.setProperty(
                    "/clockZone",
                    Intl.DateTimeFormat()
                        .resolvedOptions().timeZone || "Hora local"
                );
            },

            // ======================================
            // ENTRADA A LA PANTALLA
            // ======================================

            _onRouteMatched: function (event) {
                var type = event.getParameter("name") ===
                    "earlyExitJustifications"
                    ? "early"
                    : "late";

                console.info(
                    "[JUSTIFICATIONS][ROUTE]",
                    "Entrando a la pantalla:",
                    type
                );

                // Consulta directa al entrar.
                // No esperar attendance.dataLoaded().
                this._loadRows(type, false)
                    .catch(function (error) {
                        console.error(
                            "[JUSTIFICATIONS][ROUTE][ERROR]",
                            error
                        );
                    });
            },

            _resolvePeriod: function () {
                var attendance = this.getModel("attendance");

                var context = attendance
                    ? attendance.getProperty("/justificationContext") || {}
                    : {};

                var from = periodHelper.parseDate(context.start);
                var to = periodHelper.parseDate(context.end);

                if (!from || !to) {
                    to = new Date();

                    from = new Date(
                        to.getFullYear(),
                        to.getMonth(),
                        1
                    );
                }

                return {
                    from: dateKey(from),
                    to: dateKey(to),
                    label: context.label ||
                        displayDate(dateKey(from)) +
                        " – " +
                        displayDate(dateKey(to))
                };
            },

            _setPage: function (type, period) {
                var model = this.getModel("review");

                model.setProperty("/type", type);

                model.setProperty(
                    "/title",
                    type === "late"
                        ? "Revisión de retardos"
                        : "Revisión de salidas anticipadas"
                );

                model.setProperty(
                    "/subtitle",
                    type === "late"
                        ? "Consulta y gestión de justificaciones por llegadas tardías."
                        : "Consulta y gestión de justificaciones por salidas anticipadas."
                );

                model.setProperty("/periodLabel", period.label);
                model.setProperty("/dateFrom", period.from);
                model.setProperty("/dateTo", period.to);
            },

            // ======================================
            // CONSULTA ODATA
            // ======================================

            _loadRows: function (type, keepSearch) {
                var model = this.getModel("review");
                var period = this._resolvePeriod();

                var sequence = ++this._requestSequence;

                var search = keepSearch
                    ? text(model.getProperty("/search"))
                    : "";

                this._setPage(type, period);

                model.setProperty("/busy", true);
                model.setProperty("/error", "");
                model.setProperty("/hasError", false);
                model.setProperty(
                    "/loadingText",
                    "Consultando justificaciones desde SAP..."
                );

                console.info(
                    "[JUSTIFICATIONS][ODATA][START]",
                    {
                        entitySet: "ProcessingJustificationsSet",
                        type: type,
                        from: period.from,
                        to: period.to,
                        sequence: sequence
                    }
                );

                return this._api.getProcessingJustifications(
                    period.from,
                    period.to
                ).then(function (odataRows) {

                    if (sequence !== this._requestSequence) {
                        return null;
                    }

                    if (!Array.isArray(odataRows)) {
                        throw new Error(
                            "SAP no devolvió una colección de registros válida."
                        );
                    }

                    var attendance = this.getModel("attendance");

                    var employees = attendance
                        ? attendance.getProperty("/employees") || []
                        : [];

                    var centers = attendance
                        ? attendance.getProperty("/centers") || []
                        : [];

                    var employeesByNumber = {};
                    var centersByCode = {};

                    employees.forEach(function (employee) {
                        employeesByNumber[
                            numberKey(
                                employee.number ||
                                employee.employeeNumber ||
                                employee.PersonnelNumber
                            )
                        ] = employee;
                    });

                    centers.forEach(function (center) {
                        centersByCode[
                            text(center.code).toUpperCase()
                        ] = center;
                    });

                    var registerType = type === "late"
                        ? "P10"
                        : "P20";

                    var mapped = odataRows
                        .filter(function (row) {
                            return text(row.TypeRegister)
                                .toUpperCase() === registerType;
                        })
                        .map(function (row, index) {
                            var number = text(row.PersonalNumber);

                            var employee =
                                employeesByNumber[numberKey(number)] || {};

                            var centerCode = text(row.CenterOffice);

                            var center =
                                centersByCode[
                                    centerCode.toUpperCase()
                                ] || {};

                            var decision = decisionState(
                                row.DecisionRH
                            );

                            var justification =
                                text(row.DescriptionStatus) ||
                                text(row.ReasonType) ||
                                text(row.IncidentType) ||
                                text(row.JustificationStatus);

                            var comment = text(row.CommentsRH);

                            // Mostrar hora sólo si hay un campo
                            // confiable en la respuesta OData.
                            var eventTime = timeValue(
                                type === "late"
                                    ? row.EnterHour || row.P10Time
                                    : row.ExitHour || row.P20Time
                            );

                            return {
                                id: number + "-" +
                                    text(row.DateJustification) +
                                    "-" + registerType + "-" + index,

                                employeeId:
                                    employee.id ||
                                    (number ? "employee-" + number : ""),

                                employee:
                                    text(row.FullName) ||
                                    text(employee.name) ||
                                    number ||
                                    "Sin nombre",

                                personalNumber: number,
                                date: displayDate(
                                    row.DateJustification
                                ),

                                center:
                                    text(center.name) ||
                                    centerCode ||
                                    "Sin centro",

                                schedule:
                                    text(employee.shift) ||
                                    text(employee.schedule) ||
                                    text(employee.scheduleName) ||
                                    "—",

                                eventTime: eventTime,

                                justification:
                                    justification ||
                                    "Sin justificación registrada",

                                hasJustification:
                                    Boolean(justification),

                                commentsRH: comment,
                                originalCommentsRH: comment,

                                decision: decision,

                                approvalText:
                                    decision === "approved"
                                        ? "Aprobada"
                                        : decision === "rejected"
                                            ? "Rechazada"
                                            : "Pendiente",

                                approvalState:
                                    decision === "approved"
                                        ? "Success"
                                        : decision === "rejected"
                                            ? "Error"
                                            : "Warning",

                                raw: row
                            };
                        });

                    model.setProperty("/rows", mapped);
                    model.setProperty("/search", search);
                    model.setProperty("/hasUnsavedComments", false);

                    this._updateCounts();
                    this._applySearch();

                    var updatedAt = new Date().toLocaleTimeString(
                        "es-MX",
                        {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit"
                        }
                    );

                    model.setProperty(
                        "/lastRefreshText",
                        "Última consulta: " + updatedAt
                    );

                    console.info(
                        "[JUSTIFICATIONS][ODATA][OK]",
                        {
                            received: odataRows.length,
                            matched: mapped.length,
                            registerType: registerType,
                            period: period
                        }
                    );

                    return mapped;
                }.bind(this)).catch(function (error) {
                    if (sequence !== this._requestSequence) {
                        return null;
                    }

                    var message =
                        error && error.message
                            ? error.message
                            : String(error);

                    model.setProperty("/error", message);
                    model.setProperty("/hasError", true);

                    console.error(
                        "[JUSTIFICATIONS][ODATA][ERROR]",
                        error
                    );

                    // Conserva los datos de la última
                    // consulta exitosa, si los hay.
                    MessageBox.error(
                        "No fue posible obtener las justificaciones de SAP.",
                        {
                            details: [
                                message,
                                error && error.responseBody
                            ].filter(Boolean).join("\n\n")
                        }
                    );

                    throw error;
                }.bind(this)).finally(function () {
                    if (sequence === this._requestSequence) {
                        model.setProperty("/busy", false);
                    }
                }.bind(this));
            },

            // ======================================
            // INDICADORES
            // ======================================

            _updateCounts: function () {
                var model = this.getModel("review");
                var rows = model.getProperty("/rows") || [];

                var pending = 0;
                var approved = 0;
                var rejected = 0;

                rows.forEach(function (row) {
                    if (row.decision === "approved") {
                        approved += 1;
                    } else if (row.decision === "rejected") {
                        rejected += 1;
                    } else {
                        pending += 1;
                    }
                });

                model.setProperty("/count", rows.length);
                model.setProperty("/pendingCount", pending);
                model.setProperty("/approvedCount", approved);
                model.setProperty("/rejectedCount", rejected);
                model.setProperty(
                    "/resolvedCount",
                    approved + rejected
                );
            },

            // ======================================
            // BUSCADOR
            // ======================================

            _applySearch: function () {
                var model = this.getModel("review");

                var search = text(
                    model.getProperty("/search")
                ).toLowerCase();

                var rows = model.getProperty("/rows") || [];

                var filtered = rows.filter(function (row) {
                    if (!search) {
                        return true;
                    }

                    return [
                        row.employee,
                        row.personalNumber,
                        row.center,
                        row.schedule,
                        row.justification,
                        row.commentsRH,
                        row.approvalText,
                        row.date
                    ].some(function (value) {
                        return text(value)
                            .toLowerCase()
                            .indexOf(search) >= 0;
                    });
                });

                model.setProperty("/filteredRows", filtered);
                model.setProperty("/visibleCount", filtered.length);
            },

            onSearch: function (event) {
                var search =
                    event.getParameter("newValue") ||
                    event.getParameter("query") ||
                    "";

                this.getModel("review")
                    .setProperty("/search", search);

                this._applySearch();
            },

            onCommentChange: function () {
                var model = this.getModel("review");
                var rows = model.getProperty("/rows") || [];

                model.setProperty(
                    "/hasUnsavedComments",
                    rows.some(function (row) {
                        return text(row.commentsRH) !==
                            text(row.originalCommentsRH);
                    })
                );
            },

            // ======================================
            // BOTÓN ACTUALIZAR
            // ======================================

            onRefreshJustifications: function () {
                var model = this.getModel("review");

                if (
                    model.getProperty("/busy") ||
                    this._decisionInProgress
                ) {
                    MessageToast.show(
                        "Hay una consulta en proceso."
                    );
                    return;
                }

                if (model.getProperty("/hasUnsavedComments")) {
                    MessageBox.confirm(
                        "Hay comentarios RH sin enviar. " +
                        "Al actualizar se perderán los cambios. " +
                        "¿Deseas continuar?",
                        {
                            title: "Actualizar desde SAP",
                            emphasizedAction:
                                MessageBox.Action.OK,

                            onClose: function (action) {
                                if (action === MessageBox.Action.OK) {
                                    this._refreshDirectly();
                                }
                            }.bind(this)
                        }
                    );

                    return;
                }

                return this._refreshDirectly();
            },

            _refreshDirectly: function () {
                var model = this.getModel("review");
                var type = model.getProperty("/type") || "late";

                // Misma consulta que al navegar a la vista.
                return this._loadRows(type, true)
                    .then(function (rows) {
                        if (rows) {
                            MessageToast.show(
                                "Información actualizada desde SAP."
                            );
                        }
                    })
                    .catch(function (error) {
                        console.error(
                            "[JUSTIFICATIONS][REFRESH]",
                            error
                        );
                    });
            },

            // ======================================
            // APROBACIONES Y RECHAZOS
            // ======================================

            onApprove: function (event) {
                this._confirmDecision(
                    event.getSource()
                        .getBindingContext("review")
                        .getObject(),
                    "APROBADA"
                );
            },

            onReject: function (event) {
                this._confirmDecision(
                    event.getSource()
                        .getBindingContext("review")
                        .getObject(),
                    "RECHAZADA"
                );
            },

            _confirmDecision: function (row, decision) {
                var approving = decision === "APROBADA";

                if (
                    this._decisionInProgress ||
                    this.getModel("review").getProperty("/busy")
                ) {
                    MessageToast.show(
                        "Espera a que termine la operación."
                    );
                    return;
                }

                if (row.decision !== "pending") {
                    MessageToast.show(
                        "Esta justificación ya fue revisada."
                    );
                    return;
                }

                if (!row.hasJustification) {
                    MessageBox.warning(
                        "El empleado no tiene una justificación registrada."
                    );
                    return;
                }

                MessageBox.confirm(
                    "¿Deseas " +
                    (approving ? "aceptar" : "rechazar") +
                    " la justificación de " + row.employee + "?",
                    {
                        title: approving
                            ? "Aceptar justificación"
                            : "Rechazar justificación",

                        emphasizedAction:
                            MessageBox.Action.OK,

                        onClose: function (action) {
                            if (action === MessageBox.Action.OK) {
                                this._submitDecision(row, decision);
                            }
                        }.bind(this)
                    }
                );
            },

            _submitDecision: function (row, decision) {
                var raw = row.raw || {};
                var model = this.getModel("review");

                var payload = {
                    PersonalNumber: text(raw.PersonalNumber),
                    FullName: text(raw.FullName),
                    CenterOffice: text(raw.CenterOffice),
                    Zone: text(raw.Zone),
                    Base: text(raw.Base),
                    DateJustification:
                        text(raw.DateJustification),
                    TypeRegister: text(raw.TypeRegister),
                    TypeRegisterDescrip:
                        text(raw.TypeRegisterDescrip),
                    IncidentType: text(raw.IncidentType),
                    ReasonType: text(raw.ReasonType),
                    JustificationStatus:
                        text(raw.JustificationStatus),
                    DescriptionStatus:
                        text(raw.DescriptionStatus),
                    Email: text(raw.Email),
                    DecisionRH: decision,
                    CommentsRH:
                        text(row.commentsRH) ||
                        text(raw.CommentsRH)
                };

                this._decisionInProgress = true;
                model.setProperty("/busy", true);

                return this._api
                    .submitJustificationDecision(payload)
                    .then(function () {
                        MessageToast.show(
                            decision === "APROBADA"
                                ? "Justificación aprobada"
                                : "Justificación rechazada"
                        );

                        return this._loadRows(
                            model.getProperty("/type"),
                            true
                        );
                    }.bind(this))
                    .catch(function (error) {
                        MessageBox.error(
                            "SAP no pudo guardar la decisión. " +
                            (error.message || String(error))
                        );
                    })
                    .finally(function () {
                        this._decisionInProgress = false;
                        model.setProperty("/busy", false);
                    }.bind(this));
            },

            // ======================================
            // NAVEGACIÓN
            // ======================================

            onEmployeePress: function (event) {
                var row = event.getSource()
                    .getBindingContext("review")
                    .getObject();

                if (row.employeeId) {
                    this.navTo("userPerformance", {
                        employeeId: row.employeeId
                    });
                }
            },

            onBack: function () {
                this.navTo("overview");
            }
        }
    );
});
