sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "com/mitsu/monitorasistencia/model/periodHelper",
    "sap/ui/model/json/JSONModel",
    "sap/m/ResponsivePopover", "sap/m/Button", "sap/m/VBox", "sap/m/HBox", "sap/m/Text",
    "sap/m/Select", "sap/ui/core/Item", "sap/m/MessageToast", "sap/m/Title"
], function (BaseController, periodHelper, JSONModel, ResponsivePopover, Button, VBox, HBox,
    Text, Select, Item, MessageToast, Title) {
    "use strict";

    var ZONES = ["Centro", "Norte", "Sur", "Este", "Oeste"];
    var MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
        "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

    function value(v) { return Number(v || 0) || 0; }
    function pad(n) { return String(n).padStart(2, "0"); }
    function key(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
    function human(d) { return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear(); }
    function slug(s) { return String(s || "").replace(/^Zona\s+/i, "").normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
    function nameOfZone(s) {
        var id = slug(s);
        return ZONES.find(function (z) { return slug(z) === id; }) || null;
    }
    function emptyZone(label) {
        return { zoneId: slug(label), zone: label, name: "Zona " + label,
            centers: 0, users: 0, meta: "0 centros con registros · 0 jornadas",
            total: 0, present: 0, late: 0, absent: 0, outside: 0,
            attendance: "0.0", inefficiency: "0.0", lateRate: 0, absentRate: 0,
            incidentSummary: "0 retardos · 0 ausencias · 0 fuera de zona",
            inefficiencyText: "0.0% ineficiencia", riskText: "Sin datos", state: "None" };
    }
    function datesFor(type, d) {
        var s, e;
        if (type === "year") { s = new Date(d.getFullYear(), 0, 1); e = new Date(d.getFullYear(), 11, 31); }
        else if (type === "month") { s = new Date(d.getFullYear(), d.getMonth(), 1);
            e = new Date(d.getFullYear(), d.getMonth() + 1, 0); }
        else { s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
            e = new Date(s); e.setDate(e.getDate() + 6); }
        return { start: s, end: e };
    }

    return BaseController.extend("com.mitsu.monitorasistencia.controller.Overview", {
        onInit: function () {
            var today = new Date();
            this.setModel(new JSONModel({
                granularity: "week", referenceDate: key(today), selectionLabel: "",
                periodLabel: "", loading: false, zoneSummaries: [], zoneInefficiency: [],
                incidentTrend: [], lateCount: 0, earlyExitCount: "—",
                earlyExitNote: "Campo SAP pendiente de confirmar"
            }), "view");
            this._setPeriod();
            this.getRouter().getRoute("overview").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            var m = this.getModel("attendance");
            if (m && m.dataLoaded) {
                m.dataLoaded().then(function () { this._renderFromLoadedModel(); }.bind(this));
            } else { this._renderFromLoadedModel(); }
        },

        _setPeriod: function () {
            var m = this.getModel("view");
            var type = m.getProperty("/granularity");
            var d = periodHelper.parseDate(m.getProperty("/referenceDate")) || new Date();
            var p = datesFor(type, d);
            var label = type === "year" ? String(d.getFullYear()) :
                type === "month" ? MONTHS[d.getMonth()] + " " + d.getFullYear() :
                    human(p.start) + " – " + human(p.end);
            m.setProperty("/selectionLabel", label);
            m.setProperty("/periodLabel", human(p.start) + " – " + human(p.end));
            return p;
        },

        onPeriodChange: function () { this._setPeriod(); },

        /**
         * Calendario emergente anclado al campo de Fecha de referencia.
         * Semana: selecciona la fila semanal (lunes-domingo).
         * Mes: cuadrícula de 12 meses. Año: cuadrícula de años.
         * No consulta SAP hasta pulsar "Aplicar filtros" en la barra principal.
         */
        onOpenPeriodPicker: function (oEvent) {
            var that = this;
            var model = this.getModel("view");
            var mode = model.getProperty("/granularity");
            var current = periodHelper.parseDate(model.getProperty("/referenceDate")) || new Date();
            var selected = new Date(current.getFullYear(), current.getMonth(), current.getDate());
            var visibleYear = current.getFullYear();
            var visibleMonth = current.getMonth();

            var content = new VBox({ width: "100%" }).addStyleClass("monitorPeriodPopupBody");
            var popover = new ResponsivePopover({
                placement: "Bottom",
                showHeader: false,
                contentWidth: mode === "week" ? "25rem" : "21rem",
                content: [content],
                afterClose: function () { popover.destroy(); }
            }).addStyleClass("monitorPeriodPopover");
            this.getView().addDependent(popover);

            function dayButton(d, inMonth, sameWeek) {
                var b = new Button({
                    text: String(d.getDate()),
                    type: "Transparent",
                    width: "2.65rem",
                    tooltip: human(d),
                    press: function () {
                        selected = new Date(d.getFullYear(), d.getMonth(), d.getDate());
                        visibleYear = selected.getFullYear();
                        visibleMonth = selected.getMonth();
                        render();
                    }
                }).addStyleClass("monitorCalendarDay");
                if (!inMonth) b.addStyleClass("monitorCalendarDayOutside");
                if (sameWeek) b.addStyleClass("monitorCalendarWeekSelected");
                return b;
            }

            function header(title, previous, next) {
                return new HBox({
                    alignItems: "Center",
                    justifyContent: "SpaceBetween",
                    items: [
                        new Button({ icon: "sap-icon://navigation-left-arrow", type: "Transparent",
                            press: previous }),
                        new Title({ text: title, level: "H5" }),
                        new Button({ icon: "sap-icon://navigation-right-arrow", type: "Transparent",
                            press: next })
                    ]
                }).addStyleClass("monitorCalendarHeader");
            }

            function renderWeek() {
                var prev = function () {
                    var d = new Date(visibleYear, visibleMonth - 1, 1);
                    visibleYear = d.getFullYear(); visibleMonth = d.getMonth(); render();
                };
                var next = function () {
                    var d = new Date(visibleYear, visibleMonth + 1, 1);
                    visibleYear = d.getFullYear(); visibleMonth = d.getMonth(); render();
                };
                content.addItem(header(MONTHS[visibleMonth] + " " + visibleYear, prev, next));
                var headings = new HBox({ justifyContent: "SpaceBetween", width: "100%" })
                    .addStyleClass("monitorCalendarWeekdays");
                ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].forEach(function (name) {
                    headings.addItem(new Text({ text: name, width: "2.65rem", textAlign: "Center" }));
                });
                content.addItem(headings);

                var first = new Date(visibleYear, visibleMonth, 1);
                first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
                var last = new Date(visibleYear, visibleMonth + 1, 0);
                var selectedStart = datesFor("week", selected).start;
                for (var rowStart = new Date(first); rowStart <= last; rowStart.setDate(rowStart.getDate() + 7)) {
                    var row = new HBox({ justifyContent: "SpaceBetween", width: "100%" })
                        .addStyleClass("monitorCalendarWeekRow");
                    if (rowStart.getTime() === selectedStart.getTime()) {
                        row.addStyleClass("monitorCalendarSelectedRow");
                    }
                    for (var i = 0; i < 7; i++) {
                        var d = new Date(rowStart.getFullYear(), rowStart.getMonth(), rowStart.getDate() + i);
                        row.addItem(dayButton(d, d.getMonth() === visibleMonth,
                            rowStart.getTime() === selectedStart.getTime()));
                    }
                    content.addItem(row);
                }
            }

            function renderMonth() {
                content.addItem(header(String(visibleYear),
                    function () { visibleYear--; render(); },
                    function () { visibleYear++; render(); }));
                for (var row = 0; row < 4; row++) {
                    var line = new HBox({ justifyContent: "SpaceBetween" })
                        .addStyleClass("monitorCalendarChoiceRow");
                    for (var col = 0; col < 3; col++) {
                        (function (index) {
                            var button = new Button({
                                text: MONTHS[index], width: "6.15rem",
                                type: "Transparent",
                                press: function () {
                                    selected = new Date(visibleYear, index, 1);
                                    visibleMonth = index; render();
                                }
                            }).addStyleClass("monitorCalendarChoice");
                            if (selected.getFullYear() === visibleYear && selected.getMonth() === index) {
                                button.addStyleClass("monitorCalendarChoiceSelected");
                            }
                            line.addItem(button);
                        }(row * 3 + col));
                    }
                    content.addItem(line);
                }
            }

            function renderYear() {
                var pageStart = Math.floor(visibleYear / 12) * 12;
                content.addItem(header(pageStart + " – " + (pageStart + 11),
                    function () { visibleYear -= 12; render(); },
                    function () { visibleYear += 12; render(); }));
                for (var row = 0; row < 4; row++) {
                    var line = new HBox({ justifyContent: "SpaceBetween" })
                        .addStyleClass("monitorCalendarChoiceRow");
                    for (var col = 0; col < 3; col++) {
                        (function (year) {
                            var button = new Button({
                                text: String(year), width: "6.15rem",
                                type: "Transparent",
                                press: function () { selected = new Date(year, 0, 1); render(); }
                            }).addStyleClass("monitorCalendarChoice");
                            if (selected.getFullYear() === year) {
                                button.addStyleClass("monitorCalendarChoiceSelected");
                            }
                            line.addItem(button);
                        }(pageStart + row * 3 + col));
                    }
                    content.addItem(line);
                }
            }

            function render() {
                content.removeAllItems().forEach(function (item) { item.destroy(); });
                if (mode === "week") renderWeek();
                else if (mode === "month") renderMonth();
                else renderYear();
                content.addItem(new HBox({
                    justifyContent: "End",
                    items: [
                        new Button({ text: "Cancelar", type: "Transparent",
                            press: function () { popover.close(); } }),
                        new Button({ text: "Aplicar", type: "Emphasized",
                            press: function () {
                                model.setProperty("/referenceDate", key(selected));
                                that._setPeriod();
                                popover.close();
                            } })
                    ]
                }).addStyleClass("monitorCalendarActions"));
            }

            render();
            popover.openBy(oEvent.getSource());
        },

        _renderFromLoadedModel: function () {
            var attendance = this.getModel("attendance"), m = this.getModel("view");
            if (!attendance) return;
            var sapOverview = attendance.getProperty("/sapOverview") || {};
            var raw = sapOverview.zoneSummaries || [];
            var zones = ZONES.map(function (label) {
                var found = raw.find(function (row) { return nameOfZone(row.name || row.zone) === label; });
                return found ? Object.assign(emptyZone(label), found, {
                    zoneId: slug(label), zone: label, name: "Zona " + label
                }) : emptyZone(label);
            });
            m.setProperty("/zoneSummaries", zones);
            m.setProperty("/zoneInefficiency", zones.map(function (z) {
                return { zoneId: z.zoneId, zone: z.zone,
                    lateRate: value(z.lateRate), absentRate: value(z.absentRate) };
            }));
            var trend = (sapOverview.incidentTrend || []).map(function (row) {
                return { day: row.day, late: value(row.late), absent: value(row.absent),
                    outsideZone: value(row.outsideZone), earlyExit: row.earlyExit == null ? null : value(row.earlyExit) };
            });
            m.setProperty("/incidentTrend", trend);
            var counters = sapOverview.incidentCounters || {};
            m.setProperty("/lateCount", counters.late != null ? counters.late : zones.reduce(function (sum, z) { return sum + value(z.late); }, 0));
            m.setProperty("/earlyExitCount", counters.earlyExit == null ? "—" : counters.earlyExit);
            m.setProperty("/earlyExitNote", counters.earlyExit == null ? "Campo SAP pendiente de confirmar" : "Total del periodo");
            this._configureCharts();
        },

        _configureCharts: function () {
            var first = this.byId("inefficiencyChart"), trend = this.byId("incidentTrendChart");
            if (first) first.setVizProperties({ title: { visible: false },
                legend: { visible: true, position: "right" },
                plotArea: { dataLabel: { visible: true }, colorPalette: ["#C00000", "#E9730C"] },
                valueAxis: { title: { visible: false } }, categoryAxis: { title: { visible: false } } });
            if (trend) trend.setVizProperties({ title: { visible: false },
                legend: { visible: true, position: "right" },
                plotArea: { marker: { visible: true }, dataLabel: { visible: true },
                    colorPalette: ["#E9730C", "#C00000", "#7858D7", "#0A6ED1"] },
                valueAxis: { title: { visible: false } }, categoryAxis: { title: { visible: false } } });
        },

        onZonePress: function (event) {
            this.navTo("centers", { zoneId: event.getSource().data("zoneId") });
        },
        onZoneChartSelect: function (event) {
            var selected = event.getParameter("data") || [];
            var zone = selected[0] && selected[0].data && selected[0].data.Zona;
            if (zone) this.navTo("centers", { zoneId: slug(zone) });
        },

        onApplyFilters: function () {
            var range = this._setPeriod();
            var type = this.getModel("view").getProperty("/granularity");
            var periodType = type === "year" ? "AÑO" : type === "month" ? "MES" : "SEMANA";
            var m = this.getModel("view"), component = this.getOwnerComponent();
            // Component.js de la rama actual usa SEMANA 43 fijo. No indicar éxito si todavía no se habilita consulta por periodo.
            m.setProperty("/loading", true);
            if (!component.reloadAttendanceData) {
                m.setProperty("/loading", false);
                MessageToast.show("No se encontró el método de actualización del Monitor.");
                return;
            }
            Promise.resolve(component.reloadAttendanceData(periodType, key(range.start))).then(function () {
                this._renderFromLoadedModel();
                var errors = (this.getModel("attendance").getProperty("/serviceState/errors") || []);
                MessageToast.show(errors.length ? "Consulta con errores: revisa el servicio SAP." :
                    "Periodo solicitado: " + human(range.start) + " a " + human(range.end));
            }.bind(this)).catch(function () {
                MessageToast.show("No fue posible consultar el periodo en SAP.");
            }).finally(function () { m.setProperty("/loading", false); });
        }
    });
});
