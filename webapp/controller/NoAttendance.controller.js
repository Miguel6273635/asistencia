sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "com/mitsu/monitorasistencia/model/periodHelper",
    "com/mitsu/monitorasistencia/model/noAttendanceHelper",
    "com/mitsu/monitorasistencia/model/AttendanceApi",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], function (
    BaseController,
    periodHelper,
    noAttendanceHelper,
    AttendanceApi,
    JSONModel,
    MessageBox,
    MessageToast
) {
    "use strict";

    function compactDate(date) {
        return periodHelper.toKey(date).replace(/[^0-9]/g, "");
    }

    function displayDate(value) {
        var date = String(value || "").replace(/[^0-9]/g, "").slice(0, 8);
        return /^\d{8}$/.test(date)
            ? date.slice(6, 8) + "/" + date.slice(4, 6) + "/" + date.slice(0, 4)
            : "—";
    }

    return BaseController.extend(
        "com.mitsu.monitorasistencia.controller.NoAttendance",
        {
            onInit: function () {
                this._attendanceApi = new AttendanceApi();
                this.setModel(new JSONModel({
                    busy: false,
                    error: "",
                    periodLabel: "",
                    dateFrom: "",
                    dateTo: "",
                    employeeTotal: 0,
                    withAttendanceCount: 0,
                    noAttendanceCount: 0,
                    search: "",
                    rows: [],
                    filteredRows: []
                }), "noAttendance");

                this.getRouter()
                    .getRoute("noAttendance")
                    .attachPatternMatched(this._onRouteMatched, this);
            },

            _onRouteMatched: function () {
                this._loadRows();
            },

            _resolvePeriod: function () {
                var context = this.getModel("attendance")
                    .getProperty("/noAttendanceContext") || {};

                if (!context.start || !context.end) {
                    try {
                        context = JSON.parse(
                            window.sessionStorage.getItem(
                                "monitor.noAttendanceContext"
                            ) || "{}"
                        ) || {};
                    } catch (storageError) {
                        console.warn(
                            "[Monitor][NO-ATTENDANCE][CONTEXT][READ]",
                            storageError
                        );
                        context = {};
                    }
                }

                var end = periodHelper.parseDate(context.end) || new Date();
                var start = periodHelper.parseDate(context.start) ||
                    new Date(end.getFullYear(), end.getMonth(), end.getDate());

                return {
                    from: compactDate(start),
                    to: compactDate(end),
                    label: context.label ||
                        displayDate(compactDate(start)) + " – " +
                        displayDate(compactDate(end))
                };
            },

            _loadRows: function () {
                var model = this.getModel("noAttendance");
                var period = this._resolvePeriod();
                var filters = [
                    { field: "DateFrom", value: period.from },
                    { field: "DateTo", value: period.to }
                ];

                model.setProperty("/busy", true);
                model.setProperty("/error", "");
                model.setProperty("/periodLabel", period.label);
                model.setProperty("/dateFrom", period.from);
                model.setProperty("/dateTo", period.to);

                return Promise.all([
                    this._attendanceApi.getEmployees(),
                    this._attendanceApi.getAttendanceHistory(filters)
                ]).then(function (results) {
                    var employees = results[0] || [];
                    var historyRows = results[1] || [];
                    var rows = noAttendanceHelper.buildRows(
                        employees,
                        historyRows
                    );

                    model.setProperty("/employeeTotal", employees.length);
                    model.setProperty(
                        "/withAttendanceCount",
                        employees.length - rows.length
                    );
                    model.setProperty("/noAttendanceCount", rows.length);
                    model.setProperty("/rows", rows);
                    model.setProperty("/filteredRows", rows);
                    model.setProperty("/search", "");

                    console.info("[Monitor][NO-ATTENDANCE][RESULT]", {
                        dateFrom: period.from,
                        dateTo: period.to,
                        employees: employees.length,
                        historyRows: historyRows.length,
                        withoutAttendance: rows.length
                    });
                }).catch(function (error) {
                    var message = error && error.message
                        ? error.message
                        : String(error);
                    model.setProperty("/error", message);
                    model.setProperty("/rows", []);
                    model.setProperty("/filteredRows", []);
                    model.setProperty("/employeeTotal", 0);
                    model.setProperty("/withAttendanceCount", 0);
                    model.setProperty("/noAttendanceCount", 0);
                    MessageBox.error(
                        "No fue posible calcular las inasistencias. " + message
                    );
                }).finally(function () {
                    model.setProperty("/busy", false);
                });
            },

            onSearch: function (event) {
                var query = String(
                    event.getParameter("newValue") ||
                    event.getParameter("query") || ""
                ).trim().toLowerCase();
                var model = this.getModel("noAttendance");
                var rows = model.getProperty("/rows") || [];

                model.setProperty(
                    "/filteredRows",
                    !query ? rows : rows.filter(function (row) {
                        return [
                            row.name,
                            row.personalNumber,
                            row.email,
                            row.center,
                            row.centerCode,
                            row.zone,
                            row.schedule,
                            row.position
                        ].some(function (value) {
                            return String(value || "")
                                .toLowerCase()
                                .indexOf(query) >= 0;
                        });
                    })
                );
            },

            onRefresh: function () {
                MessageToast.show("Actualizando empleados e historial desde SAP");
                return this._loadRows();
            },

            onBack: function () {
                this.navTo("overview");
            }
        }
    );
});
