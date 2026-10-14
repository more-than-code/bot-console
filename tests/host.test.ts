import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { ProcessItem, ServiceRow } from '../src/lib/api-types.ts';
import {
	alignSeries,
	PROCESS_COLUMNS,
	processRequestSort,
	SERVICE_COLUMNS,
	SERVICE_DEFAULT_DIR,
	SERVICE_DEFAULT_SORT,
	serviceDomId,
	serviceTabHref
} from '../src/lib/host-view.ts';
import { parseRange, rangeWindow, RANGES } from '../src/lib/ranges.ts';
import { searchRows, sortRows } from '../src/lib/table.ts';

const row = (overrides: Partial<ProcessItem>): ProcessItem => ({
	pid: 1,
	process_name: 'node',
	user: 'bot',
	cmdline: 'node server.js',
	service_id: null,
	cpu_usage: 1,
	memory_rss: 1024,
	memory_usage: 0.1,
	num_threads: 1,
	started_at: '2026-10-14T00:00:00Z',
	...overrides
});

test('metric ranges default to 1h and map onto exact from/to windows', () => {
	assert.equal(parseRange(null), '1h');
	assert.equal(parseRange(''), '1h');
	assert.equal(parseRange('1d'), '1h');
	assert.equal(parseRange('1h;drop'), '1h');
	assert.equal(parseRange('6h'), '6h');
	const now = Date.parse('2026-10-14T12:00:00.000Z');
	assert.deepEqual(rangeWindow('1h', now), {
		from: '2026-10-14T11:00:00.000Z',
		to: '2026-10-14T12:00:00.000Z'
	});
	assert.deepEqual(rangeWindow('6h', now), {
		from: '2026-10-14T06:00:00.000Z',
		to: '2026-10-14T12:00:00.000Z'
	});
	assert.deepEqual(rangeWindow('24h', now), {
		from: '2026-10-13T12:00:00.000Z',
		to: '2026-10-14T12:00:00.000Z'
	});
	assert.deepEqual(rangeWindow('7d', now), {
		from: '2026-10-07T12:00:00.000Z',
		to: '2026-10-14T12:00:00.000Z'
	});
	for (const key of Object.keys(RANGES) as Array<keyof typeof RANGES>) {
		const window = rangeWindow(key, now);
		assert.equal(Date.parse(window.to) - Date.parse(window.from), RANGES[key].ms);
	}
});

const service = (overrides: Partial<ServiceRow>): ServiceRow => ({
	id: '00000000-0000-4000-8000-0000000000bb',
	name: 'api',
	source: 'discovered',
	kind: 'container',
	ports: [],
	health: null,
	last_seen_at: null,
	checks: [],
	checksMessage: null,
	...overrides
});

test('process search matches pid, process, user, and command', () => {
	assert.deepEqual(
		PROCESS_COLUMNS.filter((column) => column.searchable).map((column) => column.key),
		['pid', 'process', 'user', 'command']
	);
	const items = [
		row({ pid: 3, process_name: 'alpha', user: 'bot', cmdline: 'run-one' }),
		row({ pid: 9, process_name: 'beta', user: 'root', cmdline: null }),
		row({ pid: 12, process_name: 'gamma', user: 'deploy', cmdline: 'serve-widget' })
	];
	assert.equal(searchRows(items, PROCESS_COLUMNS, '').length, 3);
	assert.deepEqual(
		searchRows(items, PROCESS_COLUMNS, '3').map((item) => item.pid),
		[3]
	);
	assert.deepEqual(
		searchRows(items, PROCESS_COLUMNS, 'ALPHA').map((item) => item.pid),
		[3]
	);
	assert.deepEqual(
		searchRows(items, PROCESS_COLUMNS, 'root').map((item) => item.pid),
		[9]
	);
	assert.deepEqual(
		searchRows(items, PROCESS_COLUMNS, 'widget').map((item) => item.pid),
		[12]
	);
	assert.equal(searchRows(items, PROCESS_COLUMNS, 'missing').length, 0);
	assert.deepEqual(
		PROCESS_COLUMNS.filter((column) => column.firstDir === 'desc').map((column) => column.key),
		['cpu', 'rss', 'memory', 'threads']
	);
	const processes = readFileSync(new URL('../src/routes/hosts/[id]/ProcessesTab.svelte', import.meta.url), 'utf8');
	assert.match(processes, /columns=\{PROCESS_COLUMNS\}/);
	assert.match(processes, /defaultDir="desc"/);
});

