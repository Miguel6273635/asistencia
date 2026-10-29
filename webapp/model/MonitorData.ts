/* global Promise */

import AttendanceApi, { ODataFilter, ODataRow } from "./AttendanceApi";

export interface MonitorDataResult {
    data: Record<string, unknown>;
    errors: string[];
}

function text(value: unknown): string {
    if (value === null || value === undefined) { return ""; }
    if (typeof value === "string") { return value.trim(); }
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") { return value.toString().trim(); }
    return value instanceof Date ? value.toISOString() : "";
}

function number(value: unknown): number {
    const parsed = Number(text(value).replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
}

function bool(value: unknown): boolean {
    return value === true || text(value).toLowerCase() === "true" || text(value) === "X";
}

function slug(value: unknown): string {
    return text(value)
        .replace(/^ZONA\s+/i, "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "sin-zona";
}

function displayZone(value: unknown): string {
    const zone = text(value).replace(/^ZONA\s+/i, "");
    return zone ? `Zona ${zone.charAt(0).toUpperCase()}${zone.slice(1).toLowerCase()}` : "Sin zona";
}

function displayDate(value: unknown): string {
    const raw = text(value).replace(/-/g, "");
    return /^\d{8}$/.test(raw) ? `${raw.slice(6, 8)}/${raw.slice(4, 6)}/${raw.slice(0, 4)}` : "";
}

function usableTime(value: unknown): string {
    const time = text(value);
    return !time || time === "00:00:00" ? "—" : time.slice(0, 5);
}

function durationTime(value: unknown): string {
    const match = /^PT(\d{1,2})H(\d{1,2})M/.exec(text(value));
    return match ? `${match[1].padStart(2, "0")}:${match[2].padStart(2, "0")}` : "";
}

function durationMinutes(value: unknown): number | null {
    const match = /^PT(\d{1,2})H(\d{1,2})M/.exec(text(value));
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function inferScheduleType(row: ODataRow): string {
    const supplied = text(row.ScheduleType);
    if (supplied) { return supplied; }

    const start = durationMinutes(row.WorkInit);
    const end = durationMinutes(row.WorkEnd);
    const detail = text(row.ScheduleDetail).toUpperCase();
    const timePairs = Array.from(detail.matchAll(/(\d{2}):\d{2}-(\d{2}):\d{2}/g));
    const differentStarts = new Set(timePairs.map((match) => match[1])).size > 1;
    if (differentStarts) { return "Mixto"; }
    if ((start !== null && start >= 20 * 60) || (end !== null && end <= 8 * 60 && start !== null && start > end)) {
        return "Nocturno";
    }
    if (start !== null && start >= 12 * 60) { return "Vespertino"; }
    if (/\b[SD]\b/.test(detail) && !/\bL[-–]/.test(detail)) { return "Fin de semana"; }
    return "Diurno";
}

function attendanceStatus(row: ODataRow): string {
    if (bool(row.IsOutOfZone)) { return "Fuera de zona"; }
    if (bool(row.IsAbsent)) { return "Ausente"; }
    if (bool(row.IsIncomplete)) { return "Incompleto"; }
    const raw = text(row.DayStatus).toUpperCase();
    const known: Record<string, string> = {
        PRESENTE: "Presente",
        RETARDO: "Retardo",
        AUSENTE: "Ausente",
        INCOMPLETO: "Incompleto"
    };
    if (known[raw]) { return known[raw]; }
    return usableTime(row.P10Time) !== "—" ? (bool(row.IsLate) ? "Retardo" : "Presente") : "Ausente";
}

function risk(inefficiency: number, supplied: unknown): { text: string; state: string } {
    const backend = text(supplied);
    if (backend) {
        return {
            text: backend,
            state: /alto|crit/i.test(backend) ? "Error" : (/aten|medio/i.test(backend) ? "Warning" : "Success")
        };
    }
    if (inefficiency >= 25) { return { text: "Riesgo alto", state: "Error" }; }
    if (inefficiency >= 15) { return { text: "Atención", state: "Warning" }; }
    return { text: "Riesgo menor", state: "Success" };
}

function mapSchedules(rows: ODataRow[], activeScheduleCount = 0): Record<string, unknown>[] {
    const summaryMarksCatalogActive = activeScheduleCount > 0 && activeScheduleCount === rows.length;
    return rows.map((row) => {
        const code = text(row.Rule) || text(row.Schedule);
        const start = durationTime(row.WorkInit);
        const end = durationTime(row.WorkEnd);
        const detail = text(row.ScheduleDetail) || [start, end].filter(Boolean).join("–");
        return {
            id: `schedule-${slug(code)}`,
            code,
            name: text(row.Schedule) || code,
            type: inferScheduleType(row),
            shortDescription: detail,
            description: [text(row.DescriptionWork), detail].filter(Boolean).join(" · "),
            assigned: number(row.EvaluatedCount),
            present: number(row.PresentCount),
            absent: number(row.AbsenceCount),
            coverage: number(row.CoveragePct),
            active: summaryMarksCatalogActive || text(row.Status).toUpperCase() !== "INACTIVO",
            sourceStatus: text(row.Status),
            rules: []
        };
    });
}

function mapRecords(rows: ODataRow[], schedules: Record<string, unknown>[]): Record<string, unknown>[] {
    const schedulesByCode = new Map(schedules.map((schedule) => [text(schedule.code), schedule]));
    return rows.map((row) => {
        const personalNumber = text(row.PersonalNumber);
        const centerCode = text(row.CenterCode);
        const scheduleCode = text(row.Schedule);
        const schedule = schedulesByCode.get(scheduleCode) || {};
        const distance = text(row.DistanceMeters);
        return {
            id: `record-${personalNumber}-${text(row.WorkDate)}`,
            employeeId: `employee-${personalNumber}`,
            employee: text(row.FullName) || personalNumber,
            date: displayDate(row.WorkDate),
            dateISO: text(row.WorkDate),
            workDate: text(row.WorkDate),
            center: text(row.CenterOffice) || centerCode,
            centerId: centerCode.toLowerCase(),
            zoneId: slug(row.Zone),
            shift: text(row.ScheduleDescription) || text(schedule.name) || scheduleCode,
            scheduleId: `schedule-${slug(scheduleCode)}`,
            scheduled: text(row.ScheduleDetail) || text(schedule.shortDescription),
            entry: usableTime(row.P10Time),
            mealCheckOut: usableTime(row.P15Time),
            mealCheckIn: usableTime(row.P25Time),
            exit: usableTime(row.P20Time),
            hours: text(row.NetHours) || "0:00",
            distanceMeters: distance ? number(distance) : null,
            status: attendanceStatus(row),
            isLate: bool(row.IsLate),
            isAbsent: bool(row.IsAbsent),
            isIncomplete: bool(row.IsIncomplete),
            isOutOfZone: bool(row.IsOutOfZone),
            isEarlyExit: bool(row.IsEarlyExit) || bool(row.EarlyExit) || bool(row.IsEarly),
            observation: text(row.Observation),
            message: text(row.Message),
            justification: text(row.Justification) || text(row.JustificationText) || text(row.Message),
            approvalStatus: text(row.StatusReq),
            geoStatus: text(row.GeoStatus),
            geoStatusDescription: text(row.GeoStatusDescripcion)
        };
    });
}

export function mapAttendanceRecords(
    rows: ODataRow[],
    schedules: Record<string, unknown>[] = []
): Record<string, unknown>[] {
    return mapRecords(rows, schedules);
}

function mapEmployees(rows: ODataRow[], history: ODataRow[]): Record<string, unknown>[] {
    const employees = new Map<string, Record<string, unknown>>();
    rows.forEach((row) => {
        const personalNumber = text(row.PersonalNumber);
        if (!personalNumber) { return; }
        const score = (text(row.Zone) ? 8 : 0) + (/^ML\d+/i.test(text(row.CenterCode)) ? 6 : 0) +
            (/^Z\d+/i.test(text(row.ScheduleCode)) ? 5 : 0) + (text(row.ScheduleDetail) ? 3 : 0) +
            (text(row.Hourly) ? 2 : 0) + (text(row.Email) ? 1 : 0);
        const candidate: Record<string, unknown> = {
            id: `employee-${personalNumber}`,
            number: personalNumber,
            name: text(row.FullName) || personalNumber,
            initials: text(row.FullName).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0)).join(""),
            centerId: text(row.CenterCode).toLowerCase(),
            center: text(row.CenterOffice),
            zoneId: slug(row.Zone),
            shift: text(row.Hourly) || text(row.Shift),
            scheduleId: `schedule-${slug(row.ScheduleCode)}`,
            scheduleCode: text(row.ScheduleCode),
            scheduleName: text(row.Hourly) || text(row.ScheduleCode),
            scheduleDescription: text(row.ScheduleDetail),
            role: text(row.Position) || text(row.Role) || "Colaborador",
            status: text(row.DescriptionStatus),
            active: text(row.Status) !== "0",
            email: text(row.Email),
            lastUpdate: text(row.LastUpdate),
            _score: score
        };
        const existing = employees.get(personalNumber);
        if (!existing || number(candidate._score) > number(existing._score)) {
            employees.set(personalNumber, Object.assign({}, existing || {}, candidate));
        } else {
            ["email", "role", "lastUpdate", "scheduleDescription"].forEach((property) => {
                if (!text(existing[property]) && text(candidate[property])) { existing[property] = candidate[property]; }
            });
        }
    });
    history.forEach((row) => {
        const personalNumber = text(row.PersonalNumber);
        const existing = employees.get(personalNumber);
        if (existing) {
            if (!existing.centerId) { existing.centerId = text(row.CenterCode).toLowerCase(); }
            if (!existing.center) { existing.center = text(row.CenterOffice); }
            if (existing.zoneId === "sin-zona") { existing.zoneId = slug(row.Zone); }
            if (existing.scheduleId === "schedule-sin-zona") { existing.scheduleId = `schedule-${slug(row.Schedule)}`; }
            return;
        }
        employees.set(personalNumber, {
            id: `employee-${personalNumber}`,
            number: personalNumber,
            name: text(row.FullName) || personalNumber,
            initials: text(row.FullName).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0)).join(""),
            centerId: text(row.CenterCode).toLowerCase(),
            center: text(row.CenterOffice),
            zoneId: slug(row.Zone),
            shift: text(row.ScheduleDescription),
            scheduleId: `schedule-${slug(row.Schedule)}`,
            scheduleName: text(row.Schedule),
            role: "Colaborador",
            status: "Activo",
            active: true
        });
    });
    return Array.from(employees.values()).map((employee) => {
        const result = Object.assign({}, employee);
        delete result._score;
        return result;
    });
}

