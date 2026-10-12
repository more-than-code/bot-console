import { PROCESS_SAMPLE_WINDOW, SERVICE_LOOKBACK } from '$lib/limits';
import {
	isMissingMetricShape,
	missingRelationRemembered,
	pgErrorCode,
	rememberMissingRelation
} from '$lib/pg-error';
import type { ProcessesQuery } from '$lib/process-query';
import {
	buildProcessesView,
	buildServicesView,
	type RawHttp,
	type RawProcess,
	type RawService,
	type RawUnit
} from '$lib/service-view';
import type { ServicesQuery } from '$lib/services-query';
import { likePattern } from '$lib/table-query';
import type { ProcessesPayload, ServicesPayload } from '$lib/types';
import { getSql } from './db';
import { logQueryFailure } from './errors';

/** Missing relations (42P01) stay empty until MISSING_RELATION_TTL_MS. 42703 is not cached. */
const absentUntil = new Map<string, number>();

function remembered(key: string): boolean {
	return missingRelationRemembered(absentUntil, key, Date.now());
}

function rememberTable(key: string): void {
	rememberMissingRelation(absentUntil, key, '42P01', Date.now());
}

type RelationName =
	| 'metrics.hosts'
	| 'metrics.services'
	| 'metrics.procstat'
	| 'metrics.systemd_units'
	| 'metrics.http_response';

type ServiceRow = {
	name: string | null;
	project: string | null;
	host: string | null;
	port: number | string | null;
	health_url: string | null;
	systemd_unit: string | null;
	systemd_scope: string | null;
	process_match: string | null;
	matches_search: boolean | null;
};

type ProcessRow = {
	host: string | null;
	process_name: string | null;
	pid: string | null;
	username: string | null;
	filter: string | null;
	cmdline: string | null;
	systemd_unit: string | null;
	cpu_usage: number | string | null;
	memory_rss: number | string | null;
	memory_usage: number | string | null;
	num_threads: number | string | null;
	created_at: string | null;
	time: Date | string | null;
};

type UnitRow = {
	host: string | null;
	name: string | null;
	active: string | null;
	sub: string | null;
	time: Date | string | null;
};

type HttpRow = {
	host: string | null;
	server: string | null;
	result: string | null;
	status_code: number | string | null;
	response_time: number | string | null;
	time: Date | string | null;
};

