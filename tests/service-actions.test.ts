import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import type { CatalogAction, Host, HostStatus, ProjectServiceRow, ServiceRuntime } from '../src/lib/api-types.ts';
import type { CatalogRunState } from '../src/lib/project-action.ts';
import { runResultTitle } from '../src/lib/run-actions.ts';
import {
	NO_CONTAINER_NOTE,
	STATE_UNKNOWN_NOTE,
	entryHostIndex,
	keyAfterResult,
	keyForKind,
	notRunningPairs,
	ownerEntry,
	runtimeDetail,
	runtimeFromImageState,
	runtimeFromImageStatus,
	serviceControls,
	statusReader,
	type NotRunningPair,
	type ServiceEntryRef
} from '../src/lib/service-actions.ts';
import CatalogRunResult from '../src/routes/projects/[id]/CatalogRunResult.svelte';
import ServicesSection from '../src/routes/projects/[id]/ServicesSection.svelte';
import { load as projectLoad } from '../src/routes/projects/[id]/+page.server.ts';
import { envelope, fakeEvent, installFetch, PROJECT, restoreEnv, TOKEN, useApi, USER, type FetchCall } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

const HOST_ID = '00000000-0000-4000-8000-0000000000aa';
const OTHER_HOST = '00000000-0000-4000-8000-0000000000ab';
const SERVICE_ID = '00000000-0000-4000-8000-0000000000bb';
const OTHER_SERVICE = '00000000-0000-4000-8000-0000000000bc';
const FOREIGN_PROJECT = '00000000-0000-4000-8000-0000000000ff';
const ALL = ['run', 'stop', 'restart', 'logs', 'status'] as const;

function image(actions: CatalogAction[] = [...ALL], name = 'web'): ServiceEntryRef {
	return { name, kind: 'image', my_actions: actions, runAs: '', shell: false };
}

function program(actions: CatalogAction[] = [...ALL], name = 'api'): ServiceEntryRef {
	return { name, kind: 'program', my_actions: actions, runAs: 'joe', shell: false };
}

function host(id = HOST_ID, name = 'pi1', overrides: Partial<Host> = {}): Host {
	return {
		id,
		project_id: PROJECT.id,
		name,
		node_type: 'pi',
		os: 'linux',
		arch: 'arm64',
		always_on: true,
		agent_version: '1.2.0',
		status: 'online',
		last_seen_at: '2026-10-14T00:00:00Z',
		enrolled_at: '2026-10-13T00:00:00Z',
		revoked_at: null,
		relation: 'owner',
		share_level: null,
		programs: { enabled: true, run_as: ['joe'], allow_shell: false, policy_hash: 'p', images: true, docker: true, files: false, logging: false, health_policy: false },
		...overrides
	};
}

function row(overrides: Partial<ProjectServiceRow> = {}): ProjectServiceRow {
	return {
		id: SERVICE_ID,
		name: 'web',
		source: 'owned',
		kind: 'container',
		ports: [80],
		health: null,
		last_seen_at: '2026-10-14T12:00:00Z',
		gone_at: null,
		display_name: null,
		owner_user: 'root',
		project_id: PROJECT.id,
		host_id: HOST_ID,
		host_name: 'pi1',
		host_status: 'online',
		project_name: 'Lab',
		catalog_entry: 'web',
		container_name: 'deploybot-lab-web',
		image_digest: null,
		checks: [],
		checksMessage: null,
		...overrides
	};
}

const running: ServiceRuntime = { state: 'running', restarts: 0 };

/** Remove tooltip `title` attributes, so a negative text check is about the cell, not a tooltip. */
function stripTitles(html: string): string {
	return html.replace(/\stitle="[^"]*"/g, '');
}

type Expected = {
	stateAction: 'run' | 'stop' | null;
	restart: boolean;
	logs: boolean;
	blockedReason: string | null;
	crashNote: string | null;
} | null;

