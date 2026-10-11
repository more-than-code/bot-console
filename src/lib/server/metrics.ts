import { WHOLE_DISK_PATTERN } from '$lib/disk';
import { isHostName } from '$lib/host';
import { RATE_LOOKBACK, RECENT_HOST_WINDOW, STALE_AFTER_MS } from '$lib/limits';
import { isMissingMetricShape } from '$lib/pg-error';
import { RANGES, type RangeKey } from '$lib/ranges';
import { mergeSeries, type DiskioPoint, type GaugePoint, type NetPoint } from '$lib/series';
import { assembleSnapshots, type FieldSample, type RegistryInfo } from '$lib/snapshot';
import type { HostDetail, Overview } from '$lib/types';
import { logQueryFailure } from './errors';
import { getSql } from './db';

const METRIC_TABLES = ['cpu', 'mem', 'disk', 'temp', 'system', 'net', 'diskio'] as const;
type MetricTable = (typeof METRIC_TABLES)[number];

type GaugeKind = 'cpu' | 'memory' | 'disk' | 'temp' | 'load1';
type GaugeField = 'cpuPercent' | 'memoryPercent' | 'diskPercent' | 'tempC';

type RegistrySqlRow = {
	name: string;
	lan_ip: string | null;
	tailscale_ip: string | null;
	role: string | null;
	runs: string | null;
};

type TimedValue = {
	host: string;
	time: Date | string | null;
	value: number | string | null;
};

type LoadRow = {
	host: string;
	time: Date | string | null;
	load1: number | string | null;
	load5: number | string | null;
	load15: number | string | null;
};

type UptimeRow = {
	host: string;
	time: Date | string | null;
	uptime_seconds: number | string | null;
};

type MemoryBytesRow = {
	host: string;
	time: Date | string | null;
	used: number | string | null;
	total: number | string | null;
	available: number | string | null;
};

type DiskBytesRow = {
	host: string;
	time: Date | string | null;
	used: number | string | null;
	total: number | string | null;
	free: number | string | null;
};

/** Tables or columns that are not in this database stay empty until restart. */
const absent = new Set<string>();
let registryMode: 'full' | 'names' | 'off' = 'full';

