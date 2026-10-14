import type { Host, ProcessItem, ProcessSample, ProjectServiceRow } from './api-types';
import { parseRange, type RangeKey } from './ranges';
import { serviceLabel } from './service-label';
import type { Column, SortDir } from './table';

export const METRIC_REFRESH_MS = 30_000;

export const HOST_TABS = ['overview', 'processes'] as const;
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
			{ name: 'rx_bps', label: 'Receive', color: 'var(--chart-1)' },
			{ name: 'tx_bps', label: 'Transmit', color: 'var(--chart-5)' }
		]
	},
	{
		m: 'diskio',
		title: 'Disk IO',
		yMin: 0,
		yMax: null,
		format: 'rate',
		series: [
			{ name: 'read_bps', label: 'Read', color: 'var(--chart-2)' },
			{ name: 'write_bps', label: 'Write', color: 'var(--chart-4)' }
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

/** Label and optional project Services link for one process row. */
export type ServiceLink = {
	label: string;
	href: string | null;
};

export type HostPage = {
	host: Host | null;
	projectName: string | null;
	tab: HostTab;
	range: RangeKey;
	processSort: ProcessSort;
	message: string | null;
	serviceLinks: Record<string, ServiceLink>;
	metrics: MetricChart[];
	processes: ProcessSample | null;
	processesMessage: string | null;
};

export function parseHostTab(value: string | null): HostTab {
	if (value === 'processes') return value;
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

/** The Project column is only there when a row belongs to some other project. */
export function showProjectColumn(projectName: string, rows: readonly { project_name: string }[]): boolean {
	return rows.some((row) => row.project_name !== projectName);
}

/** A sample the processes table can show. Null `sampled_at` and no rows is "no sample yet". */
export function hasProcessSample(sample: ProcessSample | null): sample is ProcessSample & { sampled_at: string } {
	return sample != null && sample.sampled_at != null && (sample.items.length > 0 || sample.skipped > 0);
}

/** Services list rows: every service on an owned host, or this project's services on a deploy share. */
export function serviceHostReachable(host: Pick<Host, 'relation' | 'share_level'>): boolean {
	if (host.relation === 'owner') return true;
	return host.relation === 'shared' && host.share_level === 'deploy';
}

/** Label shown in the Service column. Empty when the process has no service. */
export function processServiceText(
	row: { service_id: string | null },
	links: Readonly<Record<string, { label: string }>>
): string {
	if (!row.service_id) return '';
	return links[row.service_id]?.label ?? 'service';
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

export const PROJECT_COLUMN: Column<ProjectServiceRow> = {
	key: 'project',
	label: 'Project',
	value: (row) => row.project_name
};

/** Server-sorted project services. Ports has no API sort. `last_seen` opens descending. */
export const SERVICE_COLUMNS: Column<ProjectServiceRow>[] = [
	{ key: 'name', label: 'Name', sortable: true, value: (row) => serviceLabel(row) },
	{ key: 'host', label: 'Host', sortable: true, value: (row) => row.host_name },
	{ key: 'kind', label: 'Kind', sortable: true, value: (row) => row.kind },
	{ key: 'ports', label: 'Ports', numeric: true, value: (row) => smallestPort(row.ports) },
	{ key: 'status', label: 'Status', sortable: true, value: (row) => row.health?.status ?? 'unknown' },
	{ key: 'last_seen', label: 'Last seen', sortable: true, firstDir: 'desc', value: (row) => row.last_seen_at },
	{ key: 'checks', label: 'Checks' }
];

export function serviceColumns(showProject: boolean): Column<ProjectServiceRow>[] {
	if (!showProject) return [...SERVICE_COLUMNS];
	const columns = [...SERVICE_COLUMNS];
	const hostIndex = columns.findIndex((column) => column.key === 'host');
	columns.splice(hostIndex + 1, 0, PROJECT_COLUMN);
	return columns;
}

export const PROCESS_COLUMNS: Column<ProcessItem>[] = [
	{ key: 'pid', label: 'PID', numeric: true, sortable: true, searchable: true, value: (row) => row.pid },
	{ key: 'process', label: 'Process', sortable: true, searchable: true, value: (row) => row.process_name },
	{
		key: 'service',
		label: 'Service',
		sortable: true,
		searchable: true,
		value: (row) => (row.service_id ? 'service' : '')
	},
	{ key: 'user', label: 'User', sortable: true, searchable: true, value: (row) => row.user },
	{ key: 'command', label: 'Command', sortable: true, searchable: true, value: (row) => row.cmdline ?? '' },
	{ key: 'cpu', label: 'CPU %', numeric: true, sortable: true, firstDir: 'desc', value: (row) => row.cpu_usage },
	{ key: 'rss', label: 'RSS', numeric: true, sortable: true, firstDir: 'desc', value: (row) => row.memory_rss },
	{ key: 'memory', label: 'Mem %', numeric: true, sortable: true, firstDir: 'desc', value: (row) => row.memory_usage },
	{ key: 'threads', label: 'Threads', numeric: true, sortable: true, firstDir: 'desc', value: (row) => row.num_threads },
	{ key: 'started', label: 'Started', sortable: true, value: (row) => row.started_at }
];

/** Process columns with the Service search and sort value taken from the label map. */
export function processColumns(links: Readonly<Record<string, { label: string }>>): Column<ProcessItem>[] {
	return PROCESS_COLUMNS.map((column) =>
		column.key === 'service' ? { ...column, value: (row) => processServiceText(row, links) } : column
	);
}

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
