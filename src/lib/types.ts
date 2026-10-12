import { PROCESS_SORTS, SERVICE_SORTS, type ProcessSort, type ServiceSort, type SortDir } from './table-query.ts';
import type { RangeKey } from './ranges.ts';

export type HostSnapshot = {
	name: string;
	lanIp: string | null;
	tailscaleIp: string | null;
	role: string | null;
	/** metrics.hosts.hosts — what this host runs. */
	runs: string | null;
	cpuPercent: number | null;
	memoryPercent: number | null;
	/** Bytes from the latest metrics.mem row. Null when that column is absent. */
	memoryUsedBytes: number | null;
	memoryTotalBytes: number | null;
	memoryAvailableBytes: number | null;
	diskPercent: number | null;
	/** Bytes from the latest metrics.disk row where path = '/'. */
	diskUsedBytes: number | null;
	diskTotalBytes: number | null;
	diskFreeBytes: number | null;
	tempC: number | null;
	load1: number | null;
	load5: number | null;
	load15: number | null;
	uptimeSeconds: number | null;
	/** ISO-8601 UTC. */
	lastReported: string | null;
	online: boolean;
};

export type Overview = {
	generatedAt: string;
	hosts: HostSnapshot[];
};

export type SeriesPoint = {
	t: string;
	cpu: number | null;
	memory: number | null;
	disk: number | null;
	temp: number | null;
	load1: number | null;
	netRx: number | null;
	netTx: number | null;
	diskRead: number | null;
	diskWrite: number | null;
};

export type HostDetail = {
	generatedAt: string;
	range: RangeKey;
	host: HostSnapshot;
	points: SeriesPoint[];
};

export function isOverview(value: unknown): value is Overview {
	if (!value || typeof value !== 'object') return false;
	const hosts = (value as Overview).hosts;
	return typeof (value as Overview).generatedAt === 'string' && Array.isArray(hosts);
}

const CAPACITY_FIELDS = [
	'memoryUsedBytes',
	'memoryTotalBytes',
	'memoryAvailableBytes',
	'diskUsedBytes',
	'diskTotalBytes',
	'diskFreeBytes'
] as const;

function isOptionalFinite(value: unknown): boolean {
	return value == null || (typeof value === 'number' && Number.isFinite(value));
}

export type CheckState = 'up' | 'down' | 'unknown' | 'none';

export type ServiceStatus = 'up' | 'down' | 'unknown';

export type ServiceHealth = {
	name: string;
	project: string;
	host: string;
	port: number | null;
	healthUrl: string | null;
	systemdUnit: string | null;
	systemdScope: 'system' | 'user' | null;
	status: ServiceStatus;
	unit: CheckState;
	http: CheckState;
	unitActive: string | null;
	unitSub: string | null;
	httpCode: number | null;
	httpResult: string | null;
	/** ISO-8601 UTC. */
	lastCheck: string | null;
	latencyMs: number | null;
	/** Sum of the linked processes. Irix mode: 100 is one core. */
	cpuPercent: number | null;
	memoryRssBytes: number | null;
	memoryPercent: number | null;
};

export type ProcessSample = {
	host: string;
	processName: string;
	/** Shortened command line. Null when Telegraf did not store one. */
	cmdline: string | null;
	pid: string;
	user: string | null;
	threads: number | null;
	cpuPercent: number | null;
	memoryRssBytes: number | null;
	memoryPercent: number | null;
	uptimeSeconds: number | null;
	/** ISO-8601 UTC. */
	sampledAt: string;
	/** Declared service this row belongs to, when one matches. */
	serviceName: string | null;
};

export type ServicesPayload = {
	generatedAt: string;
	/** Null means every host. */
	host: string | null;
	/** Process-list sort. Unchanged: `cpu` or `memory`. */
	sort: 'cpu' | 'memory';
	service: string | null;
	/** Service-table search. Null means no search. */
	q: string | null;
	/** Service-table column. Does not change `sort`. */
	order: ServiceSort;
	dir: SortDir;
	/** Null means `services` is the full filtered list. */
	page: number | null;
	pageSize: number | null;
	/** Service rows after host and search filters, before paging. */
	servicesTotal: number;
	hosts: string[];
	servicesAvailable: boolean;
	processesAvailable: boolean;
	/** Newest process sample in the selection. ISO-8601 UTC. */
	sampledAt: string | null;
	services: ServiceHealth[];
	processes: ProcessSample[];
};

export type ProcessesPayload = {
	generatedAt: string;
	host: string | null;
	service: string | null;
	q: string | null;
	sort: ProcessSort;
	dir: SortDir;
	page: number;
	pageSize: number;
	/** Rows after host, search, and service filters, before paging. */
	total: number;
	hosts: string[];
	processesAvailable: boolean;
	/** Newest process sample in the filtered selection. ISO-8601 UTC. */
	sampledAt: string | null;
	processes: ProcessSample[];
};

