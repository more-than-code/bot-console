import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MISSING_RELATION_TTL_MS, missingRelationRemembered, rememberMissingRelation } from '../src/lib/pg-error.ts';
import { parseServicesQuery, type ServicesQuery } from '../src/lib/services-query.ts';
import {
	buildServicesView,
	type RawHttp,
	type RawProcess,
	type RawService,
	type RawUnit,
	type ServicesViewInput
} from '../src/lib/service-view.ts';
import { isServicesPayload } from '../src/lib/types.ts';

function params(query: string) {
	return parseServicesQuery(new URLSearchParams(query));
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

function proc(
	overrides: Partial<RawProcess> & Pick<RawProcess, 'host' | 'pid' | 'processName'>
): RawProcess {
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

function query(partial: Partial<ServicesQuery> = {}): ServicesQuery {
	return {
		host: null,
		sort: 'cpu',
		service: null,
		q: null,
		order: 'host',
		dir: 'asc',
		page: null,
		pageSize: null,
		...partial
	};
}

function view(partial: Partial<Omit<ServicesViewInput, 'query'>> & { query?: Partial<ServicesQuery> } = {}) {
	const { query: queryPartial, ...rest } = partial;
	return buildServicesView({
		generatedAt: '2026-10-12T00:00:30.000Z',
		query: query(queryPartial),
		knownHosts: [],
		servicesAvailable: true,
		processesAvailable: true,
		services: [],
		units: [],
		http: [],
		processes: [],
		...rest
	});
}

const consoleService = service({
	name: 'bot-console',
	host: 'pi2',
	project: 'deploybot',
	port: 5180,
	healthUrl: 'http://127.0.0.1:5180/',
	systemdUnit: 'bot-console.service',
	systemdScope: 'user',
	processMatch: 'bot-console'
});

const unitUp: RawUnit = {
	host: 'pi2',
	name: 'bot-console.service',
	active: 'active',
	sub: 'running',
	sampledAt: '2026-10-12T00:00:00.000Z'
};

function httpRow(overrides: Partial<RawHttp> = {}): RawHttp {
	return {
		host: 'pi2',
		server: 'http://127.0.0.1:5180/',
		result: 'success',
		statusCode: 200,
		responseTimeSeconds: 0.25,
		sampledAt: '2026-10-12T00:00:01.000Z',
		...overrides
	};
}

test('parseServicesQuery accepts the defaults and rejects bad filters', () => {
	const empty = params('');
	assert.equal(empty.ok, true);
	if (empty.ok) {
		assert.deepEqual(empty.query, {
			host: null,
			sort: 'cpu',
			service: null,
			q: null,
			order: 'host',
			dir: 'asc',
			page: null,
			pageSize: null
		});
	}

	const all = params('host=all');
	assert.equal(all.ok, true);
	if (all.ok) assert.equal(all.query.host, null);

	const selected = params('host=pi1&sort=memory&service=tra-backend');
	assert.equal(selected.ok, true);
	if (selected.ok) {
		assert.equal(selected.query.host, 'pi1');
		assert.equal(selected.query.sort, 'memory');
		assert.equal(selected.query.service, 'tra-backend');
		assert.equal(selected.query.order, 'host');
		assert.equal(selected.query.page, null);
	}

	assert.equal(params('host=../x').ok, false);
	assert.equal(params('host=bad host').ok, false);
	assert.equal(params('sort=disk').ok, false);
	assert.equal(params('sort=').ok, true);
	assert.equal(params('service=Tra').ok, false);
	assert.equal(params('service=-no').ok, false);
	assert.equal(params('host=pi1&host=pi2').ok, true);
	const first = params('host=pi1&host=pi2');
	if (first.ok) assert.equal(first.query.host, 'pi1');

	assert.equal(params('order=disk').ok, false);
	assert.equal(params('dir=up').ok, false);
	assert.equal(params('page=0').ok, false);
	assert.equal(params('page=1.5').ok, false);
	assert.equal(params('pageSize=101').ok, false);
	assert.equal(params('pageSize=0').ok, false);
	assert.equal(params(`q=${'a'.repeat(201)}`).ok, false);
	assert.equal(params('q=%00').ok, false);
	const long = params(`q=${'a'.repeat(200)}`);
	assert.equal(long.ok, true);
	if (long.ok) assert.equal(long.query.q?.length, 200);

	const paged = params('order=cpu&dir=desc&page=2&pageSize=10&q=%25cpu');
	assert.equal(paged.ok, true);
	if (paged.ok) {
		assert.equal(paged.query.order, 'cpu');
		assert.equal(paged.query.dir, 'desc');
		assert.equal(paged.query.page, 2);
		assert.equal(paged.query.pageSize, 10);
		assert.equal(paged.query.q, '%cpu');
		assert.equal(paged.query.sort, 'cpu');
	}

	const sizeOnly = params('pageSize=10');
	assert.equal(sizeOnly.ok, true);
	if (sizeOnly.ok) {
		assert.equal(sizeOnly.query.page, 1);
		assert.equal(sizeOnly.query.pageSize, 10);
	}
});

const consoleProc = proc({
	host: 'pi2',
	pid: '1',
	processName: 'MainThread',
	filter: 'bot-console',
	cmdline: '/home/joe/.local/opt/node/bin/node build'
});

test('health is up only when every declared check is up', () => {
	const both = view({
		services: [consoleService],
		units: [unitUp],
		http: [httpRow()],
		processes: [consoleProc]
	});
	assert.equal(both.services[0]?.status, 'up');
	assert.equal(both.services[0]?.unit, 'none');
	assert.equal(both.services[0]?.http, 'up');
	assert.equal(both.services[0]?.latencyMs, 250);
	assert.equal(both.services[0]?.lastCheck, '2026-10-12T00:00:01.000Z');
	assert.equal(isServicesPayload(both), true);

	const httpDown = view({
		services: [consoleService],
		units: [unitUp],
		http: [httpRow({ statusCode: 500, responseTimeSeconds: 1.5 })],
		processes: [consoleProc]
	});
	assert.equal(httpDown.services[0]?.status, 'down');
	assert.equal(httpDown.services[0]?.unit, 'none');
	assert.equal(httpDown.services[0]?.http, 'down');
	assert.equal(httpDown.services[0]?.latencyMs, 1500);

	const httpOnly = view({
		services: [{ ...consoleService, systemdUnit: null, systemdScope: null }],
		http: [httpRow({ statusCode: 302 })]
	});
	assert.equal(httpOnly.services[0]?.status, 'up');
	assert.equal(httpOnly.services[0]?.unit, 'none');
	assert.equal(httpOnly.services[0]?.http, 'up');

	const unitOnly = view({
		services: [{ ...consoleService, healthUrl: null, systemdScope: 'system' }],
		units: [unitUp]
	});
	assert.equal(unitOnly.services[0]?.status, 'up');
	assert.equal(unitOnly.services[0]?.http, 'none');
	assert.equal(unitOnly.services[0]?.unit, 'up');
	assert.equal(unitOnly.services[0]?.latencyMs, null);

	const neither = view({
		services: [service({ name: 'idle', host: 'pi4', project: 'idle' })]
	});
	assert.equal(neither.services[0]?.status, 'unknown');
	assert.equal(neither.services[0]?.unit, 'none');
	assert.equal(neither.services[0]?.http, 'none');

	const failed = view({
		services: [consoleService],
		http: [httpRow({ result: 'connection_failed', statusCode: null })],
		processes: [consoleProc]
	});
	assert.equal(failed.services[0]?.http, 'down');
	assert.equal(failed.services[0]?.status, 'down');

	const starting = view({
		services: [{ ...consoleService, healthUrl: null, systemdScope: 'system' }],
		units: [{ ...unitUp, active: 'activating', sub: 'auto-restart' }]
	});
	assert.equal(starting.services[0]?.unit, 'unknown');
	assert.equal(starting.services[0]?.status, 'unknown');
});

test('a user-scope service with HTTP up and no process is down', () => {
	const payload = view({ services: [consoleService], units: [unitUp], http: [httpRow()] });
	assert.equal(payload.services[0]?.unit, 'none');
	assert.equal(payload.services[0]?.http, 'up');
	assert.equal(payload.services[0]?.status, 'down');
});

test('unit and http samples older than two minutes are unknown', () => {
	const watched = service({
		name: 'bot-agent-pi4',
		host: 'pi4',
		healthUrl: 'http://127.0.0.1:8081/health',
		systemdUnit: 'bot_agent.service',
		systemdScope: 'system'
	});
	const freshAt = '2026-10-12T00:00:00.000Z';
	const within = view({
		generatedAt: '2026-10-12T00:02:00.000Z',
		services: [watched],
		units: [{ host: 'pi4', name: 'bot_agent.service', active: 'active', sub: 'running', sampledAt: freshAt }],
		http: [httpRow({ host: 'pi4', server: 'http://127.0.0.1:8081/health', sampledAt: freshAt })]
	});
	assert.equal(within.services[0]?.unit, 'up');
	assert.equal(within.services[0]?.http, 'up');
	assert.equal(within.services[0]?.status, 'up');

	const stale = view({
		generatedAt: '2026-10-12T00:02:00.001Z',
		services: [watched],
		units: [{ host: 'pi4', name: 'bot_agent.service', active: 'active', sub: 'running', sampledAt: freshAt }],
		http: [httpRow({ host: 'pi4', server: 'http://127.0.0.1:8081/health', sampledAt: freshAt })]
	});
	assert.equal(stale.services[0]?.unit, 'unknown');
	assert.equal(stale.services[0]?.http, 'unknown');
	assert.equal(stale.services[0]?.status, 'unknown');
});

test('a check on another host does not count', () => {
	const payload = view({
		services: [consoleService],
		http: [httpRow({ host: 'pi1' })],
		processes: [consoleProc]
	});
	assert.equal(payload.services[0]?.http, 'unknown');
	assert.equal(payload.services[0]?.status, 'unknown');
});

test('process rows prefer the service filter and do not double-count CPU', () => {
	const postgres = service({
		name: 'postgres',
		host: 'pi4',
		systemdUnit: 'postgresql.service',
		systemdScope: 'system',
		processMatch: 'postgres'
	});
	const payload = view({
		services: [postgres],
		processes: [
			proc({
				host: 'pi4',
				pid: '10',
				processName: 'postgres',
				filter: 'user',
				cpuPercent: 1,
				memoryRssBytes: 10,
				sampledAt: '2026-10-12T00:00:02.000Z'
			}),
			proc({
				host: 'pi4',
				pid: '10',
				processName: 'postgres',
				filter: 'postgres',
				cpuPercent: 9,
				memoryRssBytes: 40,
				sampledAt: '2026-10-12T00:00:01.000Z'
			}),
			proc({
				host: 'pi4',
				pid: '11',
				processName: 'postgres',
				filter: 'postgres',
				cpuPercent: 4,
				memoryRssBytes: 15,
				memoryPercent: 2
			})
		]
	});
	assert.equal(payload.processes.filter((row) => row.pid === '10').length, 1);
	assert.equal(payload.processes.find((row) => row.pid === '10')?.cpuPercent, 9);
	assert.equal(payload.processes.find((row) => row.pid === '10')?.serviceName, 'postgres');
	assert.equal(payload.services[0]?.cpuPercent, 13);
	assert.equal(payload.services[0]?.memoryRssBytes, 55);
});

test('a service missing its own filter uses the top-N row, not another service filter', () => {
	const postgres = service({ name: 'postgres', host: 'pi4', processMatch: 'postgres' });
	const other = service({ name: 'other', host: 'pi4', processMatch: 'postgres' });
	const fallback = view({
		services: [postgres],
		processes: [proc({ host: 'pi4', pid: '10', processName: 'postgres', filter: 'user', cpuPercent: 5 })]
	});
	assert.equal(fallback.services[0]?.cpuPercent, 5);

	const stolen = view({
		services: [postgres, other],
		processes: [proc({ host: 'pi4', pid: '10', processName: 'postgres', filter: 'other', cpuPercent: 7 })]
	});
	assert.equal(stolen.services.find((row) => row.name === 'postgres')?.cpuPercent, null);
	assert.equal(stolen.services.find((row) => row.name === 'other')?.cpuPercent, 7);
});

test('sort puts nulls last and the cap keeps declared service processes', () => {
	const byCpu = view({
		query: { host: null, sort: 'cpu', service: null },
		processes: [
			proc({ host: 'pi1', pid: '1', processName: 'a', cpuPercent: 1, memoryRssBytes: 500 }),
			proc({ host: 'pi1', pid: '2', processName: 'b', cpuPercent: null, memoryRssBytes: 900 }),
			proc({ host: 'pi2', pid: '3', processName: 'c', cpuPercent: 5, memoryRssBytes: 100 })
		]
	});
	assert.deepEqual(
		byCpu.processes.map((row) => row.pid),
		['3', '1', '2']
	);

	const byMemory = view({
		query: { host: null, sort: 'memory', service: null },
		processes: [
			proc({ host: 'pi1', pid: '1', processName: 'a', cpuPercent: 1, memoryRssBytes: 500 }),
			proc({ host: 'pi1', pid: '2', processName: 'b', cpuPercent: null, memoryRssBytes: 900 }),
			proc({ host: 'pi2', pid: '3', processName: 'c', cpuPercent: 5, memoryRssBytes: null })
		]
	});
	assert.deepEqual(
		byMemory.processes.map((row) => row.pid),
		['2', '1', '3']
	);

	const processes: RawProcess[] = [];
	for (let i = 0; i < 40; i += 1) {
		processes.push(
			proc({
				host: 'pi1',
				pid: String(1000 + i),
				processName: `p${i}`,
				filter: 'user',
				cpuPercent: 100 - i
			})
		);
	}
	processes.push(
		proc({
			host: 'pi1',
			pid: '5',
			processName: 'bot-console',
			filter: 'bot-console',
			cpuPercent: 0.1
		})
	);
	processes.push(proc({ host: 'pi2', pid: '8', processName: 'other', cpuPercent: 3 }));
	const capped = view({
		services: [service({ name: 'bot-console', host: 'pi1' })],
		processes
	});
	assert.equal(capped.processes.length, 42);
	assert.equal(capped.processes.some((row) => row.pid === '5' && row.serviceName === 'bot-console'), true);
});

test('uptime comes from the nanosecond created_at text', () => {
	const sampled = '2026-10-12T00:00:10.000Z';
	const startedMs = Date.parse(sampled) - 10_000;
	const createdAt = (BigInt(startedMs) * 1_000_000n).toString();
	const good = view({
		processes: [proc({ host: 'pi1', pid: '1', processName: 'sleep', createdAt, sampledAt: sampled })]
	});
	assert.equal(good.processes[0]?.uptimeSeconds, 10);
	assert.equal(good.sampledAt, sampled);

	const bad = view({
		processes: [proc({ host: 'pi1', pid: '1', processName: 'sleep', createdAt: 'nope', sampledAt: sampled })]
	});
	assert.equal(bad.processes[0]?.uptimeSeconds, null);

	const future = (BigInt(Date.parse(sampled) + 5_000) * 1_000_000n).toString();
	const ahead = view({
		processes: [proc({ host: 'pi1', pid: '1', processName: 'sleep', createdAt: future, sampledAt: sampled })]
	});
	assert.equal(ahead.processes[0]?.uptimeSeconds, null);

	const ancientMs = Date.parse(sampled) - 11 * 365.25 * 24 * 60 * 60 * 1000;
	const ancient = (BigInt(Math.trunc(ancientMs)) * 1_000_000n).toString();
	const old = view({
		processes: [proc({ host: 'pi1', pid: '1', processName: 'sleep', createdAt: ancient, sampledAt: sampled })]
	});
	assert.equal(old.processes[0]?.uptimeSeconds, null);
});

test('host filter keeps the selector and drops other hosts from the tables', () => {
	const payload = view({
		query: { host: 'pi1', sort: 'cpu', service: 'tra-backend' },
		knownHosts: ['pi3'],
		services: [
			service({ name: 'tra-backend', host: 'pi1' }),
			service({ name: 'bot-console', host: 'pi2' })
		],
		processes: [
			proc({ host: 'pi1', pid: '1', processName: 'tra-backend', filter: 'tra-backend' }),
			proc({ host: 'pi2', pid: '2', processName: 'bot-console', filter: 'bot-console' })
		]
	});
	assert.deepEqual(
		payload.services.map((row) => row.name),
		['tra-backend']
	);
	assert.deepEqual(
		payload.processes.map((row) => row.host),
		['pi1']
	);
	assert.deepEqual(payload.hosts, ['pi1', 'pi2', 'pi3']);
	assert.equal(payload.service, 'tra-backend');
	assert.equal(isServicesPayload(payload), true);
	assert.equal(isServicesPayload({ generatedAt: 'x' }), false);
	assert.equal(isServicesPayload(null), false);
});

test('shortened command lines distinguish MainThread rows', () => {
	const payload = view({
		processes: [
			proc({
				host: 'pi1',
				pid: '1',
				processName: 'MainThread',
				cmdline:
					'node /home/joe/workspace/tour-agent/tra-backend/node_modules/tsx/dist/cli.mjs watch src/server.ts'
			}),
			proc({
				host: 'pi1',
				pid: '2',
				processName: 'MainThread',
				cmdline: '/home/joe/.local/opt/node/bin/node build'
			}),
			proc({
				host: 'pi4',
				pid: '3',
				processName: 'postgres',
				cmdline: 'postgres: 18/main: metrics_monitor tutored_ops 127.0.0.1(41404) idle'
			}),
			proc({
				host: 'pi4',
				pid: '4',
				processName: 'pgadmin4',
				cmdline: '/home/joe/apps/pgadmin4/bin/python3 /home/joe/apps/pgadmin4/bin/pgadmin4'
			})
		]
	});
	const byPid = new Map(payload.processes.map((row) => [row.pid, row.cmdline]));
	assert.equal(byPid.get('1'), 'tour-agent/tra-backend');
	assert.equal(byPid.get('2'), 'node build');
	assert.equal(byPid.get('3'), 'postgres');
	assert.equal(byPid.get('4'), 'pgadmin4');
});

test('a workspace command line links a MainThread scan row', () => {
	const tra = service({
		name: 'tra-backend',
		host: 'pi1',
		processMatch: '/home/joe/workspace/tour-agent/tra-backend'
	});
	const payload = view({
		services: [tra],
		processes: [
			proc({
				host: 'pi1',
				pid: '9',
				processName: 'MainThread',
				filter: 'user',
				cmdline: '/usr/bin/node /home/joe/workspace/tour-agent/tra-backend/src/server.ts',
				cpuPercent: 4
			})
		]
	});
	assert.equal(payload.services[0]?.cpuPercent, 4);
	assert.equal(payload.processes[0]?.serviceName, 'tra-backend');
	assert.equal(payload.processes[0]?.cmdline, 'tour-agent/tra-backend');
});

test('missing-table cache expires and does not store undefined_column', () => {
	const cache = new Map<string, number>();
	rememberMissingRelation(cache, 'rel', '42703', 1_000);
	assert.equal(cache.size, 0);
	rememberMissingRelation(cache, 'rel', '42P01', 1_000);
	assert.equal(missingRelationRemembered(cache, 'rel', 1_000 + MISSING_RELATION_TTL_MS - 1), true);
	assert.equal(missingRelationRemembered(cache, 'rel', 1_000 + MISSING_RELATION_TTL_MS), false);
	assert.equal(cache.has('rel'), false);
});

test('service table sorts with nulls last and pages without dropping processes', () => {
	const services = [
		service({ name: 'b', host: 'pi2', port: null }),
		service({ name: 'a', host: 'pi1', port: 2 }),
		service({ name: 'c', host: 'pi1', port: 1 })
	];
	const processes = [
		proc({ host: 'pi1', pid: '1', processName: 'a', cpuPercent: 1, memoryRssBytes: 10 }),
		proc({ host: 'pi2', pid: '2', processName: 'b', cpuPercent: null, memoryRssBytes: 50 })
	];
	const byName = view({ query: { order: 'name', dir: 'asc', page: 1, pageSize: 2 }, services, processes });
	assert.deepEqual(
		byName.services.map((row) => row.name),
		['a', 'b']
	);
	assert.equal(byName.servicesTotal, 3);
	assert.equal(byName.page, 1);
	assert.equal(byName.processes.length, 2);

	const byPort = view({ query: { order: 'port', dir: 'asc' }, services });
	assert.deepEqual(
		byPort.services.map((row) => row.name),
		['c', 'a', 'b']
	);
	const byPortDesc = view({ query: { order: 'port', dir: 'desc' }, services });
	assert.deepEqual(
		byPortDesc.services.map((row) => row.name),
		['a', 'c', 'b']
	);

	const past = view({ query: { page: 5, pageSize: 2 }, services });
	assert.equal(past.services.length, 0);
	assert.equal(past.servicesTotal, 3);
	assert.equal(isServicesPayload(past), true);
});

test('service search keeps only rows the SQL flag marked, and ignores the flag when q is absent', () => {
	const services = [
		service({ name: 'keep', host: 'pi1', matchesSearch: true }),
		service({ name: 'drop', host: 'pi2', matchesSearch: false })
	];
	const filtered = view({ query: { q: 'keep' }, services });
	assert.deepEqual(
		filtered.services.map((row) => row.name),
		['keep']
	);
	assert.equal(filtered.servicesTotal, 1);
	assert.equal(filtered.q, 'keep');

	const all = view({ services });
	assert.equal(all.services.length, 2);
	assert.equal(all.q, null);
});

test('status sort is up, unknown, down and a legacy payload shape is rejected', () => {
	const up = view({
		services: [service({ name: 'up', host: 'pi1', healthUrl: 'http://127.0.0.1:1/' })],
		http: [httpRow({ host: 'pi1', server: 'http://127.0.0.1:1/' })]
	}).services[0];
	const down = view({
		services: [service({ name: 'down', host: 'pi1', healthUrl: 'http://127.0.0.1:1/' })],
		http: [httpRow({ host: 'pi1', server: 'http://127.0.0.1:1/', statusCode: 500 })]
	}).services[0];
	const unknown = view({
		services: [service({ name: 'unknown', host: 'pi2' })]
	}).services[0];
	assert.ok(up && down && unknown);
	const ordered = view({
		query: { order: 'status', dir: 'asc' },
		services: [
			service({ name: 'unknown', host: 'pi2' }),
			service({ name: 'down', host: 'pi1', healthUrl: 'http://127.0.0.1:1/' }),
			service({ name: 'up', host: 'pi1', healthUrl: 'http://127.0.0.1:2/' })
		],
		http: [
			httpRow({ host: 'pi1', server: 'http://127.0.0.1:1/', statusCode: 500 }),
			httpRow({ host: 'pi1', server: 'http://127.0.0.1:2/' })
		]
	});
	assert.deepEqual(
		ordered.services.map((row) => row.name),
		['up', 'unknown', 'down']
	);
	assert.equal(up.status, 'up');
	assert.equal(down.status, 'down');
	assert.equal(unknown.status, 'unknown');
	const legacy = { ...ordered, order: undefined, servicesTotal: undefined };
	assert.equal(isServicesPayload(legacy), false);
});