/**
 * Each state: which grant enables the state button, the blocked reason (needs `run`), whether Restart
 * exists (needs `restart`), and the restart line.
 */
const STATES: Array<{
	label: string;
	host: HostStatus;
	runtime: ServiceRuntime;
	stateBy: 'run' | 'stop' | null;
	blocked: string | null;
	restart: boolean;
	crash: string | null;
}> = [
	{ label: 'running', host: 'online', runtime: runtimeFromImageState('running', 0), stateBy: 'stop', blocked: null, restart: true, crash: null },
	{ label: 'running, 7 restarts', host: 'online', runtime: runtimeFromImageState('running', 7), stateBy: 'stop', blocked: null, restart: true, crash: '7 restarts so far' },
	{ label: 'restarting', host: 'online', runtime: runtimeFromImageState('restarting', 3), stateBy: 'stop', blocked: null, restart: false, crash: 'restarting, 3 restarts' },
	{ label: 'paused', host: 'online', runtime: runtimeFromImageState('paused', 0), stateBy: 'stop', blocked: null, restart: false, crash: null },
	{ label: 'exited', host: 'online', runtime: runtimeFromImageState('exited', 1), stateBy: 'run', blocked: null, restart: false, crash: null },
	{ label: 'created', host: 'online', runtime: runtimeFromImageState('created', 0), stateBy: 'run', blocked: null, restart: false, crash: null },
	{ label: 'dead', host: 'online', runtime: runtimeFromImageState('dead', 0), stateBy: 'run', blocked: null, restart: false, crash: null },
	{ label: 'missing', host: 'online', runtime: runtimeFromImageState('missing', 0), stateBy: null, blocked: NO_CONTAINER_NOTE, restart: false, crash: null },
	{ label: 'unknown', host: 'online', runtime: runtimeFromImageState('unknown', 0), stateBy: null, blocked: STATE_UNKNOWN_NOTE, restart: false, crash: null },
	{ label: 'host offline', host: 'offline', runtime: runtimeFromImageState('running', 9), stateBy: null, blocked: 'Host offline.', restart: false, crash: null }
];

const GRANTS: Record<string, CatalogAction[]> = {
	none: [],
	run: ['run'],
	stop: ['stop'],
	restart: ['restart'],
	logs: ['logs'],
	all: [...ALL]
};

function expected(state: (typeof STATES)[number], grants: CatalogAction[]): Expected {
	if (grants.length === 0) return null;
	const has = (action: CatalogAction) => grants.includes(action);
	return {
		stateAction: state.stateBy != null && has(state.stateBy) ? state.stateBy : null,
		restart: state.restart && has('restart'),
		logs: has('logs'),
		blockedReason: state.blocked != null && has('run') ? state.blocked : null,
		crashNote: state.crash
	};
}

function actual(state: (typeof STATES)[number], grants: CatalogAction[]): Expected {
	const entry = ownerEntry(row(), PROJECT.id, [image(grants)]);
	if (entry == null) return null;
	const controls = serviceControls(entry, state.host, state.runtime);
	return {
		stateAction: controls.stateAction,
		restart: controls.restart,
		logs: controls.logs,
		blockedReason: controls.blockedReason,
		crashNote: controls.crashNote
	};
}

test('controls for every state and grant subset', () => {
	for (const state of STATES) {
		for (const [name, grants] of Object.entries(GRANTS)) {
			assert.deepEqual(actual(state, grants), expected(state, grants), `${state.label} / ${name}`);
		}
	}
	// Start never shows on a running or restarting container, enabled or blocked.
	for (const state of ['running', 'restarting'] as const) {
		const controls = serviceControls(image(), 'online', runtimeFromImageState(state, 0));
		assert.notEqual(controls.stateAction, 'run');
		assert.equal(controls.blockedReason, null);
	}
});

