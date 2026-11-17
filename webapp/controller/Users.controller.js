/* sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "com/mitsu/monitorasistencia/model/formatter",
    "com/mitsu/monitorasistencia/model/AttendanceApi",
    "com/mitsu/monitorasistencia/model/Diagnostics",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], function (BaseController, formatter, AttendanceApi, Diagnostics, JSONModel, MessageBox, MessageToast) {
    "use strict";

    var XLSX = null;
    var ITEM_FIELDS = [
        "PersonnelNumber", "HireDate", "Position", "PersonnelArea", "EmployeeGroup",
        "EmployeeSubgroup", "FirstName", "LastName", "BirthDate", "Language",
        "BirthCountry", "Gender", "PersonnelSubarea", "AttendanceChannel", "Zone",
        "City", "Region", "Municipality", "Country", "ResidenceType", "Schedule", "Email"
    ];
    var UPDATE_ITEM_FIELDS = [
        "PersonnelNumber", "Position", "Zone", "PersonnelSubarea",
        "Schedule"
    ];
    var WEEKLY_DAY_FIELDS = [
        "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado",
        "Domingo"
    ];
    var WEEKLY_ITEM_FIELDS = ["PersonalNumber", "Semana"].concat(
        WEEKLY_DAY_FIELDS
    );
    var UPLOAD_CONFIGURATION = {
        CREATE: {
            title: "Creación masiva de usuarios",
            description: "El Excel debe contener los 22 campos del layout para crear cada usuario con su información completa.",
            fieldsText: "22 campos obligatorios del layout de usuarios",
            placeholder: "Selecciona el Excel completo de nuevos usuarios",
            sendText: "Crear usuarios",
            entitySet: "EmployeesUploadSet"
        },
        UPDATE: {
            title: "Modificación masiva de usuarios",
            description: "La modificación utiliza únicamente nómina, puesto de trabajo, zona, base y horario.",
            fieldsText: "Nómina · Puesto de trabajo · Zona · Base · Horario",
            placeholder: "Selecciona el Excel con los campos que se modificarán",
            sendText: "Modificar usuarios",
            entitySet: "EmployeesUploadSet"
        },
        WEEKLY: {
            title: "Carga semanal de usuarios",
            description: "La carga semanal envía una cabecera con nómina y semana, más las posiciones de lunes a domingo.",
            fieldsText: "Nómina · Semana · Lunes · Martes · Miércoles · Jueves · Viernes · Sábado · Domingo",
            placeholder: "Selecciona el Excel con la semana y los estatus diarios",
            sendText: "Enviar carga semanal",
            entitySet: "WeeklyLoadSet"
        }
    };
    var FIELD_LABELS = {
        PersonnelNumber: "Número de personal",
        HireDate: "Fecha de contratación",
        Position: "Puesto de trabajo",
        PersonnelArea: "División de personal",
        EmployeeGroup: "Grupo de personal",
        EmployeeSubgroup: "Área de personal",
        FirstName: "Nombre",
        LastName: "Apellido",
        BirthDate: "Fecha de nacimiento",
        Language: "Idioma",
        BirthCountry: "País de nacimiento",
        Gender: "Sexo",
        PersonnelSubarea: "Base",
        AttendanceChannel: "Canal de marcaje",
        Zone: "Zona",
        City: "Localidad",
        Region: "Estado / región",
        Municipality: "Municipio",
        Country: "País domicilio",
        ResidenceType: "Tipo de vivienda",
        Schedule: "Horario",
        Email: "Correo electrónico",
        Semana: "Semana",
        Lunes: "Lunes",
        Martes: "Martes",
        Miercoles: "Miércoles",
        Jueves: "Jueves",
        Viernes: "Viernes",
        Sabado: "Sábado",
        Domingo: "Domingo"
    };
    var HEADER_MAP = {
        "personalnumber": "PersonnelNumber",
        "numero de personal": "PersonnelNumber",
        "numero de nomina": "PersonnelNumber",
        "nomina": "PersonnelNumber",
        "fecha de contratacion": "HireDate",
        "posicion": "Position",
        "puesto de trabajo": "Position",
        "division de personal": "PersonnelArea",
        "grupo de personal": "EmployeeGroup",
        "area de personal": "EmployeeSubgroup",
        "nombre": "FirstName",
        "apellido": "LastName",
        "fecha de nacimiento": "BirthDate",
        "idioma": "Language",
        "pais de nacimiento": "BirthCountry",
        "sexo": "Gender",
        "base / subdivision de personal": "PersonnelSubarea",
        "base": "PersonnelSubarea",
        "canal de marcaje": "AttendanceChannel",
        "zona": "Zone",
        "localidad": "City",
        "estado / region": "Region",
        "municipio": "Municipality",
        "pais domicilio": "Country",
        "tipo de vivienda": "ResidenceType",
        "horario": "Schedule",
        "correo electronico": "Email",
        "semana": "Semana",
        "lunes": "Lunes",
        "martes": "Martes",
        "miercoles": "Miercoles",
        "jueves": "Jueves",
        "viernes": "Viernes",
        "sabado": "Sabado",
        "domingo": "Domingo"
    };

    function cleanText(value) {
        return value === null || value === undefined ? "" : String(value).trim();
    }

    function normalizeHeader(value) {
        return cleanText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ");
    }

    function pad(value, length) {
        return String(value).padStart(length, "0");
    }

    return BaseController.extend("com.mitsu.monitorasistencia.controller.Users", {
        formatter: formatter,

        onInit: function () {
            this.setModel(new JSONModel({
                allEmployees: [], employees: [], search: "", status: "all", scheduleId: "",
                uploadEntitySet: "EmployeesUploadSet", uploadOperation: "CREATE",
                uploadProcessingMode: "PARTIAL", uploadBusy: false, uploadFileName: "",
                uploadRows: [], uploadRowCount: 0, uploadJson: "", editBusy: false,
                weeklySingleBusy: false,
                uploadDialogTitle: UPLOAD_CONFIGURATION.CREATE.title,
                uploadDescription: UPLOAD_CONFIGURATION.CREATE.description,
                uploadFieldsText: UPLOAD_CONFIGURATION.CREATE.fieldsText,
                uploadPlaceholder: UPLOAD_CONFIGURATION.CREATE.placeholder,
                uploadSendText: UPLOAD_CONFIGURATION.CREATE.sendText,
                editEmployee: this._emptyEmployee(),
                weeklySingle: this._emptyWeeklyRecord(),
                stats: { total: 0, active: 0, inactive: 0, centers: 0 }
            }), "view");
            this._attendanceApi = new AttendanceApi();
            this.getRouter().getRoute("users").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            this.getModel("attendance").dataLoaded().then(this._loadUsers.bind(this));
        },

        _loadUsers: function () {
            var attendance = this.getModel("attendance");
            var employees = attendance.getProperty("/employees") || [];
            var schedules = attendance.getProperty("/schedules") || [];
            var scheduleMap = schedules.reduce(function (result, schedule) {
                result[schedule.id] = schedule;
                return result;
            }, {});
            employees.forEach(function (employee) {
                var schedule = scheduleMap[employee.scheduleId] || {};
                employee.scheduleName = schedule.name || employee.scheduleName || "Sin horario asignado";
                employee.scheduleCode = employee.scheduleCode || schedule.code || employee.Schedule || "";
                employee.scheduleDescription = schedule.shortDescription || employee.scheduleDescription || employee.shift || "Pendiente de asignación";
            });
            this.getModel("view").setProperty("/allEmployees", employees);
            Diagnostics.filters("Usuarios", "DATA-LOADED", { total: employees.length, employees: employees });
            this._applyFilters();
        },

        _applyFilters: function () {
            var model = this.getModel("view");
            var search = cleanText(model.getProperty("/search")).toLowerCase();
            var status = model.getProperty("/status");
            var scheduleId = model.getProperty("/scheduleId") || "";
            var employees = model.getProperty("/allEmployees") || [];
            var filtered = employees.filter(function (employee) {
                var statusMatches = status === "all" || (status === "active" && employee.active) || (status === "inactive" && !employee.active);
                var scheduleMatches = !scheduleId || employee.scheduleId === scheduleId;
                var haystack = [employee.name, employee.number, employee.email, employee.center, employee.scheduleName,
                    employee.scheduleDescription, employee.position, employee.zone].join(" ").toLowerCase();
                return statusMatches && scheduleMatches && (!search || haystack.includes(search));
            });
            var sapSummary = this.getModel("attendance").getProperty("/employeeSummary") || {};
            var centers = Array.from(new Set(employees.map(function (employee) { return employee.centerId; }).filter(Boolean)));
            model.setProperty("/employees", filtered);
            model.setProperty("/stats", {
                total: Number(sapSummary.total) || employees.length,
                active: Number(sapSummary.active) || employees.filter(function (employee) { return employee.active; }).length,
                inactive: Number(sapSummary.inactive) || employees.filter(function (employee) { return !employee.active; }).length,
                centers: Number(sapSummary.centers) || centers.length
            });
            Diagnostics.filters("Usuarios", "APPLIED", {
                search: search, status: status, scheduleId: scheduleId,
                sourceRows: employees.length, resultRows: filtered.length
            });
        },

        onSearch: function (event) {
            this.getModel("view").setProperty("/search", event.getParameter("newValue"));
            this._applyFilters();
        },

        onFilterChange: function () { this._applyFilters(); },

        onToggleUserStatus: function () {
            MessageToast.show("La baja lógica requiere un EntitySet de actualización confirmado por SAP.");
        },

        _requestId: function () {
            var now = new Date();
            return now.getFullYear() + pad(now.getMonth() + 1, 2) + pad(now.getDate(), 2) + "-" +
                pad(now.getHours(), 2) + pad(now.getMinutes(), 2) + pad(now.getSeconds(), 2);
        },

        _emptyEmployee: function () {
            return ITEM_FIELDS.concat(["Semana"]).concat(WEEKLY_DAY_FIELDS).reduce(function (result, field) {
                result[field] = "";
                return result;
            }, {});
        },

        _emptyWeeklyRecord: function () {
            return WEEKLY_ITEM_FIELDS.reduce(function (result, field) {
                result[field] = "";
                return result;
            }, {});
        },

        _fieldsForOperation: function (operation) {
            if (operation === "UPDATE") {
                return UPDATE_ITEM_FIELDS;
            }
            if (operation === "WEEKLY") {
                return WEEKLY_ITEM_FIELDS;
            }
            return ITEM_FIELDS;
        },

        _requiredFieldsForOperation: function (operation) {
            if (operation === "UPDATE") {
                return UPDATE_ITEM_FIELDS;
            }
            if (operation === "WEEKLY") {
                return ["PersonalNumber", "Semana"];
            }
            return ITEM_FIELDS;
        },

        _ensureXlsx: function () {
            if (XLSX && XLSX.read && XLSX.writeFile && XLSX.utils) {
                return Promise.resolve(XLSX);
            }
            if (!this._xlsxPromise) {
                this._xlsxPromise = new Promise(function (resolve, reject) {
                    sap.ui.require([
                        "com/mitsu/monitorasistencia/thirdparty/xlsx"
                    ], function (XlsxModule) {
                        XLSX = XlsxModule && (XlsxModule.default || XlsxModule);
                        if (!XLSX || !XLSX.read || !XLSX.writeFile || !XLSX.utils) {
                            reject(new Error(
                                "La biblioteca local de Excel no expuso la API XLSX esperada."
                            ));
                            return;
                        }
                        Diagnostics.upload("XLSX-READY", {
                            source: "thirdparty/xlsx.js",
                            version: XLSX.version || "sin versión"
                        });
                        resolve(XLSX);
                    }, function (error) {
                        reject(new Error(
                            "No se pudo cargar la biblioteca local de Excel. " +
                            ((error && error.message) || "Error de módulo UI5.")
                        ));
                    });
                });
            }
            return this._xlsxPromise.catch(function (error) {
                this._xlsxPromise = null;
                throw error;
            }.bind(this));
        },

        _formatDate: function (value) {
            var date;
            if (value instanceof Date && !isNaN(value.getTime())) {
                date = value;
            } else if (typeof value === "number" && XLSX && XLSX.SSF) {
                var parsed = XLSX.SSF.parse_date_code(value);
                if (parsed) { date = new Date(parsed.y, parsed.m - 1, parsed.d); }
            } else {
                var text = cleanText(value);
                if (/^\d{8}$/.test(text)) { return text; }
                var match = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
                if (match) { return match[3] + pad(match[2], 2) + pad(match[1], 2); }
                match = text.match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/);
                if (match) { return match[1] + pad(match[2], 2) + pad(match[3], 2); }
            }
            return date ? date.getFullYear() + pad(date.getMonth() + 1, 2) + pad(date.getDate(), 2) : "";
        },

        _readWorkbook: function (arrayBuffer, file, operation) {
            if (!XLSX || !XLSX.read) {
                throw new Error("No se cargó el módulo XLSX. Revisa ui5-tooling-modules y vuelve a compilar.");
            }
            var workbook = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
            Diagnostics.upload("WORKBOOK", { file: file.name, sheets: workbook.SheetNames });
            var sheetName = workbook.SheetNames.indexOf("Layout_Carga") >= 0 ? "Layout_Carga" : workbook.SheetNames[0];
            var matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: "" });
            var headerIndex = matrix.findIndex(function (row) {
                return Array.isArray(row) && row.some(function (cell) {
                    return HEADER_MAP[normalizeHeader(cell)] === "PersonnelNumber";
                });
            });
            if (headerIndex < 0) {
                throw new Error("No se encontró la columna 'Número de personal' o 'Nómina'.");
            }
            var mappedHeaders = matrix[headerIndex].map(normalizeHeader).map(function (header) { return HEADER_MAP[header] || ""; });
            var expectedFields = this._fieldsForOperation(operation);
            var missingHeaders = expectedFields.filter(function (field) {
                return mappedHeaders.indexOf(field) < 0;
            });
            if (missingHeaders.length) {
                throw new Error(
                    "Faltan columnas obligatorias: " +
                    missingHeaders.map(function (field) {
                        return FIELD_LABELS[field] || field;
                    }).join(", ") + "."
                );
            }
            Diagnostics.upload("HEADERS", { source: matrix[headerIndex], mapped: mappedHeaders });
            var rows = matrix.slice(headerIndex + 1).filter(function (row) {
                return Array.isArray(row) && row.some(function (cell) { return cleanText(cell); });
            }).map(function (row, rowIndex) {
                var item = this._emptyEmployee();
                mappedHeaders.forEach(function (field, columnIndex) {
                    if (field) {
                        item[field] = field === "HireDate" || field === "BirthDate" ? this._formatDate(row[columnIndex]) : cleanText(row[columnIndex]);
                    }
                }, this);
                item.__excelRow = headerIndex + rowIndex + 2;
                return item;
            }, this);
            Diagnostics.upload("PARSED-ROWS", { count: rows.length, rows: rows });
            return rows;
        },

        _openUploadDialog: function (operation) {
            var model = this.getModel("view");
            var configuration = UPLOAD_CONFIGURATION[operation] ||
                UPLOAD_CONFIGURATION.CREATE;

            model.setProperty("/uploadOperation", operation);
            model.setProperty("/uploadDialogTitle", configuration.title);
            model.setProperty("/uploadDescription", configuration.description);
            model.setProperty("/uploadFieldsText", configuration.fieldsText);
            model.setProperty("/uploadPlaceholder", configuration.placeholder);
            model.setProperty("/uploadSendText", configuration.sendText);
            model.setProperty("/uploadEntitySet", configuration.entitySet);
            model.setProperty("/uploadFileName", "");
            model.setProperty("/uploadRows", []);
            model.setProperty("/uploadRowCount", 0);
            model.setProperty("/uploadJson", "");
            this.byId("employeeExcelUploader").clear();
            this.byId("employeeUploadDialog").open();
        },

        onOpenUploadDialog: function () {
            this._openUploadDialog("CREATE");
        },

        onOpenCreateUpload: function () {
            this._openUploadDialog("CREATE");
        },

        onOpenUpdateUpload: function () {
            this._openUploadDialog("UPDATE");
        },

        onOpenWeeklyUpload: function () {
            this._openUploadDialog("WEEKLY");
        },

        onOpenWeeklySingle: function () {
            var model = this.getModel("view");
            model.setProperty("/weeklySingle", this._emptyWeeklyRecord());
            model.setProperty("/uploadEntitySet", "WeeklyLoadSet");
            this.byId("weeklySingleDialog").open();
        },

        onSubmitWeeklySingle: function () {
            var model = this.getModel("view");
            var row = Object.assign({}, model.getProperty("/weeklySingle"));
            var payload;
            try {
                payload = this._validateUploadPayload(
                    this._buildPayload([row], "WEEKLY")
                );
            } catch (error) {
                MessageBox.error("No se puede enviar la carga semanal. " + error.message);
                return;
            }
            this._sendPayload(
                payload,
                false,
                "weeklySingleDialog",
                "/weeklySingleBusy"
            );
        },

        onCloseWeeklySingle: function () {
            if (!this.getModel("view").getProperty("/weeklySingleBusy")) {
                this.byId("weeklySingleDialog").close();
            }
        },

        onExcelSelected: function (event) {
            var file = event.getParameter("files") && event.getParameter("files")[0];
            if (!file) { return; }
            Diagnostics.upload("FILE-SELECTED", { name: file.name, type: file.type, size: file.size, lastModified: file.lastModified });
            var model = this.getModel("view");
            model.setProperty("/uploadBusy", true);
            this._ensureXlsx().then(function () {
                var reader = new FileReader();
                reader.onload = function (loadEvent) {
                    try {
                        var operation = model.getProperty("/uploadOperation");
                        var rows = this._readWorkbook(
                            loadEvent.target.result,
                            file,
                            operation
                        );
                        var payload = this._buildPayload(rows, operation);
                        this._validateUploadPayload(payload);
                        model.setProperty("/uploadFileName", file.name);
                        model.setProperty("/uploadRows", rows);
                        model.setProperty("/uploadRowCount", rows.length);
                        model.setProperty("/uploadJson", JSON.stringify(payload, null, 2));
                        MessageToast.show(rows.length + " empleado(s) listos para enviar");
                    } catch (error) {
                        Diagnostics.error("EMPLOYEE-UPLOAD", error, { file: file.name });
                        model.setProperty("/uploadRows", []);
                        model.setProperty("/uploadRowCount", 0);
                        model.setProperty("/uploadJson", "");
                        MessageBox.error("No fue posible leer el Excel. " + error.message);
                    } finally { model.setProperty("/uploadBusy", false); }
                }.bind(this);
                reader.onerror = function () {
                    model.setProperty("/uploadBusy", false);
                    MessageBox.error("El navegador no pudo leer el archivo seleccionado.");
                };
                reader.readAsArrayBuffer(file);
            }.bind(this)).catch(function (error) {
                Diagnostics.error("EMPLOYEE-UPLOAD", error, { file: file.name, phase: "LOAD-XLSX" });
                model.setProperty("/uploadBusy", false);
                MessageBox.error("No fue posible preparar la carga de Excel. " + error.message);
            });
        },

        onUploadOperationChange: function () {
            var model = this.getModel("view");
            var rows = model.getProperty("/uploadRows") || [];
            if (rows.length) {
                var payload = this._buildPayload(rows, model.getProperty("/uploadOperation"));
                model.setProperty("/uploadJson", JSON.stringify(payload, null, 2));
                Diagnostics.upload("OPERATION-CHANGED", payload);
            }
        },

        _buildPayload: function (rows, operation) {
            if (operation === "WEEKLY") {
                return this._buildWeeklyPayload(rows);
            }
            var requestId = this._requestId();
            var fields = this._fieldsForOperation(operation);
            var items = rows.map(function (row, index) {
                var item = { RequestId: requestId, ItemNo: pad(index + 1, 5) };
                fields.forEach(function (field) {
                    item[field] = cleanText(row[field]);
                });
                return item;
            });
            var payload = { RequestId: requestId, Operation: operation || "CREATE", ProcessingMode: "PARTIAL", ToEmployeesUpload: items };
            Diagnostics.upload("PAYLOAD-BUILT", payload);
            return payload;
        },

        _buildWeeklyPayload: function (rows) {
            var firstRow = rows[0] || {};
            var weeks = Array.from(new Set(rows.map(function (row) {
                return cleanText(row.Semana);
            }).filter(Boolean)));
            if (weeks.length > 1) {
                throw new Error("La carga semanal debe contener una sola semana por archivo.");
            }
            var payload = {
                PersonalNumber: cleanText(firstRow.PersonalNumber),
                Semana: cleanText(firstRow.Semana),
                WeeklyLoadSet: rows.map(function (row) {
                    var item = {
                        PersonalNumber: cleanText(row.PersonalNumber),
                        Semana: ""
                    };
                    WEEKLY_DAY_FIELDS.forEach(function (field) {
                        item[field] = cleanText(row[field]);
                    });
                    item.StatusRequest = "";
                    item.Message = "";
                    return item;
                })
            };
            Diagnostics.upload("WEEKLY-PAYLOAD-BUILT", payload);
            return payload;
        },

        _validateUploadPayload: function (payload) {
            if (Array.isArray(payload && payload.WeeklyLoadSet)) {
                return this._validateWeeklyPayload(payload);
            }
            var operation = cleanText(payload && payload.Operation) || "CREATE";
            var requiredFields = this._requiredFieldsForOperation(operation);

            ["RequestId", "Operation", "ProcessingMode"].forEach(function (field) {
                if (!cleanText(payload && payload[field])) { throw new Error("Falta el campo de cabecera " + field + "."); }
            });
            if (!Array.isArray(payload.ToEmployeesUpload) || !payload.ToEmployeesUpload.length) {
                throw new Error("El Excel no contiene empleados para procesar.");
            }
            payload.ToEmployeesUpload.forEach(function (item, index) {
                var missing = requiredFields.find(function (field) {
                    return !cleanText(item[field]);
                });
                if (missing) {
                    throw new Error(
                        "Fila " + (index + 2) + ": falta " +
                        (FIELD_LABELS[missing] || missing) + "."
                    );
                }
                if (operation === "CREATE" && !/^\d{8}$/.test(item.HireDate)) {
                    throw new Error("Fila " + (index + 2) + ": HireDate debe usar AAAAMMDD.");
                }
                if (operation === "CREATE" && cleanText(item.BirthDate) && !/^\d{8}$/.test(item.BirthDate)) {
                    throw new Error("Fila " + (index + 2) + ": BirthDate debe usar AAAAMMDD o quedar vacío.");
                }
                if (operation === "CREATE" && !/^\S+@\S+\.\S+$/.test(item.Email)) {
                    throw new Error("Fila " + (index + 2) + ": el correo no es válido.");
                }
                if (item.RequestId !== payload.RequestId) { throw new Error("Fila " + (index + 2) + ": RequestId no coincide."); }
            });
            Diagnostics.upload("VALIDATED", { count: payload.ToEmployeesUpload.length, operation: payload.Operation });
            return payload;
        },

        _validateWeeklyPayload: function (payload) {
            if (!cleanText(payload.PersonalNumber)) {
                throw new Error("Falta PersonalNumber en la cabecera semanal.");
            }
            if (!/^\d{6}$/.test(cleanText(payload.Semana))) {
                throw new Error("Semana debe usar el formato AAAASS, por ejemplo 202646.");
            }
            if (!Array.isArray(payload.WeeklyLoadSet) || !payload.WeeklyLoadSet.length) {
                throw new Error("El Excel no contiene posiciones para la carga semanal.");
            }
            payload.WeeklyLoadSet.forEach(function (item, index) {
                if (!cleanText(item.PersonalNumber)) {
                    throw new Error("Fila " + (index + 2) + ": falta Número de personal.");
                }
                if (!WEEKLY_DAY_FIELDS.some(function (field) {
                    return cleanText(item[field]);
                })) {
                    throw new Error("Fila " + (index + 2) + ": captura al menos un estatus entre lunes y domingo.");
                }
            });
            Diagnostics.upload("WEEKLY-VALIDATED", {
                semana: payload.Semana,
                count: payload.WeeklyLoadSet.length
            });
            return payload;
        },

        onSubmitEmployeeUpload: function () {
            var model = this.getModel("view");
            var payload;
            try { payload = this._validateUploadPayload(JSON.parse(model.getProperty("/uploadJson") || "{}")); }
            catch (error) { MessageBox.error("No se puede enviar la carga. " + error.message); return; }
            this._sendPayload(payload, false);
        },

        _sendPayload: function (payload, editing, dialogId, busyPath) {
            var model = this.getModel("view");
            var entitySet = cleanText(model.getProperty("/uploadEntitySet")) || "EmployeesUploadSet";
            var activeBusyPath = busyPath || (editing ? "/editBusy" : "/uploadBusy");
            var activeDialogId = dialogId || (editing ? "employeeEditDialog" : "employeeUploadDialog");
            model.setProperty(activeBusyPath, true);
            Diagnostics.upload("POST", { entitySet: entitySet, payload: payload });
            this._attendanceApi.uploadEmployees(payload, entitySet).then(function (response) {
                Diagnostics.upload("RESPONSE", response);
                this.byId(activeDialogId).close();
                var total = Array.isArray(payload.WeeklyLoadSet)
                    ? payload.WeeklyLoadSet.length
                    : payload.ToEmployeesUpload.length;
                MessageBox.success(total + " registro(s) enviados a SAP.", { details: JSON.stringify(response, null, 2) });
            }.bind(this)).catch(function (error) {
                Diagnostics.error("EMPLOYEE-UPLOAD", error, { entitySet: entitySet, payload: payload, responseBody: error.responseBody });
                MessageBox.error("SAP rechazó la carga de usuarios.", { details: [error.message, error.responseBody].filter(Boolean).join("\n\n") });
            }).finally(function () { model.setProperty(activeBusyPath, false); });
        },

        onCloseUploadDialog: function () {
            if (!this.getModel("view").getProperty("/uploadBusy")) { this.byId("employeeUploadDialog").close(); }
        },

        onOpenEmployeeEdit: function (event) {
            var context = event.getSource().getBindingContext("view");
            var source = context && context.getObject();
            if (!source) { return; }
            var item = this._emptyEmployee();
            ITEM_FIELDS.forEach(function (field) { item[field] = cleanText(source[field]); });
            item.PersonnelNumber = item.PersonnelNumber || cleanText(source.number);
            item.FirstName = item.FirstName || cleanText(source.firstName) || cleanText(source.name);
            item.LastName = item.LastName || cleanText(source.lastName);
            item.Position = item.Position || cleanText(source.position) || cleanText(source.role);
            item.PersonnelArea = item.PersonnelArea || cleanText(source.personnelArea) || cleanText(source.centerCode);
            item.PersonnelSubarea = item.PersonnelSubarea || cleanText(source.personnelSubarea) || cleanText(source.base);
            item.Zone = item.Zone || cleanText(source.zoneCode) || cleanText(source.zone);
            item.Schedule = item.Schedule || cleanText(source.scheduleCode);
            item.Email = item.Email || cleanText(source.email);
            this.getModel("view").setProperty("/editEmployee", item);
            this.getModel("view").setProperty("/uploadEntitySet", "EmployeesUploadSet");
            Diagnostics.upload("EDIT-OPENED", item);
            this.byId("employeeEditDialog").open();
        },

        onSubmitEmployeeEdit: function () {
            var item = Object.assign({}, this.getModel("view").getProperty("/editEmployee"));
            var payload = this._buildPayload([item], "UPDATE");
            try { this._validateUploadPayload(payload); }
            catch (error) { MessageBox.error("No se puede actualizar el empleado. " + error.message); return; }
            this._sendPayload(payload, true);
        },

        onCloseEmployeeEdit: function () {
            if (!this.getModel("view").getProperty("/editBusy")) { this.byId("employeeEditDialog").close(); }
        },

        onDownloadTemplate: function () {
            this._downloadOperationWorkbook("CREATE", false);
        },

        onDownloadExample: function () {
            this._downloadOperationWorkbook("CREATE", true);
        },

        onDownloadUploadTemplate: function () {
            this._downloadOperationWorkbook(
                this.getModel("view").getProperty("/uploadOperation"),
                false
            );
        },

        onDownloadUploadExample: function () {
            this._downloadOperationWorkbook(
                this.getModel("view").getProperty("/uploadOperation"),
                true
            );
        },

        _exampleRowForOperation: function (operation) {
            var example = {
                PersonnelNumber: "01111199",
                HireDate: "20261115",
                Position: "ANALISTA",
                PersonnelArea: "ML01",
                EmployeeGroup: "X",
                EmployeeSubgroup: "CONFIANZA",
                FirstName: "USUARIO",
                LastName: "EJEMPLO",
                BirthDate: "19900101",
                Language: "ES",
                BirthCountry: "MX",
                Gender: "M",
                PersonnelSubarea: "Base Centro",
                AttendanceChannel: "AMBOS",
                Zone: "ZONA CENTRO",
                City: "CIUDAD DE MÉXICO",
                Region: "CDMX",
                Municipality: "MIGUEL HIDALGO",
                Country: "MX",
                ResidenceType: "PROPIA",
                Schedule: "Z01",
                Email: "USUARIO.EJEMPLO@MELCO.COM.MX",
                Semana: "202646",
                Lunes: "Home Office",
                Martes: "Vacaciones",
                Miercoles: "Sancionado",
                Jueves: "Viaje de negocios",
                Viernes: "Viaje de negocios",
                Sabado: "Incapacidad",
                Domingo: "Cumpleaños"
            };

            return this._fieldsForOperation(operation).map(function (field) {
                return example[field] || "";
            });
        },

        _downloadOperationWorkbook: function (operation, includeExample) {
            var normalizedOperation = UPLOAD_CONFIGURATION[operation]
                ? operation
                : "CREATE";
            var fields = this._fieldsForOperation(normalizedOperation);
            var matrix = [fields.map(function (field) {
                return FIELD_LABELS[field] || field;
            })];
            var fileNames = {
                CREATE: "Plantilla_Creacion_Usuarios.xlsx",
                UPDATE: "Plantilla_Modificacion_Usuarios.xlsx",
                WEEKLY: "Plantilla_Carga_Semanal.xlsx"
            };

            if (includeExample) {
                matrix.push(this._exampleRowForOperation(normalizedOperation));
            }

            this._ensureXlsx().then(function () {
                var worksheet = XLSX.utils.aoa_to_sheet(matrix);
                var workbook = XLSX.utils.book_new();

                XLSX.utils.book_append_sheet(
                    workbook,
                    worksheet,
                    "Layout_Carga"
                );
                XLSX.writeFile(
                    workbook,
                    includeExample
                        ? fileNames[normalizedOperation].replace(
                            "Plantilla_",
                            "Ejemplo_"
                        )
                        : fileNames[normalizedOperation]
                );
            }).catch(function (error) {
                Diagnostics.error("EMPLOYEE-UPLOAD", error, {
                    phase: "DOWNLOAD-TEMPLATE",
                    operation: normalizedOperation
                });
                MessageBox.error(
                    "No fue posible preparar la plantilla. " +
                    error.message
                );
            });
        },

        _scrollUsersTable: function (iDelta) {
            var oContainer = this.byId("usersTableScroll");
            var oDomRef = oContainer && oContainer.getDomRef();
            var oScroller = oDomRef && (oDomRef.querySelector(".sapMScrollContScroll") || oDomRef);
            if (!oScroller) {
                MessageToast.show("La tabla todavía no está lista para desplazarse.");
                return;
            }
            if (typeof oScroller.scrollBy === "function") {
                oScroller.scrollBy({ left: iDelta, top: 0, behavior: "smooth" });
            } else {
                oScroller.scrollLeft += iDelta;
            }
        },

        onScrollUsersLeft: function () {
            this._scrollUsersTable(-720);
        },

        onScrollUsersRight: function () {
            this._scrollUsersTable(720);
        },

        onExport: function () {
            this._ensureXlsx().then(function () {
                var rows = (this.getModel("view").getProperty("/employees") || []).map(function (employee) {
                    var result = {};
                    ITEM_FIELDS.forEach(function (field) { result[field] = cleanText(employee[field]); });
                    return result;
                });
                Diagnostics.upload("EXPORT", { count: rows.length, rows: rows });
                var worksheet = XLSX.utils.json_to_sheet(rows);
                var workbook = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(workbook, worksheet, "Usuarios");
                XLSX.writeFile(workbook, "usuarios-monitor.xlsx");
            }.bind(this)).catch(function (error) {
                Diagnostics.error("EMPLOYEE-UPLOAD", error, { phase: "EXPORT" });
                MessageBox.error("No fue posible preparar la exportación. " + error.message);
            });
        },

        onOpenUserMap: function (event) {
            var employee = event.getSource().getBindingContext("view").getObject();
            this.navTo("mapUser", { zoneId: employee.zoneId, employeeId: employee.id });
        },

        onOpenUserPerformance: function (event) {
            var listItem = event.getParameter && event.getParameter("listItem");
            var context = (listItem || event.getSource()).getBindingContext("view");
            var employee = context && context.getObject();
            if (employee && employee.id) { this.navTo("userPerformance", { employeeId: employee.id }); }
        },

        onNavOverview: function () { this.navTo("overview"); }
    });
});
 */