function mapCenters(rows: ODataRow[], history: ODataRow[], employees: Record<string, unknown>[]): Record<string, unknown>[] {
    const centers = new Map<string, Record<string, unknown>>();
    rows.forEach((row) => {
        const code = text(row.CenterCode);
        if (!code) { return; }
        const employee = employees.find((item) => text(item.centerId) === code.toLowerCase() && text(item.zoneId) !== "sin-zona");
        const zone = text(row.Zone) || text(employee?.zoneId);
        centers.set(code, {
            id: code.toLowerCase(),
            name: text(row.CenterOffice) || code,
            code,
            zoneId: slug(zone),
            zone: displayZone(zone),
            users: number(row.UsersCount),
            present: number(row.PresentCount),
            late: number(row.LateCount),
            absent: number(row.AbsenceCount),
            outside: number(row.OutOfZoneCount),
            attendance: number(row.AttendancePct),
            inefficiency: number(row.InefficiencyPct),
            incidents: number(row.IncidentCount),
            evaluated: number(row.EvaluatedCount),
            source: "sap",
            active: text(row.CenterStatus).toUpperCase() !== "INACTIVO"
        });
    });
    history.forEach((row) => {
        const code = text(row.CenterCode);
        if (!code) { return; }
        const existing = centers.get(code);
        if (existing) {
            if (existing.zoneId === "sin-zona") {
                existing.zoneId = slug(row.Zone);
                existing.zone = displayZone(row.Zone);
            }
            return;
        }
        centers.set(code, {
            id: code.toLowerCase(),
            name: text(row.CenterOffice) || code,
            code,
            zoneId: slug(row.Zone),
            zone: displayZone(row.Zone),
            users: 0,
            present: 0,
            late: 0,
            absent: 0,
            attendance: 0,
            evaluated: 0,
            source: "sap",
            active: true
        });
    });
    employees.forEach((employee) => {
        const code = text(employee.centerId).toUpperCase();
        if (!/^ML\d+/i.test(code) || centers.has(code)) { return; }
        centers.set(code, {
            id: code.toLowerCase(), name: text(employee.center) || code, code,
            zoneId: text(employee.zoneId), zone: displayZone(employee.zoneId),
            users: 0, present: 0, late: 0, absent: 0, outside: 0,
            attendance: 0, inefficiency: 0, incidents: 0, evaluated: 0,
            source: "sap", active: true
        });
    });
    return Array.from(centers.values());
}