test('the status badge details: Docker state, exit code when stopped, restarts, digest, ports; programs state only', () => {
	const status = (state: 'running' | 'exited' | 'missing', exit: number | null) =>
		runtimeFromImageStatus({
			container: 'deploybot-lab-web',
			state,
			exit_code: exit,
			restart_count: 2,
			started_at: null,
			finished_at: null,
			digest: `sha256:${'a'.repeat(64)}`,
			ports: [80, 443]
		});
	assert.equal(runtimeDetail(status('running', null), 'online'), `Docker running, 2 restarts, sha256:${'a'.repeat(12)}, ports 80, 443.`);
	assert.equal(runtimeDetail(status('exited', 137), 'online'), `Docker exited, exit 137, 2 restarts, sha256:${'a'.repeat(12)}, ports 80, 443.`);
	assert.equal(runtimeDetail(status('missing', null), 'online'), NO_CONTAINER_NOTE);
	assert.equal(runtimeDetail({ state: 'stopped', restarts: null }, 'online'), 'Program stopped.');
	assert.equal(runtimeDetail({ state: 'running', restarts: null }, 'online'), 'Program running.');
	assert.equal(runtimeDetail(running, 'offline'), 'Host offline.');
	assert.equal(runtimeDetail({ state: 'unknown', restarts: null }, 'online'), STATE_UNKNOWN_NOTE);
});

test('status reads are deduplicated per (entry, host) and capped at four at a time', async () => {
	let inFlight = 0;
	let most = 0;
	const reads: string[] = [];
	const read = statusReader(async (entry, hostId) => {
		reads.push(`${entry}@${hostId}`);
		inFlight += 1;
		most = Math.max(most, inFlight);
		await new Promise((resolve) => setTimeout(resolve, 5));
		inFlight -= 1;
		return running;
	}, 4);
	const keys = Array.from({ length: 10 }, (_, index) => [`e${index}`, HOST_ID] as const);
	const results = await Promise.all([...keys, ...keys, ['e0', OTHER_HOST] as const].map(([entry, hostId]) => read(entry, hostId)));
	assert.equal(results.length, 21);
	assert.equal(reads.length, 11);
	assert.equal(new Set(reads).size, 11);
	assert.equal(most, 4);
});

test('the idempotency key renews after any answer and on a kind change', () => {
	let n = 0;
	const fresh = () => `k${++n}`;
	assert.equal(keyAfterResult('k0', { type: 'success', status: 200 }, fresh), 'k1');
	assert.equal(keyAfterResult('k0', { type: 'failure', status: 409 }, fresh), 'k2');
	assert.equal(keyAfterResult('k0', { type: 'error', status: 500 }, fresh), 'k3');
	// No response at all (network error): the same request may be sent again.
	assert.equal(keyAfterResult('k0', { type: 'error' }, fresh), 'k0');
	assert.equal(keyForKind('k0', 'run', 'run', fresh), 'k0');
	assert.equal(keyForKind('k0', 'run', 'stop', fresh), 'k4');
	assert.equal(keyForKind('', null, 'run', fresh), 'k5');
});

test('the not-running list covers programs on hosts that can run them and have no row', () => {
	const index = entryHostIndex([
		{ source: 'owned', kind: 'systemd', gone_at: '2026-10-14T00:00:00Z', catalog_entry: 'api', project_id: PROJECT.id, host_id: HOST_ID },
		{ source: 'discovered', kind: 'systemd', gone_at: null, catalog_entry: null, project_id: PROJECT.id, host_id: OTHER_HOST },
		{ source: 'owned', kind: 'container', gone_at: null, catalog_entry: 'web', project_id: PROJECT.id, host_id: OTHER_HOST }
	]);
	assert.deepEqual(index, { api: [HOST_ID], web: [OTHER_HOST] });
	const hosts = [
		host(),
		host(OTHER_HOST, 'pi2'),
		host('00000000-0000-4000-8000-0000000000ac', 'bare', { programs: null }),
		host('00000000-0000-4000-8000-0000000000ad', 'metrics', { relation: 'shared', share_level: 'metrics' })
	];
	const pairs = notRunningPairs([program(), image(), program(['logs'], 'quiet')], hosts, index);
	assert.deepEqual(
		pairs.map((pair) => `${pair.entry.name}@${pair.host.name}`),
		['api@pi2']
	);
});

