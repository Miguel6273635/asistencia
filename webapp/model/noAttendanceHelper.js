/* sap.ui.define([], function () {
    "use strict";

    function text(value) {
        return value === null || value === undefined
            ? ""
            : String(value).trim();
    }

    function normalizeNumber(value) {
        var number = text(value).replace(/^employee-/, "");
        return number.replace(/^0+(?=\d)/, "");
    }

    function employeeNumber(source) {
        var row = source || {};
        return text(
            row.PersonalNumber ||
            row.PersonnelNumber ||
            row.personalNumber ||
            row.employeeNumber ||
            row.number ||
            row.employeeId ||
            row.id
        );
    }

    function initials(name) {
        return text(name)
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map(function (part) {
                return part.charAt(0).toUpperCase();
            })
            .join("") || "—";
    }

    function buildRows(employees, historyRows) {
        var numbersWithAttendance = {};
        var uniqueEmployees = {};

        (historyRows || []).forEach(function (row) {
            var number = normalizeNumber(employeeNumber(row));
            if (number) {
                numbersWithAttendance[number] = true;
            }
        });

        (employees || []).forEach(function (employee) {
            var originalNumber = employeeNumber(employee);
            var normalizedNumber = normalizeNumber(originalNumber);
            var name;

            if (!normalizedNumber || numbersWithAttendance[normalizedNumber] ||
                uniqueEmployees[normalizedNumber]) {
                return;
            }

            name = text(employee.FullName || employee.name) || originalNumber;
            uniqueEmployees[normalizedNumber] = {
                id: text(employee.id) || "employee-" + originalNumber,
                personalNumber: originalNumber,
                normalizedNumber: normalizedNumber,
                name: name,
                initials: initials(name),
                email: text(employee.Email || employee.email),
                center: text(employee.CenterOffice || employee.center) || "Sin centro",
                centerCode: text(employee.CenterCode || employee.centerCode),
                zone: text(employee.Zone || employee.zone || employee.zoneName) || "Sin zona",
                schedule: text(
                    employee.ScheduleDetail ||
                    employee.scheduleDetail ||
                    employee.Hourly ||
                    employee.scheduleName ||
                    employee.shift
                ) || "Sin horario",
                position: text(employee.Position || employee.position || employee.role),
                employeeStatus: text(
                    employee.DescriptionStatus ||
                    employee.GroupPersonDescription ||
                    employee.status
                ) || "Sin estado",
                attendanceStatus: "Sin marcaciones"
            };
        });

        return Object.keys(uniqueEmployees)
            .map(function (number) {
                return uniqueEmployees[number];
            })
            .sort(function (left, right) {
                return left.name.localeCompare(right.name, "es") ||
                    left.personalNumber.localeCompare(right.personalNumber, "es");
            });
    }

    return {
        normalizeNumber: normalizeNumber,
        buildRows: buildRows
    };
});
 */
