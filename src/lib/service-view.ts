import { isHostName } from './host.ts';
import { PROCESS_CAP, STALE_AFTER_MS } from './limits.ts';
import type { ProcessesQuery } from './process-query.ts';
import type { ServicesQuery } from './services-query.ts';
import { compareValues, slicePage, type ProcessSort, type ServiceSort, type SortDir } from './table-query.ts';
import type {
	CheckState,
	ProcessSample,
	ProcessesPayload,
	ServiceHealth,
	ServiceStatus,
	ServicesPayload
} from './types.ts';

export type RawService = {
	name: string;
	project: string;
	host: string;
	port: number | null;
	healthUrl: string | null;
	systemdUnit: string | null;
	systemdScope: 'system' | 'user' | null;
	processMatch: string | null;
	/** Set by the service query's ILIKE. Ignored when the request has no search. */
	matchesSearch?: boolean;
};

export type RawUnit = {
	host: string;
	name: string;
	active: string | null;
	sub: string | null;
	sampledAt: string | null;
};

export type RawHttp = {
	host: string;
	server: string;
	result: string | null;
	statusCode: number | null;
	responseTimeSeconds: number | null;
	sampledAt: string | null;
};

export type RawProcess = {
	host: string;
	processName: string;
	cmdline: string | null;
	pid: string;
	user: string | null;
	filter: string | null;
	systemdUnit: string | null;
	cpuPercent: number | null;
	memoryRssBytes: number | null;
	memoryPercent: number | null;
	threads: number | null;
	/** Nanoseconds since the epoch, as digits. Float64 cannot hold this. */
	createdAt: string | null;
	sampledAt: string;
};

export type ServicesViewInput = {
	generatedAt: string;
	query: ServicesQuery;
	knownHosts: string[];
	servicesAvailable: boolean;
	processesAvailable: boolean;
	services: RawService[];
	units: RawUnit[];
	http: RawHttp[];
	processes: RawProcess[];
};

export type ProcessesViewInput = {
	generatedAt: string;
	query: ProcessesQuery;
	knownHosts: string[];
	processesAvailable: boolean;
	services: RawService[];
	processes: RawProcess[];
};

const TEN_YEARS_MS = 10 * 365.25 * 24 * 60 * 60 * 1000;

type Linked = {
	sample: ProcessSample;
	rank: number;
};

function finite(value: number | null | undefined): number | null {
	return value != null && Number.isFinite(value) ? value : null;
}

function sumFinite(values: Array<number | null>): number | null {
	let total = 0;
	let any = false;
	for (const value of values) {
		if (value == null || !Number.isFinite(value)) continue;
		total += value;
		any = true;
	}
	return any ? total : null;
}

function instant(value: string | null | undefined): number | null {
	if (!value) return null;
	const ms = new Date(value).getTime();
	return Number.isFinite(ms) ? ms : null;
}

/** Uptime from Telegraf's created_at (ns) and the sample time. Rejects junk. */
export function uptimeSeconds(createdAt: string | null, sampledAt: string): number | null {
	if (!createdAt || !/^\d+$/.test(createdAt)) return null;
	const startedMs = BigInt(createdAt) / 1_000_000n;
	const started = Number(startedMs);
	const sampleMs = instant(sampledAt);
	if (!Number.isFinite(started) || sampleMs == null) return null;
	const delta = sampleMs - started;
	if (delta < 0 || delta > TEN_YEARS_MS) return null;
	return delta / 1000;
}

const CMDLINE_LIMIT = 80;
const INTERPRETERS = new Set(['node', 'python', 'python3', 'sh', 'bash', 'pnpm', 'npm']);

/** A sample older than the dashboard stale window is not a current check. */
function isFresh(sampledAt: string | null | undefined, generatedAt: string): boolean {
	const sample = instant(sampledAt);
	const generated = instant(generatedAt);
	if (sample == null || generated == null) return false;
	return generated - sample <= STALE_AFTER_MS;
}

function basename(token: string): string {
	const slash = token.lastIndexOf('/');
	return slash >= 0 ? token.slice(slash + 1) : token;
}