describe('services rows', () => {
	function renderSection(rows: ProjectServiceRow[], entries: ServiceEntryRef[], extra: Record<string, unknown> = {}): string {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=services`);
		return render(ServicesSection, {
			props: {
				projectId: PROJECT.id,
				projectName: 'Lab',
				hosts: [host()],
				canAdmin: false,
				rows,
				total: rows.length,
				prevCursor: null,
				nextCursor: null,
				omitted: 0,
				message: null,
				probe: null,
				probeServiceId: null,
				renameServiceId: null,
				typedName: null,
				entries,
				...extra
			}
		}).body;
	}

	function labels(html: string): string[] {
		return [...html.matchAll(/aria-label="([^"]*)"/g)].map((match) => match[1] ?? '');
	}

	const ACTION_LABEL = /^(Start|Stop|Restart|Logs|Status) /;
	// Status is not an action any more; the pattern keeps it so a stray Status button would fail the tests.

	function actions(html: string): string[] {
		return labels(html).filter((label) => ACTION_LABEL.test(label));
	}

	function result(kind: CatalogRunState['kind'], overrides: Partial<CatalogRunState> = {}): CatalogRunState {
		return {
			name: 'web',
			hostId: HOST_ID,
			serviceId: SERVICE_ID,
			kind,
			resultId: '00000000-0000-4000-8000-0000000000e1',
			status: null,
			logs: null,
			message: null,
			...overrides
		};
	}

	test('a running container row has Stop, Restart and Logs in that order', () => {
		assert.deepEqual(actions(renderSection([row({ runtime: running })], [image()])), [
			'Stop web on pi1',
			'Restart web on pi1',
			'Logs web on pi1'
		]);
	});

	test('an exited container row has Start, Logs and Status', () => {
		assert.deepEqual(actions(renderSection([row({ runtime: runtimeFromImageState('exited', 0) })], [image()])), [
			'Start web on pi1',
			'Logs web on pi1'
		]);
	});

	test('a restarting row has Stop, and no restart text in the cell', () => {
		const html = renderSection([row({ runtime: runtimeFromImageState('restarting', 7) })], [image()]);
		assert.deepEqual(actions(html), ['Stop web on pi1', 'Logs web on pi1']);
		assert.equal(stripTitles(html).includes('restarting, 7'), false);
	});

	test('a blocked Start is focusable, aria-disabled, and described by its reason', () => {
		const html = renderSection([row({ host_status: 'offline', runtime: running })], [image()]);
		assert.deepEqual(actions(html), ['Start web on pi1', 'Logs web on pi1']);
		const tag = html.match(/<button\b[^>]*aria-label="Start web on pi1"[^>]*>/)?.[0] ?? '';
		assert.match(tag, /aria-disabled="true"/);
		assert.equal(/\sdisabled(?:[\s=>])/.test(tag), false);
		const describedBy = tag.match(/aria-describedby="([^"]+)"/)?.[1] ?? '';
		assert.notEqual(describedBy, '');
		assert.match(html, new RegExp(`id="${describedBy}"[^>]*>Host offline\\.<`));
		assert.equal(/title="Start web on pi1/.test(html), false);

		// No run grant: nothing in that slot.
		assert.deepEqual(actions(renderSection([row({ host_status: 'offline', runtime: running })], [image(['logs'])])), [
			'Logs web on pi1'
		]);
	});

	test('a gone container that still exists offers Start; a missing one a blocked Start', () => {
		const gone = renderSection([row({ gone_at: '2026-10-14T00:00:00Z', runtime: runtimeFromImageState('exited', 0) })], [image()]);
		assert.equal(actions(gone).includes('Start web on pi1'), true);
		assert.equal(gone.includes(NO_CONTAINER_NOTE), false);
		const missing = renderSection([row({ runtime: runtimeFromImageState('missing', 0) })], [image()]);
		assert.match(missing, new RegExp(`>${NO_CONTAINER_NOTE.replaceAll('.', '\\.')}<`));
	});

	test('no grant means no button, and discovered or foreign rows have none', () => {
		assert.deepEqual(actions(renderSection([row({ runtime: running })], [image(['logs'])])), ['Logs web on pi1']);
		const none = renderSection(
			[
				row({ source: 'discovered', catalog_entry: null, name: 'nginx' }),
				row({ id: OTHER_SERVICE, project_id: FOREIGN_PROJECT, project_name: 'Other', runtime: running })
			],
			[image()]
		);
		assert.deepEqual(actions(none), []);
		assert.deepEqual(actions(renderSection([row({ runtime: running })], [])), []);
	});

	test('the status badge of an owned row is a focusable button described by the live details', () => {
		const live = runtimeFromImageStatus({
			container: 'deploybot-lab-web',
			state: 'running',
			exit_code: null,
			restart_count: 0,
			started_at: null,
			finished_at: null,
			digest: null,
			ports: [80]
		});
		const html = renderSection([row({ runtime: live })], [image()]);
		const tag = html.match(/<button\b[^>]*aria-describedby="([^"]+)"[^>]*>(?:(?!<\/button>)[\s\S])*text-status-unknown/)?.[0] ?? '';
		assert.notEqual(tag, '');
		const id = tag.match(/aria-describedby="([^"]+)"/)?.[1] ?? '';
		assert.match(html, new RegExp(`id="${id}"[^>]*>Docker running, 0 restarts, ports 80\\.<`));
		// A discovered row keeps the plain badge.
		const plain = renderSection([row({ source: 'discovered', catalog_entry: null })], [image()]);
		assert.equal(/aria-describedby/.test(plain), false);
	});

	test('a container whose state is not read yet says checking', () => {
		const html = renderSection([row()], [image()]);
		assert.deepEqual(actions(html), []);
		assert.match(html, /data-row-checking[^>]*>checking…</);
	});

	test('narrow and wide layouts render exactly one control set per row', () => {
		for (const layout of ['narrow', 'wide'] as const) {
			const html = renderSection(
				[row({ runtime: running }), row({ id: OTHER_SERVICE, host_id: OTHER_HOST, host_name: 'pi2', runtime: running })],
				[image()],
				{ layout }
			);
			for (const hostName of ['pi1', 'pi2']) {
				assert.equal(actions(html).filter((label) => label === `Stop web on ${hostName}`).length, 1, `${layout} ${hostName}`);
				assert.equal(actions(html).filter((label) => label === `Logs web on ${hostName}`).length, 1, `${layout} ${hostName}`);
			}
		}
	});

	test('a Start result on a row that now runs opens on Stop and shows the result view', () => {
		const started = result('run', { status: { container: 'deploybot-lab-web', state: 'running', exit_code: null, restart_count: 0, started_at: null, finished_at: null, digest: null, ports: [] } });
		const html = renderSection(
			[row({ runtime: running }), row({ id: OTHER_SERVICE, host_id: OTHER_HOST, host_name: 'pi2', runtime: running })],
			[image()],
			{ runResult: started }
		);
		// The row's trigger follows the new state (Stop) and its dialog is open with the result.
		assert.match(html, /aria-label="Stop web on pi1"[^>]*aria-expanded="true"|aria-expanded="true"[^>]*aria-label="Stop web on pi1"/);
		// Routed by service id: the other row on another host stays closed.
		assert.match(html, /aria-label="Stop web on pi2"[^>]*aria-expanded="false"|aria-expanded="false"[^>]*aria-label="Stop web on pi2"/);
		assert.equal(runResultTitle(started, 'web'), 'Started web');
		assert.equal(runResultTitle(result('stop', { message: 'boom' }), 'web'), 'Stop web failed');
		const view = render(CatalogRunResult, {
			props: { result: started, close: createRawSnippet(() => ({ render: () => '<button type="button">Close</button>' })) }
		}).body;
		assert.match(view, /role="status"[^>]*>deploybot-lab-web running/);
		assert.equal(view.includes('type="submit"'), false);
		assert.equal(view.includes('Stop'), false);
		assert.equal([...view.matchAll(/<button\b/g)].length, 1);
	});

	test('a result for the same entry on another row of the same host does not open it', () => {
		const html = renderSection(
			[row({ runtime: running }), row({ id: OTHER_SERVICE, runtime: running })],
			[image()],
			{ runResult: result('stop', { serviceId: OTHER_SERVICE, message: 'boom' }) }
		);
		const tags = [...html.matchAll(/<button\b[^>]*aria-label="Stop web on pi1"[^>]*>/g)].map((match) => match[0]);
		assert.equal(tags.length, 2);
		assert.deepEqual(tags.map((tag) => tag.includes('aria-expanded="true"')), [false, true]);
	});

	test('a program that never ran gets a not-running item with Start only', () => {
		const pair: NotRunningPair = { entry: program(), host: host(OTHER_HOST, 'pi2') };
		const html = renderSection([], [program()], { notRunning: [pair] });
		assert.match(html, /Catalog programs not running yet/);
		assert.match(stripTitles(html), /api on <a[^>]*>pi2<\/a>/);
		assert.deepEqual(actions(html), ['Start api on pi2']);
		const unknown = renderSection([], [program()], { notRunningKnown: false });
		assert.match(unknown, /Programs that never ran on a host could not be listed\./);
		assert.equal(renderSection([], [program()]).includes('Catalog programs not running yet'), false);
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=services&services.q=api`);
		const searching = render(ServicesSection, {
			props: {
				projectId: PROJECT.id,
				projectName: 'Lab',
				hosts: [host()],
				canAdmin: false,
				rows: [],
				total: 0,
				prevCursor: null,
				nextCursor: null,
				omitted: 0,
				message: null,
				probe: null,
				probeServiceId: null,
				renameServiceId: null,
				typedName: null,
				entries: [program()],
				notRunning: [pair]
			}
		}).body;
		assert.equal(searching.includes('Catalog programs not running yet'), false);
	});
});

