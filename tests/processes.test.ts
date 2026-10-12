import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseProcessesQuery, type ProcessesQuery } from '../src/lib/process-query.ts';
import {
	buildProcessesView,
	type ProcessesViewInput,
	type RawProcess,
	type RawService
} from '../src/lib/service-view.ts';
import { likePattern } from '../src/lib/table-query.ts';
import { isProcessesPayload } from '../src/lib/types.ts';

function params(query: string) {
	return parseProcessesQuery(new URLSearchParams(query));
}

function query(partial: Partial<ProcessesQuery> = {}): ProcessesQuery {
	return {
		host: null,
		service: null,
		q: null,
		sort: 'cpu',
		dir: 'desc',
		page: 1,
		pageSize: 25,
		...partial
	};
}

function service(overrides: Partial<RawService> & Pick<RawService, 'name' | 'host'>): RawService {
	return {
		project: 'project',
		port: null,
		healthUrl: null,
		systemdUnit: null,
		systemdScope: null,
		processMatch: null,
		...overrides
	};
}

function proc(overrides: Partial<RawProcess> & Pick<RawProcess, 'host' | 'pid' | 'processName'>): RawProcess {
	return {
		user: 'pi',
		filter: 'user',
		systemdUnit: null,
		cpuPercent: 1,
		memoryRssBytes: 1000,
		memoryPercent: 1,
		threads: 1,
		createdAt: null,
		cmdline: null,
		sampledAt: '2026-10-12T00:00:00.000Z',
		...overrides
	};
}

function view(partial: Partial<Omit<ProcessesViewInput, 'query'>> & { query?: Partial<ProcessesQuery> } = {}) {
	const { query: queryPartial, ...rest } = partial;
	return buildProcessesView({
		generatedAt: '2026-10-12T00:00:30.000Z',
		query: query(queryPartial),
		knownHosts: ['pi3'],
		processesAvailable: true,
		services: [],
		processes: [],
		...rest
	});
}

test('parseProcessesQuery defaults to one cpu page and rejects bad paging', () => {
	const empty = params('');
	assert.equal(empty.ok, true);
	if (empty.ok) {
		assert.deepEqual(empty.query, {
			host: null,
			service: null,
			q: null,
			sort: 'cpu',
			dir: 'desc',
			page: 1,
			pageSize: 25
		});
	}

	const selected = params('host=pi1&service=tra-backend&sort=user&dir=asc&page=3&pageSize=10&q=node');
	assert.equal(selected.ok, true);
	if (selected.ok) {
		assert.deepEqual(selected.query, {
			host: 'pi1',
			service: 'tra-backend',
			q: 'node',
			sort: 'user',
			dir: 'asc',
			page: 3,
			pageSize: 10
		});
	}

	assert.equal(params('host=../x').ok, false);
	assert.equal(params('sort=disk').ok, false);
	assert.equal(params('sort=cpu;drop').ok, false);
	assert.equal(params('dir=sideways').ok, false);
	assert.equal(params('service=Nope').ok, false);
	assert.equal(params('page=0').ok, false);
	assert.equal(params('page=10001').ok, false);
	assert.equal(params('pageSize=101').ok, false);
	assert.equal(params('page=01').ok, false);
	assert.equal(params(`q=${'a'.repeat(201)}`).ok, false);
	assert.equal(params('q=%00').ok, false);
	const blank = params('q=%20%20');
	assert.equal(blank.ok, true);
	if (blank.ok) assert.equal(blank.query.q, null);
});

test('likePattern escapes LIKE wildcards and backslashes', () => {
	assert.equal(likePattern('100%'), '%100\\%%');
	assert.equal(likePattern('a_b'), '%a\\_b%');
	assert.equal(likePattern('a\\b'), '%a\\\\b%');
	assert.equal(likePattern('plain'), '%plain%');
});

test('process pages sort cpu with nulls last and can filter to a linked service', () => {
	const processes = [
		proc({ host: 'pi1', pid: '1', processName: 'a', cpuPercent: 1, memoryRssBytes: 500, user: 'ada' }),
		proc({ host: 'pi1', pid: '2', processName: 'b', cpuPercent: null, memoryRssBytes: 900, user: 'bea' }),
		proc({ host: 'pi2', pid: '3', processName: 'c', cpuPercent: 5, memoryRssBytes: 100, user: 'cy' }),
		proc({
			host: 'pi1',
			pid: '9',
			processName: 'MainThread',
			filter: 'tra-backend',
			cmdline: '/usr/bin/node /home/joe/workspace/tour-agent/tra-backend/src/server.ts',
			cpuPercent: 4
		})
	];
	const services = [
		service({
			name: 'tra-backend',
			host: 'pi1',
			processMatch: '/home/joe/workspace/tour-agent/tra-backend'
		})
	];

	const byCpu = view({ processes, services });
	assert.deepEqual(
		byCpu.processes.map((row) => row.pid),
		['3', '9', '1', '2']
	);
	assert.equal(byCpu.total, 4);
	assert.equal(byCpu.processes.find((row) => row.pid === '9')?.cmdline, 'tour-agent/tra-backend');
	assert.equal(isProcessesPayload(byCpu), true);

	const page = view({ query: { page: 2, pageSize: 2 }, processes, services });
	assert.deepEqual(
		page.processes.map((row) => row.pid),
		['1', '2']
	);
	assert.equal(page.total, 4);

	const byMemory = view({ query: { sort: 'memory', dir: 'asc' }, processes });
	assert.deepEqual(
		byMemory.processes.map((row) => row.pid),
		['3', '1', '2', '9']
	);

	const byUser = view({ query: { sort: 'user', dir: 'asc' }, processes });
	assert.deepEqual(
		byUser.processes.map((row) => row.user),
		['ada', 'bea', 'cy', 'pi']
	);

	const linked = view({ query: { service: 'tra-backend' }, processes, services });
	assert.deepEqual(
		linked.processes.map((row) => row.pid),
		['9']
	);
	assert.equal(linked.total, 1);
	assert.equal(linked.service, 'tra-backend');

	const past = view({ query: { page: 9, pageSize: 2 }, processes });
	assert.equal(past.processes.length, 0);
	assert.equal(past.total, 4);
	assert.equal(isProcessesPayload({ generatedAt: 'x' }), false);
});