function clip(value: string): string {
	if (value.length <= CMDLINE_LIMIT) return value;
	return value.slice(0, CMDLINE_LIMIT - 1) + '…';
}

/**
 * Node reports every process as MainThread. Prefer the workspace project path,
 * then a specific binary name, so the process table can tell the rows apart.
 * Postgres session lines stay as `postgres` (they carry client addresses).
 */
export function shortCmdline(cmdline: string | null | undefined): string | null {
	if (cmdline == null) return null;
	const trimmed = cmdline.trim();
	if (trimmed === '') return null;
	if (trimmed.startsWith('postgres:')) return 'postgres';
	const parts = trimmed.split(/\s+/);
	const marker = '/workspace/';
	for (const part of parts) {
		const at = part.indexOf(marker);
		if (at < 0) continue;
		const segments = part
			.slice(at + marker.length)
			.split('/')
			.filter((segment) => segment !== '');
		const head = segments.slice(0, 2).join('/');
		if (head) return clip(head);
	}
	const pathName = parts
		.filter((part) => part.includes('/'))
		.map(basename)
		.find((name) => name !== '' && !INTERPRETERS.has(name));
	if (pathName) return clip(pathName);
	const argv0 = basename(parts[0] ?? '');
	if (argv0 && !INTERPRETERS.has(argv0)) return clip(argv0);
	if (!argv0) return null;
	const next = parts.slice(1).find((part) => !part.startsWith('-') && !part.includes('/'));
	return clip(next ? `${argv0} ${next}` : argv0);
}

function unitState(
	declared: boolean,
	active: string | null,
	sampledAt: string | null | undefined,
	generatedAt: string
): CheckState {
	if (!declared) return 'none';
	if (!isFresh(sampledAt, generatedAt)) return 'unknown';
	if (active == null || active === '') return 'unknown';
	if (active === 'active') return 'up';
	if (active === 'activating' || active === 'reloading' || active === 'deactivating') return 'unknown';
	return 'down';
}

function httpState(
	declared: boolean,
	result: string | null,
	statusCode: number | null,
	sampledAt: string | null | undefined,
	generatedAt: string
): CheckState {
	if (!declared) return 'none';
	if (!isFresh(sampledAt, generatedAt)) return 'unknown';
	if (result == null && statusCode == null) return 'unknown';
	if (result === 'success' && statusCode != null && statusCode >= 200 && statusCode <= 399) return 'up';
	return 'down';
}

/** User-scope units have no unit sample. Presence of a fresh process is the check. */
function processState(
	declared: boolean,
	available: boolean,
	rows: RawProcess[],
	generatedAt: string
): CheckState {
	if (!declared) return 'none';
	if (!available) return 'unknown';
	if (rows.some((row) => isFresh(row.sampledAt, generatedAt))) return 'up';
	if (rows.length > 0) return 'unknown';
	return 'down';
}

function overallStatus(checks: CheckState[]): ServiceStatus {
	const present = checks.filter((state) => state !== 'none');
	if (present.length === 0) return 'unknown';
	if (present.some((state) => state === 'down')) return 'down';
	if (present.every((state) => state === 'up')) return 'up';
	return 'unknown';
}

function latencyMs(seconds: number | null | undefined): number | null {
	if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
	return seconds * 1000;
}

function latestIso(values: Array<string | null | undefined>): string | null {
	let best: number | null = null;
	for (const value of values) {
		const ms = instant(value);
		if (ms == null) continue;
		if (best == null || ms > best) best = ms;
	}
	return best == null ? null : new Date(best).toISOString();
}

function byHostThenName(a: { host: string; name: string }, b: { host: string; name: string }): number {
	if (a.host !== b.host) return a.host < b.host ? -1 : 1;
	if (a.name !== b.name) return a.name < b.name ? -1 : 1;
	return 0;
}

const STATUS_RANK: Record<ServiceStatus, number> = { up: 0, unknown: 1, down: 2 };

export function statusLabel(status: ServiceStatus): string {
	if (status === 'up') return 'Up';
	if (status === 'down') return 'Down';
	return 'Unknown';
}