describe('services load for row actions', { concurrency: false }, () => {
	const originalFetch = globalThis.fetch;

	before(() => {
		useApi('https://api.test');
	});

	after(() => {
		globalThis.fetch = originalFetch;
		restoreEnv();
	});

	function catalogItem(name: string, kind: 'image' | 'program', actions: string[] = [...ALL]) {
		const base = {
			id: kind === 'image' ? '00000000-0000-4000-8000-0000000000c1' : '00000000-0000-4000-8000-0000000000c2',
			project_id: PROJECT.id,
			name,
			kind,
			spec_hash: 'ab'.repeat(32),
			command_display: name,
			created_by: USER.id,
			created_at: '2026-10-14T00:00:00Z',
			updated_at: '2026-10-14T00:00:00Z',
			my_actions: actions
		};
		if (kind === 'program') {
			return { ...base, spec: { dir: '/srv', exec: 'npm', args: [], shell: false, run_as: 'joe', env: {}, port: null, restart: 'on-failure' } };
		}
		return {
			...base,
			spec: {
				kind: 'service',
				image: 'ghcr.io/acme/web:1',
				command: null,
				entrypoint: null,
				ports: [],
				env: {},
				env_sets: [],
				secret_env: {},
				volumes: [],
				files: [],
				restart: 'unless-stopped',
				user: '',
				healthy_after_sec: 30,
				memory_mb: null,
				timeout_sec: 600,
				healthcheck: null,
				logging: null,
				health_policy: null
			}
		};
	}

	function serviceItem(overrides: Record<string, unknown> = {}) {
		return {
			id: SERVICE_ID,
			name: 'web',
			source: 'owned',
			kind: 'container',
			ports: [],
			health: null,
			host_id: HOST_ID,
			host_name: 'pi1',
			host_status: 'online',
			project_id: PROJECT.id,
			project_name: 'Lab',
			catalog_entry: 'web',
			gone_at: null,
			health_checks: [],
			...overrides
		};
	}

	function page(items: unknown[], next: string | null = null) {
		return { items, total: items.length, next_cursor: next, prev_cursor: null };
	}

	function apiHost(id: string, name: string) {
		const { programs, ...rest } = host(id, name);
		return { ...rest, programs: { ...programs, docker: true } };
	}

	async function load(options: {
		items: unknown[];
		catalog: unknown[];
		state?: string;
		index?: () => Response;
	}): Promise<{ data: Record<string, unknown>; calls: FetchCall[] }> {
		const calls = installFetch((call: FetchCall) => {
			const path = call.url.pathname;
			if (path === `/v1/projects/${PROJECT.id}`) return envelope(PROJECT);
			if (path === `/v1/projects/${PROJECT.id}/hosts`) return envelope({ items: [apiHost(HOST_ID, 'pi1'), apiHost(OTHER_HOST, 'pi2')], next_cursor: null });
			if (path === `/v1/projects/${PROJECT.id}/catalog`) return envelope({ items: options.catalog, next_cursor: null });
			if (path === `/v1/projects/${PROJECT.id}/services`) {
				if (call.url.searchParams.get('limit') === '200') return options.index ? options.index() : envelope(page(options.items));
				return envelope(page(options.items));
			}
			if (path.endsWith('/status')) {
				return envelope({
					container: 'deploybot-lab-web',
					state: options.state ?? 'running',
					exit_code: null,
					restart_count: 3,
					started_at: null,
					finished_at: null,
					digest: null,
					ports: []
				});
			}
			return envelope(null, 500, 'error', path);
		});
		const data = (await projectLoad(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=services`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id }
			}).event as never
		)) as Record<string, unknown>;
		return { data, calls };
	}

	test('a live owned container reads its state with catalog status on its host', async () => {
		const { data, calls } = await load({ items: [serviceItem()], catalog: [catalogItem('web', 'image')], state: 'exited' });
		const status = calls.filter((call) => call.url.pathname.endsWith('/status'));
		assert.equal(status.length, 1);
		assert.equal(status[0]?.url.pathname, `/v1/projects/${PROJECT.id}/catalog/web/status`);
		assert.equal(status[0]?.method, 'POST');
		assert.equal(status[0]?.body, JSON.stringify({ host_id: HOST_ID }));
		// The state is streamed: the row has none yet, the promise maps its service id to it.
		const rows = data.services as ProjectServiceRow[];
		assert.equal(rows[0]?.runtime, undefined);
		assert.deepEqual(await (data.serviceStates as Promise<Record<string, ServiceRuntime>>), { [SERVICE_ID]: { state: 'stopped', restarts: 3, container: { state: 'exited', exitCode: null, digest: null, ports: [] } } });
		assert.equal((data.serviceEntries as ServiceEntryRef[])[0]?.name, 'web');
		assert.equal(data.serviceEntriesMessage, null);
	});

	test('a gone container is read too; programs, offline hosts and other projects are not', async () => {
		const { data, calls } = await load({
			items: [
				serviceItem({ id: '00000000-0000-4000-8000-0000000000b1', kind: 'systemd', catalog_entry: 'api', name: 'api', gone_at: '2026-10-14T00:00:00Z' }),
				serviceItem({ id: '00000000-0000-4000-8000-0000000000b2', gone_at: '2026-10-14T00:00:00Z' }),
				serviceItem({ id: '00000000-0000-4000-8000-0000000000b3', host_status: 'offline' }),
				serviceItem({ id: '00000000-0000-4000-8000-0000000000b4', project_id: FOREIGN_PROJECT, project_name: 'Other' }),
				serviceItem({ id: '00000000-0000-4000-8000-0000000000b5', source: 'discovered', catalog_entry: null })
			],
			catalog: [catalogItem('web', 'image'), catalogItem('api', 'program')]
		});
		const states = await (data.serviceStates as Promise<Record<string, ServiceRuntime>>);
		assert.equal(calls.filter((call) => call.url.pathname.endsWith('/status')).length, 1);
		assert.deepEqual(states, { '00000000-0000-4000-8000-0000000000b2': { state: 'running', restarts: 3, container: { state: 'running', exitCode: null, digest: null, ports: [] } } });
		const runtimes = (data.services as ProjectServiceRow[]).map((item) => item.runtime);
		assert.deepEqual(runtimes, [
			{ state: 'stopped', restarts: null },
			undefined,
			{ state: 'unknown', restarts: null },
			undefined,
			undefined
		]);
	});

	test('two rows of one copy share one status read', async () => {
		const { data, calls } = await load({
			items: [serviceItem(), serviceItem({ id: OTHER_SERVICE, gone_at: '2026-10-14T00:00:00Z' })],
			catalog: [catalogItem('web', 'image')]
		});
		const states = await (data.serviceStates as Promise<Record<string, ServiceRuntime>>);
		assert.equal(calls.filter((call) => call.url.pathname.endsWith('/status')).length, 1);
		assert.deepEqual(Object.keys(states).sort(), [SERVICE_ID, OTHER_SERVICE].sort());
	});

	test('a program with a run grant and a host without its row is listed as not running', async () => {
		const { data, calls } = await load({
			items: [serviceItem({ kind: 'systemd', catalog_entry: 'api', name: 'api', gone_at: '2026-10-14T00:00:00Z' })],
			catalog: [catalogItem('api', 'program')]
		});
		const index = calls.find((call) => call.url.pathname.endsWith('/services') && call.url.searchParams.get('limit') === '200');
		assert.equal(index?.url.searchParams.get('view'), 'deploybot');
		const pairs = data.notRunning as NotRunningPair[];
		assert.deepEqual(pairs.map((pair) => `${pair.entry.name}@${pair.host.name}`), ['api@pi2']);
		assert.equal(data.notRunningKnown, true);

		const partial = await load({
			items: [],
			catalog: [catalogItem('api', 'program')],
			index: () => envelope(page([serviceItem()], 'more'))
		});
		assert.equal(partial.data.notRunningKnown, false);
		assert.deepEqual(partial.data.notRunning, []);

		const imagesOnly = await load({ items: [], catalog: [catalogItem('web', 'image')] });
		assert.equal(imagesOnly.calls.some((call) => call.url.pathname.endsWith('/services') && call.url.searchParams.get('limit') === '200'), false);
	});

	test('a failed catalog read leaves rows without actions and says so', async () => {
		const calls = installFetch((call: FetchCall) => {
			const path = call.url.pathname;
			if (path === `/v1/projects/${PROJECT.id}`) return envelope(PROJECT);
			if (path === `/v1/projects/${PROJECT.id}/hosts`) return envelope({ items: [], next_cursor: null });
			if (path === `/v1/projects/${PROJECT.id}/services`) return envelope(page([serviceItem()]));
			return envelope(null, 500, 'error', 'boom');
		});
		const data = (await projectLoad(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=services`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id }
			}).event as never
		)) as Record<string, unknown>;
		assert.deepEqual(await (data.serviceStates as Promise<unknown>), {});
		assert.equal(calls.some((call) => call.url.pathname.endsWith('/status')), false);
		assert.equal((data.services as ProjectServiceRow[])[0]?.runtime, undefined);
		assert.match(String(data.serviceEntriesMessage), /could not be read/);
		assert.equal(data.servicesMessage, null);
	});
});
