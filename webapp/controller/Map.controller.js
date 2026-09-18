sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast"
], function (BaseController, JSONModel, MessageToast) {
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

    return BaseController.extend("com.mitsu.monitorasistencia.controller.Map", {
        onInit: function () {
            this.setModel(new JSONModel({
                mode: "general",
                title: "Mapa general de ubicaciones",
                subtitle: "Vista general por zona con información de demostración",
                currentLocationText: "Mapa general",
                currentZoneId: "all",
                mapPanelTitle: "Cobertura por zona",
                sidePanelTitle: "Zonas operativas",
                centerPosition: "-99.1700;19.4250",
                zoomLevel: 9,
                summaryText: "4 zonas · 16 centros",
                lastRefreshText: "Actualizado hace 1 min",
                zoneOptions: [],
                zoneSpots: [],
                currentCenters: [],
                currentPersonnel: [],
                selectedPerson: {},
                hasSelectedPerson: false,
                mapConfiguration: MAP_CONFIGURATION
            }), "map");

            this.byId("geoMap").setMapConfiguration(MAP_CONFIGURATION);

            this.getRouter().getRoute("map").attachPatternMatched(this._onGeneralRouteMatched, this);
            this.getRouter().getRoute("mapZone").attachPatternMatched(this._onZoneRouteMatched, this);
            this.getRouter().getRoute("mapUser").attachPatternMatched(this._onUserRouteMatched, this);
        },

        _onGeneralRouteMatched: function () {
            this.getModel("attendance").dataLoaded().then(this._showGeneralMap.bind(this));
        },

        _onZoneRouteMatched: function (oEvent) {
            var sZoneId = oEvent.getParameter("arguments").zoneId;
            this.getModel("attendance").dataLoaded().then(function () {
                this._showZoneMap(sZoneId);
            }.bind(this));
        },

        _onUserRouteMatched: function (oEvent) {
            var oArguments = oEvent.getParameter("arguments");
            this.getModel("attendance").dataLoaded().then(function () {
                this._showZoneMap(oArguments.zoneId, oArguments.employeeId);
            }.bind(this));
        },

        _showGeneralMap: function () {
            var oAttendanceModel = this.getModel("attendance");
            var oMapModel = this.getModel("map");
            var aZones = oAttendanceModel.getProperty("/mapZones") || [];

            oMapModel.setProperty("/mode", "general");
            oMapModel.setProperty("/title", "Mapa general de ubicaciones");
            oMapModel.setProperty("/subtitle", "Selecciona una zona para consultar centros y personal");
            oMapModel.setProperty("/currentLocationText", "Mapa general");
            oMapModel.setProperty("/currentZoneId", "all");
            oMapModel.setProperty("/mapPanelTitle", "Cobertura por zona");
            oMapModel.setProperty("/sidePanelTitle", "Zonas operativas");
            oMapModel.setProperty("/summaryText", "4 zonas · 16 centros · 34 ubicaciones recientes");
            oMapModel.setProperty("/zoneOptions", [{ id: "all", name: "Todas las zonas" }].concat(aZones));
            oMapModel.setProperty("/zoneSpots", aZones);
            oMapModel.setProperty("/currentCenters", []);
            oMapModel.setProperty("/currentPersonnel", []);
            oMapModel.setProperty("/selectedPerson", {});
            oMapModel.setProperty("/hasSelectedPerson", false);
            this._setMapPosition("-99.1700;19.4250", 9);
        },

        _showZoneMap: function (sZoneId, sEmployeeId) {
            var oAttendanceModel = this.getModel("attendance");
            var oMapModel = this.getModel("map");
            var aZones = oAttendanceModel.getProperty("/mapZones") || [];
            var oZone = aZones.find(function (oItem) { return oItem.id === sZoneId; });

            if (!oZone) {
                this.getRouter().navTo("map", {}, true);
                return;
            }

            var aCenters = (oAttendanceModel.getProperty("/mapCenters") || []).filter(function (oCenter) {
                return oCenter.zoneId === sZoneId;
            });
            var aPersonnel = (oAttendanceModel.getProperty("/mapPersonnel") || []).filter(function (oPerson) {
                return oPerson.zoneId === sZoneId;
            });
            var oSelectedPerson = sEmployeeId ? aPersonnel.find(function (oPerson) {
                return oPerson.employeeId === sEmployeeId;
            }) : null;

            oMapModel.setProperty("/mode", "zone");
            oMapModel.setProperty("/title", oZone.name);
            oMapModel.setProperty("/subtitle", "Ubicación de centros, técnicos y personal operativo");
            oMapModel.setProperty("/currentLocationText", oZone.name);
            oMapModel.setProperty("/currentZoneId", sZoneId);
            oMapModel.setProperty("/mapPanelTitle", "Mapa de " + oZone.name.toLowerCase());
            oMapModel.setProperty("/sidePanelTitle", "Personal localizado · " + aPersonnel.length);
            oMapModel.setProperty("/summaryText", oZone.centers + " centros · " + aPersonnel.length + " personas visibles");
            oMapModel.setProperty("/zoneOptions", [{ id: "all", name: "Todas las zonas" }].concat(aZones));
            oMapModel.setProperty("/currentCenters", aCenters);
            oMapModel.setProperty("/currentPersonnel", aPersonnel);
            oMapModel.setProperty("/selectedPerson", oSelectedPerson || {});
            oMapModel.setProperty("/hasSelectedPerson", Boolean(oSelectedPerson));

            if (oSelectedPerson) {
                this._setMapPosition(this._positionWithoutAltitude(oSelectedPerson.position), 15);
            } else {
                this._setMapPosition(oZone.centerPosition, oZone.zoomLevel);
            }
        },

        _positionWithoutAltitude: function (sPosition) {
            return (sPosition || "").split(";").slice(0, 2).join(";");
        },

        _setMapPosition: function (sCenterPosition, iZoomLevel) {
            var oMapModel = this.getModel("map");
            oMapModel.setProperty("/centerPosition", sCenterPosition);
            oMapModel.setProperty("/zoomLevel", iZoomLevel);

            var oMap = this.byId("geoMap");
            if (oMap) {
                oMap.setCenterPosition(sCenterPosition);
                oMap.setZoomlevel(iZoomLevel);
            }
        },

        onZoneSpotPress: function (oEvent) {
            this._openZone(oEvent.getSource().getBindingContext("map").getObject().id);
        },

        onZoneListPress: function (oEvent) {
            this._openZone(oEvent.getSource().getBindingContext("map").getObject().id);
        },

        _openZone: function (sZoneId) {
            this.navTo("mapZone", { zoneId: sZoneId });
        },

        onPersonnelSpotPress: function (oEvent) {
            this._openPerson(oEvent.getSource().getBindingContext("map").getObject());
        },

        onPersonnelListPress: function (oEvent) {
            this._openPerson(oEvent.getSource().getBindingContext("map").getObject());
        },

        _openPerson: function (oPerson) {
            this.navTo("mapUser", {
                zoneId: oPerson.zoneId,
                employeeId: oPerson.employeeId
            });
        },

        onCenterSpotPress: function (oEvent) {
            var oCenter = oEvent.getSource().getBindingContext("map").getObject();
            MessageToast.show(oCenter.name + " · " + oCenter.code);
        },

        onZoneSelectorChange: function (oEvent) {
            var sZoneId = oEvent.getSource().getSelectedKey();
            if (sZoneId === "all") {
                this.navTo("map");
                return;
            }
            this._openZone(sZoneId);
        },

        onRefreshLocations: function () {
            var sTime = new Intl.DateTimeFormat("es-MX", {
                hour: "2-digit",
                minute: "2-digit"
            }).format(new Date());
            this.getModel("map").setProperty("/lastRefreshText", "Actualizado ahora · " + sTime);
            MessageToast.show("Ubicaciones de demostración actualizadas");
        },

        onNavOverview: function () {
            this.navTo("overview");
        },

        onNavMap: function () {
            this.navTo("map");
        }
    });
});