export function unitLabel(row: Pick<ServiceHealth, 'unit' | 'unitActive' | 'unitSub'>): string {
	if (row.unit === 'none') return 'n/a';
	if (row.unit === 'unknown') return 'unknown';
	const active = row.unitActive ?? 'unknown';
	return row.unitSub ? `${active} / ${row.unitSub}` : active;
}

export function httpLabel(row: Pick<ServiceHealth, 'http' | 'httpCode' | 'httpResult'>): string {
	if (row.http === 'none') return 'n/a';
	if (row.http === 'unknown') return 'unknown';
	if (row.httpCode != null) return String(row.httpCode);
	return row.httpResult ?? 'down';
}

function serviceValue(row: ServiceHealth, order: ServiceSort): string | number | null {
	switch (order) {
		case 'name':
			return row.name;
		case 'status':
			return STATUS_RANK[row.status];
		case 'host':
			return row.host;
		case 'port':
			return row.port;
		case 'unit':
			return unitLabel(row);
		case 'http':
			return httpLabel(row);
		case 'lastCheck':
			return row.lastCheck;
		case 'latency':
			return row.latencyMs;
		case 'cpu':
			return row.cpuPercent;
		case 'memory':
			return row.memoryRssBytes;
	}
}

function processValue(row: ProcessSample, sort: ProcessSort): string | number | null {
	switch (sort) {
		case 'host':
			return row.host;
		case 'process':
			return row.cmdline ?? row.processName;
		case 'pid':
			return /^\d+$/.test(row.pid) ? Number(row.pid) : row.pid;
		case 'user':
			return row.user;
		case 'threads':
			return row.threads;
		case 'cpu':
			return row.cpuPercent;
		case 'memory':
			return row.memoryRssBytes;
		case 'uptime':
			return row.uptimeSeconds;
		case 'sampledAt':
			return row.sampledAt;
	}
}

function tieProcess(a: ProcessSample, b: ProcessSample): number {
	if (a.host !== b.host) return a.host < b.host ? -1 : 1;
	if (a.processName !== b.processName) return a.processName < b.processName ? -1 : 1;
	if (a.pid !== b.pid) return a.pid < b.pid ? -1 : 1;
	return 0;
}

function orderedBy<T>(
	rows: T[],
	dir: SortDir,
	value: (row: T) => string | number | null,
	tie: (a: T, b: T) => number
): T[] {
	return [...rows].sort((a, b) => {
		const primary = compareValues(value(a), value(b), dir);
		return primary === 0 ? tie(a, b) : primary;
	});
}

function patternHit(service: RawService, row: RawProcess): boolean {
	if (row.processName === service.name) return true;
	if (service.processMatch == null) return false;
	if (row.processName === service.processMatch) return true;
	if (row.cmdline == null) return false;
	try {
		return new RegExp(service.processMatch).test(row.cmdline);
	} catch {
		return false;
	}
}

function linkOf(row: RawProcess, services: RawService[]): { name: string | null; rank: number } {
	const onHost = services.filter((service) => service.host === row.host);
	const byFilter = onHost.find((service) => row.filter != null && row.filter === service.name);
	if (byFilter) return { name: byFilter.name, rank: 3 };
	const byUnit = onHost.find(
		(service) =>
			service.systemdUnit != null && row.systemdUnit != null && row.systemdUnit === service.systemdUnit
	);
	if (byUnit) return { name: byUnit.name, rank: 2 };
	const byName = onHost.find((service) => patternHit(service, row));
	if (byName) return { name: byName.name, rank: 1 };
	return { name: null, rank: 0 };
}

function toSample(row: RawProcess, serviceName: string | null): ProcessSample | null {
	const sampledMs = instant(row.sampledAt);
	if (sampledMs == null) return null;
	const threads = finite(row.threads);
	return {
		host: row.host,
		processName: row.processName,
		pid: row.pid,
		user: row.user,
		threads: threads == null || threads < 0 ? null : Math.round(threads),
		cpuPercent: finite(row.cpuPercent),
		memoryRssBytes: finite(row.memoryRssBytes),
		memoryPercent: finite(row.memoryPercent),
		uptimeSeconds: uptimeSeconds(row.createdAt, row.sampledAt),
		sampledAt: new Date(sampledMs).toISOString(),
		cmdline: shortCmdline(row.cmdline),
		serviceName
	};
}

