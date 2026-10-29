sap.ui.define([], function () {
    "use strict";

    var HEADERS = [
        "Numero empleado", "Nombres", "Apellido paterno", "Apellido materno",
        "CURP", "Fecha nacimiento", "Centro", "Horario", "Rol", "Activo"
    ];
    var xlsxLibrary = null;
    var xlsxLoadingPromise = null;

    function isValidXlsxLibrary(candidate) {
        return Boolean(candidate && candidate.read && candidate.writeFile && candidate.SSF &&
            candidate.utils && candidate.utils.sheet_to_json && candidate.utils.json_to_sheet &&
            candidate.utils.book_new && candidate.utils.book_append_sheet);
    }

    function getXlsxLibrary() {
        var candidate = xlsxLibrary || window.XLSX || globalThis.XLSX || null;
        xlsxLibrary = isValidXlsxLibrary(candidate) ? candidate : null;
        return xlsxLibrary;
    }

    function ensureXlsxLibrary() {
        var currentLibrary = getXlsxLibrary();
        if (currentLibrary) {
            return Promise.resolve(currentLibrary);
        }
        if (xlsxLoadingPromise) {
            return xlsxLoadingPromise;
        }

        xlsxLoadingPromise = new Promise(function (resolve, reject) {
            var script = document.createElement("script");
            var resourceUrl = sap.ui.require.toUrl("com/mitsu/monitorasistencia/thirdparty/xlsx.full.min.js");
            var amdMarker = window.define && window.define.amd;
            var restoreAmdMarker = function () {
                if (amdMarker && window.define) {
                    window.define.amd = amdMarker;
                }
            };
            if (amdMarker) {
                window.define.amd = false;
            }
            script.id = "monitor-sheetjs-runtime";
            script.async = true;
            script.src = resourceUrl + "?version=0.20.3";
            script.onload = function () {
                restoreAmdMarker();
                var loadedLibrary = getXlsxLibrary();
                if (loadedLibrary) {
                    resolve(loadedLibrary);
                } else {
                    xlsxLoadingPromise = null;
                    reject(new Error("El lector de Excel se descargó, pero no pudo inicializarse. Actualiza la página e inténtalo nuevamente."));
                }
            };
            script.onerror = function () {
                restoreAmdMarker();
                xlsxLoadingPromise = null;
                reject(new Error("No fue posible cargar el lector de Excel. Verifica que thirdparty/xlsx.full.min.js esté incluido en el despliegue de BTP."));
            };
            document.head.appendChild(script);
        });
        return xlsxLoadingPromise;
    }

    function normalize(value) {
        return String(value || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^A-Z0-9]/gi, "")
            .toUpperCase();
    }

    function normalizeHeader(value) {
        return normalize(value).toLowerCase();
    }

    function text(value) {
        return String(value == null ? "" : value).trim();
    }

    function excelDate(value) {
        if (value instanceof Date && !isNaN(value.getTime())) {
            return value;
        }
        if (typeof value === "number" && getXlsxLibrary()) {
            var parsed = getXlsxLibrary().SSF.parse_date_code(value);
            return parsed ? new Date(parsed.y, parsed.m - 1, parsed.d) : null;
        }
        var raw = text(value);
        var match = raw.match(/^(\d{4})[-\/]([01]?\d)[-\/]([0-3]?\d)$/);
        if (match) {
            return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        }
        match = raw.match(/^([0-3]?\d)[-\/]([01]?\d)[-\/](\d{4})$/);
        if (match) {
            return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
        }
        return null;
    }

    function formatDate(value) {
        var date = excelDate(value);
        if (!date || isNaN(date.getTime())) {
            return text(value);
        }
        return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
    }

    function findValue(source, aliases) {
        var normalized = {};
        Object.keys(source || {}).forEach(function (key) {
            normalized[normalizeHeader(key)] = source[key];
        });
        for (var index = 0; index < aliases.length; index += 1) {
            var key = normalizeHeader(aliases[index]);
            if (Object.prototype.hasOwnProperty.call(normalized, key)) {
                return normalized[key];
            }
        }
        return "";
    }

    function rowFromExcel(source, index) {
        var firstNames = text(findValue(source, ["Nombres", "Nombre", "Nombre(s)"]));
        var paternal = text(findValue(source, ["Apellido paterno", "Primer apellido", "Paterno"]));
        var maternal = text(findValue(source, ["Apellido materno", "Segundo apellido", "Materno"]));
        var fullName = [firstNames, paternal, maternal].filter(Boolean).join(" ");
        return {
            rowNumber: index + 2,
            number: text(findValue(source, ["Numero empleado", "Número empleado", "Num empleado", "ID empleado"])).toUpperCase(),
            firstNames: firstNames,
            paternalSurname: paternal,
            maternalSurname: maternal,
            name: fullName,
            curp: text(findValue(source, ["CURP"])).toUpperCase(),
            birthDate: formatDate(findValue(source, ["Fecha nacimiento", "Fecha de nacimiento", "Nacimiento"])),
            centerValue: text(findValue(source, ["Centro", "Centro de trabajo", "Codigo centro", "Código centro"])),
            scheduleValue: text(findValue(source, ["Horario", "Horario semanal", "Codigo horario", "Código horario"])),
            role: text(findValue(source, ["Rol", "Puesto"])) || "Empleado",
            active: !/^(NO|FALSE|0|INACTIVO)$/i.test(text(findValue(source, ["Activo", "Estatus"]))),
            status: "Pendiente",
            state: "None",
            messages: [],
            messageText: "Pendiente de validar",
            selected: true
        };
    }

    function getCurpNamePrefix(row) {
        var names = row.firstNames.split(/\s+/).filter(Boolean);
        var firstName = names[0] || "";
        if (names.length > 1 && /^(JOSE|MARIA)$/i.test(normalize(firstName))) {
            firstName = names[1];
        }
        var paternal = normalize(row.paternalSurname);
        var maternal = normalize(row.maternalSurname);
        var vowel = (paternal.slice(1).match(/[AEIOU]/) || ["X"])[0];
        return (paternal.charAt(0) || "X") + vowel + (maternal.charAt(0) || "X") + (normalize(firstName).charAt(0) || "X");
    }

    function validateCurp(row) {
        var curp = normalize(row.curp);
        var date = excelDate(row.birthDate);
        if (!/^[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/.test(curp)) {
            return "La CURP no tiene el formato oficial de 18 caracteres";
        }
        if (!date) {
            return "La fecha de nacimiento no es válida";
        }
        var datePart = String(date.getFullYear()).slice(-2) + String(date.getMonth() + 1).padStart(2, "0") + String(date.getDate()).padStart(2, "0");
        if (curp.slice(4, 10) !== datePart) {
            return "La fecha de nacimiento no coincide con la CURP";
        }
        if (curp.slice(0, 4) !== getCurpNamePrefix(row)) {
            return "El nombre y los apellidos no coinciden con la CURP";
        }
        if (["AS", "BC", "BS", "CC", "CL", "CM", "CS", "CH", "DF", "DG", "GT", "GR", "HG", "JC", "MC", "MN", "MS", "NT", "NL", "OC", "PL", "QT", "QR", "SP", "SL", "SR", "TC", "TS", "TL", "VZ", "YN", "ZS", "NE"].indexOf(curp.slice(11, 13)) < 0) {
            return "La entidad federativa de la CURP no es válida";
        }
        var dictionary = "0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ";
        var sum = 0;
        for (var index = 0; index < 17; index += 1) {
            sum += dictionary.indexOf(curp.charAt(index)) * (18 - index);
        }
        if (String((10 - (sum % 10)) % 10) !== curp.charAt(17)) {
            return "El dígito verificador de la CURP no es válido";
        }
        return "";
    }

    function buildLookup(items, keys) {
        var lookup = {};
        (items || []).forEach(function (item) {
            keys.forEach(function (key) {
                if (item[key]) {
                    lookup[normalize(item[key])] = item;
                }
            });
        });
        return lookup;
    }

    function countBy(rows, getter) {
        return rows.reduce(function (result, row) {
            var key = normalize(getter(row));
            if (key) {
                result[key] = (result[key] || 0) + 1;
            }
            return result;
        }, {});
    }

    function validateRows(rows, context) {
        var employees = context.employees || [];
        var centerLookup = buildLookup(context.centers, ["id", "code", "name"]);
        var scheduleLookup = buildLookup(context.schedules, ["id", "code", "name"]);
        var employeeNumbers = new Set(employees.map(function (item) { return normalize(item.number); }));
        var curps = new Set(employees.map(function (item) { return normalize(item.curp); }).filter(Boolean));
        var names = new Set(employees.map(function (item) { return normalize(item.name); }));
        var rowNumbers = countBy(rows, function (item) { return item.number; });
        var rowCurps = countBy(rows, function (item) { return item.curp; });
        var rowNames = countBy(rows, function (item) { return item.name; });

        rows.forEach(function (row) {
            var errors = [];
            row.name = [row.firstNames, row.paternalSurname, row.maternalSurname].filter(Boolean).join(" ").trim();
            row.curp = text(row.curp).toUpperCase();
            row.number = text(row.number).toUpperCase();
            row.birthDate = formatDate(row.birthDate);

            if (!row.number) { errors.push("Falta el número de empleado"); }
            if (!row.firstNames || !row.paternalSurname) { errors.push("Faltan nombres o apellido paterno"); }
            if (!row.curp) { errors.push("Falta la CURP"); }
            if (!row.birthDate) { errors.push("Falta la fecha de nacimiento"); }
            if (row.curp && row.birthDate && row.firstNames && row.paternalSurname) {
                var curpError = validateCurp(row);
                if (curpError) { errors.push(curpError); }
            }

            var numberKey = normalize(row.number);
            var curpKey = normalize(row.curp);
            var nameKey = normalize(row.name);
            if (numberKey && (employeeNumbers.has(numberKey) || rowNumbers[numberKey] > 1)) { errors.push("Número de empleado duplicado"); }
            if (curpKey && (curps.has(curpKey) || rowCurps[curpKey] > 1)) { errors.push("CURP duplicada"); }
            if (nameKey && (names.has(nameKey) || rowNames[nameKey] > 1)) { errors.push("Nombre completo duplicado"); }

            row.center = centerLookup[normalize(row.centerValue)];
            row.schedule = scheduleLookup[normalize(row.scheduleValue)];
            if (!row.center) { errors.push("Centro de trabajo no reconocido"); }
            if (!row.schedule) { errors.push("Horario no reconocido"); }
            if (["Empleado", "Supervisor", "Recursos Humanos", "Administrador", "Técnico", "Técnico de campo"].indexOf(row.role) < 0) {
                errors.push("Rol no reconocido");
            }

            row.messages = errors;
            row.messageText = errors.length ? errors.join(" · ") : "Listo para cargar";
            row.status = errors.length ? "Requiere corrección" : "Válido";
            row.state = errors.length ? "Error" : "Success";
            row.selected = !errors.length;
        });
        return rows;
    }

    function stats(rows) {
        var valid = rows.filter(function (row) { return row.state === "Success"; }).length;
        return { total: rows.length, valid: valid, invalid: rows.length - valid, selected: rows.filter(function (row) { return row.selected && row.state === "Success"; }).length };
    }

    function readFile(file) {
        return ensureXlsxLibrary().then(function (XLSX) {
            return new Promise(function (resolve, reject) {
                var reader = new FileReader();
                reader.onload = function (event) {
                    try {
                        var workbook = XLSX.read(event.target.result, { type: "array", cellDates: true });
                        var sheet = workbook.Sheets[workbook.SheetNames[0]];
                        var rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
                        resolve(rawRows.map(rowFromExcel));
                    } catch (error) {
                        reject(new Error("El archivo no se pudo leer. Verifica que sea un Excel válido y que la primera hoja contenga los encabezados de la plantilla."));
                    }
                };
                reader.onerror = function () { reject(new Error("No fue posible leer el archivo")); };
                reader.readAsArrayBuffer(file);
            });
        });
    }

    function downloadWorkbook(XLSX, fileName, rows, sheetName) {
        var sheet = XLSX.utils.json_to_sheet(rows, { header: HEADERS });
        sheet["!cols"] = [{ wch: 18 }, { wch: 22 }, { wch: 20 }, { wch: 20 }, { wch: 22 }, { wch: 18 }, { wch: 22 }, { wch: 18 }, { wch: 22 }, { wch: 10 }];
        var workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, sheet, sheetName || "Usuarios");
        XLSX.writeFile(workbook, fileName);
    }

    function downloadTemplate(centers, schedules) {
        var exampleCenter = (centers || [])[0] || { code: "NOR-001" };
        var exampleSchedule = (schedules || [])[0] || { code: "H01" };
        return ensureXlsxLibrary().then(function (XLSX) {
            downloadWorkbook(XLSX, "Plantilla_carga_masiva_usuarios.xlsx", [{
                "Numero empleado": "EMP-2001",
                "Nombres": "ANA SOFIA",
                "Apellido paterno": "RAMIREZ",
                "Apellido materno": "LOPEZ",
                "CURP": "RALA900101MDFMPN04",
                "Fecha nacimiento": "1990-01-01",
                "Centro": exampleCenter.code || exampleCenter.name,
                "Horario": exampleSchedule.code || exampleSchedule.name,
                "Rol": "Empleado",
                "Activo": "Sí"
            }], "Usuarios");
        });
    }

    function downloadRejected(rows) {
        return ensureXlsxLibrary().then(function (XLSX) {
            downloadWorkbook(XLSX, "Usuarios_no_cargados.xlsx", rows.map(function (row) {
                return {
                    "Numero empleado": row.number,
                    "Nombres": row.firstNames,
                    "Apellido paterno": row.paternalSurname,
                    "Apellido materno": row.maternalSurname,
                    "CURP": row.curp,
                    "Fecha nacimiento": row.birthDate,
                    "Centro": row.centerValue,
                    "Horario": row.scheduleValue,
                    "Rol": row.role,
                    "Activo": row.active ? "Sí" : "No",
                    "Errores": row.messageText
                };
            }), "No cargados");
        });
    }

    return {
        readFile: readFile,
        validateRows: validateRows,
        stats: stats,
        downloadTemplate: downloadTemplate,
        downloadRejected: downloadRejected,
        ensureReady: ensureXlsxLibrary,
        validateCurp: validateCurp,
        normalize: normalize
    };
});
