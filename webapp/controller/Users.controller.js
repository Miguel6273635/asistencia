sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "com/mitsu/monitorasistencia/model/formatter",
    "com/mitsu/monitorasistencia/model/BulkUserImport",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (BaseController, formatter, BulkUserImport, JSONModel, MessageToast, MessageBox) {
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
            this.setModel(new JSONModel({
                fileName: "",
                rows: [],
                stats: { total: 0, valid: 0, invalid: 0, selected: 0 }
            }), "bulk");
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
            this.byId("userBirthDate").setValue("");
            this.byId("userCurp").setValue("");
            this.byId("userCurp").setValueState("None");
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
            var sBirthDate = this.byId("userBirthDate").getValue();
            var sCurp = this.byId("userCurp").getValue().trim().toUpperCase();
            var sCenterId = this.byId("userCenter").getSelectedKey();
            var sScheduleId = this.byId("userSchedule").getSelectedKey();
            var sRole = this.byId("userRole").getSelectedKey();

            if (!sName || !sNumber || !sBirthDate || !sCurp || !sCenterId || !sScheduleId) {
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

            if (aEmployees.some(function (oEmployee) { return BulkUserImport.normalize(oEmployee.name) === BulkUserImport.normalize(sName); })) {
                MessageToast.show("Ya existe un usuario con el mismo nombre");
                return;
            }

            if (aEmployees.some(function (oEmployee) { return oEmployee.curp && BulkUserImport.normalize(oEmployee.curp) === BulkUserImport.normalize(sCurp); })) {
                MessageToast.show("La CURP ya está registrada");
                return;
            }

            var aNameParts = sName.split(/\s+/);
            var oCurpRow = {
                firstNames: aNameParts.slice(0, Math.max(1, aNameParts.length - 2)).join(" "),
                paternalSurname: aNameParts.length > 1 ? aNameParts[aNameParts.length - 2] : "",
                maternalSurname: aNameParts.length > 2 ? aNameParts[aNameParts.length - 1] : "",
                curp: sCurp,
                birthDate: sBirthDate
            };
            var sCurpError = BulkUserImport.validateCurp(oCurpRow);
            if (sCurpError) {
                this.byId("userCurp").setValueState("Error");
                this.byId("userCurp").setValueStateText(sCurpError);
                MessageToast.show(sCurpError);
                return;
            }

            aEmployees.push({
                id: "emp-" + Date.now(),
                number: sNumber.toUpperCase(),
                name: sName,
                curp: sCurp,
                birthDate: sBirthDate,
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

        onCurpLiveChange: function (oEvent) {
            var oInput = oEvent.getSource();
            oInput.setValue(oEvent.getParameter("value").toUpperCase());
            oInput.setValueState("None");
        },

        onOpenBulkDialog: function () {
            this.byId("bulkUserDialog").open();
            BulkUserImport.ensureReady().catch(function (oError) {
                MessageBox.error(oError.message);
            });
        },

        onCloseBulkDialog: function () {
            this.byId("bulkUserDialog").close();
        },

        onDownloadBulkTemplate: function () {
            var oAttendanceModel = this.getModel("attendance");
            BulkUserImport.downloadTemplate(
                oAttendanceModel.getProperty("/centers") || [],
                oAttendanceModel.getProperty("/schedules") || []
            ).then(function () {
                MessageToast.show("Plantilla Excel descargada");
            }).catch(function (oError) {
                MessageBox.error(oError.message);
            });
        },

        onBulkFileChange: function (oEvent) {
            var oFile = (oEvent.getParameter("files") || [])[0];
            if (!oFile) {
                return;
            }
            var oBulkModel = this.getModel("bulk");
            oBulkModel.setProperty("/fileName", oFile.name);
            this.byId("bulkUserDialog").setBusy(true);
            BulkUserImport.readFile(oFile).then(function (aRows) {
                oBulkModel.setProperty("/rows", aRows);
                this._validateBulkRows();
                if (!aRows.length) {
                    MessageBox.warning("El archivo no contiene filas de usuarios.");
                } else {
                    MessageToast.show(aRows.length + " filas leídas; revisa el resultado de validación");
                }
            }.bind(this)).catch(function (oError) {
                oBulkModel.setProperty("/rows", []);
                oBulkModel.setProperty("/stats", { total: 0, valid: 0, invalid: 0, selected: 0 });
                MessageBox.error(oError.message);
            }).finally(function () {
                this.byId("bulkUserDialog").setBusy(false);
            }.bind(this));
        },

        onBulkCellChange: function () {
            this._validateBulkRows();
        },

        onDiscardBulkFile: function () {
            MessageBox.confirm(
                "Se eliminarán del diálogo todas las filas importadas y las correcciones realizadas. El archivo original de tu equipo no será eliminado.",
                {
                    title: "Descartar archivo Excel",
                    actions: ["Descartar", "Cancelar"],
                    emphasizedAction: "Descartar",
                    onClose: function (sAction) {
                        if (sAction === "Descartar") {
                            this._clearBulkImport();
                            MessageToast.show("Archivo Excel descartado");
                        }
                    }.bind(this)
                }
            );
        },

        _clearBulkImport: function () {
            var oBulkModel = this.getModel("bulk");
            var oFileUploader = this.byId("bulkFileUploader");
            oBulkModel.setData({
                fileName: "",
                rows: [],
                stats: { total: 0, valid: 0, invalid: 0, selected: 0 }
            });
            if (oFileUploader) {
                if (typeof oFileUploader.clear === "function") {
                    oFileUploader.clear();
                } else {
                    oFileUploader.setValue("");
                }
            }
        },

        onValidateBulkRows: function () {
            this._validateBulkRows();
            var oStats = this.getModel("bulk").getProperty("/stats");
            MessageToast.show(oStats.valid + " válidos y " + oStats.invalid + " con observaciones");
        },

        _validateBulkRows: function () {
            var oAttendanceModel = this.getModel("attendance");
            var oBulkModel = this.getModel("bulk");
            var aRows = oBulkModel.getProperty("/rows") || [];
            BulkUserImport.validateRows(aRows, {
                employees: oAttendanceModel.getProperty("/employees") || [],
                centers: oAttendanceModel.getProperty("/centers") || [],
                schedules: oAttendanceModel.getProperty("/schedules") || []
            });
            oBulkModel.setProperty("/rows", aRows);
            oBulkModel.setProperty("/stats", BulkUserImport.stats(aRows));
            oBulkModel.refresh(true);
        },

        onImportValidUsers: function () {
            this._validateBulkRows();
            var oBulkModel = this.getModel("bulk");
            var aRows = oBulkModel.getProperty("/rows") || [];
            var aValid = aRows.filter(function (oRow) { return oRow.state === "Success"; });
            var aInvalid = aRows.filter(function (oRow) { return oRow.state !== "Success"; });
            if (!aValid.length) {
                MessageBox.warning("No hay usuarios válidos para cargar.");
                return;
            }

            var oAttendanceModel = this.getModel("attendance");
            var aEmployees = oAttendanceModel.getProperty("/employees") || [];
            var sUpdate = new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short" }).format(new Date());
            aValid.forEach(function (oRow, iIndex) {
                var aWords = oRow.name.split(/\s+/);
                aEmployees.push({
                    id: "emp-bulk-" + Date.now() + "-" + iIndex,
                    number: oRow.number,
                    name: oRow.name,
                    initials: aWords.slice(0, 2).map(function (sWord) { return sWord.charAt(0).toUpperCase(); }).join(""),
                    curp: oRow.curp,
                    birthDate: oRow.birthDate,
                    centerId: oRow.center.id,
                    center: oRow.center.name,
                    zoneId: oRow.center.zoneId,
                    shift: oRow.schedule.type,
                    scheduleId: oRow.schedule.id,
                    scheduleName: oRow.schedule.name,
                    scheduleCode: oRow.schedule.code,
                    scheduleDescription: oRow.schedule.shortDescription,
                    role: oRow.role,
                    entry: "—",
                    exit: "—",
                    hours: "0:00",
                    status: "Incompleto",
                    active: oRow.active,
                    lastUpdate: sUpdate
                });
            });

            oAttendanceModel.setProperty("/employees", aEmployees);
            oAttendanceModel.refresh(true);
            oBulkModel.setProperty("/rows", aInvalid);
            this._validateBulkRows();
            this._loadUsers();
            MessageBox.success(aValid.length + " usuarios cargados correctamente." + (aInvalid.length ? " " + aInvalid.length + " filas permanecen pendientes para corregir o descargar." : ""));
        },

        onDownloadRejectedUsers: function () {
            var aRejected = (this.getModel("bulk").getProperty("/rows") || []).filter(function (oRow) { return oRow.state !== "Success"; });
            if (!aRejected.length) {
                MessageToast.show("No hay filas rechazadas");
                return;
            }
            BulkUserImport.downloadRejected(aRejected).then(function () {
                MessageToast.show("Reporte de usuarios no cargados descargado");
            }).catch(function (oError) {
                MessageBox.error(oError.message);
            });
        },

        onExport: function () {
            MessageToast.show("Aquí se conectará la exportación a Excel");
        },

        onOpenUserPerformance: function (oEvent) {
            var oEmployee = oEvent.getSource().getBindingContext("view").getObject();
            this.navTo("userPerformance", {
                employeeId: oEmployee.id
            });
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
