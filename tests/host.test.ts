import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { ProcessItem } from '../src/lib/api-types.ts';
import {
	alignSeries,
	PROCESS_COLUMNS,
	processColumns,
	processRequestSort,
	SERVICE_COLUMNS,
	SERVICE_DEFAULT_DIR,
	SERVICE_DEFAULT_SORT,
	serviceColumns,
	serviceDomId,
	showProjectColumn,
	smallestPort
} from '../src/lib/host-view.ts';
import { processServiceHref } from '../src/lib/service-label.ts';
import { parseRange, rangeWindow, RANGES } from '../src/lib/ranges.ts';
import { searchRows } from '../src/lib/table.ts';

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

test('process search matches pid, process, user, and command', () => {
	assert.deepEqual(
		PROCESS_COLUMNS.filter((column) => column.searchable).map((column) => column.key),
		['pid', 'process', 'service', 'user', 'command']
	);
	const linked = processColumns({
		svc: { label: 'API' }
	});
	const withService = row({ pid: 3, process_name: 'alpha', service_id: 'svc' });
	assert.equal(linked.find((column) => column.key === 'process')?.value?.(withService), 'alpha');
	assert.equal(linked.find((column) => column.key === 'service')?.value?.(withService), 'API');
	assert.equal(linked.find((column) => column.key === 'service')?.value?.(row({ service_id: 'missing' })), 'service');
	assert.equal(linked.find((column) => column.key === 'service')?.value?.(row({ service_id: null })), '');
	assert.deepEqual(
		searchRows([withService], linked, 'API').map((item) => item.pid),
		[3]
	);
	assert.deepEqual(
		searchRows([withService], linked, 'alpha').map((item) => item.pid),
		[3]
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
	assert.match(processes, /processColumns\(serviceLinks\)/);
	assert.match(processes, /defaultDir="desc"/);
});

test('project service columns are server-sorted and ports is not a sort', () => {
	assert.deepEqual(
		SERVICE_COLUMNS.filter((column) => column.sortable).map((column) => column.key),
		['name', 'host', 'kind', 'status', 'last_seen']
	);
	assert.equal(
		SERVICE_COLUMNS.find((column) => column.key === 'ports')?.sortable,
		undefined
	);
	assert.equal(SERVICE_COLUMNS.find((column) => column.key === 'last_seen')?.firstDir, 'desc');
	assert.equal(SERVICE_DEFAULT_SORT, 'name');
	assert.equal(SERVICE_DEFAULT_DIR, 'asc');
	assert.equal(smallestPort([8080, 80]), 80);
	assert.equal(smallestPort([]), null);
	assert.deepEqual(
		serviceColumns(true).map((column) => column.key),
		['name', 'host', 'project', 'kind', 'ports', 'status', 'last_seen', 'checks']
	);
	assert.equal(showProjectColumn('Lab', [{ project_name: 'Lab' }]), false);
	assert.equal(showProjectColumn('Lab', [{ project_name: 'Lab' }, { project_name: 'Other' }]), true);
	const services = readFileSync(new URL('../src/routes/projects/[id]/ServicesSection.svelte', import.meta.url), 'utf8');
	assert.match(services, /serviceColumns\(showProject\)/);
	assert.match(services, /server=\{\{ total/);
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

test('a process service link targets the owning project services tab', () => {
	const id = '00000000-0000-4000-8000-0000000000bb';
	const project = '00000000-0000-4000-8000-000000000010';
	const host = '00000000-0000-4000-8000-0000000000aa';
	assert.equal(serviceDomId(id), `service-${id}`);
	assert.equal(
		processServiceHref(project, host, 'api'),
		`/projects/${project}?tab=services&services.host=${host}&services.q=api`
	);
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