test('services columns sort ports by the smallest port and search the joined text', () => {
	assert.deepEqual(
		SERVICE_COLUMNS.filter((column) => column.sortable).map((column) => column.key),
		['name', 'kind', 'ports', 'status', 'lastSeen']
	);
	assert.deepEqual(
		SERVICE_COLUMNS.filter((column) => column.searchable).map((column) => column.key),
		['name', 'kind', 'ports']
	);
	assert.equal(SERVICE_DEFAULT_SORT, 'name');
	assert.equal(SERVICE_DEFAULT_DIR, 'asc');
	const wide = service({ id: 'wide', name: 'wide-api', kind: 'container', ports: [8080, 80] });
	const web = service({ id: 'web', name: 'web', kind: 'systemd', ports: [443] });
	const none = service({ id: 'none', name: 'none', kind: 'process', ports: [] });
	const rows = [wide, web, none];
	assert.deepEqual(
		sortRows(rows, SERVICE_COLUMNS, 'ports', 'asc').map((item) => item.id),
		['wide', 'web', 'none']
	);
	assert.deepEqual(
		sortRows(rows, SERVICE_COLUMNS, 'ports', 'desc').map((item) => item.id),
		['web', 'wide', 'none']
	);
	assert.deepEqual(
		searchRows(rows, SERVICE_COLUMNS, '8080').map((item) => item.id),
		['wide']
	);
	assert.deepEqual(
		searchRows(rows, SERVICE_COLUMNS, '80').map((item) => item.id),
		['wide']
	);
	assert.deepEqual(
		searchRows(rows, SERVICE_COLUMNS, '443').map((item) => item.id),
		['web']
	);
	assert.deepEqual(
		searchRows(rows, SERVICE_COLUMNS, 'wide-api').map((item) => item.id),
		['wide']
	);
	assert.deepEqual(
		searchRows(rows, SERVICE_COLUMNS, 'systemd').map((item) => item.id),
		['web']
	);
	const services = readFileSync(new URL('../src/routes/hosts/[id]/ServicesTab.svelte', import.meta.url), 'utf8');
	assert.match(services, /columns=\{SERVICE_COLUMNS\}/);
	assert.match(services, /defaultSort=\{SERVICE_DEFAULT_SORT\}/);
	assert.match(services, /defaultDir=\{SERVICE_DEFAULT_DIR\}/);
});

test('process API sort follows the table column and falls back to cpu', () => {
	assert.equal(processRequestSort(new URLSearchParams('sort=memory')), 'memory');
	assert.equal(processRequestSort(new URLSearchParams('sort=nope')), 'cpu');
	assert.equal(processRequestSort(new URLSearchParams('processes.sort=memory')), 'memory');
	assert.equal(processRequestSort(new URLSearchParams('processes.sort=cpu')), 'cpu');
	assert.equal(processRequestSort(new URLSearchParams('processes.sort=pid&sort=memory')), 'cpu');
	assert.equal(processRequestSort(new URLSearchParams('')), 'cpu');
});

test('a process service link targets the services tab anchor', () => {
	const id = '00000000-0000-4000-8000-0000000000bb';
	assert.equal(serviceDomId(id), `service-${id}`);
	assert.equal(serviceTabHref(id), `?tab=services#service-${id}`);
});

test('null metric points stay gaps when series are aligned', () => {
	const aligned = alignSeries([
		{
			points: [
				{ t: '2026-10-14T00:00:00.000Z', value: 1 },
				{ t: '2026-10-14T00:01:00.000Z', value: null }
			]
		},
		{ points: [{ t: '2026-10-14T00:01:00.000Z', value: 2 }] }
	]);
	assert.deepEqual(aligned.times, ['2026-10-14T00:00:00.000Z', '2026-10-14T00:01:00.000Z']);
	assert.deepEqual(aligned.columns[0], [1, null]);
	assert.deepEqual(aligned.columns[1], [null, 2]);
});