export function isHostDetail(value: unknown): value is HostDetail {
	if (!value || typeof value !== 'object') return false;
	const detail = value as HostDetail;
	if (
		typeof detail.generatedAt !== 'string' ||
		(detail.range !== '1h' && detail.range !== '1d' && detail.range !== '1w') ||
		!Array.isArray(detail.points) ||
		!detail.host ||
		typeof detail.host !== 'object' ||
		typeof detail.host.name !== 'string'
	) {
		return false;
	}
	return CAPACITY_FIELDS.every((key) => isOptionalFinite(detail.host[key]));
}

const CHECK_STATES = new Set<CheckState>(['up', 'down', 'unknown', 'none']);
const SERVICE_ORDERS = new Set<string>(SERVICE_SORTS);
const PROCESS_ORDERS = new Set<string>(PROCESS_SORTS);

function isCount(value: unknown): boolean {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isOptionalPage(value: unknown): boolean {
	return value == null || (typeof value === 'number' && Number.isInteger(value) && value >= 1);
}

function isServiceHealth(value: unknown): value is ServiceHealth {
	if (!value || typeof value !== 'object') return false;
	const row = value as ServiceHealth;
	return (
		typeof row.name === 'string' &&
		typeof row.project === 'string' &&
		typeof row.host === 'string' &&
		isOptionalFinite(row.port) &&
		(row.healthUrl == null || typeof row.healthUrl === 'string') &&
		(row.systemdUnit == null || typeof row.systemdUnit === 'string') &&
		(row.systemdScope == null || row.systemdScope === 'system' || row.systemdScope === 'user') &&
		(row.status === 'up' || row.status === 'down' || row.status === 'unknown') &&
		CHECK_STATES.has(row.unit) &&
		CHECK_STATES.has(row.http) &&
		(row.unitActive == null || typeof row.unitActive === 'string') &&
		(row.unitSub == null || typeof row.unitSub === 'string') &&
		isOptionalFinite(row.httpCode) &&
		(row.httpResult == null || typeof row.httpResult === 'string') &&
		(row.lastCheck == null || typeof row.lastCheck === 'string') &&
		isOptionalFinite(row.latencyMs) &&
		isOptionalFinite(row.cpuPercent) &&
		isOptionalFinite(row.memoryRssBytes) &&
		isOptionalFinite(row.memoryPercent)
	);
}

function isProcessSample(value: unknown): value is ProcessSample {
	if (!value || typeof value !== 'object') return false;
	const row = value as ProcessSample;
	return (
		typeof row.host === 'string' &&
		typeof row.processName === 'string' &&
		(row.cmdline == null || typeof row.cmdline === 'string') &&
		typeof row.pid === 'string' &&
		(row.user == null || typeof row.user === 'string') &&
		isOptionalFinite(row.threads) &&
		isOptionalFinite(row.cpuPercent) &&
		isOptionalFinite(row.memoryRssBytes) &&
		isOptionalFinite(row.memoryPercent) &&
		isOptionalFinite(row.uptimeSeconds) &&
		typeof row.sampledAt === 'string' &&
		(row.serviceName == null || typeof row.serviceName === 'string')
	);
}

export function isServicesPayload(value: unknown): value is ServicesPayload {
	if (!value || typeof value !== 'object') return false;
	const payload = value as ServicesPayload;
	return (
		typeof payload.generatedAt === 'string' &&
		(payload.host == null || typeof payload.host === 'string') &&
		(payload.sort === 'cpu' || payload.sort === 'memory') &&
		(payload.service == null || typeof payload.service === 'string') &&
		(payload.q == null || typeof payload.q === 'string') &&
		SERVICE_ORDERS.has(payload.order) &&
		(payload.dir === 'asc' || payload.dir === 'desc') &&
		isOptionalPage(payload.page) &&
		isOptionalPage(payload.pageSize) &&
		isCount(payload.servicesTotal) &&
		Array.isArray(payload.hosts) &&
		payload.hosts.every((host) => typeof host === 'string') &&
		typeof payload.servicesAvailable === 'boolean' &&
		typeof payload.processesAvailable === 'boolean' &&
		(payload.sampledAt == null || typeof payload.sampledAt === 'string') &&
		Array.isArray(payload.services) &&
		payload.services.every(isServiceHealth) &&
		Array.isArray(payload.processes) &&
		payload.processes.every(isProcessSample)
	);
}

export function isProcessesPayload(value: unknown): value is ProcessesPayload {
	if (!value || typeof value !== 'object') return false;
	const payload = value as ProcessesPayload;
	return (
		typeof payload.generatedAt === 'string' &&
		(payload.host == null || typeof payload.host === 'string') &&
		(payload.service == null || typeof payload.service === 'string') &&
		(payload.q == null || typeof payload.q === 'string') &&
		PROCESS_ORDERS.has(payload.sort) &&
		(payload.dir === 'asc' || payload.dir === 'desc') &&
		isOptionalPage(payload.page) &&
		payload.page != null &&
		isOptionalPage(payload.pageSize) &&
		payload.pageSize != null &&
		isCount(payload.total) &&
		Array.isArray(payload.hosts) &&
		payload.hosts.every((host) => typeof host === 'string') &&
		typeof payload.processesAvailable === 'boolean' &&
		(payload.sampledAt == null || typeof payload.sampledAt === 'string') &&
		Array.isArray(payload.processes) &&
		payload.processes.every(isProcessSample)
	);
}
