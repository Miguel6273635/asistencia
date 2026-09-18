sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "com/mitsu/monitorasistencia/model/formatter",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast"
], function (BaseController, formatter, JSONModel, MessageToast) {
    "use strict";

    return BaseController.extend("com.mitsu.monitorasistencia.controller.Users", {
        formatter: formatter,

        onInit: function () {
            this.setModel(new JSONModel({
                allEmployees: [],
                employees: [],
                search: "",
                status: "all",
                scheduleId: "",
                stats: { total: 0, active: 0, inactive: 0, centers: 0 }
            }), "view");
            this.getRouter().getRoute("users").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            this.getModel("attendance").dataLoaded().then(this._loadUsers.bind(this));
        },

        _loadUsers: function () {
            var oAttendanceModel = this.getModel("attendance");
            var aEmployees = oAttendanceModel.getProperty("/employees") || [];
            var aSchedules = oAttendanceModel.getProperty("/schedules") || [];
            var mSchedules = aSchedules.reduce(function (oResult, oSchedule) {
                oResult[oSchedule.id] = oSchedule;
                return oResult;
            }, {});

            aEmployees.forEach(function (oEmployee) {
                var oSchedule = mSchedules[oEmployee.scheduleId] || {};
                oEmployee.scheduleName = oSchedule.name || oEmployee.scheduleName || "Sin horario asignado";
                oEmployee.scheduleCode = oSchedule.code || "";
                oEmployee.scheduleDescription = oSchedule.shortDescription || oEmployee.shift || "Pendiente de asignación";
            });
            this.getModel("view").setProperty("/allEmployees", aEmployees);
            this._applyFilters();
        },

        _applyFilters: function () {
            var oViewModel = this.getModel("view");
            var sSearch = (oViewModel.getProperty("/search") || "").toLowerCase();
            var sStatus = oViewModel.getProperty("/status");
            var sScheduleId = oViewModel.getProperty("/scheduleId") || "";
            var aEmployees = oViewModel.getProperty("/allEmployees") || [];
            var aFiltered = aEmployees.filter(function (oEmployee) {
                var bStatus = sStatus === "all" || (sStatus === "active" && oEmployee.active) || (sStatus === "inactive" && !oEmployee.active);
                var bSchedule = !sScheduleId || oEmployee.scheduleId === sScheduleId;
                var sHaystack = [oEmployee.name, oEmployee.number, oEmployee.center, oEmployee.scheduleName, oEmployee.scheduleDescription].join(" ").toLowerCase();
                var bSearch = !sSearch || sHaystack.includes(sSearch);
                return bStatus && bSchedule && bSearch;
            });
            var aCenters = Array.from(new Set(aEmployees.map(function (oEmployee) { return oEmployee.centerId; })));

            oViewModel.setProperty("/employees", aFiltered);
            oViewModel.setProperty("/stats", {
                total: aEmployees.length,
                active: aEmployees.filter(function (oEmployee) { return oEmployee.active; }).length,
                inactive: aEmployees.filter(function (oEmployee) { return !oEmployee.active; }).length,
                centers: aCenters.length
            });
        },

        onSearch: function (oEvent) {
            this.getModel("view").setProperty("/search", oEvent.getParameter("newValue"));
            this._applyFilters();
        },

        onFilterChange: function () {
            this._applyFilters();
        },

        onToggleUserStatus: function (oEvent) {
            var oEmployee = oEvent.getSource().getBindingContext("view").getObject();
            oEmployee.active = !oEmployee.active;
            oEmployee.lastUpdate = "31/08/2026 12:00";
            this.getModel("attendance").refresh(true);
            this._applyFilters();
            MessageToast.show(oEmployee.name + (oEmployee.active ? " fue activado" : " fue dado de baja"));
        },

        onOpenUserDialog: function () {
            this.byId("userName").setValue("");
            this.byId("userNumber").setValue("");
            this.byId("userCenter").setSelectedIndex(0);
            this.byId("userSchedule").setSelectedIndex(0);
            this.byId("userRole").setSelectedKey("Empleado");
            this.byId("userActive").setState(true);
            this.byId("userDialog").open();
        },

        onCloseUserDialog: function () {
            this.byId("userDialog").close();
        },

        onSaveUser: function () {
            var sName = this.byId("userName").getValue().trim();
            var sNumber = this.byId("userNumber").getValue().trim();
            var sCenterId = this.byId("userCenter").getSelectedKey();
            var sScheduleId = this.byId("userSchedule").getSelectedKey();
            var sRole = this.byId("userRole").getSelectedKey();

            if (!sName || !sNumber || !sCenterId || !sScheduleId) {
                MessageToast.show("Completa los campos obligatorios");
                return;
            }

            var oAttendanceModel = this.getModel("attendance");
            var aEmployees = oAttendanceModel.getProperty("/employees");
            var oCenter = (oAttendanceModel.getProperty("/centers") || []).find(function (oItem) { return oItem.id === sCenterId; });
            var oSchedule = (oAttendanceModel.getProperty("/schedules") || []).find(function (oItem) { return oItem.id === sScheduleId; });
            var aWords = sName.split(/\s+/);

            if (!oCenter || !oSchedule) {
                MessageToast.show("Selecciona un centro y un horario válidos");
                return;
            }

            if (aEmployees.some(function (oEmployee) { return oEmployee.number.toUpperCase() === sNumber.toUpperCase(); })) {
                MessageToast.show("El número de empleado ya existe");
                return;
            }

            aEmployees.push({
                id: "emp-" + Date.now(),
                number: sNumber.toUpperCase(),
                name: sName,
                initials: aWords.slice(0, 2).map(function (sWord) { return sWord.charAt(0).toUpperCase(); }).join(""),
                centerId: sCenterId,
                center: oCenter.name,
                zoneId: oCenter.zoneId,
                shift: oSchedule.type,
                scheduleId: oSchedule.id,
                scheduleName: oSchedule.name,
                scheduleCode: oSchedule.code,
                scheduleDescription: oSchedule.shortDescription,
                role: sRole,
                entry: "—",
                exit: "—",
                hours: "0:00",
                status: "Incompleto",
                active: this.byId("userActive").getState(),
                lastUpdate: "31/08/2026 12:00"
            });

            oAttendanceModel.refresh(true);
            this.getModel("view").setProperty("/allEmployees", aEmployees);
            this._applyFilters();
            this.onCloseUserDialog();
            MessageToast.show("Usuario creado");
        },

        onExport: function () {
            MessageToast.show("Aquí se conectará la exportación a Excel");
        },

        onOpenUserMap: function (oEvent) {
            var oEmployee = oEvent.getSource().getBindingContext("view").getObject();
            this.navTo("mapUser", {
                zoneId: oEmployee.zoneId,
                employeeId: oEmployee.id
            });
        },

        onNavOverview: function () {
            this.navTo("overview");
        }
    });
});