/** One row per host and pid. The service filter beats the top-N scan of the same pid. */
function dedupe(rows: RawProcess[], services: RawService[]): ProcessSample[] {
	const byKey = new Map<string, Linked>();
	for (const row of rows) {
		const link = linkOf(row, services);
		const sample = toSample(row, link.name);
		if (!sample) continue;
		const next: Linked = { sample, rank: link.rank };
		const key = `${row.host}\0${row.pid}`;
		const current = byKey.get(key);
		const newer = next.sample.sampledAt > (current?.sample.sampledAt ?? '');
		if (!current || next.rank > current.rank || (next.rank === current.rank && newer)) {
			byKey.set(key, next);
		}
	}
	return [...byKey.values()].map((row) => row.sample);
}

function newestPerPid(rows: RawProcess[]): RawProcess[] {
	const byPid = new Map<string, RawProcess>();
	for (const row of rows) {
		const current = byPid.get(row.pid);
		if (!current || row.sampledAt > current.sampledAt) byPid.set(row.pid, row);
	}
	return [...byPid.values()];
}

/**
 * Sum the service's own procstat filter. That skips the top-N copy of the same
 * pid. If the service missed the top-N and has no own filter row, use the scan.
 */
function rowsForService(service: RawService, processes: RawProcess[], names: Set<string>): RawProcess[] {
	const onHost = processes.filter((row) => row.host === service.host);
	const dedicated = newestPerPid(onHost.filter((row) => row.filter === service.name));
	if (dedicated.length > 0) return dedicated;
	return newestPerPid(
		onHost.filter((row) => {
			if (row.filter != null && row.filter !== 'user' && names.has(row.filter)) return false;
			return patternHit(service, row);
		})
	);
}

function compareSamples(sort: 'cpu' | 'memory', a: ProcessSample, b: ProcessSample): number {
	const left = sort === 'cpu' ? a.cpuPercent : a.memoryRssBytes;
	const right = sort === 'cpu' ? b.cpuPercent : b.memoryRssBytes;
	if (left == null && right != null) return 1;
	if (left != null && right == null) return -1;
	if (left != null && right != null && left !== right) return right - left;
	if (a.host !== b.host) return a.host < b.host ? -1 : 1;
	if (a.processName !== b.processName) return a.processName < b.processName ? -1 : 1;
	if (a.pid !== b.pid) return a.pid < b.pid ? -1 : 1;
	return 0;
}

function capProcesses(rows: ProcessSample[], sort: 'cpu' | 'memory'): ProcessSample[] {
	const byHost = new Map<string, ProcessSample[]>();
	for (const row of rows) {
		const list = byHost.get(row.host);
		if (list) list.push(row);
		else byHost.set(row.host, [row]);
	}
	const kept: ProcessSample[] = [];
	for (const list of byHost.values()) {
		const ordered = [...list].sort((a, b) => compareSamples(sort, a, b));
		kept.push(...ordered.slice(0, PROCESS_CAP));
		kept.push(...ordered.slice(PROCESS_CAP).filter((row) => row.serviceName != null));
	}
	kept.sort((a, b) => compareSamples(sort, a, b));
	return kept;
}