function num(value: number | string | null | undefined): number | null {
	if (value == null || value === '') return null;
	const parsed = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function iso(value: Date | string | null | undefined): string | null {
	if (value == null) return null;
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function text(value: string | null | undefined): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed === '' ? null : trimmed;
}

function portOf(value: number | string | null): number | null {
	const parsed = num(value);
	if (parsed == null || !Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return null;
	return parsed;
}

function scopeOf(value: string | null): 'system' | 'user' | null {
	return value === 'system' || value === 'user' ? value : null;
}

/**
 * to_regclass returns null when the table is not there. Remember that for a
 * short time so a poll does not ask on every tick, and so the page picks the
 * table up after the SQL without a restart.
 */
async function relationExists(qualified: RelationName): Promise<boolean> {
	const key = `rel:${qualified}`;
	if (remembered(key)) return false;
	const sql = getSql();
	const rows = await sql<{ name: string | null }[]>`
		SELECT to_regclass(${qualified})::text AS name
	`;
	if (rows[0]?.name == null) {
		rememberTable(key);
		return false;
	}
	return true;
}

async function optional<T>(key: string, fn: () => Promise<T>, empty: T): Promise<T> {
	if (remembered(key)) return empty;
	try {
		return await fn();
	} catch (err) {
		if (!isMissingMetricShape(err)) throw err;
		const code = pgErrorCode(err);
		if (code === '42P01') rememberTable(key);
		logQueryFailure(err);
		return empty;
	}
}

async function loadGeneratedAt(): Promise<string> {
	const sql = getSql();
	const rows = await sql<{ generated_at: Date | string }[]>`SELECT now() AS generated_at`;
	return iso(rows[0]?.generated_at) ?? new Date().toISOString();
}

async function loadHostNames(): Promise<string[]> {
	if (!(await relationExists('metrics.hosts'))) return [];
	return optional('services.hosts', async () => {
		const sql = getSql();
		const rows = await sql<{ name: string | null }[]>`
			SELECT name FROM metrics.hosts ORDER BY name
		`;
		return rows.flatMap((row) => (typeof row.name === 'string' ? [row.name] : []));
	}, []);
}

async function loadServices(pattern: string | null): Promise<{ available: boolean; rows: RawService[] }> {
	if (!(await relationExists('metrics.services'))) return { available: false, rows: [] };
	if (remembered('services.registry')) return { available: false, rows: [] };
	try {
		const sql = getSql();
		// ESCAPE '\' so a search for "%" or "_" stays literal. pattern is a bound parameter.
		const rows = await sql<ServiceRow[]>`
			SELECT name, project, host, port, health_url, systemd_unit, systemd_scope, process_match,
				(
					${pattern}::text IS NULL
					OR COALESCE(name, '') ILIKE ${pattern} ESCAPE '\\'
					OR COALESCE(project, '') ILIKE ${pattern} ESCAPE '\\'
					OR COALESCE(host, '') ILIKE ${pattern} ESCAPE '\\'
					OR COALESCE(systemd_unit, '') ILIKE ${pattern} ESCAPE '\\'
					OR COALESCE(health_url, '') ILIKE ${pattern} ESCAPE '\\'
				) AS matches_search
			FROM metrics.services
			ORDER BY host, name
		`;
		return {
			available: true,
			rows: rows.flatMap((row) => {
				const name = text(row.name);
				const host = text(row.host);
				if (!name || !host) return [];
				const service: RawService = {
					name,
					project: text(row.project) ?? '',
					host,
					port: portOf(row.port),
					healthUrl: text(row.health_url),
					systemdUnit: text(row.systemd_unit),
					systemdScope: scopeOf(text(row.systemd_scope)),
					processMatch: text(row.process_match),
					matchesSearch: row.matches_search === true
				};
				return [service];
			})
		};
	} catch (err) {
		if (!isMissingMetricShape(err)) throw err;
		if (pgErrorCode(err) === '42P01') rememberTable('services.registry');
		logQueryFailure(err);
		return { available: false, rows: [] };
	}
}

async function loadProcesses(
	host: string | null,
	pattern: string | null
): Promise<{ available: boolean; rows: RawProcess[] }> {
	if (!(await relationExists('metrics.procstat'))) return { available: false, rows: [] };
	if (remembered('services.procstat')) return { available: false, rows: [] };
	try {
		const sql = getSql();
		const rows = await sql<ProcessRow[]>`
			WITH latest AS (
				SELECT host, max(time) AS latest
				FROM metrics.procstat
				WHERE time >= (now() AT TIME ZONE 'UTC') - ${SERVICE_LOOKBACK}::interval
					AND (${host}::text IS NULL OR host = ${host})
				GROUP BY host
			)
			SELECT DISTINCT ON (p.host, p.pid, p.filter)
				p.host,
				p.process_name,
				p.pid,
				p."user" AS username,
				p.filter,
				p.cmdline,
				p.systemd_unit,
				p.cpu_usage::float8 AS cpu_usage,
				p.memory_rss::float8 AS memory_rss,
				p.memory_usage::float8 AS memory_usage,
				p.num_threads::float8 AS num_threads,
				p.created_at::text AS created_at,
				(p.time AT TIME ZONE 'UTC') AS time
			FROM metrics.procstat p
			JOIN latest l ON p.host = l.host
			WHERE p.time >= l.latest - ${PROCESS_SAMPLE_WINDOW}::interval
				AND p.time <= l.latest
				AND p.pid IS NOT NULL
				AND (
					${pattern}::text IS NULL
					OR COALESCE(p.process_name, '') ILIKE ${pattern} ESCAPE '\\'
					OR COALESCE(p.cmdline, '') ILIKE ${pattern} ESCAPE '\\'
					OR COALESCE(p."user", '') ILIKE ${pattern} ESCAPE '\\'
					OR COALESCE(p.host, '') ILIKE ${pattern} ESCAPE '\\'
					OR COALESCE(p.pid::text, '') ILIKE ${pattern} ESCAPE '\\'
				)
			ORDER BY p.host, p.pid, p.filter, p.time DESC
		`;
		return {
			available: true,
			rows: rows.flatMap((row) => {
				const rowHost = text(row.host);
				const pid = text(row.pid);
				const processName = text(row.process_name);
				const sampledAt = iso(row.time);
				if (!rowHost || !pid || !processName || !sampledAt) return [];
				const sample: RawProcess = {
					host: rowHost,
					processName,
					pid,
					user: text(row.username),
					filter: text(row.filter),
					cmdline: text(row.cmdline),
					systemdUnit: text(row.systemd_unit),
					cpuPercent: num(row.cpu_usage),
					memoryRssBytes: num(row.memory_rss),
					memoryPercent: num(row.memory_usage),
					threads: num(row.num_threads),
					createdAt: text(row.created_at),
					sampledAt
				};
				return [sample];
			})
		};
	} catch (err) {
		if (!isMissingMetricShape(err)) throw err;
		if (pgErrorCode(err) === '42P01') rememberTable('services.procstat');
		logQueryFailure(err);
		return { available: false, rows: [] };
	}
}

async function loadUnits(services: RawService[]): Promise<RawUnit[]> {
	const names = [...new Set(services.flatMap((service) => (service.systemdUnit ? [service.systemdUnit] : [])))];
	if (names.length === 0 || !(await relationExists('metrics.systemd_units'))) return [];
	return optional('services.systemd', async () => {
		const sql = getSql();
		const rows = await sql<UnitRow[]>`
			SELECT DISTINCT ON (host, name)
				host,
				name,
				active,
				sub,
				(time AT TIME ZONE 'UTC') AS time
			FROM metrics.systemd_units
			WHERE name IN ${sql(names)}
				AND time >= (now() AT TIME ZONE 'UTC') - ${SERVICE_LOOKBACK}::interval
			ORDER BY host, name, time DESC
		`;
		return rows.flatMap((row) => {
			const host = text(row.host);
			const name = text(row.name);
			if (!host || !name) return [];
			const unit: RawUnit = {
				host,
				name,
				active: text(row.active),
				sub: text(row.sub),
				sampledAt: iso(row.time)
			};
			return [unit];
		});
	}, []);
}

async function loadHttp(services: RawService[]): Promise<RawHttp[]> {
	const urls = [...new Set(services.flatMap((service) => (service.healthUrl ? [service.healthUrl] : [])))];
	if (urls.length === 0 || !(await relationExists('metrics.http_response'))) return [];
	return optional('services.http', async () => {
		const sql = getSql();
		const rows = await sql<HttpRow[]>`
			SELECT DISTINCT ON (host, server)
				host,
				server,
				result,
				status_code,
				response_time::float8 AS response_time,
				(time AT TIME ZONE 'UTC') AS time
			FROM metrics.http_response
			WHERE server IN ${sql(urls)}
				AND time >= (now() AT TIME ZONE 'UTC') - ${SERVICE_LOOKBACK}::interval
			ORDER BY host, server, time DESC
		`;
		return rows.flatMap((row) => {
			const host = text(row.host);
			const server = text(row.server);
			if (!host || !server) return [];
			const status = num(row.status_code);
			const sample: RawHttp = {
				host,
				server,
				result: text(row.result),
				statusCode: status != null && Number.isInteger(status) ? status : null,
				responseTimeSeconds: num(row.response_time),
				sampledAt: iso(row.time)
			};
			return [sample];
		});
	}, []);
}

export async function getServices(query: ServicesQuery): Promise<ServicesPayload> {
	const pattern = query.q == null ? null : likePattern(query.q);
	const [generatedAt, knownHosts, registry, processes] = await Promise.all([
		loadGeneratedAt(),
		loadHostNames(),
		loadServices(pattern),
		loadProcesses(query.host, null)
	]);
	const [units, http] = await Promise.all([loadUnits(registry.rows), loadHttp(registry.rows)]);
	return buildServicesView({
		generatedAt,
		query,
		knownHosts,
		servicesAvailable: registry.available,
		processesAvailable: processes.available,
		services: registry.rows,
		units,
		http,
		processes: processes.rows
	});
}

export async function getProcesses(query: ProcessesQuery): Promise<ProcessesPayload> {
	const pattern = query.q == null ? null : likePattern(query.q);
	const [generatedAt, knownHosts, registry, processes] = await Promise.all([
		loadGeneratedAt(),
		loadHostNames(),
		loadServices(null),
		loadProcesses(query.host, pattern)
	]);
	return buildProcessesView({
		generatedAt,
		query,
		knownHosts,
		processesAvailable: processes.available,
		services: registry.rows,
		processes: processes.rows
	});
}
