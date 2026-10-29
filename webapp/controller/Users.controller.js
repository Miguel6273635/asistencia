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
            var oSapSummary = this.getModel("attendance").getProperty("/employeeSummary") || {};
            var aCenters = Array.from(new Set(aEmployees.map(function (oEmployee) { return oEmployee.centerId; }).filter(Boolean)));

            oViewModel.setProperty("/employees", aFiltered);
            oViewModel.setProperty("/stats", {
                total: Number(oSapSummary.total) || aEmployees.length,
                active: Number(oSapSummary.active) || aEmployees.filter(function (oEmployee) { return oEmployee.active; }).length,
                inactive: Number(oSapSummary.inactive) || aEmployees.filter(function (oEmployee) { return !oEmployee.active; }).length,
                centers: Number(oSapSummary.centers) || aCenters.length
            });
        },

        onSearch: function (oEvent) {
            this.getModel("view").setProperty("/search", oEvent.getParameter("newValue"));
            this._applyFilters();
        },

        onFilterChange: function () {
            this._applyFilters();
        },

        onToggleUserStatus: function () {
            MessageToast.show("EmployeeSet está disponible sólo para consulta; SAP aún no expone el alta o baja de colaboradores.");
        },

        onOpenUserDialog: function () {
            MessageToast.show("SAP aún no expone un servicio para crear colaboradores; la pantalla permanece en modo consulta.");
        },

        onCloseUserDialog: function () {
            this.byId("userDialog").close();
        },

        onSaveUser: function () {
            MessageToast.show("No se enviaron cambios: falta el endpoint de mantenimiento de colaboradores en SAP.");
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
