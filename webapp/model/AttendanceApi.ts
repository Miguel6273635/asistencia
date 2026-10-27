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
    | "SearchText";

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
        const response = await fetch(this.buildUrl(entitySet, options), {
            method: "GET",
            credentials: "same-origin",
            headers: { Accept: "application/json" },
            signal: options.signal
        });

        if (!response.ok) {
            throw await this.toError(response, `${entitySet} respondió con HTTP ${response.status}`);
        }

        const body = await response.json() as ODataV2Collection<T>;
        return body.d?.results ?? [];
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

    public async createAttendanceRecord(payload: AttendanceRecordPayload): Promise<ODataRow> {
        const response = await fetch(`${this.serviceRoot}AttendanceRecordSet`, {
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
            throw await this.toError(response, `AttendanceRecordSet respondió con HTTP ${response.status}`);
        }

        const body = await response.json() as { d?: ODataRow };
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
        return new AttendanceApiError(response.status, message, await response.text());
    }
}