function num(value: number | string | null | undefined): number | null {
	if (value == null) return null;
	const parsed = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function iso(value: Date | string | null | undefined): string | null {
	if (value == null) return null;
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function optional<T>(key: string, fn: () => Promise<T>, empty: T): Promise<T> {
	if (absent.has(key)) return empty;
	try {
		return await fn();
	} catch (err) {
		if (!isMissingMetricShape(err)) throw err;
		absent.add(key);
		logQueryFailure(err);
		return empty;
	}
}

async function loadGeneratedAt(): Promise<string> {
	const sql = getSql();
	const rows = await sql<{ generated_at: Date | string }[]>`SELECT now() AS generated_at`;
	return iso(rows[0]?.generated_at) ?? new Date().toISOString();
}

function registryInfo(rows: RegistrySqlRow[]): RegistryInfo[] {
	return rows.flatMap((row) => {
		if (typeof row.name !== 'string') return [];
		return [
			{
				name: row.name,
				lanIp: row.lan_ip,
				tailscaleIp: row.tailscale_ip,
				role: row.role,
				runs: row.runs
			}
		];
	});
}

async function queryRegistryFull(name: string | null): Promise<RegistryInfo[]> {
	const sql = getSql();
	const rows = await sql<RegistrySqlRow[]>`
		SELECT
			name,
			host(lan_ip) AS lan_ip,
			host(tailscale_ip) AS tailscale_ip,
			role,
			hosts AS runs
		FROM metrics.hosts
		WHERE ${name}::text IS NULL OR name = ${name}
		ORDER BY name
	`;
	return registryInfo(rows);
}

async function queryRegistryNames(name: string | null): Promise<RegistryInfo[]> {
	const sql = getSql();
	const rows = await sql<{ name: string }[]>`
		SELECT name
		FROM metrics.hosts
		WHERE ${name}::text IS NULL OR name = ${name}
		ORDER BY name
	`;
	return rows.flatMap((row) => {
		if (typeof row.name !== 'string') return [];
		return [{ name: row.name, lanIp: null, tailscaleIp: null, role: null, runs: null }];
	});
}

async function loadRegistry(name: string | null): Promise<RegistryInfo[]> {
	if (registryMode === 'off') return [];
	if (registryMode === 'names') return queryRegistryNames(name);
	try {
		return await queryRegistryFull(name);
	} catch (err) {
		if (!isMissingMetricShape(err)) throw err;
		logQueryFailure(err);
		registryMode = 'names';
		try {
			return await queryRegistryNames(name);
		} catch (err2) {
			if (!isMissingMetricShape(err2)) throw err2;
			logQueryFailure(err2);
			registryMode = 'off';
			return [];
		}
	}
}

async function discoverHosts(table: MetricTable, name: string | null): Promise<string[]> {
	const sql = getSql();
	const rows = await sql<{ host: string | null }[]>`
		SELECT DISTINCT host
		FROM metrics.${sql(table)}
		WHERE host IS NOT NULL
			AND time >= (now() AT TIME ZONE 'UTC') - ${RECENT_HOST_WINDOW}::interval
			AND (${name}::text IS NULL OR host = ${name})
	`;
	return rows.flatMap((row) => (typeof row.host === 'string' ? [row.host] : []));
}

function gaugeParts(kind: GaugeKind, sql: ReturnType<typeof getSql>) {
	switch (kind) {
		case 'cpu':
			return {
				table: 'cpu',
				value: sql`(100 - usage_idle)::float8`,
				where: sql`cpu = 'cpu-total' AND usage_idle IS NOT NULL`
			};
		case 'memory':
			return {
				table: 'mem',
				value: sql`used_percent::float8`,
				where: sql`used_percent IS NOT NULL`
			};
		case 'disk':
			return {
				table: 'disk',
				value: sql`used_percent::float8`,
				where: sql`path = '/' AND used_percent IS NOT NULL`
			};
		case 'temp':
			return {
				table: 'temp',
				value: sql`temp::float8`,
				where: sql`sensor = 'cpu_thermal' AND temp IS NOT NULL`
			};
		case 'load1':
			return {
				table: 'system',
				value: sql`load1::float8`,
				where: sql`load1 IS NOT NULL`
			};
	}
}

async function loadLatestGauge(kind: Exclude<GaugeKind, 'load1'>, name: string | null): Promise<TimedValue[]> {
	const sql = getSql();
	const parts = gaugeParts(kind, sql);
	const order = kind === 'disk' ? sql`host, time DESC, device` : sql`host, time DESC`;
	return sql<TimedValue[]>`
		SELECT DISTINCT ON (host)
			host,
			(time AT TIME ZONE 'UTC') AS time,
			${parts.value} AS value
		FROM metrics.${sql(parts.table)}
		WHERE ${parts.where}
			AND time >= (now() AT TIME ZONE 'UTC') - ${RECENT_HOST_WINDOW}::interval
			AND (${name}::text IS NULL OR host = ${name})
		ORDER BY ${order}
	`;
}

async function loadLatestLoad(name: string | null): Promise<LoadRow[]> {
	const sql = getSql();
	return sql<LoadRow[]>`
		SELECT DISTINCT ON (host)
			host,
			(time AT TIME ZONE 'UTC') AS time,
			load1::float8 AS load1,
			load5::float8 AS load5,
			load15::float8 AS load15
		FROM metrics.system
		WHERE load1 IS NOT NULL
			AND time >= (now() AT TIME ZONE 'UTC') - ${RECENT_HOST_WINDOW}::interval
			AND (${name}::text IS NULL OR host = ${name})
		ORDER BY host, time DESC
	`;
}

async function loadLatestUptime(name: string | null): Promise<UptimeRow[]> {
	const sql = getSql();
	return sql<UptimeRow[]>`
		SELECT DISTINCT ON (host)
			host,
			(time AT TIME ZONE 'UTC') AS time,
			uptime::float8 AS uptime_seconds
		FROM metrics.system
		WHERE uptime IS NOT NULL
			AND time >= (now() AT TIME ZONE 'UTC') - ${RECENT_HOST_WINDOW}::interval
			AND (${name}::text IS NULL OR host = ${name})
		ORDER BY host, time DESC
	`;
}

// Own queries so a missing byte column blanks capacity only, not used_percent.
async function loadLatestMemoryBytes(name: string | null): Promise<MemoryBytesRow[]> {
	const sql = getSql();
	return sql<MemoryBytesRow[]>`
		SELECT DISTINCT ON (host)
			host,
			(time AT TIME ZONE 'UTC') AS time,
			used::float8 AS used,
			total::float8 AS total,
			available::float8 AS available
		FROM metrics.mem
		WHERE used_percent IS NOT NULL
			AND time >= (now() AT TIME ZONE 'UTC') - ${RECENT_HOST_WINDOW}::interval
			AND (${name}::text IS NULL OR host = ${name})
		ORDER BY host, time DESC
	`;
}

async function loadLatestDiskBytes(name: string | null): Promise<DiskBytesRow[]> {
	const sql = getSql();
	return sql<DiskBytesRow[]>`
		SELECT DISTINCT ON (host)
			host,
			(time AT TIME ZONE 'UTC') AS time,
			used::float8 AS used,
			total::float8 AS total,
			free::float8 AS free
		FROM metrics.disk
		WHERE path = '/' AND used_percent IS NOT NULL
			AND time >= (now() AT TIME ZONE 'UTC') - ${RECENT_HOST_WINDOW}::interval
			AND (${name}::text IS NULL OR host = ${name})
		ORDER BY host, time DESC, device
	`;
}

function gaugeSamples(rows: TimedValue[], field: GaugeField): FieldSample[] {
	return rows.flatMap((row) => {
		if (!row.host) return [];
		const sample: FieldSample = { host: row.host, time: iso(row.time) };
		sample[field] = num(row.value);
		return [sample];
	});
}

function loadSamples(rows: LoadRow[]): FieldSample[] {
	return rows.flatMap((row) => {
		if (!row.host) return [];
		return [
			{
				host: row.host,
				time: iso(row.time),
				load1: num(row.load1),
				load5: num(row.load5),
				load15: num(row.load15)
			}
		];
	});
}

function uptimeSamples(rows: UptimeRow[]): FieldSample[] {
	return rows.flatMap((row) => {
		if (!row.host) return [];
		return [{ host: row.host, time: iso(row.time), uptimeSeconds: num(row.uptime_seconds) }];
	});
}

function memoryByteSamples(rows: MemoryBytesRow[]): FieldSample[] {
	return rows.flatMap((row) => {
		if (!row.host) return [];
		return [
			{
				host: row.host,
				time: iso(row.time),
				memoryUsedBytes: num(row.used),
				memoryTotalBytes: num(row.total),
				memoryAvailableBytes: num(row.available)
			}
		];
	});
}

function diskByteSamples(rows: DiskBytesRow[]): FieldSample[] {
	return rows.flatMap((row) => {
		if (!row.host) return [];
		return [
			{
				host: row.host,
				time: iso(row.time),
				diskUsedBytes: num(row.used),
				diskTotalBytes: num(row.total),
				diskFreeBytes: num(row.free)
			}
		];
	});
}

/**
 * Hosts are the registry plus any host tag in recent metric rows.
 * Each metric is its own query so a missing table or column blanks that
 * metric only. A registry row with no timestamps stays in the list as stale.
 */
export async function listHosts(name: string | null): Promise<Overview> {
	if (name !== null && !isHostName(name)) {
		return { generatedAt: new Date().toISOString(), hosts: [] };
	}
	const [
		generatedAt,
		registry,
		discoveredGroups,
		cpu,
		memory,
		disk,
		temp,
		load,
		uptime,
		memoryBytes,
		diskBytes
	] = await Promise.all([
		loadGeneratedAt(),
		loadRegistry(name),
		Promise.all(
			METRIC_TABLES.map((table) => optional(`discover.${table}`, () => discoverHosts(table, name), []))
		),
		optional('latest.cpu', () => loadLatestGauge('cpu', name), []),
		optional('latest.memory', () => loadLatestGauge('memory', name), []),
		optional('latest.disk', () => loadLatestGauge('disk', name), []),
		optional('latest.temp', () => loadLatestGauge('temp', name), []),
		optional('latest.load', () => loadLatestLoad(name), []),
		optional('latest.uptime', () => loadLatestUptime(name), []),
		optional('latest.memory.bytes', () => loadLatestMemoryBytes(name), []),
		optional('latest.disk.bytes', () => loadLatestDiskBytes(name), [])
	]);
	const samples = [
		...gaugeSamples(cpu, 'cpuPercent'),
		...gaugeSamples(memory, 'memoryPercent'),
		...gaugeSamples(disk, 'diskPercent'),
		...gaugeSamples(temp, 'tempC'),
		...loadSamples(load),
		...uptimeSamples(uptime),
		...memoryByteSamples(memoryBytes),
		...diskByteSamples(diskBytes)
	];
	return {
		generatedAt,
		hosts: assembleSnapshots({
			registry,
			discovered: discoveredGroups.flat(),
			samples,
			generatedAt,
			staleMs: STALE_AFTER_MS
		})
	};
}

export function getOverview(): Promise<Overview> {
	return listHosts(null);
}

async function loadGauge(host: string, range: RangeKey, kind: GaugeKind): Promise<GaugePoint[]> {
	const sql = getSql();
	const { window, bucket } = RANGES[range];
	const parts = gaugeParts(kind, sql);
	const rows = await sql<{ bucket: Date | string; value: number | string | null }[]>`
		SELECT
			(time_bucket(${bucket}::interval, time) AT TIME ZONE 'UTC') AS bucket,
			avg(${parts.value})::float8 AS value
		FROM metrics.${sql(parts.table)}
		WHERE host = ${host}
			AND ${parts.where}
			AND time >= (now() AT TIME ZONE 'UTC') - ${window}::interval
		GROUP BY 1
		ORDER BY 1
	`;
	return rows.flatMap((row) => {
		const t = iso(row.bucket);
		if (!t) return [];
		return [{ t, value: num(row.value) }];
	});
}

async function loadNet(host: string, range: RangeKey): Promise<NetPoint[]> {
	const sql = getSql();
	const { window, bucket } = RANGES[range];
	// Per-interface counter deltas. A negative delta is a reset and is dropped.
	// Rates are averaged inside the bucket, then summed across interfaces except lo.
	const rows = await sql<{ bucket: Date | string; rx: number | string | null; tx: number | string | null }[]>`
		WITH deltas AS (
			SELECT
				time,
				interface,
				CASE WHEN dt > 0 AND rx >= prev_rx THEN (rx - prev_rx) / dt END AS rx_bps,
				CASE WHEN dt > 0 AND tx >= prev_tx THEN (tx - prev_tx) / dt END AS tx_bps
			FROM (
				SELECT
					time,
					interface,
					bytes_recv::float8 AS rx,
					bytes_sent::float8 AS tx,
					lag(bytes_recv::float8) OVER w AS prev_rx,
					lag(bytes_sent::float8) OVER w AS prev_tx,
					EXTRACT(EPOCH FROM (time - lag(time) OVER w)) AS dt
				FROM metrics.net
				WHERE host = ${host}
					AND interface <> 'lo'
					AND time >= (now() AT TIME ZONE 'UTC') - ${window}::interval - ${RATE_LOOKBACK}::interval
				WINDOW w AS (PARTITION BY interface ORDER BY time)
			) samples
		),
		per_iface AS (
			SELECT
				time_bucket(${bucket}::interval, time) AS bucket,
				interface,
				avg(rx_bps) AS rx_bps,
				avg(tx_bps) AS tx_bps
			FROM deltas
			WHERE time >= (now() AT TIME ZONE 'UTC') - ${window}::interval
			GROUP BY 1, 2
		)
		SELECT
			(bucket AT TIME ZONE 'UTC') AS bucket,
			sum(rx_bps)::float8 AS rx,
			sum(tx_bps)::float8 AS tx
		FROM per_iface
		GROUP BY bucket
		ORDER BY bucket
	`;
	return rows.flatMap((row) => {
		const t = iso(row.bucket);
		if (!t) return [];
		return [{ t, rx: num(row.rx), tx: num(row.tx) }];
	});
}

async function loadDiskio(host: string, range: RangeKey): Promise<DiskioPoint[]> {
	const sql = getSql();
	const { window, bucket } = RANGES[range];
	const rows = await sql<{ bucket: Date | string; read: number | string | null; write: number | string | null }[]>`
		WITH deltas AS (
			SELECT
				time,
				name,
				CASE WHEN dt > 0 AND read_b >= prev_read THEN (read_b - prev_read) / dt END AS read_bps,
				CASE WHEN dt > 0 AND write_b >= prev_write THEN (write_b - prev_write) / dt END AS write_bps
			FROM (
				SELECT
					time,
					name,
					read_bytes::float8 AS read_b,
					write_bytes::float8 AS write_b,
					lag(read_bytes::float8) OVER w AS prev_read,
					lag(write_bytes::float8) OVER w AS prev_write,
					EXTRACT(EPOCH FROM (time - lag(time) OVER w)) AS dt
				FROM metrics.diskio
				WHERE host = ${host}
					AND name ~ ${WHOLE_DISK_PATTERN}
					AND time >= (now() AT TIME ZONE 'UTC') - ${window}::interval - ${RATE_LOOKBACK}::interval
				WINDOW w AS (PARTITION BY name ORDER BY time)
			) samples
		),
		per_disk AS (
			SELECT
				time_bucket(${bucket}::interval, time) AS bucket,
				name,
				avg(read_bps) AS read_bps,
				avg(write_bps) AS write_bps
			FROM deltas
			WHERE time >= (now() AT TIME ZONE 'UTC') - ${window}::interval
			GROUP BY 1, 2
		)
		SELECT
			(bucket AT TIME ZONE 'UTC') AS bucket,
			sum(read_bps)::float8 AS read,
			sum(write_bps)::float8 AS write
		FROM per_disk
		GROUP BY bucket
		ORDER BY bucket
	`;
	return rows.flatMap((row) => {
		const t = iso(row.bucket);
		if (!t) return [];
		return [{ t, read: num(row.read), write: num(row.write) }];
	});
}

async function loadPoints(host: string, range: RangeKey) {
	const [cpu, memory, disk, temp, load1, net, diskio] = await Promise.all([
		optional('series.cpu', () => loadGauge(host, range, 'cpu'), []),
		optional('series.memory', () => loadGauge(host, range, 'memory'), []),
		optional('series.disk', () => loadGauge(host, range, 'disk'), []),
		optional('series.temp', () => loadGauge(host, range, 'temp'), []),
		optional('series.load1', () => loadGauge(host, range, 'load1'), []),
		optional('series.net', () => loadNet(host, range), []),
		optional('series.diskio', () => loadDiskio(host, range), [])
	]);
	return mergeSeries({ cpu, memory, disk, temp, load1, net, diskio });
}

export async function getHostSeries(name: string, range: RangeKey): Promise<HostDetail | null> {
	if (!isHostName(name)) return null;
	const overview = await listHosts(name);
	const host = overview.hosts[0];
	if (!host) return null;
	const points = await loadPoints(name, range);
	return { generatedAt: overview.generatedAt, range, host, points };
}