sap.ui.define([], function () {
    "use strict";

    function text(value) {
        return value === null || value === undefined
            ? ""
            : String(value).trim();
    }

    function normalizeNumber(value) {
        var number = text(value).replace(/^employee-/, "");
        return number.replace(/^0+(?=\d)/, "");
    }

    function employeeNumber(source) {
        var row = source || {};
        return text(
            row.PersonalNumber ||
            row.PersonnelNumber ||
            row.personalNumber ||
            row.employeeNumber ||
            row.number ||
            row.employeeId ||
            row.id
        );
    }

    function initials(name) {
        return text(name)
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map(function (part) {
                return part.charAt(0).toUpperCase();
            })
            .join("") || "—";
    }

    function positionText(value) {
        var position = text(value);
        return position.toLowerCase() === "default position"
            ? "Posición predeterminada"
            : position;
    }

    function centerText(value) {
        return text(value).replace(
            /^personnel area\s+/i,
            "Área de personal "
        );
    }

    function mapDailyAbsences(absenceRows) {
        var uniqueRows = {};

        (absenceRows || []).forEach(function (absence) {
            var originalNumber = employeeNumber(absence);
            var normalizedNumber = normalizeNumber(originalNumber);
            var name;

            if (!normalizedNumber || uniqueRows[normalizedNumber]) {
                return;
            }

            name = text(absence.FullName || absence.name) || originalNumber;
            uniqueRows[normalizedNumber] = {
                id: text(absence.id) || "employee-" + originalNumber,
                personalNumber: originalNumber,
                normalizedNumber: normalizedNumber,
                name: name,
                initials: initials(name),
                email: text(absence.Email || absence.email),
                center: centerText(
                    absence.CenterOffice || absence.center || absence.Base
                ) || "Sin centro",
                centerCode: text(absence.CenterCode || absence.centerCode),
                zone: text(absence.Zone || absence.zone) || "Sin zona",
                schedule: text(
                    absence.ScheduleDetail || absence.scheduleDetail ||
                    absence.Hourly || absence.Shift
                ) || "Sin horario",
                scheduleCode: text(
                    absence.ScheduleCode || absence.scheduleCode
                ),
                position: positionText(
                    absence.Position || absence.position || absence.Role
                ),
                employeeStatus: text(
                    absence.Status || absence.StatusRegister
                ),
                attendanceStatus: text(
                    absence.DescriptionStatus || absence.descriptionStatus
                ) || "Sin marcaciones",
                dateAbsent: text(absence.DateAbsent || absence.dateAbsent),
                base: text(absence.Base || absence.base),
                hourly: text(absence.Hourly || absence.hourly)
            };
        });

        return Object.keys(uniqueRows)
            .map(function (number) {
                return uniqueRows[number];
            })
            .sort(function (left, right) {
                return left.name.localeCompare(right.name, "es") ||
                    left.personalNumber.localeCompare(
                        right.personalNumber,
                        "es"
                    );
            });
    }

    function buildRows(employees, historyRows) {
        var numbersWithAttendance = {};
        var uniqueEmployees = {};

        (historyRows || []).forEach(function (row) {
            var number = normalizeNumber(employeeNumber(row));
            if (number) {
                numbersWithAttendance[number] = true;
            }
        });

        (employees || []).forEach(function (employee) {
            var originalNumber = employeeNumber(employee);
            var normalizedNumber = normalizeNumber(originalNumber);
            var name;

            if (!normalizedNumber || numbersWithAttendance[normalizedNumber] ||
                uniqueEmployees[normalizedNumber]) {
                return;
            }

            name = text(employee.FullName || employee.name) || originalNumber;
            uniqueEmployees[normalizedNumber] = {
                id: text(employee.id) || "employee-" + originalNumber,
                personalNumber: originalNumber,
                normalizedNumber: normalizedNumber,
                name: name,
                initials: initials(name),
                email: text(employee.Email || employee.email),
                center: text(employee.CenterOffice || employee.center) || "Sin centro",
                centerCode: text(employee.CenterCode || employee.centerCode),
                zone: text(employee.Zone || employee.zone || employee.zoneName) || "Sin zona",
                schedule: text(
                    employee.ScheduleDetail ||
                    employee.scheduleDetail ||
                    employee.Hourly ||
                    employee.scheduleName ||
                    employee.shift
                ) || "Sin horario",
                position: text(employee.Position || employee.position || employee.role),
                employeeStatus: text(
                    employee.DescriptionStatus ||
                    employee.GroupPersonDescription ||
                    employee.status
                ) || "Sin estado",
                attendanceStatus: "Sin marcaciones"
            };
        });

        return Object.keys(uniqueEmployees)
            .map(function (number) {
                return uniqueEmployees[number];
            })
            .sort(function (left, right) {
                return left.name.localeCompare(right.name, "es") ||
                    left.personalNumber.localeCompare(right.personalNumber, "es");
            });
    }

    return {
        normalizeNumber: normalizeNumber,
        buildRows: buildRows,
        mapDailyAbsences: mapDailyAbsences
    };
});