function coordinate(value: unknown, longitude = false): number | null {
    const raw = text(value);
    if (!raw) { return null; }
    const trailingNegative = /-$/.test(raw);
    const parsed = Number(raw.replace(/-$/, ""));
    if (!Number.isFinite(parsed)) { return null; }
    if (trailingNegative) { return -Math.abs(parsed); }
    return longitude && parsed > 0 ? -parsed : parsed;
}

function mapLocations(
    rows: ODataRow[],
    centers: Record<string, unknown>[],
    employees: Record<string, unknown>[]
): Record<string, unknown> {
    const centersByCode = new Map(centers.map((center) => [text(center.code), center]));
    const employeesByNumber = new Map(employees.map((employee) => [text(employee.number), employee]));
    const locationsByCenter = new Map<string, Record<string, unknown>>();
    const mapPersonnel: Record<string, unknown>[] = [];
    rows.forEach((row) => {
        const code = text(row.Center);
        const center = centersByCode.get(code) || {};
        const employee = employeesByNumber.get(text(row.PersonalNumber)) || {};
        const employeeZoneId = text(employee.zoneId);
        const zoneId = employeeZoneId && employeeZoneId !== "sin-zona" ? employeeZoneId : (text(center.zoneId) || slug(row.Zone));
        const latitudeCenter = coordinate(row.LatitudeCenter);
        const longitudeCenter = coordinate(row.LongitudeCenter, true);
        if (code && latitudeCenter !== null && longitudeCenter !== null && !locationsByCenter.has(code)) {
            locationsByCenter.set(code, {
                id: code.toLowerCase(), zoneId, name: text(center.name) || code, code,
                position: `${longitudeCenter};${latitudeCenter};0`, type: "Default", icon: "sap-icon://building",
                tooltip: `${text(center.name) || code} · ubicación proporcionada por SAP`
            });
        }
        const latitudeEmployee = coordinate(row.LatitudeEmp);
        const longitudeEmployee = coordinate(row.LongitudeEmp, true);
        if (text(row.PersonalNumber) && latitudeEmployee !== null && longitudeEmployee !== null) {
            const name = text(row.FullName) || text(employee.name) || text(row.PersonalNumber);
            const geoStatus = text(row.GeoStatus);
            const state = /OUT|FUERA/i.test(geoStatus) ? "Error" : (/IN/i.test(geoStatus) ? "Success" : "None");
            mapPersonnel.push({
                employeeId: `employee-${text(row.PersonalNumber)}`,
                number: text(row.PersonalNumber), name,
                initials: name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0)).join(""),
                zoneId, centerId: code.toLowerCase(), center: text(center.name) || text(employee.center) || code,
                position: `${longitudeEmployee};${latitudeEmployee};0`, role: text(employee.role) || "Colaborador",
                locationStatus: geoStatus || "Ubicación registrada", type: state === "Error" ? "Error" : "Success", state,
                lastLocation: text(row.LastSignal) || text(row.LastUpdate) || "Sin hora reportada",
                accuracy: "Sin dato", tooltip: `${name} · ${geoStatus || "ubicación registrada"}`
            });
        }
    });
    const centerList = Array.from(locationsByCenter.values());
    const zoneGroups = new Map<string, Record<string, unknown>[]>();
    centerList.forEach((center) => {
        const zoneId = text(center.zoneId);
        if (zoneId === "sin-zona") { return; }
        const group = zoneGroups.get(zoneId) || [];
        group.push(center);
        zoneGroups.set(zoneId, group);
    });
    const mapZones = Array.from(zoneGroups.entries()).map(([zoneId, group]) => {
        const coordinates = group.map((center) => text(center.position).split(";").map(Number));
        const longitude = coordinates.reduce((sum, item) => sum + item[0], 0) / coordinates.length;
        const latitude = coordinates.reduce((sum, item) => sum + item[1], 0) / coordinates.length;
        const visible = mapPersonnel.filter((person) => person.zoneId === zoneId).length;
        return {
            id: zoneId, name: displayZone(zoneId), position: `${longitude};${latitude};0`,
            centerPosition: `${longitude};${latitude}`, zoomLevel: 6,
            text: zoneId.charAt(0).toUpperCase(), type: "Default", centers: group.length,
            users: visible, online: visible, tooltip: `${displayZone(zoneId)} · ${group.length} centros · ${visible} ubicaciones`
        };
    });
    return { mapZones, mapCenters: centerList, mapPersonnel };
}

