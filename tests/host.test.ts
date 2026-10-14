import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProcessItem } from '../src/lib/api-types.ts';
import { alignSeries, filterProcesses, serviceDomId, serviceTabHref } from '../src/lib/host-view.ts';
import { parseRange, rangeWindow, RANGES } from '../src/lib/ranges.ts';

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

test('process search matches pid, process, user, and cmdline without changing order', () => {
	const items = [
		row({ pid: 3, process_name: 'node', user: 'bot', cmdline: 'node server.js' }),
		row({ pid: 9, process_name: 'sshd', user: 'root', cmdline: null })
	];
	assert.equal(filterProcesses(items, null).length, 2);
	assert.equal(filterProcesses(items, '')[0]?.pid, 3);
	assert.equal(filterProcesses(items, 'NODE')[0]?.pid, 3);
	assert.equal(filterProcesses(items, 'root')[0]?.pid, 9);
	assert.equal(filterProcesses(items, '3')[0]?.pid, 3);
	assert.equal(filterProcesses(items, 'server.js')[0]?.pid, 3);
	assert.equal(filterProcesses(items, 'missing').length, 0);
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
