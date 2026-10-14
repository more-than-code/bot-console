import type { Host, ProcessItem, ProcessSample, ServiceRow } from './api-types';
import { parseRange, type RangeKey } from './ranges';

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

export function hostQuery(url: URL): { tab: HostTab; range: RangeKey; processSort: ProcessSort } {
	return {
		tab: parseHostTab(url.searchParams.get('tab')),
		range: parseRange(url.searchParams.get('range')),
		processSort: parseProcessSort(url.searchParams.get('sort'))
	};
}

export function serviceDomId(serviceId: string): string {
	return `service-${serviceId}`;
}

export function serviceTabHref(serviceId: string): string {
	return `?tab=services#${serviceDomId(serviceId)}`;
}

/**
 * SvelteKit named action on the current path. The action name is the search key
 * `&/name` (see `?/name`), so `tab` and `range` are still there when the page renders.
 * Omit `range` on a page that has no range.
 */
export function hostFormAction(name: string, query: { tab: string; range?: string }): string {
	const params = new URLSearchParams({ tab: query.tab });
	if (query.range) params.set('range', query.range);
	return `?${params.toString()}&/${name}`;
}

/** A sample the processes table can show. Null `sampled_at` and no rows is "no sample yet". */
export function hasProcessSample(sample: ProcessSample | null): sample is ProcessSample & { sampled_at: string } {
	return sample != null && sample.sampled_at != null && (sample.items.length > 0 || sample.skipped > 0);
}

/** Case-insensitive substring over pid, process name, user, and cmdline. */
export function filterProcesses(items: ProcessItem[], q: string | null): ProcessItem[] {
	if (q == null || q === '') return items;
	const needle = q.toLowerCase();
	return items.filter((item) => {
		const hay = [String(item.pid), item.process_name, item.user, item.cmdline ?? ''].join('\n').toLowerCase();
		return hay.includes(needle);
	});
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