function mapOverview(zoneRows: ODataRow[], indicators: ODataRow[], centerRows: ODataRow[], trendRows: ODataRow[]): Record<string, unknown> {
    const groupedZones = new Map<string, ODataRow[]>();
    zoneRows.forEach((row) => {
        const key = slug(row.Zone);
        const group = groupedZones.get(key) || [];
        group.push(row);
        groupedZones.set(key, group);
    });
    const zones = Array.from(groupedZones.entries()).map(([zoneId, rows]) => {
        const first = rows[0] || {};
        const users = rows.reduce((sum, row) => sum + number(row.UsersCount), 0);
        const evaluated = rows.reduce((sum, row) => sum + number(row.EvaluatedCount), 0) || users;
        const present = rows.reduce((sum, row) => sum + number(row.PresentCount), 0);
        const late = rows.reduce((sum, row) => sum + number(row.LateCount), 0);
        const absent = rows.reduce((sum, row) => sum + number(row.AbsenceCount), 0);
        const outside = rows.reduce((sum, row) => sum + number(row.OutOfZoneCount), 0);
        const attendance = evaluated ? present * 100 / evaluated : 0;
        const inefficiency = evaluated ? (late + absent + outside) * 100 / evaluated : 0;
        const riskInfo = risk(inefficiency, first.RiskLevel);
        const zoneName = displayZone(first.Zone);
        const explicitCenters = Math.max(...rows.map((row) => number(row.CentersCount)), 0);
        const centers = explicitCenters || new Set(centerRows
            .filter((row) => slug(row.Zone) === zoneId && text(row.CenterCode))
            .map((row) => text(row.CenterCode))).size;
        return {
            zoneId,
            zone: zoneName.replace(/^Zona\s+/i, ""),
            name: zoneName,
            centers,
            users,
            meta: `${centers} centros con registros · ${users} jornadas`,
            total: evaluated,
            present,
            late,
            absent,
            outside,
            attendance: attendance.toFixed(1),
            inefficiency: inefficiency.toFixed(1),
            incidentSummary: `${late} retardos · ${absent} ausencias · ${outside} fuera de zona`,
            inefficiencyText: `${inefficiency.toFixed(1)}% ineficiencia`,
            riskText: riskInfo.text,
            state: riskInfo.state,
            lateRate: evaluated ? late * 100 / evaluated : 0,
            absentRate: evaluated ? absent * 100 / evaluated : 0
        };
    });
    const indicator = (name: string, detail?: string): ODataRow | undefined => indicators.find((row) =>
        text(row.Indicator).toLowerCase() === name.toLowerCase() && (!detail || text(row.TextValues).toLowerCase() === detail.toLowerCase()));
    const attendance = indicator("Asistencia global");
    const late = indicator("Incidencias", "Retardos");
    const absent = indicator("Incidencias", "Ausencias");
    const outside = indicator("Incidencias", "Fuera de zona");
    const greatestRisk = indicator("Mayor riesgo");
    const gap = indicator("Brecha de meta");
    const priority = indicator("Prioridad del día");
    const incidentCount = number(late?.Numerator) + number(absent?.Numerator) + number(outside?.Numerator);
    const criticalCenters = centerRows.map((row) => {
        const inefficiency = number(row.InefficiencyPct);
        const riskInfo = risk(inefficiency, row.RiskLevel);
        return {
            id: text(row.CenterCode).toLowerCase(),
            center: text(row.CenterOffice),
            zone: displayZone(row.Zone),
            incidents: number(row.IncidentCount) || number(row.LateCount) + number(row.AbsenceCount) + number(row.OutOfZoneCount),
            inefficiency: `${inefficiency.toFixed(1)}%`,
            attendance: `${number(row.AttendancePct).toFixed(1)}%`,
            status: riskInfo.text,
            state: riskInfo.state,
            total: number(row.EvaluatedCount) || number(row.UsersCount)
        };
    }).filter((row) => row.total > 0).sort((a, b) => number(b.inefficiency) - number(a.inefficiency));
    return {
        zoneSummaries: zones,
        zoneInefficiency: zones.map((zone) => ({ zoneId: zone.zoneId, zone: zone.zone, lateRate: zone.lateRate, absentRate: zone.absentRate })),
        incidentTrend: trendRows.map((row) => ({
            day: displayDate(row.TrendDate).slice(0, 5),
            late: number(row.LateCount),
            absent: number(row.AbsenceCount),
            outsideZone: number(row.OutOfZoneCount)
        })),
        criticalCenters,
        overviewSummary: {
            attendance: number(attendance?.ValueIndicator).toFixed(1),
            attendanceDescription: text(attendance?.TextValues) || "Sin datos evaluados",
            incidents: incidentCount,
            incidentsDescription: `${number(late?.Numerator)} retardos · ${number(absent?.Numerator)} ausencias · ${number(outside?.Numerator)} fuera de zona`,
            criticalZone: text(greatestRisk?.TextValues) || "Sin riesgo detectado",
            criticalZoneDescription: text(greatestRisk?.ValueIndicator) || "Indicador proporcionado por SAP",
            targetGap: text(gap?.ValueIndicator) || "0.0 pp",
            targetGapDescription: text(gap?.TextValues) || "Diferencia frente a la meta de 90%"
        },
        priorityText: text(priority?.TextValues) || "No hay prioridades de ineficiencia para revisar."
    };
}