function uniqueSorted(values: string[]): string[] {
	return [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function buildServicesView(input: ServicesViewInput): ServicesPayload {
	const catalog = [...input.services].sort(byHostThenName);
	const names = new Set(catalog.map((service) => service.name));
	const selected = input.query.host;
	const hosts = uniqueSorted(
		[
			...input.knownHosts,
			...catalog.map((service) => service.host),
			...input.processes.map((row) => row.host),
			...(selected ? [selected] : [])
		].filter((name) => isHostName(name))
	);

	const services = catalog
		.filter((service) => selected == null || service.host === selected)
		.filter((service) => input.query.q == null || service.matchesSearch === true)
		.map((service): ServiceHealth => {
			const unit = input.units.find(
				(row) => row.host === service.host && service.systemdUnit != null && row.name === service.systemdUnit
			);
			const http = input.http.find(
				(row) => row.host === service.host && service.healthUrl != null && row.server === service.healthUrl
			);
			const linked = rowsForService(service, input.processes, names);
			// User scope has no readable unit state. Health is HTTP plus a live process.
			const unitDeclared = service.systemdScope === 'system' && service.systemdUnit != null;
			const processDeclared = service.systemdScope === 'user';
			const unitCheck = unitState(unitDeclared, unit?.active ?? null, unit?.sampledAt, input.generatedAt);
			const httpCheck = httpState(
				service.healthUrl != null,
				http?.result ?? null,
				http?.statusCode ?? null,
				http?.sampledAt,
				input.generatedAt
			);
			const presence = processState(processDeclared, input.processesAvailable, linked, input.generatedAt);
			return {
				name: service.name,
				project: service.project,
				host: service.host,
				port: service.port,
				healthUrl: service.healthUrl,
				systemdUnit: service.systemdUnit,
				systemdScope: service.systemdScope,
				status: overallStatus([unitCheck, httpCheck, presence]),
				unit: unitCheck,
				http: httpCheck,
				unitActive: unit?.active ?? null,
				unitSub: unit?.sub ?? null,
				httpCode: http?.statusCode ?? null,
				httpResult: http?.result ?? null,
				lastCheck: latestIso([
					unitDeclared ? unit?.sampledAt : null,
					http?.sampledAt,
					processDeclared ? latestIso(linked.map((row) => row.sampledAt)) : null
				]),
				latencyMs: service.healthUrl == null ? null : latencyMs(http?.responseTimeSeconds),
				cpuPercent: sumFinite(linked.map((row) => finite(row.cpuPercent))),
				memoryRssBytes: sumFinite(linked.map((row) => finite(row.memoryRssBytes))),
				memoryPercent: sumFinite(linked.map((row) => finite(row.memoryPercent)))
			};
		});

	// Column sort is applied here: status, CPU, and memory are computed, not registry columns.
	const orderedServices = orderedBy(
		services,
		input.query.dir,
		(row) => serviceValue(row, input.query.order),
		byHostThenName
	);
	const selectedProcesses = input.processes.filter((row) => selected == null || row.host === selected);
	const sampledAt = latestIso(selectedProcesses.map((row) => row.sampledAt));

	return {
		generatedAt: input.generatedAt,
		host: selected,
		sort: input.query.sort,
		service: input.query.service,
		q: input.query.q,
		order: input.query.order,
		dir: input.query.dir,
		page: input.query.page,
		pageSize: input.query.pageSize,
		servicesTotal: orderedServices.length,
		hosts,
		servicesAvailable: input.servicesAvailable,
		processesAvailable: input.processesAvailable,
		sampledAt,
		services: slicePage(orderedServices, input.query.page, input.query.pageSize),
		processes: capProcesses(dedupe(selectedProcesses, catalog), input.query.sort)
	};
}

/** One page of deduped process rows. Search filtering happens in SQL before this runs. */
export function buildProcessesView(input: ProcessesViewInput): ProcessesPayload {
	const catalog = [...input.services].sort(byHostThenName);
	const selected = input.query.host;
	const hosts = uniqueSorted(
		[
			...input.knownHosts,
			...catalog.map((service) => service.host),
			...input.processes.map((row) => row.host),
			...(selected ? [selected] : [])
		].filter((name) => isHostName(name))
	);
	const deduped = dedupe(
		input.processes.filter((row) => selected == null || row.host === selected),
		catalog
	);
	const matched =
		input.query.service == null
			? deduped
			: deduped.filter((row) => row.serviceName === input.query.service);
	const ordered = orderedBy(
		matched,
		input.query.dir,
		(row) => processValue(row, input.query.sort),
		tieProcess
	);

	return {
		generatedAt: input.generatedAt,
		host: selected,
		service: input.query.service,
		q: input.query.q,
		sort: input.query.sort,
		dir: input.query.dir,
		page: input.query.page,
		pageSize: input.query.pageSize,
		total: ordered.length,
		hosts,
		processesAvailable: input.processesAvailable,
		sampledAt: latestIso(matched.map((row) => row.sampledAt)),
		processes: slicePage(ordered, input.query.page, input.query.pageSize)
	};
}
