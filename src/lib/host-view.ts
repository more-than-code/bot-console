import type { Host, ProcessItem, ProcessSample, ServiceRow } from './api-types';
import { parseRange, type RangeKey } from './ranges';
import type { Column, SortDir } from './table';

export const METRIC_REFRESH_MS = 30_000;

export const HOST_TABS = ['overview', 'services', 'processes'] as const;
export type HostTab = (typeof HOST_TABS)[number];

export type ProcessSort = 'cpu' | 'memory';

export type MetricFormat = 'percent' | 'rate' | 'load' | 'temp';

export type MetricName = 'cpu' | 'mem' | 'disk' | 'net' | 'diskio' | 'system' | 'temp';

export type MetricSpec = {
	m: MetricName;
	title: string;
	yMin: number | null;
	yMax: number | null;
	format: MetricFormat;
	series: ReadonlyArray<{ name: string; label: string; color: string }>;
};

/** Series names are the api-v1 set. Colors are the existing chart tokens. */
export const METRIC_SPECS: readonly MetricSpec[] = [
	{
		m: 'cpu',
		title: 'CPU',
		yMin: 0,
		yMax: 100,
		format: 'percent',
		series: [{ name: 'usage_percent', label: 'CPU', color: 'var(--chart-1)' }]
	},
	{
		m: 'mem',
		title: 'Memory',
		yMin: 0,
		yMax: 100,
		format: 'percent',
		series: [{ name: 'used_percent', label: 'Memory', color: 'var(--chart-2)' }]
	},
	{
		m: 'disk',
		title: 'Disk',
		yMin: 0,
		yMax: 100,
		format: 'percent',
		series: [{ name: 'used_percent', label: 'Used', color: 'var(--chart-3)' }]
	},
	{
		m: 'net',
		title: 'Network',
		yMin: 0,
		yMax: null,
		format: 'rate',
		series: [
			{ name: 'rx_bps', label: 'Receive', color: 'var(--chart-6)' },
			{ name: 'tx_bps', label: 'Transmit', color: 'var(--chart-7)' }
		]
	},
	{
		m: 'diskio',
		title: 'Disk IO',
		yMin: 0,
		yMax: null,
		format: 'rate',
		series: [
			{ name: 'read_bps', label: 'Read', color: 'var(--chart-6)' },
			{ name: 'write_bps', label: 'Write', color: 'var(--chart-7)' }
		]
	},
	{
		m: 'system',
		title: 'Load',
		yMin: 0,
		yMax: null,
		format: 'load',
		series: [
			{ name: 'load1', label: 'load1', color: 'var(--chart-5)' },
			{ name: 'load5', label: 'load5', color: 'var(--chart-1)' },
			{ name: 'load15', label: 'load15', color: 'var(--chart-2)' }
		]
	},
	{
		m: 'temp',
		title: 'Temperature',
		yMin: null,
		yMax: null,
		format: 'temp',
		series: [{ name: 'celsius', label: 'Temperature', color: 'var(--chart-4)' }]
	}
];

export type MetricPoint = { t: string; value: number | null };

export type MetricChart = {
	m: MetricName;
	message: string | null;
	step: number | null;
	series: Array<{ name: string; points: MetricPoint[] }>;
};

export type HostPage = {
	host: Host | null;
	projectName: string | null;
	tab: HostTab;
	range: RangeKey;
	processSort: ProcessSort;
	message: string | null;
	services: ServiceRow[];
	omitted: number;
	metrics: MetricChart[];
	processes: ProcessSample | null;
	processesMessage: string | null;
};

export function parseHostTab(value: string | null): HostTab {
	if (value === 'services' || value === 'processes') return value;
	return 'overview';
}

export function parseProcessSort(value: string | null): ProcessSort {
	return value === 'memory' ? 'memory' : 'cpu';
}

/**
 * API `sort` for the process sample. `processes.sort=cpu|memory` wins.
 * Any other table column still requests `cpu` (the page sorts those rows).
 * With no table sort, the legacy `sort` param is used and unknown values fall back to cpu.
 */
