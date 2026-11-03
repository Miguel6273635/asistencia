/* global Promise */

export type AttendanceEntitySet =
    | "ZoneSummarySet"
    | "CriticalIndicatorsSet"
    | "CenterOfficeSummarySet"
    | "ScheduleDistributionSet"
    | "IncidentTrendSet"
    | "AttendanceHistorySet"
    | "AttendanceRecordSet"
    | "CatalogScheduleSet"
    | "ProcessingJustificationsSet"
    | "CenterOfficeSet"
    | "ZoneAttendanceSet"
    | "BasesSet"
    | "ScheduleSummarySet"
    | "ScheduleTypeDistributionSet"
    | "EmployeeSet"
    | "EmployeeSummarySet"
    | "PerformanceTrendSet"
    | "GeneralMapUbicationsSet";

export type FilterOperator = "eq" | "ne" | "gt" | "ge" | "lt" | "le";

export type FilterField =
    | "PeriodType"
    | "ReferenceDate"
    | "DateFrom"
    | "DateTo"
    | "Zone"
    | "CenterOffice"
    | "Schedule"
    | "ScheduleCode"
    | "ScheduleType"
    | "Status"
    | "PersonalNumber"
    | "Email"
    | "SearchText"
    | "DateJustification"
    | "TypeRegister"
    | "DecisionRH";

export interface ODataFilter {
    field: FilterField;
    operator?: FilterOperator;
    value: string | number | boolean | Date;
}

export interface QueryOptions {
    filters?: readonly ODataFilter[];
    select?: readonly string[];
    orderBy?: readonly string[];
    top?: number;
    skip?: number;
    signal?: AbortSignal;
}

export type ODataRow = Readonly<Record<string, unknown>>;

interface ODataV2Collection<T> {
    d?: { results?: T[] };
}

export interface AttendanceRecordPayload {
    PersonalNumber: string;
    RegisterType: "P10" | "P11" | "P15" | "P20" | "P25";
    EnterDate: string;
    EnterHour: string;
    Chanel: string;
    Device: string;
    Id_log: string;
    FullName?: string;
    Email?: string;
    Latitude?: string;
    Longitude?: string;
    GeoStatus?: string;
    IsLate?: string;
    StatusReq?: string;
    Message?: string;
}

export interface EmployeeUploadItem {
    RequestId: string;
    ItemNo: string;
    PersonnelNumber: string;
    HireDate: string;
    Position: string;
    PersonnelArea: string;
    EmployeeGroup: string;
    EmployeeSubgroup: string;
    FirstName: string;
    LastName: string;
    BirthDate?: string;
    Language?: string;
    BirthCountry?: string;
    Gender?: string;
    PersonnelSubarea?: string;
    AttendanceChannel?: string;
    Zone?: string;
    City?: string;
    Region?: string;
    Municipality?: string;
    Country?: string;
    ResidenceType?: string;
    Schedule?: string;
    Email: string;
}

export interface EmployeeUploadPayload {
    RequestId: string;
    Operation: string;
    ProcessingMode: string;
    ToEmployeesUpload: EmployeeUploadItem[];
}

export interface ProcessingJustificationPayload {
    PersonalNumber: string;
    FullName: string;
    CenterOffice: string;
    Zone: string;
    Base: string;
    DateJustification: string;
    TypeRegister: string;
    TypeRegisterDescrip: string;
    IncidentType: string;
    ReasonType: string;
    JustificationStatus: string;
    DescriptionStatus: string;
    Email: string;
    DecisionRH: string;
    CommentsRH: string;
}

export interface OverviewQuery {
    periodType: string;
    referenceDate?: string;
    zone?: string;
    scheduleCode?: string;
    status?: string;
}

export interface OverviewSnapshot {
    zones: ODataRow[];
    indicators: ODataRow[];
}

export interface CenterSnapshot {
    indicators: ODataRow[];
    scheduleDistribution: ODataRow[];
    incidentTrend: ODataRow[];
    schedules: ODataRow[];
}

export class AttendanceApiError extends Error {
    public constructor(
        public readonly status: number,
        message: string,
        public readonly responseBody = ""
    ) {
        super(message);
        this.name = "AttendanceApiError";
    }
}

function trimSlashes(value: string): string {
    return value.replace(/^\/+|\/+$/g, "");
}

function formatLiteral(value: ODataFilter["value"]): string {
    if (value instanceof Date) {
        return `datetime'${value.toISOString().replace(/\.\d{3}Z$/, "")}'`;
    }
    if (typeof value === "string") {
        return `'${value.replace(/'/g, "''")}'`;
    }
    return String(value);
}

