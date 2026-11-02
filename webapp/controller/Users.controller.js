sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "com/mitsu/monitorasistencia/model/formatter",
    "com/mitsu/monitorasistencia/model/AttendanceApi",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], function (BaseController, formatter, AttendanceApi, JSONModel, MessageBox, MessageToast) {
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
                uploadEntitySet: "EmployeesUploadSet",
                uploadJson: "",
                uploadBusy: false,
                stats: { total: 0, active: 0, inactive: 0, centers: 0 }
            }), "view");
            this._attendanceApi = new AttendanceApi();
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
            this.onOpenUploadDialog();
        },

        onCloseUserDialog: function () {
            this.byId("userDialog").close();
        },

        onSaveUser: function () {
            this.onSubmitEmployeeUpload();
        },

        _createUploadTemplate: function () {
            var oNow = new Date();
            var sDate = oNow.getFullYear() + String(oNow.getMonth() + 1).padStart(2, "0") + String(oNow.getDate()).padStart(2, "0");
            var sTime = String(oNow.getHours()).padStart(2, "0") + String(oNow.getMinutes()).padStart(2, "0") + String(oNow.getSeconds()).padStart(2, "0");
            var sRequestId = sDate + "-" + sTime;
            return {
                RequestId: sRequestId,
                Operation: "CREATE",
                ProcessingMode: "PARTIAL",
                ToEmployeesUpload: [{
                    RequestId: sRequestId,
                    ItemNo: "00001",
                    PersonnelNumber: "",
                    HireDate: sDate,
                    Position: "",
                    PersonnelArea: "",
                    EmployeeGroup: "",
                    EmployeeSubgroup: "",
                    FirstName: "",
                    LastName: "",
                    BirthDate: "",
                    Language: "ES",
                    BirthCountry: "MX",
                    Gender: "X",
                    PersonnelSubarea: "",
                    AttendanceChannel: "APP",
                    Zone: "",
                    City: "",
                    Region: "",
                    Municipality: "",
                    Country: "MX",
                    ResidenceType: "0",
                    Schedule: "",
                    Email: ""
                }]
            };
        },

        onOpenUploadDialog: function () {
            var oViewModel = this.getModel("view");
            if (!oViewModel.getProperty("/uploadJson")) {
                oViewModel.setProperty("/uploadJson", JSON.stringify(this._createUploadTemplate(), null, 2));
            }
            this.byId("employeeUploadDialog").open();
        },

        onCloseUploadDialog: function () {
            if (!this.getModel("view").getProperty("/uploadBusy")) {
                this.byId("employeeUploadDialog").close();
            }
        },

        _validateUploadPayload: function (oPayload) {
            var aHeaderFields = ["RequestId", "Operation", "ProcessingMode"];
            var aItemFields = [
                "RequestId", "ItemNo", "PersonnelNumber", "HireDate", "Position", "PersonnelArea",
                "EmployeeGroup", "EmployeeSubgroup", "FirstName", "LastName", "AttendanceChannel",
                "Zone", "Schedule", "Email"
            ];
            var sMissingHeader = aHeaderFields.find(function (sField) { return !String(oPayload && oPayload[sField] || "").trim(); });
            if (sMissingHeader) {
                throw new Error("Falta el campo de cabecera " + sMissingHeader + ".");
            }
            if (!Array.isArray(oPayload.ToEmployeesUpload) || !oPayload.ToEmployeesUpload.length) {
                throw new Error("ToEmployeesUpload debe contener por lo menos un empleado.");
            }
            oPayload.ToEmployeesUpload.forEach(function (oItem, iIndex) {
                var sMissingItem = aItemFields.find(function (sField) { return !String(oItem && oItem[sField] || "").trim(); });
                if (sMissingItem) {
                    throw new Error("Empleado " + (iIndex + 1) + ": falta " + sMissingItem + ".");
                }
                if (oItem.RequestId !== oPayload.RequestId) {
                    throw new Error("Empleado " + (iIndex + 1) + ": RequestId debe coincidir con la cabecera.");
                }
                if (!/^\d{8}$/.test(String(oItem.HireDate))) {
                    throw new Error("Empleado " + (iIndex + 1) + ": HireDate debe usar el formato AAAAMMDD.");
                }
                if (!/^\S+@\S+\.\S+$/.test(String(oItem.Email))) {
                    throw new Error("Empleado " + (iIndex + 1) + ": Email no tiene un formato válido.");
                }
            });
            return oPayload;
        },

        onSubmitEmployeeUpload: function () {
            var oViewModel = this.getModel("view");
            var oPayload;
            try {
                oPayload = this._validateUploadPayload(JSON.parse(oViewModel.getProperty("/uploadJson") || "{}"));
            } catch (oError) {
                MessageBox.error("No se puede enviar la carga. " + oError.message);
                return;
            }

            var sEntitySet = String(oViewModel.getProperty("/uploadEntitySet") || "EmployeesUploadSet").trim();
            oViewModel.setProperty("/uploadBusy", true);
            console.info("[EmployeeUpload][POST]", sEntitySet, JSON.parse(JSON.stringify(oPayload)));
            this._attendanceApi.uploadEmployees(oPayload, sEntitySet).then(function (oResponse) {
                console.info("[EmployeeUpload][RESPONSE]", oResponse);
                this.byId("employeeUploadDialog").close();
                oViewModel.setProperty("/uploadJson", "");
                MessageBox.success(oPayload.ToEmployeesUpload.length + " empleado(s) enviados a SAP.", {
                    details: JSON.stringify(oResponse, null, 2)
                });
            }.bind(this)).catch(function (oError) {
                console.error("[EmployeeUpload][ERROR]", oError, oError.responseBody || "");
                MessageBox.error("SAP rechazó la carga de usuarios.", {
                    details: [oError.message, oError.responseBody].filter(Boolean).join("\n\n")
                });
            }).finally(function () {
                oViewModel.setProperty("/uploadBusy", false);
            });
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

        onOpenUserPerformance: function (oEvent) {
            var oListItem = oEvent.getParameter && oEvent.getParameter("listItem");
            var oContext = (oListItem || oEvent.getSource()).getBindingContext("view");
            var oEmployee = oContext && oContext.getObject();
            if (oEmployee && oEmployee.id) {
                this.navTo("userPerformance", { employeeId: oEmployee.id });
            }
        },

        onNavOverview: function () {
            this.navTo("overview");
        }
    });
});