/* global Promise */
sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "com/mitsu/monitorasistencia/model/formatter",
    "com/mitsu/monitorasistencia/model/AttendanceApi",
    "com/mitsu/monitorasistencia/model/Diagnostics",
    "sap/ui/model/json/JSONModel",
    "sap/ui/dom/includeScript",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], function (BaseController, formatter, AttendanceApi, Diagnostics, JSONModel, includeScript, MessageBox, MessageToast) {
    "use strict";

    var XLSX = null;
    var XLSX_SCRIPT_ID = "mitsu-monitor-xlsx-runtime";

    function hasXlsxApi(candidate) {
        return Boolean(
            candidate && candidate.read && candidate.writeFile && candidate.utils
        );
    }
    var ITEM_FIELDS = [
        "PersonnelNumber", "HireDate", "Position", "PersonnelArea", "EmployeeGroup",
        "EmployeeSubgroup", "FirstName", "LastName", "BirthDate", "Language",
        "BirthCountry", "Gender", "PersonnelSubarea", "AttendanceChannel", "Zone",
        "City", "Region", "Municipality", "Country", "ResidenceType", "Schedule", "Email"
    ];
    var UPDATE_ITEM_FIELDS = [
        "PersonnelNumber", "Position", "Zone", "PersonnelSubarea",
        "Schedule"
    ];
    var WEEKLY_DAY_FIELDS = [
        "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado",
        "Domingo"
    ];
    var WEEKLY_ITEM_FIELDS = ["PersonalNumber", "Semana"].concat(
        WEEKLY_DAY_FIELDS
    );
    var UPLOAD_CONFIGURATION = {
        CREATE: {
            title: "Creación masiva de usuarios",
            description: "El Excel debe contener los 22 campos del layout para crear cada usuario con su información completa.",
            fieldsText: "22 campos obligatorios del layout de usuarios",
            placeholder: "Selecciona el Excel completo de nuevos usuarios",
            sendText: "Crear usuarios",
            entitySet: "EmployeesUploadSet"
        },
        UPDATE: {
            title: "Modificación masiva de usuarios",
            description: "La modificación utiliza únicamente nómina, puesto de trabajo, zona, base y horario.",
            fieldsText: "Nómina · Puesto de trabajo · Zona · Base · Horario",
            placeholder: "Selecciona el Excel con los campos que se modificarán",
            sendText: "Modificar usuarios",
            entitySet: "EmployeesUploadSet"
        },
        WEEKLY: {
            title: "Carga semanal de usuarios",
            description: "La carga semanal envía una cabecera con nómina y semana, más las posiciones de lunes a domingo.",
            fieldsText: "Nómina · Semana · Lunes · Martes · Miércoles · Jueves · Viernes · Sábado · Domingo",
            placeholder: "Selecciona el Excel con la semana y los estatus diarios",
            sendText: "Enviar carga semanal",
            entitySet: "WeeklyLoadSet"
        }
    };
    var FIELD_LABELS = {
        PersonnelNumber: "Número de personal",
        HireDate: "Fecha de contratación",
        Position: "Puesto de trabajo",
        PersonnelArea: "División de personal",
        EmployeeGroup: "Grupo de personal",
        EmployeeSubgroup: "Área de personal",
        FirstName: "Nombre",
        LastName: "Apellido",
        BirthDate: "Fecha de nacimiento",
        Language: "Idioma",
        BirthCountry: "País de nacimiento",
        Gender: "Sexo",
        PersonnelSubarea: "Base",
        AttendanceChannel: "Canal de marcaje",
        Zone: "Zona",
        City: "Localidad",
        Region: "Estado / región",
        Municipality: "Municipio",
        Country: "País domicilio",
        ResidenceType: "Tipo de vivienda",
        Schedule: "Horario",
        Email: "Correo electrónico",
        Semana: "Semana",
        Lunes: "Lunes",
        Martes: "Martes",
        Miercoles: "Miércoles",
        Jueves: "Jueves",
        Viernes: "Viernes",
        Sabado: "Sábado",
        Domingo: "Domingo"
    };
    var HEADER_MAP = {
        "personalnumber": "PersonnelNumber",
        "numero de personal": "PersonnelNumber",
        "numero de nomina": "PersonnelNumber",
        "nomina": "PersonnelNumber",
        "fecha de contratacion": "HireDate",
        "posicion": "Position",
        "puesto de trabajo": "Position",
        "division de personal": "PersonnelArea",
        "grupo de personal": "EmployeeGroup",
        "area de personal": "EmployeeSubgroup",
        "nombre": "FirstName",
        "apellido": "LastName",
        "fecha de nacimiento": "BirthDate",
        "idioma": "Language",
        "pais de nacimiento": "BirthCountry",
        "sexo": "Gender",
        "base / subdivision de personal": "PersonnelSubarea",
        "base": "PersonnelSubarea",
        "canal de marcaje": "AttendanceChannel",
        "zona": "Zone",
        "localidad": "City",
        "estado / region": "Region",
        "municipio": "Municipality",
        "pais domicilio": "Country",
        "tipo de vivienda": "ResidenceType",
        "horario": "Schedule",
        "correo electronico": "Email",
        "semana": "Semana",
        "lunes": "Lunes",
        "martes": "Martes",
        "miercoles": "Miercoles",
        "jueves": "Jueves",
        "viernes": "Viernes",
        "sabado": "Sabado",
        "domingo": "Domingo"
    };

    function cleanText(value) {
        return value === null || value === undefined ? "" : String(value).trim();
    }

    function normalizeHeader(value) {
        return cleanText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ");
    }

    function pad(value, length) {
        return String(value).padStart(length, "0");
    }

    return BaseController.extend("com.mitsu.monitorasistencia.controller.Users", {
        formatter: formatter,

        onInit: function () {
            this.setModel(new JSONModel({
                allEmployees: [], employees: [], search: "", status: "all", scheduleId: "",
                uploadEntitySet: "EmployeesUploadSet", uploadOperation: "CREATE",
                uploadProcessingMode: "PARTIAL", uploadBusy: false, uploadFileName: "",
                uploadRows: [], uploadRowCount: 0, uploadJson: "", editBusy: false,
                weeklySingleBusy: false,
                uploadDialogTitle: UPLOAD_CONFIGURATION.CREATE.title,
                uploadDescription: UPLOAD_CONFIGURATION.CREATE.description,
                uploadFieldsText: UPLOAD_CONFIGURATION.CREATE.fieldsText,
                uploadPlaceholder: UPLOAD_CONFIGURATION.CREATE.placeholder,
                uploadSendText: UPLOAD_CONFIGURATION.CREATE.sendText,
                editEmployee: this._emptyEmployee(),
                weeklySingle: this._emptyWeeklyRecord(),
                stats: { total: 0, active: 0, inactive: 0, centers: 0 }
            }), "view");
            this._attendanceApi = new AttendanceApi();
            this.getRouter().getRoute("users").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            this.getModel("attendance").dataLoaded().then(this._loadUsers.bind(this));
        },

        _loadUsers: function () {
            var attendance = this.getModel("attendance");
            var employees = attendance.getProperty("/employees") || [];
            var schedules = attendance.getProperty("/schedules") || [];
            var scheduleMap = schedules.reduce(function (result, schedule) {
                result[schedule.id] = schedule;
                return result;
            }, {});
            employees.forEach(function (employee) {
                var schedule = scheduleMap[employee.scheduleId] || {};
                employee.scheduleName = schedule.name || employee.scheduleName || "Sin horario asignado";
                employee.scheduleCode = employee.scheduleCode || schedule.code || employee.Schedule || "";
                employee.scheduleDescription = schedule.shortDescription || employee.scheduleDescription || employee.shift || "Pendiente de asignación";
            });
            this.getModel("view").setProperty("/allEmployees", employees);
            Diagnostics.filters("Usuarios", "DATA-LOADED", { total: employees.length, employees: employees });
            this._applyFilters();
        },

        _applyFilters: function () {
            var model = this.getModel("view");
            var search = cleanText(model.getProperty("/search")).toLowerCase();
            var status = model.getProperty("/status");
            var scheduleId = model.getProperty("/scheduleId") || "";
            var employees = model.getProperty("/allEmployees") || [];
            var filtered = employees.filter(function (employee) {
                var statusMatches = status === "all" || (status === "active" && employee.active) || (status === "inactive" && !employee.active);
                var scheduleMatches = !scheduleId || employee.scheduleId === scheduleId;
                var haystack = [employee.name, employee.number, employee.email, employee.center, employee.scheduleName,
                    employee.scheduleDescription, employee.position, employee.zone].join(" ").toLowerCase();
                return statusMatches && scheduleMatches && (!search || haystack.includes(search));
            });
            var sapSummary = this.getModel("attendance").getProperty("/employeeSummary") || {};
            var centers = Array.from(new Set(employees.map(function (employee) { return employee.centerId; }).filter(Boolean)));
            model.setProperty("/employees", filtered);
            model.setProperty("/stats", {
                total: Number(sapSummary.total) || employees.length,
                active: Number(sapSummary.active) || employees.filter(function (employee) { return employee.active; }).length,
                inactive: Number(sapSummary.inactive) || employees.filter(function (employee) { return !employee.active; }).length,
                centers: Number(sapSummary.centers) || centers.length
            });
            Diagnostics.filters("Usuarios", "APPLIED", {
                search: search, status: status, scheduleId: scheduleId,
                sourceRows: employees.length, resultRows: filtered.length
            });
        },

        onSearch: function (event) {
            this.getModel("view").setProperty("/search", event.getParameter("newValue"));
            this._applyFilters();
        },

        onFilterChange: function () { this._applyFilters(); },

        onToggleUserStatus: function () {
            MessageToast.show("La baja lógica requiere un EntitySet de actualización confirmado por SAP.");
        },

        _requestId: function () {
            var now = new Date();
            return now.getFullYear() + pad(now.getMonth() + 1, 2) + pad(now.getDate(), 2) + "-" +
                pad(now.getHours(), 2) + pad(now.getMinutes(), 2) + pad(now.getSeconds(), 2);
        },

        _emptyEmployee: function () {
            return ITEM_FIELDS.concat(["Semana"]).concat(WEEKLY_DAY_FIELDS).reduce(function (result, field) {
                result[field] = "";
                return result;
            }, {});
        },

        _emptyWeeklyRecord: function () {
            return WEEKLY_ITEM_FIELDS.reduce(function (result, field) {
                result[field] = "";
                return result;
            }, {});
        },

        _fieldsForOperation: function (operation) {
            if (operation === "UPDATE") {
                return UPDATE_ITEM_FIELDS;
            }
            if (operation === "WEEKLY") {
                return WEEKLY_ITEM_FIELDS;
            }
            return ITEM_FIELDS;
        },

        _requiredFieldsForOperation: function (operation) {
            if (operation === "UPDATE") {
                return UPDATE_ITEM_FIELDS;
            }
            if (operation === "WEEKLY") {
                return ["PersonalNumber", "Semana"];
            }
            return ITEM_FIELDS;
        },

        _ensureXlsx: function () {
            if (!hasXlsxApi(XLSX) && hasXlsxApi(window.XLSX)) {
                XLSX = window.XLSX;
            }
            if (hasXlsxApi(XLSX)) {
                return Promise.resolve(XLSX);
            }
            if (!this._xlsxPromise) {
                var libraryResource =
                    "com/mitsu/monitorasistencia/thirdparty/xlsx.full.min.js";
                var libraryUrl = sap.ui.require.toUrl(libraryResource);

                this._xlsxPromise = includeScript({
                    url: libraryUrl,
                    id: XLSX_SCRIPT_ID
                }).then(function () {
                    XLSX = window.XLSX;
                    if (!hasXlsxApi(XLSX)) {
                        throw new Error(
                            "La biblioteca local de Excel no expuso la API XLSX esperada."
                        );
                    }
                    Diagnostics.upload("XLSX-READY", {
                        source: "local:thirdparty/xlsx.full.min.js",
                        version: XLSX.version || "sin versión"
                    });
                    return XLSX;
                }, function () {
                    throw new Error(
                        "No se pudo cargar la biblioteca local de Excel desde " +
                        libraryUrl + "."
                    );
                });
            }
            return this._xlsxPromise.catch(function (error) {
                this._xlsxPromise = null;
                throw error;
            }.bind(this));
        },

        _formatDate: function (value) {
            var date;
            if (value instanceof Date && !isNaN(value.getTime())) {
                date = value;
            } else if (typeof value === "number" && XLSX && XLSX.SSF) {
                var parsed = XLSX.SSF.parse_date_code(value);
                if (parsed) { date = new Date(parsed.y, parsed.m - 1, parsed.d); }
            } else {
                var text = cleanText(value);
                if (/^\d{8}$/.test(text)) { return text; }
                var match = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
                if (match) { return match[3] + pad(match[2], 2) + pad(match[1], 2); }
                match = text.match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/);
                if (match) { return match[1] + pad(match[2], 2) + pad(match[3], 2); }
            }
            return date ? date.getFullYear() + pad(date.getMonth() + 1, 2) + pad(date.getDate(), 2) : "";
        },

        _readWorkbook: function (arrayBuffer, file, operation) {
            if (!XLSX || !XLSX.read) {
                throw new Error("No se cargó el módulo XLSX. Revisa ui5-tooling-modules y vuelve a compilar.");
            }
            var workbook = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
            Diagnostics.upload("WORKBOOK", { file: file.name, sheets: workbook.SheetNames });
            var sheetName = workbook.SheetNames.indexOf("Layout_Carga") >= 0 ? "Layout_Carga" : workbook.SheetNames[0];
            var matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: "" });
            var headerIndex = matrix.findIndex(function (row) {
                return Array.isArray(row) && row.some(function (cell) {
                    return HEADER_MAP[normalizeHeader(cell)] === "PersonnelNumber";
                });
            });
            if (headerIndex < 0) {
                throw new Error("No se encontró la columna 'Número de personal' o 'Nómina'.");
            }
            var mappedHeaders = matrix[headerIndex].map(normalizeHeader).map(function (header) { return HEADER_MAP[header] || ""; });
            var expectedFields = this._fieldsForOperation(operation);
            var missingHeaders = expectedFields.filter(function (field) {
                return mappedHeaders.indexOf(field) < 0;
            });
            if (missingHeaders.length) {
                throw new Error(
                    "Faltan columnas obligatorias: " +
                    missingHeaders.map(function (field) {
                        return FIELD_LABELS[field] || field;
                    }).join(", ") + "."
                );
            }
            Diagnostics.upload("HEADERS", { source: matrix[headerIndex], mapped: mappedHeaders });
            var rows = matrix.slice(headerIndex + 1).filter(function (row) {
                return Array.isArray(row) && row.some(function (cell) { return cleanText(cell); });
            }).map(function (row, rowIndex) {
                var item = this._emptyEmployee();
                mappedHeaders.forEach(function (field, columnIndex) {
                    if (field) {
                        item[field] = field === "HireDate" || field === "BirthDate" ? this._formatDate(row[columnIndex]) : cleanText(row[columnIndex]);
                    }
                }, this);
                item.__excelRow = headerIndex + rowIndex + 2;
                return item;
            }, this);
            Diagnostics.upload("PARSED-ROWS", { count: rows.length, rows: rows });
            return rows;
        },

        _openUploadDialog: function (operation) {
            var model = this.getModel("view");
            var configuration = UPLOAD_CONFIGURATION[operation] ||
                UPLOAD_CONFIGURATION.CREATE;

            model.setProperty("/uploadOperation", operation);
            model.setProperty("/uploadDialogTitle", configuration.title);
            model.setProperty("/uploadDescription", configuration.description);
            model.setProperty("/uploadFieldsText", configuration.fieldsText);
            model.setProperty("/uploadPlaceholder", configuration.placeholder);
            model.setProperty("/uploadSendText", configuration.sendText);
            model.setProperty("/uploadEntitySet", configuration.entitySet);
            model.setProperty("/uploadFileName", "");
            model.setProperty("/uploadRows", []);
            model.setProperty("/uploadRowCount", 0);
            model.setProperty("/uploadJson", "");
            this.byId("employeeExcelUploader").clear();
            this.byId("employeeUploadDialog").open();
        },

        onOpenUploadDialog: function () {
            this._openUploadDialog("CREATE");
        },

        onOpenCreateUpload: function () {
            this._openUploadDialog("CREATE");
        },

        onOpenUpdateUpload: function () {
            this._openUploadDialog("UPDATE");
        },

        onOpenWeeklyUpload: function () {
            this._openUploadDialog("WEEKLY");
        },

        onOpenWeeklySingle: function () {
            var model = this.getModel("view");
            model.setProperty("/weeklySingle", this._emptyWeeklyRecord());
            model.setProperty("/uploadEntitySet", "WeeklyLoadSet");
            this.byId("weeklySingleDialog").open();
        },

        onSubmitWeeklySingle: function () {
            var model = this.getModel("view");
            var row = Object.assign({}, model.getProperty("/weeklySingle"));
            var payload;
            try {
                payload = this._validateUploadPayload(
                    this._buildPayload([row], "WEEKLY")
                );
            } catch (error) {
                MessageBox.error("No se puede enviar la carga semanal. " + error.message);
                return;
            }
            this._sendPayload(
                payload,
                false,
                "weeklySingleDialog",
                "/weeklySingleBusy"
            );
        },

        onCloseWeeklySingle: function () {
            if (!this.getModel("view").getProperty("/weeklySingleBusy")) {
                this.byId("weeklySingleDialog").close();
            }
        },

        onExcelSelected: function (event) {
            var file = event.getParameter("files") && event.getParameter("files")[0];
            if (!file) { return; }
            Diagnostics.upload("FILE-SELECTED", { name: file.name, type: file.type, size: file.size, lastModified: file.lastModified });
            var model = this.getModel("view");
            model.setProperty("/uploadBusy", true);
            this._ensureXlsx().then(function () {
                var reader = new FileReader();
                reader.onload = function (loadEvent) {
                    try {
                        var operation = model.getProperty("/uploadOperation");
                        var rows = this._readWorkbook(
                            loadEvent.target.result,
                            file,
                            operation
                        );
                        var payload = this._buildPayload(rows, operation);
                        this._validateUploadPayload(payload);
                        model.setProperty("/uploadFileName", file.name);
                        model.setProperty("/uploadRows", rows);
                        model.setProperty("/uploadRowCount", rows.length);
                        model.setProperty("/uploadJson", JSON.stringify(payload, null, 2));
                        MessageToast.show(rows.length + " empleado(s) listos para enviar");
                    } catch (error) {
                        Diagnostics.error("EMPLOYEE-UPLOAD", error, { file: file.name });
                        model.setProperty("/uploadRows", []);
                        model.setProperty("/uploadRowCount", 0);
                        model.setProperty("/uploadJson", "");
                        MessageBox.error("No fue posible leer el Excel. " + error.message);
                    } finally { model.setProperty("/uploadBusy", false); }
                }.bind(this);
                reader.onerror = function () {
                    model.setProperty("/uploadBusy", false);
                    MessageBox.error("El navegador no pudo leer el archivo seleccionado.");
                };
                reader.readAsArrayBuffer(file);
            }.bind(this)).catch(function (error) {
                Diagnostics.error("EMPLOYEE-UPLOAD", error, { file: file.name, phase: "LOAD-XLSX" });
                model.setProperty("/uploadBusy", false);
                MessageBox.error("No fue posible preparar la carga de Excel. " + error.message);
            });
        },

        onUploadOperationChange: function () {
            var model = this.getModel("view");
            var rows = model.getProperty("/uploadRows") || [];
            if (rows.length) {
                var payload = this._buildPayload(rows, model.getProperty("/uploadOperation"));
                model.setProperty("/uploadJson", JSON.stringify(payload, null, 2));
                Diagnostics.upload("OPERATION-CHANGED", payload);
            }
        },

        _buildPayload: function (rows, operation) {
            if (operation === "WEEKLY") {
                return this._buildWeeklyPayload(rows);
            }
            var requestId = this._requestId();
            var fields = this._fieldsForOperation(operation);
            var items = rows.map(function (row, index) {
                var item = { RequestId: requestId, ItemNo: pad(index + 1, 5) };
                fields.forEach(function (field) {
                    item[field] = cleanText(row[field]);
                });
                return item;
            });
            var payload = { RequestId: requestId, Operation: operation || "CREATE", ProcessingMode: "PARTIAL", ToEmployeesUpload: items };
            Diagnostics.upload("PAYLOAD-BUILT", payload);
            return payload;
        },

        _buildWeeklyPayload: function (rows) {
            var firstRow = rows[0] || {};
            var weeks = Array.from(new Set(rows.map(function (row) {
                return cleanText(row.Semana);
            }).filter(Boolean)));
            if (weeks.length > 1) {
                throw new Error("La carga semanal debe contener una sola semana por archivo.");
            }
            var payload = {
                PersonalNumber: cleanText(firstRow.PersonalNumber),
                Semana: cleanText(firstRow.Semana),
                WeeklyLoadSet: rows.map(function (row) {
                    var item = {
                        PersonalNumber: cleanText(row.PersonalNumber),
                        Semana: ""
                    };
                    WEEKLY_DAY_FIELDS.forEach(function (field) {
                        item[field] = cleanText(row[field]);
                    });
                    item.StatusRequest = "";
                    item.Message = "";
                    return item;
                })
            };
            Diagnostics.upload("WEEKLY-PAYLOAD-BUILT", payload);
            return payload;
        },

        _validateUploadPayload: function (payload) {
            if (Array.isArray(payload && payload.WeeklyLoadSet)) {
                return this._validateWeeklyPayload(payload);
            }
            var operation = cleanText(payload && payload.Operation) || "CREATE";
            var requiredFields = this._requiredFieldsForOperation(operation);

            ["RequestId", "Operation", "ProcessingMode"].forEach(function (field) {
                if (!cleanText(payload && payload[field])) { throw new Error("Falta el campo de cabecera " + field + "."); }
            });
            if (!Array.isArray(payload.ToEmployeesUpload) || !payload.ToEmployeesUpload.length) {
                throw new Error("El Excel no contiene empleados para procesar.");
            }
            payload.ToEmployeesUpload.forEach(function (item, index) {
                var missing = requiredFields.find(function (field) {
                    return !cleanText(item[field]);
                });
                if (missing) {
                    throw new Error(
                        "Fila " + (index + 2) + ": falta " +
                        (FIELD_LABELS[missing] || missing) + "."
                    );
                }
                if (operation === "CREATE" && !/^\d{8}$/.test(item.HireDate)) {
                    throw new Error("Fila " + (index + 2) + ": HireDate debe usar AAAAMMDD.");
                }
                if (operation === "CREATE" && cleanText(item.BirthDate) && !/^\d{8}$/.test(item.BirthDate)) {
                    throw new Error("Fila " + (index + 2) + ": BirthDate debe usar AAAAMMDD o quedar vacío.");
                }
                if (operation === "CREATE" && !/^\S+@\S+\.\S+$/.test(item.Email)) {
                    throw new Error("Fila " + (index + 2) + ": el correo no es válido.");
                }
                if (item.RequestId !== payload.RequestId) { throw new Error("Fila " + (index + 2) + ": RequestId no coincide."); }
            });
            Diagnostics.upload("VALIDATED", { count: payload.ToEmployeesUpload.length, operation: payload.Operation });
            return payload;
        },

        _validateWeeklyPayload: function (payload) {
            if (!cleanText(payload.PersonalNumber)) {
                throw new Error("Falta PersonalNumber en la cabecera semanal.");
            }
            if (!/^\d{6}$/.test(cleanText(payload.Semana))) {
                throw new Error("Semana debe usar el formato AAAASS, por ejemplo 202646.");
            }
            if (!Array.isArray(payload.WeeklyLoadSet) || !payload.WeeklyLoadSet.length) {
                throw new Error("El Excel no contiene posiciones para la carga semanal.");
            }
            payload.WeeklyLoadSet.forEach(function (item, index) {
                if (!cleanText(item.PersonalNumber)) {
                    throw new Error("Fila " + (index + 2) + ": falta Número de personal.");
                }
                if (!WEEKLY_DAY_FIELDS.some(function (field) {
                    return cleanText(item[field]);
                })) {
                    throw new Error("Fila " + (index + 2) + ": captura al menos un estatus entre lunes y domingo.");
                }
            });
            Diagnostics.upload("WEEKLY-VALIDATED", {
                semana: payload.Semana,
                count: payload.WeeklyLoadSet.length
            });
            return payload;
        },

        onSubmitEmployeeUpload: function () {
            var model = this.getModel("view");
            var payload;
            try { payload = this._validateUploadPayload(JSON.parse(model.getProperty("/uploadJson") || "{}")); }
            catch (error) { MessageBox.error("No se puede enviar la carga. " + error.message); return; }
            this._sendPayload(payload, false);
        },

        _sendPayload: function (payload, editing, dialogId, busyPath) {
            var model = this.getModel("view");
            var entitySet = cleanText(model.getProperty("/uploadEntitySet")) || "EmployeesUploadSet";
            var activeBusyPath = busyPath || (editing ? "/editBusy" : "/uploadBusy");
            var activeDialogId = dialogId || (editing ? "employeeEditDialog" : "employeeUploadDialog");
            model.setProperty(activeBusyPath, true);
            Diagnostics.upload("POST", { entitySet: entitySet, payload: payload });
            this._attendanceApi.uploadEmployees(payload, entitySet).then(function (response) {
                Diagnostics.upload("RESPONSE", response);
                this.byId(activeDialogId).close();
                var total = Array.isArray(payload.WeeklyLoadSet)
                    ? payload.WeeklyLoadSet.length
                    : payload.ToEmployeesUpload.length;
                MessageBox.success(total + " registro(s) enviados a SAP.", { details: JSON.stringify(response, null, 2) });
            }.bind(this)).catch(function (error) {
                Diagnostics.error("EMPLOYEE-UPLOAD", error, { entitySet: entitySet, payload: payload, responseBody: error.responseBody });
                MessageBox.error("SAP rechazó la carga de usuarios.", { details: [error.message, error.responseBody].filter(Boolean).join("\n\n") });
            }).finally(function () { model.setProperty(activeBusyPath, false); });
        },

        onCloseUploadDialog: function () {
            if (!this.getModel("view").getProperty("/uploadBusy")) { this.byId("employeeUploadDialog").close(); }
        },

        onOpenEmployeeEdit: function (event) {
            var context = event.getSource().getBindingContext("view");
            var source = context && context.getObject();
            if (!source) { return; }
            var item = this._emptyEmployee();
            ITEM_FIELDS.forEach(function (field) { item[field] = cleanText(source[field]); });
            item.PersonnelNumber = item.PersonnelNumber || cleanText(source.number);
            item.FirstName = item.FirstName || cleanText(source.firstName) || cleanText(source.name);
            item.LastName = item.LastName || cleanText(source.lastName);
            item.Position = item.Position || cleanText(source.position) || cleanText(source.role);
            item.PersonnelArea = item.PersonnelArea || cleanText(source.personnelArea) || cleanText(source.centerCode);
            item.PersonnelSubarea = item.PersonnelSubarea || cleanText(source.personnelSubarea) || cleanText(source.base);
            item.Zone = item.Zone || cleanText(source.zoneCode) || cleanText(source.zone);
            item.Schedule = item.Schedule || cleanText(source.scheduleCode);
            item.Email = item.Email || cleanText(source.email);
            this.getModel("view").setProperty("/editEmployee", item);
            this.getModel("view").setProperty("/uploadEntitySet", "EmployeesUploadSet");
            Diagnostics.upload("EDIT-OPENED", item);
            this.byId("employeeEditDialog").open();
        },

        onSubmitEmployeeEdit: function () {
            var item = Object.assign({}, this.getModel("view").getProperty("/editEmployee"));
            var payload = this._buildPayload([item], "UPDATE");
            try { this._validateUploadPayload(payload); }
            catch (error) { MessageBox.error("No se puede actualizar el empleado. " + error.message); return; }
            this._sendPayload(payload, true);
        },

        onCloseEmployeeEdit: function () {
            if (!this.getModel("view").getProperty("/editBusy")) { this.byId("employeeEditDialog").close(); }
        },

        onDownloadTemplate: function () {
            this._downloadOperationWorkbook("CREATE", false);
        },

        onDownloadExample: function () {
            this._downloadOperationWorkbook("CREATE", true);
        },

        onDownloadUploadTemplate: function () {
            this._downloadOperationWorkbook(
                this.getModel("view").getProperty("/uploadOperation"),
                false
            );
        },

        onDownloadUploadExample: function () {
            this._downloadOperationWorkbook(
                this.getModel("view").getProperty("/uploadOperation"),
                true
            );
        },

        _exampleRowForOperation: function (operation) {
            var example = {
                PersonnelNumber: "01111199",
                HireDate: "20261115",
                Position: "ANALISTA",
                PersonnelArea: "ML01",
                EmployeeGroup: "X",
                EmployeeSubgroup: "CONFIANZA",
                FirstName: "USUARIO",
                LastName: "EJEMPLO",
                BirthDate: "19900101",
                Language: "ES",
                BirthCountry: "MX",
                Gender: "M",
                PersonnelSubarea: "Base Centro",
                AttendanceChannel: "AMBOS",
                Zone: "ZONA CENTRO",
                City: "CIUDAD DE MÉXICO",
                Region: "CDMX",
                Municipality: "MIGUEL HIDALGO",
                Country: "MX",
                ResidenceType: "PROPIA",
                Schedule: "Z01",
                Email: "USUARIO.EJEMPLO@MELCO.COM.MX",
                Semana: "202646",
                Lunes: "Home Office",
                Martes: "Vacaciones",
                Miercoles: "Sancionado",
                Jueves: "Viaje de negocios",
                Viernes: "Viaje de negocios",
                Sabado: "Incapacidad",
                Domingo: "Cumpleaños"
            };

            return this._fieldsForOperation(operation).map(function (field) {
                return example[field] || "";
            });
        },

        _downloadOperationWorkbook: function (operation, includeExample) {
            var normalizedOperation = UPLOAD_CONFIGURATION[operation]
                ? operation
                : "CREATE";
            var fields = this._fieldsForOperation(normalizedOperation);
            var matrix = [fields.map(function (field) {
                return FIELD_LABELS[field] || field;
            })];
            var fileNames = {
                CREATE: "Plantilla_Creacion_Usuarios.xlsx",
                UPDATE: "Plantilla_Modificacion_Usuarios.xlsx",
                WEEKLY: "Plantilla_Carga_Semanal.xlsx"
            };

            if (includeExample) {
                matrix.push(this._exampleRowForOperation(normalizedOperation));
            }

            this._ensureXlsx().then(function () {
                var worksheet = XLSX.utils.aoa_to_sheet(matrix);
                var workbook = XLSX.utils.book_new();

                XLSX.utils.book_append_sheet(
                    workbook,
                    worksheet,
                    "Layout_Carga"
                );
                XLSX.writeFile(
                    workbook,
                    includeExample
                        ? fileNames[normalizedOperation].replace(
                            "Plantilla_",
                            "Ejemplo_"
                        )
                        : fileNames[normalizedOperation]
                );
            }).catch(function (error) {
                Diagnostics.error("EMPLOYEE-UPLOAD", error, {
                    phase: "DOWNLOAD-TEMPLATE",
                    operation: normalizedOperation
                });
                MessageBox.error(
                    "No fue posible preparar la plantilla. " +
                    error.message
                );
            });
        },

        _scrollUsersTable: function (iDelta) {
            var oContainer = this.byId("usersTableScroll");
            var oDomRef = oContainer && oContainer.getDomRef();
            var oScroller = oDomRef && (oDomRef.querySelector(".sapMScrollContScroll") || oDomRef);
            if (!oScroller) {
                MessageToast.show("La tabla todavía no está lista para desplazarse.");
                return;
            }
            if (typeof oScroller.scrollBy === "function") {
                oScroller.scrollBy({ left: iDelta, top: 0, behavior: "smooth" });
            } else {
                oScroller.scrollLeft += iDelta;
            }
        },

        onScrollUsersLeft: function () {
            this._scrollUsersTable(-720);
        },

        onScrollUsersRight: function () {
            this._scrollUsersTable(720);
        },

        onExport: function () {
            this._ensureXlsx().then(function () {
                var rows = (this.getModel("view").getProperty("/employees") || []).map(function (employee) {
                    var result = {};
                    ITEM_FIELDS.forEach(function (field) { result[field] = cleanText(employee[field]); });
                    return result;
                });
                Diagnostics.upload("EXPORT", { count: rows.length, rows: rows });
                var worksheet = XLSX.utils.json_to_sheet(rows);
                var workbook = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(workbook, worksheet, "Usuarios");
                XLSX.writeFile(workbook, "usuarios-monitor.xlsx");
            }.bind(this)).catch(function (error) {
                Diagnostics.error("EMPLOYEE-UPLOAD", error, { phase: "EXPORT" });
                MessageBox.error("No fue posible preparar la exportación. " + error.message);
            });
        },

        onOpenUserMap: function (event) {
            var employee = event.getSource().getBindingContext("view").getObject();
            this.navTo("mapUser", { zoneId: employee.zoneId, employeeId: employee.id });
        },

        onOpenUserPerformance: function (event) {
            var listItem = event.getParameter && event.getParameter("listItem");
            var context = (listItem || event.getSource()).getBindingContext("view");
            var employee = context && context.getObject();
            if (employee && employee.id) { this.navTo("userPerformance", { employeeId: employee.id }); }
        },

        onNavOverview: function () { this.navTo("overview"); }
    });
});