export function processRequestSort(params: URLSearchParams): ProcessSort {
	const tableSort = params.get('processes.sort');
	if (tableSort === 'cpu' || tableSort === 'memory') return tableSort;
	if (tableSort != null && tableSort !== '') return 'cpu';
	return parseProcessSort(params.get('sort'));
}

export function hostQuery(url: URL): { tab: HostTab; range: RangeKey; processSort: ProcessSort } {
	return {
		tab: parseHostTab(url.searchParams.get('tab')),
		range: parseRange(url.searchParams.get('range')),
		processSort: processRequestSort(url.searchParams)
	};
}

export function serviceDomId(serviceId: string): string {
	return `service-${serviceId}`;
}

export function serviceTabHref(serviceId: string): string {
	return `?tab=services#${serviceDomId(serviceId)}`;
}

/** A sample the processes table can show. Null `sampled_at` and no rows is "no sample yet". */
export function hasProcessSample(sample: ProcessSample | null): sample is ProcessSample & { sampled_at: string } {
	return sample != null && sample.sampled_at != null && (sample.items.length > 0 || sample.skipped > 0);
}

/** Smallest port, or null when the list is empty. Null sorts last. */
export function smallestPort(ports: readonly number[]): number | null {
	let min: number | null = null;
	for (const port of ports) {
		if (!Number.isFinite(port)) continue;
		if (min == null || port < min) min = port;
	}
	return min;
}

export const SERVICE_DEFAULT_SORT = 'name';
export const SERVICE_DEFAULT_DIR: SortDir = 'asc';

export const SERVICE_COLUMNS: Column<ServiceRow>[] = [
	{ key: 'name', label: 'Name', sortable: true, searchable: true, value: (row) => row.name },
	{ key: 'source', label: 'Source', value: (row) => row.source },
	{ key: 'kind', label: 'Kind', sortable: true, searchable: true, value: (row) => row.kind },
	{
		key: 'ports',
		label: 'Ports',
		numeric: true,
		sortable: true,
		searchable: true,
		value: (row) => smallestPort(row.ports),
		searchValue: (row) => (row.ports.length ? row.ports.join(', ') : null)
	},
	{
		key: 'status',
		label: 'Health',
		sortable: true,
		value: (row) => row.health?.status ?? 'unknown'
	},
	{ key: 'lastSeen', label: 'Last seen', sortable: true, value: (row) => row.last_seen_at },
	{ key: 'checks', label: 'Checks' }
];

export const PROCESS_COLUMNS: Column<ProcessItem>[] = [
	{ key: 'pid', label: 'PID', numeric: true, sortable: true, searchable: true, value: (row) => row.pid },
	{ key: 'process', label: 'Process', sortable: true, searchable: true, value: (row) => row.process_name },
	{ key: 'user', label: 'User', sortable: true, searchable: true, value: (row) => row.user },
	{ key: 'command', label: 'Command', sortable: true, searchable: true, value: (row) => row.cmdline ?? '' },
	{ key: 'cpu', label: 'CPU %', numeric: true, sortable: true, firstDir: 'desc', value: (row) => row.cpu_usage },
	{ key: 'rss', label: 'RSS', numeric: true, sortable: true, firstDir: 'desc', value: (row) => row.memory_rss },
	{ key: 'memory', label: 'Mem %', numeric: true, sortable: true, firstDir: 'desc', value: (row) => row.memory_usage },
	{ key: 'threads', label: 'Threads', numeric: true, sortable: true, firstDir: 'desc', value: (row) => row.num_threads },
	{ key: 'started', label: 'Started', sortable: true, value: (row) => row.started_at }
];

/** One time axis. A series missing a timestamp, or a null value, is a gap. */
export function alignSeries(series: ReadonlyArray<{ points: readonly MetricPoint[] }>): {
	times: string[];
	columns: Array<Array<number | null>>;
} {
	const times: string[] = [];
	const seen = new Set<string>();
	for (const item of series) {
		for (const point of item.points) {
			if (seen.has(point.t)) continue;
			seen.add(point.t);
			times.push(point.t);
		}
	}
	times.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	const columns = series.map((item) => {
		const byTime = new Map(item.points.map((point) => [point.t, point.value]));
		return times.map((t) => (byTime.has(t) ? (byTime.get(t) ?? null) : null));
	});
	return { times, columns };
}
