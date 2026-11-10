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

    var CENTER_FALLBACK_POSITIONS = {
        ML01: "-99.1332;19.4326;0",
        ML02: "-86.8515;21.1619;0",
        ML03: "-103.3496;20.6597;0",
        ML04: "-100.3161;25.6866;0",
        ML05: "-100.3899;20.5888;0",
        ML06: "-99.1700;19.4250;0"
    };

    var OPERATIONAL_ZONE_CATALOG = [
        {
            id: "centro",
            name: "Zona Centro",
            text: "C",
            position: "-99.1332;19.4326;0",
            centerPosition: "-99.1332;19.4326"
        },
        {
            id: "norte",
            name: "Zona Norte",
            text: "N",
            position: "-100.3161;25.6866;0",
            centerPosition: "-100.3161;25.6866"
        },
        {
            id: "sur",
            name: "Zona Sur",
            text: "S",
            position: "-96.7266;17.0732;0",
            centerPosition: "-96.7266;17.0732"
        },
        {
            id: "este",
            name: "Zona Este",
            text: "E",
            position: "-86.8515;21.1619;0",
            centerPosition: "-86.8515;21.1619"
        },
        {
            id: "oeste",
            name: "Zona Oeste",
            text: "O",
            position: "-103.3496;20.6597;0",
            centerPosition: "-103.3496;20.6597"
        }
    ];

    var CENTER_OPERATIONAL_ZONE = {
        ML01: "centro",
        ML02: "este",
        ML03: "oeste",
        ML04: "norte",
        ML05: "centro",
        ML06: "centro"
    };

    var PERSON_STATUS_FILTER_LABELS = {
        inside: "Dentro de zona",
        outside: "Fuera de zona",
        missing: "Sin información"
    };

    function clean(value) {
        return value === null || value === undefined
            ? ""
            : String(value).trim();
    }

    function pad(value) {
        return String(value).padStart(2, "0");
    }

    function currentYearRange() {
        var year = new Date().getFullYear();

        return {
            from: year + "-01-01",
            to: year + "-12-31"
        };
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

    function normalizeSearch(value) {
        return clean(value)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase();
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

    function entriesFromHistory(rows) {
        var latest = {};

        rows.forEach(function (row) {
            var number = normalizeNumber(row.PersonalNumber);
            var date = compactDate(row.WorkDate);
            var time = normalizeTime(row.P10Time);

            if (!number || !/^\d{8}$/.test(date) ||
                !time || time === "00:00") {
                return;
            }

            var key = date + time.replace(":", "");

            if (!latest[number] || key > latest[number].key) {
                latest[number] = {
                    key: key,
                    date: date,
                    time: time,
                    text: displayDate(date) + " " + time,
                    channel: clean(row.Chanel),
                    device: clean(row.Device),
                    row: row
                };
            }
        });

        return latest;
    }

    function latestEntryRows(historyRows) {
        var entries = entriesFromHistory(historyRows);

        return Object.keys(entries).map(function (number) {
            return entries[number].row;
        });
    }

    return BaseController.extend(
        "com.mitsu.monitorasistencia.controller.Map",
        {
            onInit: function () {
                var yearRange = currentYearRange();

                this._api = new AttendanceApi();
                this._loadSequence = 0;
                this._locationRows = [];
                this._historyRows = [];
                this._zoneCatalogRows = [];
                this._baseCatalogRows = [];
                this._personnel = [];
                this._centers = [];
                this._zones = [];

                this.setModel(new JSONModel({
                    mode: "general",
                    title: "Mapa general de ubicaciones",
                    subtitle: "Ubicación del inicio de labores del personal",
                    currentLocationText: "Mapa general",
                    currentZoneId: "all",
                    focusedEmployeeId: "",
                    mapPanelTitle: "Inicios de labores por zona",
                    sidePanelTitle: "Personal recibido",
                    centerPosition: "-99.1700;19.4250",
                    zoomLevel: 9,
                    dateFrom: yearRange.from,
                    dateTo: yearRange.to,
                    appliedDateFrom: yearRange.from,
                    appliedDateTo: yearRange.to,
                    dateRangeText: "",
                    loading: false,
                    errorText: "",
                    hasError: false,
                    locationWarningText: "",
                    hasLocationWarning: false,
                    summaryText: "Consultando SAP...",
                    lastRefreshText: "Sin actualizar",
                    personnelTotal: 0,
                    withCoordinates: 0,
                    withoutCoordinates: 0,
                    withinZone: 0,
                    outsideZone: 0,
                    withoutZoneInfo: 0,
                    outsideZonePersonnel: [],
                    outsideZoneListTitle: "Registros fuera de zona",
                    showOutsideZoneSection: false,
                    zoneOptions: [],
                    baseOptions: [],
                    zoneSpots: [],
                    currentCenters: [],
                    currentPersonnel: [],
                    currentPersonnelSpots: [],
                    personSearch: "",
                    hasPersonSearch: false,
                    personStatusFilter: "all",
                    personStatusFilterLabel: "",
                    hasPersonnelStatusFilter: false,
                    hasPersonnelFilter: false,
                    personSearchResultText: "",
                    personNoDataText: "No se recibió personal en este rango",
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
                ).then(this._scrollPersonnelToTop.bind(this));
            },

            _activateRoute: function (zone, employeeId) {
                var model = this.getModel("map");
                var routeZone = clean(zone).toLowerCase();
                var centerZone =
                    CENTER_OPERATIONAL_ZONE[routeZone.toUpperCase()];

                model.setProperty(
                    "/currentZoneId",
                    centerZone || routeZone || "all"
                );
                model.setProperty(
                    "/focusedEmployeeId",
                    employeeId || ""
                );

                return this.getModel("attendance")
                    .dataLoaded()
                    .then(function () {
                        if (!this._hasLoadedLocations) {
                            return this._loadFilteredLocations();
                        }

                        this._renderMap();
                        return undefined;
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

                var historyFilters = [
                    {
                        field: "DateFrom",
                        value: compactDate(from)
                    },
                    {
                        field: "DateTo",
                        value: compactDate(to)
                    }
                ];

                /*
                 * AttendanceHistorySet es la fuente del mapa. P10Time
                 * identifica el inicio de labores y Latitude/Longitude
                 * corresponden a la ubicación de esa entrada.
                 */
                var historyRequest = this._api.getCollection(
                    "AttendanceHistorySet",
                    {
                        filters: historyFilters
                    }
                );

                /*
                 * Catálogo de zonas/centros y relación con bases.
                 * El backend requiere el filtro CENTRO para entregar
                 * el catálogo completo ML01–ML06.
                 */
                var zoneCatalogRequest = this._api.getCollection(
                    "ZoneAttendanceSet",
                    {
                        filters: [{
                            field: "Zone",
                            value: "CENTRO"
                        }]
                    }
                );

                var baseCatalogRequest = this._api.getCollection(
                    "BasesSet"
                );

                return Promise.allSettled([
                    historyRequest,
                    zoneCatalogRequest,
                    baseCatalogRequest
                ]).then(function (results) {
                    if (sequence !== this._loadSequence) {
                        return;
                    }

                    var historyResult = results[0];
                    var zoneCatalogResult = results[1];
                    var baseCatalogResult = results[2];

                    var historyRows =
                        historyResult.status === "fulfilled"
                            ? historyResult.value
                            : [];

                    this._historyRows = historyRows;
                    this._locationRows = latestEntryRows(historyRows);
                    this._zoneCatalogRows =
                        zoneCatalogResult.status === "fulfilled"
                            ? zoneCatalogResult.value
                            : this._zoneCatalogRows;
                    this._baseCatalogRows =
                        baseCatalogResult.status === "fulfilled"
                            ? baseCatalogResult.value
                            : this._baseCatalogRows;

                    if (historyResult.status === "rejected" ||
                        zoneCatalogResult.status === "rejected" ||
                        baseCatalogResult.status === "rejected") {
                        console.warn(
                            "[Monitor][Mapa] Fuente parcial:",
                            historyResult.reason ||
                            zoneCatalogResult.reason ||
                            baseCatalogResult.reason
                        );

                        model.setProperty(
                            "/errorText",
                            "Algunas fuentes no respondieron; se muestran " +
                            "los datos disponibles."
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
                        this._personnel.length +
                        " personas disponibles"
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
                        "SAP no pudo entregar el historial del rango. " +
                        (error.message || String(error))
                    );

                    MessageBox.error(
                        "No fue posible consultar AttendanceHistorySet.",
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
                var fallbackCenters =
                    attendance.getProperty("/mapCenters") || [];
                var fallbackZones =
                    attendance.getProperty("/mapZones") || [];
                var fallbackCentersByCode = {};
                var catalogCentersByCode = {};
                var baseOptionsByCode = {};
                var employeeZoneByCenter = {};

                employees.forEach(function (employee) {
                    var centerCode = clean(
                        employee.centerCode ||
                        employee.PersonnelArea ||
                        employee.centerId
                    ).toUpperCase();
                    var operationalZone = zoneId(
                        employee.zoneId || employee.Zone
                    );

                    if (centerCode &&
                        operationalZone !== "sin-zona") {
                        employeeZoneByCenter[centerCode] =
                            operationalZone;
                    }
                });

                fallbackCenters.forEach(function (center) {
                    fallbackCentersByCode[
                        clean(center.code).toUpperCase()
                    ] = center;
                });

                this._zoneCatalogRows.forEach(function (row) {
                    var code = clean(
                        row.Zone || row.CenterCode
                    ).toUpperCase();

                    if (!code) {
                        return;
                    }

                    var existing =
                        fallbackCentersByCode[code] || {};
                    var position = clean(existing.position) ||
                        CENTER_FALLBACK_POSITIONS[code] ||
                        CENTER_FALLBACK_POSITIONS.ML06;

                    catalogCentersByCode[code] = {
                        id: code.toLowerCase(),
                        code: code,
                        name: clean(
                            row.ZoneDescription ||
                            existing.name ||
                            code
                        ),
                        zoneId:
                            employeeZoneByCenter[code] ||
                            CENTER_OPERATIONAL_ZONE[code] ||
                            zoneId(existing.zoneId),
                        position: position,
                        centerPosition: position
                            .split(";")
                            .slice(0, 2)
                            .join(";"),
                        zoomLevel: 7,
                        type: "Default",
                        icon: "sap-icon://building",
                        text: code.replace(/^ML/i, ""),
                        users: 0,
                        online: 0,
                        tooltip: clean(
                            row.ZoneDescription || code
                        ) + " · " + code
                    };
                });

                this._baseCatalogRows.forEach(function (row) {
                    var code = clean(row.Base);

                    if (code && !baseOptionsByCode[code]) {
                        baseOptionsByCode[code] = {
                            key: code,
                            text: clean(row.BaseDescription) || code
                        };
                    }
                });

                this.getModel("map").setProperty(
                    "/baseOptions",
                    [{ key: "all", text: "Todas las bases" }]
                        .concat(Object.keys(baseOptionsByCode)
                            .map(function (code) {
                                return baseOptionsByCode[code];
                            })
                            .sort(function (left, right) {
                                return left.text.localeCompare(
                                    right.text,
                                    "es"
                                );
                            }))
                );

                var baseCenters =
                    Object.keys(catalogCentersByCode).length
                        ? Object.keys(catalogCentersByCode)
                            .map(function (code) {
                                return catalogCentersByCode[code];
                            })
                        : fallbackCenters;

                var fallbackZonesById = {};
                fallbackZones.forEach(function (zone) {
                    fallbackZonesById[clean(zone.id)] = zone;
                });

                var baseZones = OPERATIONAL_ZONE_CATALOG
                    .map(function (zone) {
                        return Object.assign(
                            {},
                            zone,
                            fallbackZonesById[zone.id] || {},
                            {
                                id: zone.id,
                                name: zone.name,
                                text: zone.text,
                                position: clean(
                                    (fallbackZonesById[zone.id] || {})
                                        .position
                                ) || zone.position,
                                centerPosition: clean(
                                    (fallbackZonesById[zone.id] || {})
                                        .centerPosition
                                ) || zone.centerPosition,
                                zoomLevel: 6,
                                type: "Default"
                            }
                        );
                    });

                var employeesByNumber = {};
                var centersByCode = {};
                var entriesByNumber = entriesFromHistory(
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
                        employee.centerCode ||
                        employee.PersonnelArea ||
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
                        row.Latitude,
                        false
                    );

                    var longitude = coordinate(
                        row.Longitude,
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
                    var outOfZoneFlag = row.IsOutOfZone === true ||
                        /^(X|TRUE|1|SI|SÍ)$/.test(
                            clean(row.IsOutOfZone).toUpperCase()
                        );

                    var state = "None";
                    var locationStatus = "Sin información de zona";

                    if (outOfZoneFlag ||
                        /OUT|FUERA/.test(statusUpper)) {
                        state = "Error";
                        locationStatus = clean(
                            row.GeoStatusDescripcion
                        ) || "Registro fuera de zona";
                    } else if (/IN|DENTRO/.test(statusUpper)) {
                        state = "Success";
                        locationStatus = clean(
                            row.GeoStatusDescripcion
                        ) || "Registro dentro de zona";
                    }

                    var entry = entriesByNumber[normalizedNumber];
                    var entrySource = [
                        entry && entry.channel,
                        entry && entry.device
                    ].filter(Boolean).join(" · ");

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
                        email: clean(
                            row.Email ||
                            employee.email ||
                            employee.Email
                        ),
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
                            : "Sin ubicación de entrada",
                        locationStatus: locationStatus,
                        state: state,
                        type: state === "Error"
                            ? "Error"
                            : "Success",
                        entryText: entry
                            ? entry.text
                            : "Sin entrada registrada en el rango",
                        entryChannel: entry && entry.channel
                            ? "Canal: " + entry.channel
                            : "",
                        entrySourceText: entrySource || "Sin dato",
                        hasEntry: Boolean(entry),
                        accuracy: "Sin dato",
                        tooltip: name + " · " +
                            locationStatus + " · " +
                            (entry
                                ? "Inicio " + entry.text
                                : "Sin entrada en el rango")
                    };

                    peopleByNumber[normalizedNumber] = person;
                });

                /*
                 * El catálogo de empleados mantiene visible a todo el
                 * personal, aunque no tenga una entrada P10 o ubicación
                 * en el rango seleccionado.
                 */
                employees.forEach(function (employee) {
                    var number = clean(
                        employee.number ||
                        employee.PersonnelNumber ||
                        employee.PersonalNumber
                    );
                    var normalizedNumber = normalizeNumber(number);

                    if (!number || peopleByNumber[normalizedNumber]) {
                        return;
                    }

                    var code = clean(
                        employee.centerCode ||
                        employee.PersonnelArea ||
                        employee.centerId
                    ).toUpperCase();
                    var center = centersByCode[code] || {};
                    var currentZone = zoneId(
                        employee.zoneId || center.zoneId
                    );
                    var name = clean(employee.name) || number;
                    var initial = name.split(/\s+/)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map(function (part) {
                            return part.charAt(0).toUpperCase();
                        })
                        .join("");

                    peopleByNumber[normalizedNumber] = {
                        employeeId: employee.id ||
                            "employee-" + number,
                        number: number,
                        normalizedNumber: normalizedNumber,
                        name: name,
                        email: clean(
                            employee.email || employee.Email
                        ),
                        initials: initial,
                        zoneId: currentZone,
                        centerId: code.toLowerCase(),
                        center: clean(
                            center.name || employee.center || code
                        ) || "Sin centro",
                        position: "",
                        latitude: null,
                        longitude: null,
                        hasCoordinates: false,
                        coordinatesText: "Sin ubicación de entrada",
                        locationStatus: "Sin entrada registrada",
                        state: "None",
                        type: "Default",
                        entryText: "Sin entrada registrada en el rango",
                        entryChannel: "",
                        entrySourceText: "Sin registro",
                        hasEntry: false,
                        accuracy: "Sin dato",
                        tooltip: name +
                            " · Sin entrada registrada en el rango"
                    };
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
                            visible + " con ubicación de entrada"
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

                var searchText = normalizeSearch(
                    model.getProperty("/personSearch")
                );

                var statusFilter = clean(
                    model.getProperty("/personStatusFilter")
                ).toLowerCase();

                if (!PERSON_STATUS_FILTER_LABELS[statusFilter]) {
                    statusFilter = "all";
                }

                var zones = this._zones || [];
                var people = this._personnel || [];

                var zone = zones.find(function (item) {
                    return item.id === selectedZone;
                });

                var isGeneral =
                    selectedZone === "all" || !zone;

                var scopePeople = isGeneral
                    ? people
                    : people.filter(function (person) {
                        return person.zoneId === selectedZone;
                    });

                var searchFilteredPeople = searchText
                    ? scopePeople.filter(function (person) {
                        return [
                            person.number,
                            person.normalizedNumber,
                            person.name,
                            person.email
                        ].some(function (value) {
                            return normalizeSearch(value)
                                .indexOf(searchText) !== -1;
                        });
                    })
                    : scopePeople;

                var outsidePeople = searchFilteredPeople.filter(
                    function (person) {
                        return person.state === "Error";
                    }
                );

                var insidePeople = searchFilteredPeople.filter(
                    function (person) {
                        return person.state === "Success";
                    }
                );

                var missingPeople = searchFilteredPeople.filter(
                    function (person) {
                        return person.state !== "Error" &&
                            person.state !== "Success";
                    }
                );

                var filteredPeople = statusFilter === "inside"
                    ? insidePeople
                    : statusFilter === "outside"
                        ? outsidePeople
                        : statusFilter === "missing"
                            ? missingPeople
                            : searchFilteredPeople;

                var hasStatusFilter = statusFilter !== "all";
                var hasPersonnelFilter = Boolean(searchText) ||
                    hasStatusFilter;
                var statusFilterLabel =
                    PERSON_STATUS_FILTER_LABELS[statusFilter] || "";

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
                    ? scopePeople.find(function (person) {
                        return person.employeeId === employeeId;
                    }) || people.find(function (person) {
                        return person.employeeId === employeeId;
                    })
                    : null;

                var outside = outsidePeople.length;
                var inside = insidePeople.length;
                var missing = missingPeople.length;
                var entriesWithoutCoordinates = filteredPeople.filter(
                    function (person) {
                        return person.hasEntry &&
                            !person.hasCoordinates;
                    }
                ).length;

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
                    "Lugar donde el personal registró su inicio de labores"
                );

                model.setProperty(
                    "/currentLocationText",
                    isGeneral ? "Mapa general" : zone.name
                );

                model.setProperty(
                    "/mapPanelTitle",
                    isGeneral
                        ? "Inicios de labores por zona"
                        : "Entradas de " + zone.name.toLowerCase()
                );

                model.setProperty(
                    "/sidePanelTitle",
                    hasStatusFilter
                        ? statusFilterLabel + " · " +
                            filteredPeople.length + " de " +
                            searchFilteredPeople.length
                        : searchText
                            ? "Resultados · " + filteredPeople.length +
                                " de " + scopePeople.length
                        : "Personal recibido · " + scopePeople.length
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
                    "/outsideZonePersonnel",
                    outsidePeople
                );
                model.setProperty(
                    "/outsideZoneListTitle",
                    "Registros fuera de zona · " + outside
                );
                model.setProperty(
                    "/showOutsideZoneSection",
                    isGeneral && !searchText &&
                        !hasStatusFilter && outside > 0
                );
                model.setProperty(
                    "/hasLocationWarning",
                    entriesWithoutCoordinates > 0
                );
                model.setProperty(
                    "/locationWarningText",
                    entriesWithoutCoordinates > 0
                        ? entriesWithoutCoordinates +
                            " entradas P10 no incluyen Latitude/Longitude " +
                            "en la respuesta de SAP."
                        : ""
                );

                model.setProperty(
                    "/summaryText",
                    filteredCenters.length + " centros · " +
                    filteredPeople.length + " personas · " +
                    spots.length + " con ubicación de entrada"
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
                    isGeneral && !hasPersonnelFilter
                        ? []
                        : filteredPeople
                );

                model.setProperty(
                    "/currentPersonnelSpots",
                    isGeneral && !hasPersonnelFilter
                        ? []
                        : spots
                );

                model.setProperty(
                    "/hasPersonSearch",
                    Boolean(searchText)
                );

                model.setProperty(
                    "/personStatusFilter",
                    statusFilter
                );

                model.setProperty(
                    "/personStatusFilterLabel",
                    statusFilterLabel
                );

                model.setProperty(
                    "/hasPersonnelStatusFilter",
                    hasStatusFilter
                );

                model.setProperty(
                    "/hasPersonnelFilter",
                    hasPersonnelFilter
                );

                model.setProperty(
                    "/personSearchResultText",
                    hasStatusFilter
                        ? filteredPeople.length + " personas · " +
                            statusFilterLabel
                        : searchText
                        ? filteredPeople.length + " de " +
                            scopePeople.length + " coincidencias"
                        : scopePeople.length + " personas disponibles"
                );

                model.setProperty(
                    "/personNoDataText",
                    hasStatusFilter
                        ? "No hay personas clasificadas como “" +
                            statusFilterLabel + "”"
                        : searchText
                        ? "No hay usuarios que coincidan con la búsqueda"
                        : "No se recibió personal en este rango"
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
                var model = this.getModel("map");

                model.setProperty(
                    "/focusedEmployeeId",
                    person.employeeId
                );
                model.setProperty("/selectedPerson", person);
                model.setProperty("/hasSelectedPerson", true);

                if (person.hasCoordinates) {
                    this._setMapPosition(
                        this._positionWithoutAltitude(
                            person.position
                        ),
                        15
                    );
                }

                this._scrollPersonnelToTop();

                this.navTo("mapUser", {
                    zoneId: person.zoneId,
                    employeeId: person.employeeId
                });
            },

            _scrollPersonnelToTop: function () {
                setTimeout(function () {
                    var content = this.byId("mapSideContent");
                    var domRef = content && content.getDomRef();

                    if (domRef) {
                        domRef.scrollTop = 0;
                    }
                }.bind(this), 0);
            },

            onPersonnelSearch: function (event) {
                var value = event.getParameter("newValue");

                if (value === undefined) {
                    value = event.getParameter("query");
                }

                this.getModel("map").setProperty(
                    "/personSearch",
                    value || ""
                );
                this._renderMap();
            },

            onPersonnelStatusFilterPress: function (event) {
                var model = this.getModel("map");
                var requestedFilter = clean(
                    event.getSource().data("personStatusFilter")
                ).toLowerCase();
                var currentFilter = clean(
                    model.getProperty("/personStatusFilter")
                ).toLowerCase();

                if (!PERSON_STATUS_FILTER_LABELS[requestedFilter]) {
                    return;
                }

                model.setProperty(
                    "/personStatusFilter",
                    currentFilter === requestedFilter
                        ? "all"
                        : requestedFilter
                );

                this._renderMap();
                this._scrollPersonnelToTop();
            },

            onClearPersonnelStatusFilter: function () {
                this.getModel("map").setProperty(
                    "/personStatusFilter",
                    "all"
                );
                this._renderMap();
                this._scrollPersonnelToTop();
            },

            onClearSelectedPerson: function () {
                var model = this.getModel("map");
                var selectedZone =
                    model.getProperty("/currentZoneId") || "all";

                model.setProperty("/focusedEmployeeId", "");
                model.setProperty("/selectedPerson", {});
                model.setProperty("/hasSelectedPerson", false);

                if (selectedZone === "all") {
                    this.navTo("map");
                } else {
                    this.navTo("mapZone", {
                        zoneId: selectedZone
                    });
                }
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
