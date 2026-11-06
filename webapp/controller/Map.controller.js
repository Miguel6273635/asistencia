
sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "com/mitsu/monitorasistencia/model/AttendanceApi",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (
    BaseController,
    AttendanceApi,
    JSONModel,
    MessageToast,
    MessageBox
) {
    "use strict";

    var MAP_CONFIGURATION = {
        MapProvider: [{
            name: "OpenStreetMap",
            type: "",
            description: "OpenStreetMap",
            tileX: "256",
            tileY: "256",
            minLOD: "1",
            maxLOD: "19",
            copyright: "© OpenStreetMap contributors",
            Source: [{
                id: "osm",
                url: "https://tile.openstreetmap.org/{LOD}/{X}/{Y}.png"
            }]
        }],
        MapLayerStacks: [{
            name: "MONITOR_MAP",
            MapLayer: [{
                name: "OpenStreetMap",
                refMapProvider: "OpenStreetMap",
                opacity: "1",
                colBkgndRGB: "245,246,247"
            }]
        }]
    };

    function clean(value) {
        return value === null || value === undefined
            ? ""
            : String(value).trim();
    }

    function pad(value) {
        return String(value).padStart(2, "0");
    }

    function todayISO() {
        var date = new Date();

        return date.getFullYear() + "-" +
            pad(date.getMonth() + 1) + "-" +
            pad(date.getDate());
    }

    function compactDate(value) {
        return clean(value).replace(/[^0-9]/g, "").slice(0, 8);
    }

    function displayDate(value) {
        var date = compactDate(value);

        if (!/^\d{8}$/.test(date)) {
            return "";
        }

        return date.slice(6, 8) + "/" +
            date.slice(4, 6) + "/" +
            date.slice(0, 4);
    }

    function validISO(value) {
        var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(
            clean(value)
        );

        if (!match) {
            return false;
        }

        var year = Number(match[1]);
        var month = Number(match[2]);
        var day = Number(match[3]);
        var date = new Date(year, month - 1, day);

        return date.getFullYear() === year &&
            date.getMonth() === month - 1 &&
            date.getDate() === day;
    }

    function normalizeNumber(value) {
        var number = clean(value);

        return number.replace(/^0+(?=\d)/, "");
    }

    function zoneId(value) {
        var zone = clean(value)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toUpperCase()
            .replace(/^ZONA\s+/, "");

        var zones = {
            CENTRO: "centro",
            NORTE: "norte",
            SUR: "sur",
            ESTE: "este",
            OESTE: "oeste",
            ZC: "centro",
            ZN: "norte",
            ZS: "sur",
            ZE: "este",
            ZO: "oeste"
        };

        return zones[zone] || "sin-zona";
    }

    function coordinate(value, isLongitude) {
        var source = clean(value);

        if (!source) {
            return null;
        }

        var trailingNegative = /-$/.test(source);
        var parsed = Number(source.replace(/-$/, ""));

        if (!Number.isFinite(parsed)) {
            return null;
        }

        if (trailingNegative) {
            parsed = -Math.abs(parsed);
        } else if (isLongitude && parsed > 0) {
            parsed = -parsed;
        }

        if (
            parsed < (isLongitude ? -180 : -90) ||
            parsed > (isLongitude ? 180 : 90)
        ) {
            return null;
        }

        return parsed;
    }

    function normalizeTime(value) {
        var source = clean(value);

        var duration = /^PT(\d+)H(\d+)M(?:([\d.]+)S)?$/.exec(source);

        if (duration) {
            return pad(duration[1]) + ":" + pad(duration[2]);
        }

        var time = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(source);

        if (time) {
            return pad(time[1]) + ":" + time[2];
        }

        if (/^\d{6}$/.test(source)) {
            return source.slice(0, 2) + ":" +
                source.slice(2, 4);
        }

        if (/^\d{4}$/.test(source)) {
            return source.slice(0, 2) + ":" +
                source.slice(2, 4);
        }

        return "";
    }

    function lastCheckFromHistory(rows) {
        var latest = {};

        rows.forEach(function (row) {
            var number = normalizeNumber(row.PersonalNumber);
            var date = compactDate(row.WorkDate);

            if (!number || !/^\d{8}$/.test(date)) {
                return;
            }

            [
                { field: "P10Time", label: "Entrada" },
                { field: "P11Time", label: "Marcaje P11" },
                { field: "P15Time", label: "Salida a comida" },
                { field: "P25Time", label: "Regreso de comida" },
                { field: "P20Time", label: "Salida" }
            ].forEach(function (event) {
                var time = normalizeTime(row[event.field]);

                if (!time || time === "00:00") {
                    return;
                }

                var key = date + time.replace(":", "");

                if (!latest[number] || key > latest[number].key) {
                    latest[number] = {
                        key: key,
                        date: date,
                        time: time,
                        label: event.label,
                        text: displayDate(date) + " " + time
                    };
                }
            });
        });

        return latest;
    }

    return BaseController.extend(
        "com.mitsu.monitorasistencia.controller.Map",
        {
            onInit: function () {
                var date = todayISO();

                this._api = new AttendanceApi();
                this._loadSequence = 0;
                this._locationRows = [];
                this._historyRows = [];
                this._personnel = [];
                this._centers = [];
                this._zones = [];

                this.setModel(new JSONModel({
                    mode: "general",
                    title: "Mapa general de ubicaciones",
                    subtitle: "Ubicación y último marcaje del personal",
                    currentLocationText: "Mapa general",
                    currentZoneId: "all",
                    focusedEmployeeId: "",
                    mapPanelTitle: "Cobertura por zona",
                    sidePanelTitle: "Personal recibido",
                    centerPosition: "-99.1700;19.4250",
                    zoomLevel: 9,
                    dateFrom: date,
                    dateTo: date,
                    appliedDateFrom: date,
                    appliedDateTo: date,
                    dateRangeText: "",
                    loading: false,
                    errorText: "",
                    hasError: false,
                    summaryText: "Consultando SAP...",
                    lastRefreshText: "Sin actualizar",
                    personnelTotal: 0,
                    withCoordinates: 0,
                    withoutCoordinates: 0,
                    withinZone: 0,
                    outsideZone: 0,
                    withoutZoneInfo: 0,
                    zoneOptions: [],
                    zoneSpots: [],
                    currentCenters: [],
                    currentPersonnel: [],
                    currentPersonnelSpots: [],
                    selectedPerson: {},
                    hasSelectedPerson: false,
                    mapConfiguration: MAP_CONFIGURATION
                }), "map");

                this.byId("geoMap")
                    .setMapConfiguration(MAP_CONFIGURATION);

                this.getRouter()
                    .getRoute("map")
                    .attachPatternMatched(
                        this._onGeneralRouteMatched,
                        this
                    );

                this.getRouter()
                    .getRoute("mapZone")
                    .attachPatternMatched(
                        this._onZoneRouteMatched,
                        this
                    );

                this.getRouter()
                    .getRoute("mapUser")
                    .attachPatternMatched(
                        this._onUserRouteMatched,
                        this
                    );
            },

            _onGeneralRouteMatched: function () {
                this._activateRoute("all", "");
            },

            _onZoneRouteMatched: function (event) {
                this._activateRoute(
                    event.getParameter("arguments").zoneId,
                    ""
                );
            },

            _onUserRouteMatched: function (event) {
                var args = event.getParameter("arguments");

                this._activateRoute(
                    args.zoneId,
                    args.employeeId
                );
            },

            _activateRoute: function (zone, employeeId) {
                var model = this.getModel("map");

                model.setProperty("/currentZoneId", zone);
                model.setProperty(
                    "/focusedEmployeeId",
                    employeeId || ""
                );

                this.getModel("attendance")
                    .dataLoaded()
                    .then(function () {
                        if (!this._hasLoadedLocations) {
                            return this._loadFilteredLocations();
                        }

                        this._renderMap();
                    }.bind(this));
            },

            onApplyDateFilter: function () {
                var model = this.getModel("map");
                var from = model.getProperty("/dateFrom");
                var to = model.getProperty("/dateTo");

                if (!validISO(from) || !validISO(to)) {
                    MessageBox.error(
                        "Selecciona dos fechas válidas en los calendarios."
                    );
                    return;
                }

                if (from > to) {
                    MessageBox.error(
                        "La fecha inicial no puede ser posterior a la fecha final."
                    );
                    return;
                }

                this._loadFilteredLocations();
            },

            _loadFilteredLocations: function () {
                var model = this.getModel("map");
                var from = model.getProperty("/dateFrom");
                var to = model.getProperty("/dateTo");

                if (!validISO(from) || !validISO(to) || from > to) {
                    MessageBox.error("El rango de fechas no es válido.");
                    return Promise.resolve();
                }

                var sequence = ++this._loadSequence;

                model.setProperty("/loading", true);
                model.setProperty("/hasError", false);
                model.setProperty("/errorText", "");

                /*
                 * GeneralMapUbicationsSet:
                 * Se utiliza Dateto tal como lo proporcionaste.
                 * Debe coincidir con el nombre en $metadata.
                 *
                 * AttendanceHistorySet:
                 * Utiliza DateFrom y DateTo en AAAAMMDD.
                 */
                var mapRequest = this._api.getCollection(
                    "GeneralMapUbicationsSet",
                    {
                        filters: [
                            {
                                field: "DateFrom",
                                value: from
                            },
                            {
                                field: "Dateto",
                                value: to
                            }
                        ]
                    }
                );

                var historyRequest = this._api.getCollection(
                    "AttendanceHistorySet",
                    {
                        filters: [
                            {
                                field: "DateFrom",
                                value: compactDate(from)
                            },
                            {
                                field: "DateTo",
                                value: compactDate(to)
                            }
                        ]
                    }
                );

                return Promise.allSettled([
                    mapRequest,
                    historyRequest
                ]).then(function (results) {
                    if (sequence !== this._loadSequence) {
                        return;
                    }

                    var mapResult = results[0];
                    var historyResult = results[1];

                    if (mapResult.status === "rejected") {
                        throw mapResult.reason;
                    }

                    this._locationRows = mapResult.value;

                    this._historyRows =
                        historyResult.status === "fulfilled"
                            ? historyResult.value
                            : [];

                    if (historyResult.status === "rejected") {
                        console.warn(
                            "[Monitor][Mapa] No fue posible obtener historial:",
                            historyResult.reason
                        );

                        model.setProperty(
                            "/errorText",
                            "Se obtuvieron ubicaciones, pero no se pudo " +
                            "consultar el historial de marcajes."
                        );

                        model.setProperty("/hasError", true);
                    }

                    model.setProperty("/appliedDateFrom", from);
                    model.setProperty("/appliedDateTo", to);
                    model.setProperty(
                        "/dateRangeText",
                        displayDate(from) + " – " + displayDate(to)
                    );

                    this._hasLoadedLocations = true;
                    this._buildMapData();
                    this._renderMap();

                    model.setProperty(
                        "/lastRefreshText",
                        "Actualizado · " +
                        new Intl.DateTimeFormat(
                            "es-MX",
                            {
                                hour: "2-digit",
                                minute: "2-digit"
                            }
                        ).format(new Date())
                    );

                    MessageToast.show(
                        this._locationRows.length +
                        " registros de ubicación recibidos"
                    );
                }.bind(this)).catch(function (error) {
                    if (sequence !== this._loadSequence) {
                        return;
                    }

                    console.error(
                        "[Monitor][Mapa][ERROR]",
                        error
                    );

                    model.setProperty("/hasError", true);
                    model.setProperty(
                        "/errorText",
                        "SAP no pudo entregar las ubicaciones del rango. " +
                        (error.message || String(error))
                    );

                    MessageBox.error(
                        "No fue posible consultar GeneralMapUbicationsSet.",
                        {
                            details: [
                                error.message,
                                error.responseBody
                            ].filter(Boolean).join("\n\n")
                        }
                    );
                }.bind(this)).finally(function () {
                    if (sequence === this._loadSequence) {
                        model.setProperty("/loading", false);
                    }
                }.bind(this));
            },

            _buildMapData: function () {
                var attendance = this.getModel("attendance");
                var employees = attendance.getProperty("/employees") || [];
                var baseCenters = attendance.getProperty("/mapCenters") || [];
                var baseZones = attendance.getProperty("/mapZones") || [];

                var employeesByNumber = {};
                var centersByCode = {};
                var checksByNumber = lastCheckFromHistory(
                    this._historyRows
                );

                employees.forEach(function (employee) {
                    employeesByNumber[
                        normalizeNumber(
                            employee.number || employee.PersonnelNumber
                        )
                    ] = employee;
                });

                baseCenters.forEach(function (center) {
                    centersByCode[clean(center.code).toUpperCase()] =
                        center;
                });

                var peopleByNumber = {};

                this._locationRows.forEach(function (row) {
                    var number = clean(row.PersonalNumber);
                    var normalizedNumber = normalizeNumber(number);

                    if (!number) {
                        return;
                    }

                    var employee =
                        employeesByNumber[normalizedNumber] || {};

                    var code = clean(
                        row.CenterCode ||
                        row.CenterOffice ||
                        row.Center
                    );

                    var center =
                        centersByCode[code.toUpperCase()] || {};

                    var currentZone = zoneId(
                        row.Zone ||
                        employee.zoneId ||
                        center.zoneId
                    );

                    var latitude = coordinate(
                        row.LatitudeEmp,
                        false
                    );

                    var longitude = coordinate(
                        row.LongitudeEmp,
                        true
                    );

                    var hasCoordinates =
                        latitude !== null &&
                        longitude !== null;

                    var name = clean(
                        row.FullName ||
                        employee.name ||
                        number
                    );

                    var geoStatus = clean(row.GeoStatus);
                    var statusUpper = geoStatus.toUpperCase();

                    var state = "None";
                    var locationStatus = "Sin información de zona";

                    if (/OUT|FUERA/.test(statusUpper)) {
                        state = "Error";
                        locationStatus = "Fuera de zona";
                    } else if (/IN|DENTRO/.test(statusUpper)) {
                        state = "Success";
                        locationStatus = "Dentro de zona";
                    }

                    var check = checksByNumber[normalizedNumber];

                    var position = hasCoordinates
                        ? longitude + ";" + latitude + ";0"
                        : "";

                    var initial = name.split(/\s+/)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map(function (part) {
                            return part.charAt(0).toUpperCase();
                        })
                        .join("");

                    var person = {
                        employeeId: "employee-" + number,
                        number: number,
                        normalizedNumber: normalizedNumber,
                        name: name,
                        initials: initial,
                        zoneId: currentZone,
                        centerId: code.toLowerCase(),
                        center: clean(
                            center.name ||
                            employee.center ||
                            row.CenterOffice ||
                            code
                        ),
                        position: position,
                        latitude: latitude,
                        longitude: longitude,
                        hasCoordinates: hasCoordinates,
                        coordinatesText: hasCoordinates
                            ? latitude.toFixed(6) +
                                ", " + longitude.toFixed(6)
                            : "Sin coordenadas",
                        locationStatus: locationStatus,
                        state: state,
                        type: state === "Error"
                            ? "Error"
                            : "Success",
                        lastCheck: check
                            ? check.text
                            : "Sin check registrado en el rango",
                        lastCheckType: check
                            ? check.label
                            : "",
                        hasLastCheck: Boolean(check),
                        lastSignal: clean(
                            row.LastSignal || row.LastUpdate
                        ) || "Sin señal reportada",
                        accuracy: "Sin dato",
                        tooltip: name + " · " +
                            locationStatus + " · " +
                            (check
                                ? "Último check " + check.text
                                : "Sin check en el rango")
                    };

                    /*
                     * Si hay varias filas de una persona, conservamos
                     * una con coordenadas cuando está disponible.
                     */
                    var existing = peopleByNumber[normalizedNumber];

                    if (!existing ||
                        (!existing.hasCoordinates &&
                            person.hasCoordinates)) {
                        peopleByNumber[normalizedNumber] = person;
                    }
                });

                this._personnel = Object.keys(peopleByNumber)
                    .map(function (number) {
                        return peopleByNumber[number];
                    })
                    .sort(function (a, b) {
                        return a.name.localeCompare(b.name, "es");
                    });

                this._centers = baseCenters.slice();
                this._zones = baseZones.slice();

                /*
                 * Actualizar conteos sin perder las posiciones
                 * geográficas que ya calcula MonitorData.ts.
                 */
                this._zones = this._zones.map(function (zone) {
                    var people = this._personnel.filter(
                        function (person) {
                            return person.zoneId === zone.id;
                        }
                    );

                    var visible = people.filter(
                        function (person) {
                            return person.hasCoordinates;
                        }
                    ).length;

                    return Object.assign({}, zone, {
                        users: people.length,
                        online: visible,
                        tooltip:
                            zone.name + " · " +
                            people.length + " personas · " +
                            visible + " con coordenadas"
                    });
                }, this);

                console.info(
                    "[Monitor][Mapa][DATOS]",
                    {
                        locations: this._locationRows.length,
                        people: this._personnel.length,
                        history: this._historyRows.length
                    }
                );
            },

            _renderMap: function () {
                var model = this.getModel("map");
                var selectedZone =
                    model.getProperty("/currentZoneId") || "all";

                var employeeId =
                    model.getProperty("/focusedEmployeeId") || "";

                var zones = this._zones || [];
                var people = this._personnel || [];

                var zone = zones.find(function (item) {
                    return item.id === selectedZone;
                });

                var isGeneral =
                    selectedZone === "all" || !zone;

                var filteredPeople = isGeneral
                    ? people
                    : people.filter(function (person) {
                        return person.zoneId === selectedZone;
                    });

                var filteredCenters = isGeneral
                    ? this._centers
                    : this._centers.filter(function (center) {
                        return center.zoneId === selectedZone;
                    });

                var spots = filteredPeople.filter(
                    function (person) {
                        return person.hasCoordinates;
                    }
                );

                var selectedPerson = employeeId
                    ? filteredPeople.find(function (person) {
                        return person.employeeId === employeeId;
                    })
                    : null;

                var outside = filteredPeople.filter(
                    function (person) {
                        return person.state === "Error";
                    }
                ).length;

                var inside = filteredPeople.filter(
                    function (person) {
                        return person.state === "Success";
                    }
                ).length;

                var missing = filteredPeople.length -
                    outside - inside;

                model.setProperty(
                    "/mode",
                    isGeneral ? "general" : "zone"
                );

                model.setProperty(
                    "/title",
                    isGeneral
                        ? "Mapa general de ubicaciones"
                        : zone.name
                );

                model.setProperty(
                    "/subtitle",
                    "Ubicación, último check y personal operativo"
                );

                model.setProperty(
                    "/currentLocationText",
                    isGeneral ? "Mapa general" : zone.name
                );

                model.setProperty(
                    "/mapPanelTitle",
                    isGeneral
                        ? "Cobertura por zona"
                        : "Mapa de " + zone.name.toLowerCase()
                );

                model.setProperty(
                    "/sidePanelTitle",
                    "Personal recibido · " + filteredPeople.length
                );

                model.setProperty("/personnelTotal", filteredPeople.length);
                model.setProperty("/withCoordinates", spots.length);
                model.setProperty(
                    "/withoutCoordinates",
                    filteredPeople.length - spots.length
                );

                model.setProperty("/withinZone", inside);
                model.setProperty("/outsideZone", outside);
                model.setProperty("/withoutZoneInfo", missing);

                model.setProperty(
                    "/summaryText",
                    filteredCenters.length + " centros · " +
                    filteredPeople.length + " personas · " +
                    spots.length + " con coordenadas"
                );

                model.setProperty(
                    "/zoneOptions",
                    [{ id: "all", name: "Todas las zonas" }]
                        .concat(zones)
                );

                model.setProperty("/zoneSpots", zones);

                model.setProperty(
                    "/currentCenters",
                    isGeneral ? [] : filteredCenters
                );

                model.setProperty(
                    "/currentPersonnel",
                    isGeneral ? [] : filteredPeople
                );

                model.setProperty(
                    "/currentPersonnelSpots",
                    isGeneral ? [] : spots
                );

                model.setProperty(
                    "/selectedPerson",
                    selectedPerson || {}
                );

                model.setProperty(
                    "/hasSelectedPerson",
                    Boolean(selectedPerson)
                );

                if (selectedPerson &&
                    selectedPerson.hasCoordinates) {
                    this._setMapPosition(
                        this._positionWithoutAltitude(
                            selectedPerson.position
                        ),
                        15
                    );
                } else if (!isGeneral) {
                    this._setMapPosition(
                        zone.centerPosition,
                        zone.zoomLevel || 6
                    );
                } else {
                    this._setMapPosition(
                        "-99.1700;19.4250",
                        6
                    );
                }
            },

            _positionWithoutAltitude: function (position) {
                return clean(position)
                    .split(";")
                    .slice(0, 2)
                    .join(";");
            },

            _setMapPosition: function (position, zoom) {
                var model = this.getModel("map");

                model.setProperty("/centerPosition", position);
                model.setProperty("/zoomLevel", zoom);

                var map = this.byId("geoMap");

                if (map) {
                    map.setCenterPosition(position);
                    map.setZoomlevel(zoom);
                }
            },

            onZoneSpotPress: function (event) {
                var zone = event.getSource()
                    .getBindingContext("map")
                    .getObject();

                this._openZone(zone.id);
            },

            onZoneListPress: function (event) {
                var zone = event.getSource()
                    .getBindingContext("map")
                    .getObject();

                this._openZone(zone.id);
            },

            _openZone: function (zone) {
                this.navTo("mapZone", {
                    zoneId: zone
                });
            },

            onPersonnelSpotPress: function (event) {
                this._openPerson(
                    event.getSource()
                        .getBindingContext("map")
                        .getObject()
                );
            },

            onPersonnelListPress: function (event) {
                this._openPerson(
                    event.getSource()
                        .getBindingContext("map")
                        .getObject()
                );
            },

            _openPerson: function (person) {
                this.navTo("mapUser", {
                    zoneId: person.zoneId,
                    employeeId: person.employeeId
                });
            },

            onCenterSpotPress: function (event) {
                var center = event.getSource()
                    .getBindingContext("map")
                    .getObject();

                MessageToast.show(
                    center.name + " · " + center.code
                );
            },

            onZoneSelectorChange: function (event) {
                var zone = event.getSource().getSelectedKey();

                if (zone === "all") {
                    this.navTo("map");
                    return;
                }

                this._openZone(zone);
            },

            onRefreshLocations: function () {
                this._loadFilteredLocations();
            },

            onNavOverview: function () {
                this.navTo("overview");
            },

            onNavMap: function () {
                this.navTo("map");
            }
        }
    );
});