function buildFilter(filters: readonly ODataFilter[] = []): string {
    return filters
        .filter((filter) => filter.value !== "")
        .map((filter) => `${filter.field} ${filter.operator ?? "eq"} ${formatLiteral(filter.value)}`)
        .join(" and ");
}

function filtersForOverview(query: OverviewQuery): ODataFilter[] {
    const filters: ODataFilter[] = [{ field: "PeriodType", value: query.periodType }];
    if (query.referenceDate) {
        filters.push({ field: "ReferenceDate", value: query.referenceDate });
    }
    if (query.zone) {
        filters.push({ field: "Zone", value: query.zone });
    }
    if (query.scheduleCode) {
        filters.push({ field: "ScheduleCode", value: query.scheduleCode });
    }
    if (query.status) {
        filters.push({ field: "Status", value: query.status });
    }
    return filters;
}

export default class AttendanceApi {
    private readonly serviceRoot: string;
    private csrfToken = "";

    public constructor(serviceRoot = "/sap/opu/odata/sap/ZHMC_ATTENDANCE_MONITORING_SRV/") {
        this.serviceRoot = `/${trimSlashes(serviceRoot)}/`;
    }

    public async getCollection<T extends ODataRow = ODataRow>(
        entitySet: AttendanceEntitySet,
        options: QueryOptions = {}
    ): Promise<T[]> {
        const url = this.buildUrl(entitySet, options);
        console.groupCollapsed(`[Monitor][ODATA][GET][${entitySet}]`);
        console.info("URL", url);
        console.info("Filtros", options.filters ?? []);
        console.info("Opciones", options);
        console.groupEnd();
        const response = await fetch(url, {
            method: "GET",
            credentials: "same-origin",
            headers: { Accept: "application/json" },
            signal: options.signal
        });

        if (!response.ok) {
            throw await this.toError(response, `${entitySet} respondió con HTTP ${response.status}`);
        }

        const body = await response.json() as ODataV2Collection<T>;
        const rows = body.d?.results ?? [];
        console.groupCollapsed(`[Monitor][ODATA][RAW-RESPONSE][${entitySet}] ${rows.length} fila(s)`);
        console.info(body);
        console.table(rows);
        console.groupEnd();
        return rows;
    }

    public async getOverview(query: OverviewQuery, signal?: AbortSignal): Promise<OverviewSnapshot> {
        const options: QueryOptions = { filters: filtersForOverview(query), signal };
        const [zones, indicators] = await Promise.all([
            this.getCollection("ZoneSummarySet", options),
            this.getCollection("CriticalIndicatorsSet", options)
        ]);
        return { zones, indicators };
    }

    public async getCenterSnapshot(
        periodType: string,
        centerOffice: string,
        signal?: AbortSignal
    ): Promise<CenterSnapshot> {
        const filters: ODataFilter[] = [
            { field: "PeriodType", value: periodType },
            { field: "CenterOffice", value: centerOffice }
        ];
        const options: QueryOptions = { filters, signal };
        const [indicators, scheduleDistribution, incidentTrend, schedules] = await Promise.all([
            this.getCollection("CriticalIndicatorsSet", options),
            this.getCollection("ScheduleDistributionSet", options),
            this.getCollection("IncidentTrendSet", options),
            this.getCollection("CatalogScheduleSet", { signal })
        ]);
        return { indicators, scheduleDistribution, incidentTrend, schedules };
    }

    public getAttendanceHistory(filters: readonly ODataFilter[], signal?: AbortSignal): Promise<ODataRow[]> {
        return this.getCollection("AttendanceHistorySet", { filters, signal });
    }

    public getEmployees(filters: readonly ODataFilter[] = [], signal?: AbortSignal): Promise<ODataRow[]> {
        return this.getCollection("EmployeeSet", { filters, signal });
    }

    public getSchedules(filters: readonly ODataFilter[] = [], signal?: AbortSignal): Promise<ODataRow[]> {
        return this.getCollection("CatalogScheduleSet", { filters, signal });
    }

    public getPerformanceTrend(filters: readonly ODataFilter[], signal?: AbortSignal): Promise<ODataRow[]> {
        return this.getCollection("PerformanceTrendSet", { filters, signal });
    }

    public getGeneralMapLocations(filters: readonly ODataFilter[] = [], signal?: AbortSignal): Promise<ODataRow[]> {
        return this.getCollection("GeneralMapUbicationsSet", { filters, signal });
    }

