
sap.ui.define([
    "com/mitsu/monitorasistencia/controller/BaseController",
    "com/mitsu/monitorasistencia/model/formatter",
    "com/mitsu/monitorasistencia/model/AttendanceApi",
    "com/mitsu/monitorasistencia/model/Diagnostics",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], function (
    BaseController,
    formatter,
    AttendanceApi,
    Diagnostics,
    JSONModel,
    MessageBox,
    MessageToast
) {
    "use strict";

    var XLSX = null;

    var ITEM_FIELDS = [
        "PersonnelNumber", "HireDate", "Position",
        "PersonnelArea", "EmployeeGroup", "EmployeeSubgroup",
        "FirstName", "LastName", "BirthDate", "Language",
        "BirthCountry", "Gender", "PersonnelSubarea",
        "AttendanceChannel", "Zone", "City", "Region",
        "Municipality", "Country", "ResidenceType",
        "Schedule", "Email"
    ];

    var REQUIRED_ITEM_FIELDS = [
        "PersonnelNumber", "HireDate", "Position",
        "PersonnelArea", "FirstName", "LastName", "Email"
    ];

    var HEADER_MAP = {
        "numero de personal": "PersonnelNumber",
        "fecha de contratacion": "HireDate",
        "posicion": "Position",
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
        "canal de marcaje": "AttendanceChannel",
        "zona": "Zone",
        "localidad": "City",
        "estado / region": "Region",
        "municipio": "Municipality",
        "pais domicilio": "Country",
        "tipo de vivienda": "ResidenceType",
        "horario": "Schedule",
        "correo electronico": "Email"
    };

    function cleanText(value) {
        return value === null || value === undefined
            ? ""
            : String(value).trim();
    }

    function normalizeHeader(value) {
        return cleanText(value)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/\s+/g, " ");
    }

    function pad(value, length) {
        return String(value).padStart(length, "0");
    }

    return BaseController.extend(
        "com.mitsu.monitorasistencia.controller.Users",
        {
            formatter: formatter,

            // ==========================================
            // INICIALIZACIÓN
            // ==========================================

            onInit: function () {
                this.setModel(new JSONModel({
                    allEmployees: [],
                    employees: [],
                    search: "",
                    status: "all",
                    scheduleId: "",
                    uploadEntitySet: "EmployeesUploadSet",
                    uploadOperation: "CREATE",
                    uploadProcessingMode: "PARTIAL",
                    uploadBusy: false,
                    uploadFileName: "",
                    uploadRows: [],
                    uploadRowCount: 0,
                    uploadJson: "",
                    editBusy: false,
                    editEmployee: this._emptyEmployee(),
                    stats: {
                        total: 0,
                        active: 0,
                        inactive: 0,
                        centers: 0
                    }
                }), "view");

                this._attendanceApi = new AttendanceApi();

                this.getRouter()
                    .getRoute("users")
                    .attachPatternMatched(
                        this._onRouteMatched,
                        this
                    );
            },

            _onRouteMatched: function () {
                this.getModel("attendance")
                    .dataLoaded()
                    .then(this._loadUsers.bind(this));
            },

            // ==========================================
            // CARGA DE USUARIOS
            // ==========================================

            _loadUsers: function () {
                var attendance = this.getModel("attendance");

                var employees =
                    attendance.getProperty("/employees") || [];

                var schedules =
                    attendance.getProperty("/schedules") || [];

                var scheduleMap = schedules.reduce(
                    function (result, schedule) {
                        result[schedule.id] = schedule;
                        return result;
                    },
                    {}
                );

                employees.forEach(function (employee) {
                    var schedule =
                        scheduleMap[employee.scheduleId] || {};

                    employee.scheduleName =
                        schedule.name ||
                        employee.scheduleName ||
                        "Sin horario asignado";

                    employee.scheduleCode =
                        employee.scheduleCode ||
                        schedule.code ||
                        employee.Schedule ||
                        "";

                    employee.scheduleDescription =
                        schedule.shortDescription ||
                        employee.scheduleDescription ||
                        employee.shift ||
                        "Pendiente de asignación";
                });

                this.getModel("view")
                    .setProperty("/allEmployees", employees);

                Diagnostics.filters("Usuarios", "DATA-LOADED", {
                    total: employees.length,
                    employees: employees
                });

                this._applyFilters();
            },

            // ==========================================
            // FILTROS
            // ==========================================

            _applyFilters: function () {
                var model = this.getModel("view");

                var search = cleanText(
                    model.getProperty("/search")
                ).toLowerCase();

                var status = model.getProperty("/status");

                var scheduleId =
                    model.getProperty("/scheduleId") || "";

                var employees =
                    model.getProperty("/allEmployees") || [];

                var filtered = employees.filter(
                    function (employee) {
                        var statusMatches =
                            status === "all" ||
                            (status === "active" && employee.active) ||
                            (status === "inactive" && !employee.active);

                        var scheduleMatches =
                            !scheduleId ||
                            employee.scheduleId === scheduleId;

                        var haystack = [
                            employee.name,
                            employee.number,
                            employee.email,
                            employee.center,
                            employee.scheduleName,
                            employee.scheduleDescription,
                            employee.position,
                            employee.zone
                        ].join(" ").toLowerCase();

                        return statusMatches &&
                            scheduleMatches &&
                            (!search || haystack.includes(search));
                    }
                );

                var sapSummary = this
                    .getModel("attendance")
                    .getProperty("/employeeSummary") || {};

                var centers = Array.from(
                    new Set(
                        employees.map(function (employee) {
                            return employee.centerId;
                        }).filter(Boolean)
                    )
                );

                model.setProperty("/employees", filtered);

                model.setProperty("/stats", {
                    total: Number(sapSummary.total) ||
                        employees.length,

                    active: Number(sapSummary.active) ||
                        employees.filter(function (employee) {
                            return employee.active;
                        }).length,

                    inactive: Number(sapSummary.inactive) ||
                        employees.filter(function (employee) {
                            return !employee.active;
                        }).length,

                    centers: Number(sapSummary.centers) ||
                        centers.length
                });

                Diagnostics.filters("Usuarios", "APPLIED", {
                    search: search,
                    status: status,
                    scheduleId: scheduleId,
                    sourceRows: employees.length,
                    resultRows: filtered.length
                });
            },

            onSearch: function (event) {
                this.getModel("view").setProperty(
                    "/search",
                    event.getParameter("newValue")
                );

                this._applyFilters();
            },

            onFilterChange: function () {
                this._applyFilters();
            },

            onToggleUserStatus: function () {
                MessageToast.show(
                    "La baja lógica requiere un EntitySet " +
                    "de actualización confirmado por SAP."
                );
            },

            // ==========================================
            // UTILIDADES
            // ==========================================

            _requestId: function () {
                var now = new Date();

                return now.getFullYear() +
                    pad(now.getMonth() + 1, 2) +
                    pad(now.getDate(), 2) +
                    "-" +
                    pad(now.getHours(), 2) +
                    pad(now.getMinutes(), 2) +
                    pad(now.getSeconds(), 2);
            },

            _emptyEmployee: function () {
                return ITEM_FIELDS.reduce(
                    function (result, field) {
                        result[field] = "";
                        return result;
                    },
                    {}
                );
            },

            // ==========================================
            // BIBLIOTECA XLSX - CORREGIDA
            // ==========================================

            _ensureXlsx: function () {
                if (
                    XLSX &&
                    typeof XLSX.read === "function" &&
                    typeof XLSX.writeFile === "function" &&
                    XLSX.utils
                ) {
                    return Promise.resolve(XLSX);
                }

                if (!this._xlsxPromise) {
                    this._xlsxPromise = new Promise(
                        function (resolve, reject) {
                            sap.ui.require(
                                [
                                    "com/mitsu/monitorasistencia/thirdparty/xlsx.full.min"
                                ],
                                function (XLSXModule) {
                                    var library = XLSXModule &&
                                        (XLSXModule.default || XLSXModule);

                                    if (
                                        !library ||
                                        typeof library.read !== "function" ||
                                        typeof library.writeFile !== "function" ||
                                        !library.utils
                                    ) {
                                        reject(new Error(
                                            "El módulo XLSX no expone " +
                                            "la API esperada."
                                        ));
                                        return;
                                    }

                                    XLSX = library;

                                    Diagnostics.upload(
                                        "XLSX-READY",
                                        {
                                            version:
                                                XLSX.version ||
                                                "sin versión"
                                        }
                                    );

                                    resolve(XLSX);
                                },
                                function (error) {
                                    reject(new Error(
                                        "No fue posible cargar XLSX: " +
                                        (
                                            error && error.message ||
                                            String(error)
                                        )
                                    ));
                                }
                            );
                        }
                    ).catch(function (error) {
                        this._xlsxPromise = null;
                        throw error;
                    }.bind(this));
                }

                return this._xlsxPromise;
            },

            // ==========================================
            // FORMATO DE FECHAS
            // ==========================================

            _formatDate: function (value) {
                var date;

                if (
                    value instanceof Date &&
                    !isNaN(value.getTime())
                ) {
                    date = value;

                } else if (
                    typeof value === "number" &&
                    XLSX &&
                    XLSX.SSF
                ) {
                    var parsed = XLSX.SSF.parse_date_code(value);

                    if (parsed) {
                        date = new Date(
                            parsed.y,
                            parsed.m - 1,
                            parsed.d
                        );
                    }

                } else {
                    var text = cleanText(value);

                    if (/^\d{8}$/.test(text)) {
                        return text;
                    }

                    var match = text.match(
                        /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/
                    );

                    if (match) {
                        return match[3] +
                            pad(match[2], 2) +
                            pad(match[1], 2);
                    }

                    match = text.match(
                        /^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/
                    );

                    if (match) {
                        return match[1] +
                            pad(match[2], 2) +
                            pad(match[3], 2);
                    }
                }

                return date
                    ? date.getFullYear() +
                      pad(date.getMonth() + 1, 2) +
                      pad(date.getDate(), 2)
                    : "";
            },

            // ==========================================
            // LECTURA DE EXCEL
            // ==========================================

            _readWorkbook: function (arrayBuffer, file) {
                if (!XLSX || !XLSX.read) {
                    throw new Error(
                        "No se cargó el módulo XLSX."
                    );
                }

                var workbook = XLSX.read(arrayBuffer, {
                    type: "array",
                    cellDates: true
                });

                Diagnostics.upload("WORKBOOK", {
                    file: file.name,
                    sheets: workbook.SheetNames
                });

                var sheetName =
                    workbook.SheetNames.indexOf("Layout_Carga") >= 0
                        ? "Layout_Carga"
                        : workbook.SheetNames[0];

                var matrix = XLSX.utils.sheet_to_json(
                    workbook.Sheets[sheetName],
                    {
                        header: 1,
                        raw: true,
                        defval: ""
                    }
                );

                var headerIndex = matrix.findIndex(
                    function (row) {
                        return Array.isArray(row) &&
                            row.some(function (cell) {
                                return normalizeHeader(cell) ===
                                    "numero de personal";
                            });
                    }
                );

                if (headerIndex < 0) {
                    throw new Error(
                        "No se encontró la columna " +
                        "'Número de personal'."
                    );
                }

                var mappedHeaders = matrix[headerIndex]
                    .map(normalizeHeader)
                    .map(function (header) {
                        return HEADER_MAP[header] || "";
                    });

                var missingHeaders = ITEM_FIELDS.filter(
                    function (field) {
                        return mappedHeaders.indexOf(field) < 0;
                    }
                );

                if (missingHeaders.length) {
                    throw new Error(
                        "Faltan columnas obligatorias: " +
                        missingHeaders.join(", ") +
                        "."
                    );
                }

                Diagnostics.upload("HEADERS", {
                    source: matrix[headerIndex],
                    mapped: mappedHeaders
                });

                var rows = matrix.slice(headerIndex + 1)
                    .filter(function (row) {
                        return Array.isArray(row) &&
                            row.some(function (cell) {
                                return cleanText(cell);
                            });
                    })
                    .map(function (row, rowIndex) {
                        var item = this._emptyEmployee();

                        mappedHeaders.forEach(
                            function (field, columnIndex) {
                                if (field) {
                                    item[field] =
                                        field === "HireDate" ||
                                        field === "BirthDate"
                                            ? this._formatDate(
                                                row[columnIndex]
                                            )
                                            : cleanText(
                                                row[columnIndex]
                                            );
                                }
                            },
                            this
                        );

                        item.__excelRow =
                            headerIndex + rowIndex + 2;

                        return item;
                    }, this);

                Diagnostics.upload("PARSED-ROWS", {
                    count: rows.length,
                    rows: rows
                });

                return rows;
            },

            // ==========================================
            // CARGA MASIVA
            // ==========================================

            onOpenUploadDialog: function () {
                var model = this.getModel("view");

                model.setProperty(
                    "/uploadOperation",
                    "CREATE"
                );

                model.setProperty("/uploadFileName", "");
                model.setProperty("/uploadRows", []);
                model.setProperty("/uploadRowCount", 0);
                model.setProperty("/uploadJson", "");

                this.byId("employeeUploadDialog").open();
            },

            onExcelSelected: function (event) {
                var files = event.getParameter("files");
                var file = files && files[0];

                if (!file) {
                    return;
                }

                Diagnostics.upload("FILE-SELECTED", {
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    lastModified: file.lastModified
                });

                var model = this.getModel("view");

                model.setProperty("/uploadBusy", true);

                this._ensureXlsx().then(function () {
                    var reader = new FileReader();

                    reader.onload = function (loadEvent) {
                        try {
                            var rows = this._readWorkbook(
                                loadEvent.target.result,
                                file
                            );

                            var payload = this._buildPayload(
                                rows,
                                model.getProperty("/uploadOperation")
                            );

                            this._validateUploadPayload(payload);

                            model.setProperty(
                                "/uploadFileName",
                                file.name
                            );

                            model.setProperty(
                                "/uploadRows",
                                rows
                            );

                            model.setProperty(
                                "/uploadRowCount",
                                rows.length
                            );

                            model.setProperty(
                                "/uploadJson",
                                JSON.stringify(payload, null, 2)
                            );

                            MessageToast.show(
                                rows.length +
                                " empleado(s) listos para enviar"
                            );

                        } catch (error) {
                            Diagnostics.error(
                                "EMPLOYEE-UPLOAD",
                                error,
                                { file: file.name }
                            );

                            model.setProperty("/uploadRows", []);
                            model.setProperty("/uploadRowCount", 0);
                            model.setProperty("/uploadJson", "");

                            MessageBox.error(
                                "No fue posible leer el Excel. " +
                                error.message
                            );

                        } finally {
                            model.setProperty(
                                "/uploadBusy",
                                false
                            );
                        }
                    }.bind(this);

                    reader.onerror = function () {
                        model.setProperty("/uploadBusy", false);

                        MessageBox.error(
                            "El navegador no pudo leer " +
                            "el archivo seleccionado."
                        );
                    };

                    reader.readAsArrayBuffer(file);

                }.bind(this)).catch(function (error) {
                    Diagnostics.error(
                        "EMPLOYEE-UPLOAD",
                        error,
                        {
                            file: file.name,
                            phase: "LOAD-XLSX"
                        }
                    );

                    model.setProperty("/uploadBusy", false);

                    MessageBox.error(
                        "No fue posible preparar la carga " +
                        "de Excel. " +
                        error.message
                    );
                });
            },

            onUploadOperationChange: function () {
                var model = this.getModel("view");

                var rows =
                    model.getProperty("/uploadRows") || [];

                if (rows.length) {
                    var payload = this._buildPayload(
                        rows,
                        model.getProperty("/uploadOperation")
                    );

                    model.setProperty(
                        "/uploadJson",
                        JSON.stringify(payload, null, 2)
                    );

                    Diagnostics.upload(
                        "OPERATION-CHANGED",
                        payload
                    );
                }
            },

            // ==========================================
            // PAYLOAD ODATA
            // ==========================================

            _buildPayload: function (rows, operation) {
                var requestId = this._requestId();

                var items = rows.map(function (row, index) {
                    var item = {
                        RequestId: requestId,
                        ItemNo: pad(index + 1, 5)
                    };

                    ITEM_FIELDS.forEach(function (field) {
                        item[field] = cleanText(row[field]);
                    });

                    return item;
                });

                var payload = {
                    RequestId: requestId,
                    Operation: operation || "CREATE",
                    ProcessingMode: "PARTIAL",
                    ToEmployeesUpload: items
                };

                Diagnostics.upload("PAYLOAD-BUILT", payload);

                return payload;
            },

            _validateUploadPayload: function (payload) {
                [
                    "RequestId",
                    "Operation",
                    "ProcessingMode"
                ].forEach(function (field) {
                    if (!cleanText(payload && payload[field])) {
                        throw new Error(
                            "Falta el campo de cabecera " +
                            field +
                            "."
                        );
                    }
                });

                if (
                    !Array.isArray(payload.ToEmployeesUpload) ||
                    !payload.ToEmployeesUpload.length
                ) {
                    throw new Error(
                        "El Excel no contiene empleados " +
                        "para procesar."
                    );
                }

                payload.ToEmployeesUpload.forEach(
                    function (item, index) {
                        var missing = REQUIRED_ITEM_FIELDS.find(
                            function (field) {
                                return !cleanText(item[field]);
                            }
                        );

                        if (missing) {
                            throw new Error(
                                "Fila " +
                                (index + 5) +
                                ": falta " +
                                missing +
                                "."
                            );
                        }

                        if (!/^\d{8}$/.test(item.HireDate)) {
                            throw new Error(
                                "Fila " +
                                (index + 5) +
                                ": HireDate debe usar AAAAMMDD."
                            );
                        }

                        if (
                            cleanText(item.BirthDate) &&
                            !/^\d{8}$/.test(item.BirthDate)
                        ) {
                            throw new Error(
                                "Fila " +
                                (index + 5) +
                                ": BirthDate debe usar AAAAMMDD " +
                                "o quedar vacío."
                            );
                        }

                        if (
                            !/^\S+@\S+\.\S+$/.test(item.Email)
                        ) {
                            throw new Error(
                                "Fila " +
                                (index + 5) +
                                ": el correo no es válido."
                            );
                        }

                        if (
                            item.RequestId !== payload.RequestId
                        ) {
                            throw new Error(
                                "Fila " +
                                (index + 5) +
                                ": RequestId no coincide."
                            );
                        }
                    }
                );

                Diagnostics.upload("VALIDATED", {
                    count: payload.ToEmployeesUpload.length,
                    operation: payload.Operation
                });

                return payload;
            },

            // ==========================================
            // ENVÍO A SAP
            // ==========================================

            onSubmitEmployeeUpload: function () {
                var model = this.getModel("view");
                var payload;

                try {
                    payload = this._validateUploadPayload(
                        JSON.parse(
                            model.getProperty("/uploadJson") || "{}"
                        )
                    );
                } catch (error) {
                    MessageBox.error(
                        "No se puede enviar la carga. " +
                        error.message
                    );
                    return;
                }

                this._sendPayload(payload, false);
            },

            _sendPayload: function (payload, editing) {
                var model = this.getModel("view");

                var entitySet = cleanText(
                    model.getProperty("/uploadEntitySet")
                ) || "EmployeesUploadSet";

                model.setProperty(
                    editing ? "/editBusy" : "/uploadBusy",
                    true
                );

                Diagnostics.upload("POST", {
                    entitySet: entitySet,
                    payload: payload
                });

                this._attendanceApi
                    .uploadEmployees(payload, entitySet)
                    .then(function (response) {
                        Diagnostics.upload(
                            "RESPONSE",
                            response
                        );

                        (
                            editing
                                ? this.byId("employeeEditDialog")
                                : this.byId("employeeUploadDialog")
                        ).close();

                        MessageBox.success(
                            payload.ToEmployeesUpload.length +
                            " empleado(s) enviados a SAP.",
                            {
                                details: JSON.stringify(
                                    response,
                                    null,
                                    2
                                )
                            }
                        );
                    }.bind(this))
                    .catch(function (error) {
                        Diagnostics.error(
                            "EMPLOYEE-UPLOAD",
                            error,
                            {
                                entitySet: entitySet,
                                payload: payload,
                                responseBody: error.responseBody
                            }
                        );

                        MessageBox.error(
                            "SAP rechazó la carga de usuarios.",
                            {
                                details: [
                                    error.message,
                                    error.responseBody
                                ].filter(Boolean).join("\n\n")
                            }
                        );
                    })
                    .finally(function () {
                        model.setProperty(
                            editing
                                ? "/editBusy"
                                : "/uploadBusy",
                            false
                        );
                    });
            },

            onCloseUploadDialog: function () {
                if (
                    !this.getModel("view")
                        .getProperty("/uploadBusy")
                ) {
                    this.byId("employeeUploadDialog").close();
                }
            },

            // ==========================================
            // MODIFICAR EMPLEADO
            // ==========================================

            onOpenEmployeeEdit: function (event) {
                var context = event.getSource()
                    .getBindingContext("view");

                var source = context && context.getObject();

                if (!source) {
                    return;
                }

                var item = this._emptyEmployee();

                ITEM_FIELDS.forEach(function (field) {
                    item[field] = cleanText(source[field]);
                });

                item.PersonnelNumber =
                    item.PersonnelNumber ||
                    cleanText(source.number);

                item.FirstName =
                    item.FirstName ||
                    cleanText(source.firstName) ||
                    cleanText(source.name);

                item.LastName =
                    item.LastName ||
                    cleanText(source.lastName);

                item.Position =
                    item.Position ||
                    cleanText(source.position) ||
                    cleanText(source.role);

                item.PersonnelArea =
                    item.PersonnelArea ||
                    cleanText(source.personnelArea) ||
                    cleanText(source.centerCode);

                item.PersonnelSubarea =
                    item.PersonnelSubarea ||
                    cleanText(source.personnelSubarea) ||
                    cleanText(source.base);

                item.Zone =
                    item.Zone ||
                    cleanText(source.zoneCode) ||
                    cleanText(source.zone);

                item.Schedule =
                    item.Schedule ||
                    cleanText(source.scheduleCode);

                item.Email =
                    item.Email ||
                    cleanText(source.email);

                this.getModel("view").setProperty(
                    "/editEmployee",
                    item
                );

                Diagnostics.upload("EDIT-OPENED", item);

                this.byId("employeeEditDialog").open();
            },

            onSubmitEmployeeEdit: function () {
                var item = Object.assign(
                    {},
                    this.getModel("view")
                        .getProperty("/editEmployee")
                );

                var payload = this._buildPayload(
                    [item],
                    "UPDATE"
                );

                try {
                    this._validateUploadPayload(payload);
                } catch (error) {
                    MessageBox.error(
                        "No se puede actualizar el empleado. " +
                        error.message
                    );
                    return;
                }

                this._sendPayload(payload, true);
            },

            onCloseEmployeeEdit: function () {
                if (
                    !this.getModel("view")
                        .getProperty("/editBusy")
                ) {
                    this.byId("employeeEditDialog").close();
                }
            },

            // ==========================================
            // DESCARGAS
            // ==========================================

            _downloadAsset: function (
                sModulePath,
                sFileName
            ) {
                var sUrl = sap.ui.require.toUrl(
                    sModulePath
                );

                var oLink = document.createElement("a");

                oLink.href = sUrl;
                oLink.download = sFileName;
                oLink.style.display = "none";

                document.body.appendChild(oLink);

                oLink.click();

                document.body.removeChild(oLink);

                Diagnostics.upload("DOWNLOAD", {
                    file: sFileName,
                    url: sUrl
                });
            },

            onDownloadTemplate: function () {
                this._downloadAsset(
                    "com/mitsu/monitorasistencia/assets/templates/Plantilla_Carga_Usuarios.xlsx",
                    "Plantilla_Carga_Usuarios.xlsx"
                );
            },

            onDownloadExample: function () {
                this._downloadAsset(
                    "com/mitsu/monitorasistencia/assets/templates/Usuarios_Prueba.xlsx",
                    "Usuarios_Prueba.xlsx"
                );
            },

            // ==========================================
            // SCROLL HORIZONTAL CORREGIDO
            // ==========================================

            _scrollUsersTable: function (iDelta) {
                var oContainer = this.byId("usersTableScroll");

                if (!oContainer) {
                    MessageToast.show(
                        "No se encontró la tabla de usuarios."
                    );
                    return;
                }

                var oDomRef = oContainer.getDomRef();

                if (!oDomRef) {
                    MessageToast.show(
                        "La tabla todavía no está disponible."
                    );
                    return;
                }

                var oScroller = oDomRef.querySelector(
                    ".sapMScrollContScroll"
                ) || oDomRef;

                var iMaxScroll = Math.max(
                    0,
                    oScroller.scrollWidth - oScroller.clientWidth
                );

                var iDestino = Math.max(
                    0,
                    Math.min(
                        oScroller.scrollLeft + iDelta,
                        iMaxScroll
                    )
                );

                if (typeof oScroller.scrollTo === "function") {
                    oScroller.scrollTo({
                        left: iDestino,
                        behavior: "smooth"
                    });
                } else {
                    oScroller.scrollLeft = iDestino;
                }
            },

            onScrollUsersLeft: function () {
                this._scrollUsersTable(-600);
            },

            onScrollUsersRight: function () {
                this._scrollUsersTable(600);
            },

            // ==========================================
            // EXPORTAR EXCEL
            // ==========================================

            onExport: function () {
                this._ensureXlsx()
                    .then(function () {
                        var rows = (
                            this.getModel("view")
                                .getProperty("/employees") || []
                        ).map(function (employee) {
                            var result = {};

                            ITEM_FIELDS.forEach(function (field) {
                                result[field] =
                                    cleanText(employee[field]);
                            });

                            return result;
                        });

                        Diagnostics.upload("EXPORT", {
                            count: rows.length,
                            rows: rows
                        });

                        var worksheet =
                            XLSX.utils.json_to_sheet(rows);

                        var workbook =
                            XLSX.utils.book_new();

                        XLSX.utils.book_append_sheet(
                            workbook,
                            worksheet,
                            "Usuarios"
                        );

                        XLSX.writeFile(
                            workbook,
                            "usuarios-monitor.xlsx"
                        );
                    }.bind(this))
                    .catch(function (error) {
                        Diagnostics.error(
                            "EMPLOYEE-UPLOAD",
                            error,
                            { phase: "EXPORT" }
                        );

                        MessageBox.error(
                            "No fue posible preparar " +
                            "la exportación. " +
                            error.message
                        );
                    });
            },

            // ==========================================
            // NAVEGACIÓN
            // ==========================================

            onOpenUserMap: function (event) {
                var employee = event.getSource()
                    .getBindingContext("view")
                    .getObject();

                this.navTo("mapUser", {
                    zoneId: employee.zoneId,
                    employeeId: employee.id
                });
            },

            onOpenUserPerformance: function (event) {
                var listItem =
                    event.getParameter &&
                    event.getParameter("listItem");

                var context = (
                    listItem || event.getSource()
                ).getBindingContext("view");

                var employee =
                    context && context.getObject();

                if (employee && employee.id) {
                    this.navTo("userPerformance", {
                        employeeId: employee.id
                    });
                }
            },

            onNavOverview: function () {
                this.navTo("overview");
            }
        }
    );
});