async function request(name: string, call: () => Promise<ODataRow[]>, errors: string[]): Promise<ODataRow[]> {
    try {
        return await call();
    } catch (error) {
        errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
        return [];
    }
}

export async function loadMonitorData(periodType = "SEMANA 43"): Promise<MonitorDataResult> {
    const api = new AttendanceApi();
    const errors: string[] = [];
    const periodFilter: ODataFilter[] = [{ field: "PeriodType", value: periodType }];
    const [zoneRows, indicators, centerRows, scheduleRows, historyRows, employeeRows, employeeSummaryRows,
        scheduleSummaryRows, trendRows, distributionRows, mapRows] = await Promise.all([
        request("ZoneSummarySet", () => api.getCollection("ZoneSummarySet", { filters: periodFilter }), errors),
        request("CriticalIndicatorsSet", () => api.getCollection("CriticalIndicatorsSet", { filters: periodFilter }), errors),
        request("CenterOfficeSummarySet", () => api.getCollection("CenterOfficeSummarySet", { filters: periodFilter }), errors),
        request("CatalogScheduleSet", () => api.getCollection("CatalogScheduleSet"), errors),
        request("AttendanceHistorySet", () => api.getCollection("AttendanceHistorySet", { filters: periodFilter }), errors),
        request("EmployeeSet", () => api.getCollection("EmployeeSet"), errors),
        request("EmployeeSummarySet", () => api.getCollection("EmployeeSummarySet"), errors),
        request("ScheduleSummarySet", () => api.getCollection("ScheduleSummarySet", { filters: periodFilter }), errors),
        request("IncidentTrendSet", () => api.getCollection("IncidentTrendSet", { filters: periodFilter }), errors),
        request("ScheduleDistributionSet", () => api.getCollection("ScheduleDistributionSet", { filters: periodFilter }), errors),
        request("GeneralMapUbicationsSet", () => api.getCollection("GeneralMapUbicationsSet"), errors)
    ]);
    const scheduleSummary = scheduleSummaryRows[0] || {};
    const schedules = mapSchedules(scheduleRows, number(scheduleSummary.ActiveSchedules));
    const records = mapRecords(historyRows, schedules);
    const employees = mapEmployees(employeeRows, historyRows);
    const centers = mapCenters(centerRows, historyRows, employees);
    const locations = mapLocations(mapRows, centers, employees);
    const overview = mapOverview(zoneRows, indicators, centerRows, trendRows);
    const zoneNames = new Map<string, string>();
    (overview.zoneSummaries as Record<string, unknown>[]).forEach((zone) => zoneNames.set(text(zone.zoneId), text(zone.name)));
    centers.forEach((center) => zoneNames.set(text(center.zoneId), text(center.zone)));
    const zones = [{ id: "all", name: "Todas las zonas" }].concat(Array.from(zoneNames.entries())
        .filter(([id]) => id !== "sin-zona")
        .map(([id, name]) => ({ id, name })));
    const employeeSummary = employeeSummaryRows[0] || {};
    const derivedActiveEmployees = employees.filter((employee) => Boolean(employee.active)).length;
    const derivedInactiveEmployees = employees.length - derivedActiveEmployees;

    return {
        errors,
        data: {
            serviceState: { loading: false, live: true, periodType, errors },
            zones,
            centers,
            schedules,
            employees,
            records,
            userPerformanceHistory: [],
            configuration: { lateTolerance: 10, earlyEntry: 20, automaticAbsence: "10:00", refreshMinutes: 5 },
            sapOverview: overview,
            sapZoneSummaries: zoneRows,
            sapCriticalIndicators: indicators,
            sapCenterSummaries: centerRows,
            sapScheduleDistribution: distributionRows,
            sapIncidentTrend: trendRows,
            sapScheduleSummary: scheduleSummaryRows,
            sapScheduleTypes: [],
            sapEmployees: employeeRows,
            sapEmployeeSummary: employeeSummaryRows,
            sapAttendanceHistory: historyRows,
            sapMapLocations: mapRows,
            mapZones: locations.mapZones,
            mapCenters: locations.mapCenters,
            mapPersonnel: locations.mapPersonnel,
            scheduleSummary: {
                active: number(scheduleSummary.ActiveSchedules),
                present: number(scheduleSummary.PresentCount),
                evaluated: number(scheduleSummary.EvaluatedCount),
                coverage: number(scheduleSummary.CoveragePct),
                absent: number(scheduleSummary.AbsenceCount),
                absencePct: number(scheduleSummary.AbsencePct)
            },
            employeeSummary: {
                total: number(employeeSummary.UsersCount) || employees.length,
                active: number(employeeSummary.ActiveCount) || derivedActiveEmployees,
                inactive: number(employeeSummary.InactiveCount) || derivedInactiveEmployees,
                centers: number(employeeSummary.CentersCount) || new Set(employees.map((employee) => text(employee.centerId)).filter(Boolean)).size
            }
        }
    };
}

export function emptyMonitorData(error?: string): Record<string, unknown> {
    return {
        serviceState: { loading: false, live: false, errors: error ? [error] : [] },
        zones: [{ id: "all", name: "Todas las zonas" }],
        centers: [], schedules: [], employees: [], records: [], userPerformanceHistory: [],
        sapOverview: null, sapZoneSummaries: [], sapCriticalIndicators: [], sapCenterSummaries: [],
        sapScheduleDistribution: [], sapIncidentTrend: [], sapScheduleSummary: [], sapScheduleTypes: [],
        sapEmployees: [], sapEmployeeSummary: [], sapAttendanceHistory: [], sapMapLocations: [],
        mapZones: [], mapCenters: [], mapPersonnel: [],
        employeeSummary: { total: 0, active: 0, inactive: 0, centers: 0 },
        configuration: { lateTolerance: 10, earlyEntry: 20, automaticAbsence: "10:00", refreshMinutes: 5 }
    };
}