    public getProcessingJustifications(
        dateFrom: string,
        dateTo: string,
        signal?: AbortSignal
    ): Promise<ODataRow[]> {
        return this.getCollection("ProcessingJustificationsSet", {
            filters: [
                { field: "DateFrom", value: dateFrom },
                { field: "DateTo", value: dateTo }
            ],
            signal
        });
    }

    public submitJustificationDecision(payload: ProcessingJustificationPayload): Promise<ODataRow> {
        return this.postEntity("ProcessingJustificationsSet", payload, "JUSTIFICATION-DECISION");
    }

    public async createAttendanceRecord(payload: AttendanceRecordPayload): Promise<ODataRow> {
        return this.postEntity("AttendanceRecordSet", payload, "ATTENDANCE-RECORD");
    }

    private async postEntity(
        entitySet: AttendanceEntitySet,
        payload: AttendanceRecordPayload | ProcessingJustificationPayload,
        logName: string
    ): Promise<ODataRow> {
        const url = `${this.serviceRoot}${entitySet}`;
        console.groupCollapsed(`[Monitor][ODATA][POST][${logName}]`);
        console.info("URL", url);
        console.info("Payload", payload);
        console.groupEnd();
        const response = await fetch(url, {
            method: "POST",
            credentials: "same-origin",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "X-CSRF-Token": await this.getCsrfToken()
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw await this.toError(response, `${entitySet} respondió con HTTP ${response.status}`);
        }

        if (response.status === 204) {
            return {};
        }
        const body = await response.json() as { d?: ODataRow };
        console.groupCollapsed(`[Monitor][ODATA][RAW-RESPONSE][${logName}]`);
        console.info(body);
        console.groupEnd();
        return body.d ?? {};
    }

    public async uploadEmployees(
        payload: EmployeeUploadPayload,
        entitySet = "EmployeesUploadSet"
    ): Promise<ODataRow> {
        if (!/^[A-Za-z0-9_]+$/.test(entitySet)) {
            throw new Error("El EntitySet de carga contiene caracteres no permitidos.");
        }
        const url = `${this.serviceRoot}${entitySet}`;
        console.groupCollapsed(`[Monitor][EMPLOYEE-UPLOAD][POST][${entitySet}]`);
        console.info("URL", url);
        console.info("Payload", payload);
        console.groupEnd();
        const response = await fetch(url, {
            method: "POST",
            credentials: "same-origin",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "X-CSRF-Token": await this.getCsrfToken()
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw await this.toError(response, `${entitySet} respondió con HTTP ${response.status}`);
        }

        if (response.status === 204) {
            return {};
        }
        const body = await response.json() as { d?: ODataRow };
        console.groupCollapsed(`[Monitor][EMPLOYEE-UPLOAD][RAW-RESPONSE][${entitySet}]`);
        console.info(body);
        console.groupEnd();
        return body.d ?? {};
    }

    private buildUrl(entitySet: AttendanceEntitySet, options: QueryOptions): string {
        const params = new URLSearchParams();
        const filter = buildFilter(options.filters);
        if (filter) {
            params.set("$filter", filter);
        }
        if (options.select?.length) {
            params.set("$select", options.select.join(","));
        }
        if (options.orderBy?.length) {
            params.set("$orderby", options.orderBy.join(","));
        }
        if (Number.isInteger(options.top) && Number(options.top) > 0) {
            params.set("$top", String(options.top));
        }
        if (Number.isInteger(options.skip) && Number(options.skip) >= 0) {
            params.set("$skip", String(options.skip));
        }
        params.set("$format", "json");
        const query = params.toString().replace(/\+/g, "%20");
        return `${this.serviceRoot}${entitySet}?${query}`;
    }

    private async getCsrfToken(): Promise<string> {
        if (this.csrfToken) {
            return this.csrfToken;
        }
        const response = await fetch(this.serviceRoot, {
            method: "GET",
            credentials: "same-origin",
            headers: { Accept: "application/json", "X-CSRF-Token": "Fetch" }
        });
        if (!response.ok) {
            throw await this.toError(response, `No fue posible obtener el token CSRF: HTTP ${response.status}`);
        }
        const token = response.headers.get("X-CSRF-Token");
        if (!token) {
            throw new AttendanceApiError(response.status, "El servicio no devolvió un token CSRF.");
        }
        this.csrfToken = token;
        return token;
    }

    private async toError(response: Response, message: string): Promise<AttendanceApiError> {
        const responseBody = await response.text();
        console.error("[Monitor][ODATA][ERROR]", {
            status: response.status,
            statusText: response.statusText,
            url: response.url,
            message,
            responseBody
        });
        return new AttendanceApiError(response.status, message, responseBody);
    }
}
