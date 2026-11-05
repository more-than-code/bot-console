import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { render } from 'svelte/server';
import type { CatalogAction, Host, ImageDeploy, ImageEntry, ProjectServiceRow } from '../src/lib/api-types.ts';
import type { ImageDeployState } from '../src/lib/project-action.ts';
import { processServiceHref, serviceLogsHref } from '../src/lib/service-label.ts';
import {
	CATALOG_LOGS_PARAM,
	dropServiceLogs,
	serviceFilterKey,
	serviceLogsEntry,
	serviceLogsMissingNote,
	serviceLogsRow,
	serviceLogsStep,
	withoutServiceLogs
} from '../src/lib/service-view.ts';
import { filterHref, hostFilterHiddenFields, pageHrefKeepingAll, rowPage, searchHiddenFields, sortHref, tableHref, type Column } from '../src/lib/table.ts';
import { openOnRequest } from '../src/lib/log-view.ts';
import CatalogDeployForm from '../src/routes/projects/[id]/CatalogDeployForm.svelte';
import LogsDrawer from '../src/routes/projects/[id]/LogsDrawer.svelte';
import { actionUrlFrom, backTo, onPlainClick, permissionsCloseHrefFor, permissionsOpenFields } from '../src/lib/url.ts';
import { actions as projectActions } from '../src/routes/projects/[id]/+page.server.ts';
import { envelope, fakeEvent, installFetch, PROJECT, restoreEnv, TOKEN, useApi, USER } from './harness.ts';
import { imageCatalogEntry, renderCopies } from './copies.ts';
import { replaceState, replaceStateCalls } from './stubs/app-navigation.ts';
import { setPageUrl } from './stubs/app-state.ts';

const HOST_ID = '00000000-0000-4000-8000-0000000000aa';
const OTHER_HOST = '00000000-0000-4000-8000-0000000000ab';
const SERVICE_ID = '00000000-0000-4000-8000-0000000000bb';
const SECOND_ID = '00000000-0000-4000-8000-0000000000bc';
const OTHER_PROJECT = '00000000-0000-4000-8000-000000000099';
const ALL: CatalogAction[] = ['deploy', 'run', 'stop', 'restart', 'logs'];

function host(id = HOST_ID, name = 'pi1'): Host {
	return {
		id,
		project_id: PROJECT.id,
		name,
		node_type: 'pi',
		os: 'linux',
		arch: 'arm64',
		always_on: true,
		agent_version: '0.2.5',
		status: 'online',
		last_seen_at: '2026-10-14T00:00:00Z',
		enrolled_at: '2026-10-13T00:00:00Z',
		revoked_at: null,
		relation: 'owner',
		share_level: null,
		programs: null
	};
}

function row(overrides: Partial<ProjectServiceRow> = {}): ProjectServiceRow {
	return {
		id: SERVICE_ID,
		name: 'deploybot-lab-web',
		source: 'owned',
		kind: 'container',
		ports: [8080],
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
		container_name: 'web-1',
		image_digest: null,
		checks: [],
		checksMessage: null,
		runtime: { state: 'running', restarts: 0 },
		...overrides
	};
}

function catalogUrl(params: Record<string, string>): string {
	return `http://console.example/projects/${PROJECT.id}?${new URLSearchParams({ tab: 'catalog', ...params }).toString()}`;
}

/** The tab with entry `web` (every grant) and these copies. */
function renderServices(url: string, rows: ProjectServiceRow[], extra: Record<string, unknown> = {}): string {
	return renderCopies({
		rows,
		url,
		hosts: [host(), host(OTHER_HOST, 'pi2')],
		entries: [imageCatalogEntry('web', ALL)],
		...extra
	});
}

/** The opening tag of one copy row. */
function rowTag(html: string, id: string): string {
	const match = new RegExp(`<tr[^>]*id="service-${id}"[^>]*>`).exec(html);
	assert.ok(match, `row ${id} rendered`);
	return match[0];
}

/** The Logs button of one row: its trigger says whether the drawer is open. */
function logsButton(html: string, hostName = 'pi1'): string {
	const match = new RegExp(`<button[^>]*aria-label="Logs web on ${hostName}"[^>]*>`).exec(html);
	assert.ok(match, 'Logs button rendered');
	return match[0];
}

describe('catalog.logs link helpers', () => {
	test('serviceLogsHref is the tab link for that host and entry plus catalog.logs', () => {
		const href = serviceLogsHref(PROJECT.id, HOST_ID, 'web');
		assert.equal(href, `/projects/${PROJECT.id}?tab=catalog&catalog.host=${HOST_ID}&catalog.q=web&catalog.logs=web`);
		assert.equal(href.startsWith(`${processServiceHref(PROJECT.id, HOST_ID, 'web')}&`), true);
		const url = new URL(href, 'http://console.example');
		assert.equal(url.searchParams.get(CATALOG_LOGS_PARAM), 'web');
	});

	test('serviceLogsEntry accepts catalog names only', () => {
		assert.equal(serviceLogsEntry('web'), 'web');
		assert.equal(serviceLogsEntry('my-app-2'), 'my-app-2');
		assert.equal(serviceLogsEntry(null), null);
		assert.equal(serviceLogsEntry(''), null);
		assert.equal(serviceLogsEntry('Web'), null);
		assert.equal(serviceLogsEntry('-web'), null);
		assert.equal(serviceLogsEntry('web app'), null);
		assert.equal(serviceLogsEntry(`a${'b'.repeat(48)}`), null);
	});

	test('serviceLogsRow matches entry, host, and this project only', () => {
		const mine = row();
		const otherHost = row({ id: SECOND_ID, host_id: OTHER_HOST });
		const otherProject = row({ id: SECOND_ID, project_id: OTHER_PROJECT });
		const request = { entry: 'web', hostId: HOST_ID };
		assert.equal(serviceLogsRow([otherHost, mine], request, PROJECT.id)?.id, SERVICE_ID);
		assert.equal(serviceLogsRow([otherHost], request, PROJECT.id), null);
		assert.equal(serviceLogsRow([otherProject], request, PROJECT.id), null);
		assert.equal(serviceLogsRow([row({ catalog_entry: null })], request, PROJECT.id), null);
	});

	test('withoutServiceLogs drops only catalog.logs', () => {
		const url = new URL(catalogUrl({ 'catalog.host': HOST_ID, 'catalog.q': 'web', 'catalog.logs': 'web', 'catalog.kind': 'service' }));
		const next = new URL(withoutServiceLogs(url), 'http://console.example');
		assert.equal(next.searchParams.has(CATALOG_LOGS_PARAM), false);
		assert.equal(next.searchParams.get('catalog.host'), HOST_ID);
		assert.equal(next.searchParams.get('catalog.q'), 'web');
		assert.equal(next.searchParams.get('catalog.kind'), 'service');
		assert.equal(next.searchParams.get('tab'), 'catalog');
	});

	test('table links, filter forms and the Permissions drawer never carry catalog.logs on', () => {
		// After use the param leaves the address bar, but `page.url` keeps it, so every link must drop it.
		const url = new URL(catalogUrl({ 'catalog.host': HOST_ID, 'catalog.q': 'web', 'catalog.logs': 'web' }));
		const names = (fields: Array<{ name: string }>) => fields.map((field) => field.name);
		assert.equal(names(hostFilterHiddenFields(url.searchParams, 'catalog')).includes(CATALOG_LOGS_PARAM), false);
		assert.equal(names(searchHiddenFields(url.searchParams, 'catalog')).includes(CATALOG_LOGS_PARAM), false);
		assert.equal(names(permissionsOpenFields(url, 'web')).includes(CATALOG_LOGS_PARAM), false);
		assert.equal(permissionsCloseHrefFor(url).includes('catalog.logs'), false);
		assert.equal(tableHref(url, 'catalog', { page: 2 }).includes('catalog.logs'), false);
		assert.equal(sortHref(url, 'catalog', { key: 'name' }, { sort: null, dir: 'asc' }).includes('catalog.logs'), false);
		assert.equal(filterHref(url, 'catalog', 'kind', 'service').includes('catalog.logs'), false);
		assert.equal(tableHref(url, 'catalog', { page: 2 }).includes(`catalog.host=${HOST_ID}`), true);
		assert.equal(serviceLogsMissingNote('web'), "web isn't listed on this host yet. Refresh in a moment.");
	});
});

describe('catalog.logs after use', () => {
	const linked = new URL(catalogUrl({ 'catalog.host': HOST_ID, 'catalog.q': 'web', 'catalog.logs': 'web' }));
	const path = `/projects/${PROJECT.id}`;

	test('action URLs and the redirect after an action drop catalog.logs and keep the rest', () => {
		const action = actionUrlFrom(linked, 'rename');
		assert.equal(action.includes('catalog.logs'), false);
		assert.equal(action.includes(`catalog.host=${HOST_ID}`), true);
		assert.equal(action.endsWith('&/rename'), true);
		const posted = new URL(`http://console.example${path}?${linked.searchParams.toString()}&/rename`);
		const back = backTo(posted);
		assert.equal(back.includes('catalog.logs'), false);
		assert.equal(back, `${path}?tab=catalog&catalog.host=${HOST_ID}&catalog.q=web`);
	});

	test('the step waits for the row state and its rendered row, then opens and clears once', () => {
		const here = { page: 1, currentPage: 1, rendered: true };
		assert.equal(serviceLogsStep({ done: false, rowId: null, controls: null, ...here }), 'none');
		assert.equal(serviceLogsStep({ done: false, rowId: SERVICE_ID, controls: 'checking', ...here }), 'wait');
		assert.equal(serviceLogsStep({ done: false, rowId: SERVICE_ID, controls: { logs: true }, ...here }), 'open-and-clear');
		// No grant for any action: still selected and cleared, no drawer.
		assert.equal(serviceLogsStep({ done: false, rowId: SERVICE_ID, controls: null, ...here }), 'open-and-clear');
		assert.equal(serviceLogsStep({ done: true, rowId: SERVICE_ID, controls: { logs: true }, ...here }), 'none');
		// The request is used only once the copy's row is on screen.
		assert.equal(serviceLogsStep({ done: false, rowId: SERVICE_ID, controls: { logs: true }, ...here, rendered: false }), 'wait');
		// On another table page: switch to it (the request stays); filtered out: the not-listed note.
		assert.equal(serviceLogsStep({ done: false, rowId: SERVICE_ID, controls: 'checking', ...here, page: 2 }), 'go-to-page');
		assert.equal(serviceLogsStep({ done: false, rowId: SERVICE_ID, controls: { logs: true }, ...here, page: null }), 'hidden');
	});

	test('the page switch keeps catalog.logs and every other param', () => {
		const url = new URL(catalogUrl({ 'catalog.host': HOST_ID, 'catalog.q': 'web', 'catalog.logs': 'web', 'catalog.page': '1' }));
		assert.equal(
			pageHrefKeepingAll(url, 'catalog', 2),
			`/projects/${PROJECT.id}?tab=catalog&catalog.host=${HOST_ID}&catalog.q=web&catalog.logs=web&catalog.page=2`
		);
		assert.equal(pageHrefKeepingAll(url, 'catalog', 1), `/projects/${PROJECT.id}?tab=catalog&catalog.host=${HOST_ID}&catalog.q=web&catalog.logs=web`);
	});

	test('rowPage finds the table page of a row after filters, search and sort', () => {
		type Item = { name: string; kind: string };
		const columns: Column<Item>[] = [
			{ key: 'name', label: 'Name', sortable: true, searchable: true, value: (item) => item.name },
			{ key: 'kind', label: 'Kind', value: (item) => item.kind, filter: { param: 'kind', label: 'Kind', options: [{ value: 'a', label: 'As' }], value: (item) => item.kind } }
		];
		const items: Item[] = Array.from({ length: 30 }, (_, n) => ({ name: `web-${String(n).padStart(2, '0')}`, kind: n === 27 ? 'b' : 'a' }));
		const at = (query: string, name: string) =>
			rowPage(items, columns, new URLSearchParams(query), 't', { sort: 'name', dir: 'asc' }, 25, (item) => item.name === name);
		assert.deepEqual(at('', 'web-26'), { page: 2, current: 1 });
		assert.deepEqual(at('t.page=2', 'web-26'), { page: 2, current: 2 });
		assert.deepEqual(at('t.dir=desc', 'web-26'), { page: 1, current: 1 });
		assert.deepEqual(at('t.kind=a', 'web-27'), { page: null, current: 1 });
		assert.deepEqual(at('t.q=web-03', 'web-26'), { page: null, current: 1 });
	});

	test('dropServiceLogs replaces once with the URL without catalog.logs', () => {
		replaceStateCalls.length = 0;
		assert.equal(dropServiceLogs(linked, path, 'web', replaceState), true);
		assert.deepEqual(replaceStateCalls, [`${path}?tab=catalog&catalog.host=${HOST_ID}&catalog.q=web`]);
		// Already gone, another entry, or another page: no call.
		const cleared = new URL(`http://console.example${replaceStateCalls[0]}`);
		assert.equal(dropServiceLogs(cleared, path, 'web', replaceState), false);
		assert.equal(dropServiceLogs(linked, path, 'api', replaceState), false);
		assert.equal(dropServiceLogs(linked, '/projects/other', 'web', replaceState), false);
		assert.equal(replaceStateCalls.length, 1);
		// A throwing replace is swallowed.
		assert.equal(
			dropServiceLogs(linked, path, 'web', () => {
				throw new Error('router not started');
			}),
			false
		);
		replaceStateCalls.length = 0;
	});

	test('the filter key changes with search, host, page, or Kind, and not with catalog.logs or sort', () => {
		const key = serviceFilterKey(linked.searchParams);
		const changed = (name: string, value: string) => {
			const params = new URLSearchParams(linked.searchParams);
			params.set(name, value);
			return serviceFilterKey(params);
		};
		assert.notEqual(changed('catalog.q', 'api'), key);
		assert.notEqual(changed('catalog.host', OTHER_HOST), key);
		assert.notEqual(changed('catalog.page', '2'), key);
		assert.notEqual(changed('catalog.kind', 'job'), key);
		assert.equal(changed('catalog.sort', 'name'), key);
		const without = new URLSearchParams(linked.searchParams);
		without.delete('catalog.logs');
		assert.equal(serviceFilterKey(without), key);
	});
});

describe('Catalog Deploy dialog link', () => {
	const entry: ImageEntry = {
		name: 'web',
		kind: 'image',
		my_actions: ALL,
		spec: {
			kind: 'service',
			image: 'docker.io/library/nginx:1.27',
			user: 'root',
			ports: [],
			env: [],
			env_sets: [],
			files: [],
			healthcheck: null,
			healthy_after_sec: 30,
			health_policy: { mode: 'keep_running' },
			logging: null
		}
	} as unknown as ImageEntry;

	function deployRow(outcome: string): ImageDeploy {
		return {
			id: '00000000-0000-4000-8000-0000000000e1',
			outcome,
			digest: `sha256:${'ab'.repeat(32)}`,
			exit_code: 0
		} as unknown as ImageDeploy;
	}

	function result(overrides: Partial<ImageDeployState> = {}): ImageDeployState {
		return {
			name: 'web',
			resultId: '00000000-0000-4000-8000-0000000000e9',
			hostId: HOST_ID,
			workload: 'service',
			waitSec: 30,
			outcome: deployRow('succeeded'),
			status: { container: 'web-1', state: 'running', digest: null } as ImageDeployState['status'],
			lines: ['ready'],
			history: [],
			confirmation: null,
			confirmKind: null,
			message: null,
			...overrides
		};
	}

	function deployHtml(props: Record<string, unknown>): string {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		return render(CatalogDeployForm, {
			props: {
				entry,
				hosts: [host()],
				deployAction: '?/catalogDeploy',
				rollbackAction: '?/catalogRollback',
				removeAction: '?/catalogRemove',
				confirmAction: '?/catalogConfirm',
				historyAction: '?/catalogDeploys',
				projectId: PROJECT.id,
				...props
			}
		}).body;
	}

	test('a result on a host links to that copy and its logs on the same tab', () => {
		const html = deployHtml({ result: result() });
		assert.match(html, />View logs<\/a>/);
		assert.equal(html.includes('in Services'), false);
		const href = serviceLogsHref(PROJECT.id, HOST_ID, 'web').replaceAll('&', '&amp;');
		assert.match(html, new RegExp(`<a[^>]*href="${href.replace(/[.?]/g, '\\$&')}"[^>]*data-sveltekit-preload-data="off"`));
	});

	/** Runs a real catalog action against a fake API and returns the dialog state it renders. */
	async function actionState(
		action: 'catalogRollback' | 'catalogRemove' | 'catalogDeploy',
		answer: (path: string) => Response | Promise<Response> | null
	): Promise<ImageDeployState> {
		installFetch((call) => {
			if (call.url.pathname.endsWith('/deploys')) return envelope({ items: [] });
			return answer(call.url.pathname) ?? envelope(null, 500, 'error', call.url.pathname);
		});
		const form: Record<string, string> = { name: 'web', host_id: HOST_ID, workload: 'service', wait_sec: '30', idempotency_key: 'logs-key-1' };
		if (action === 'catalogRollback') form.digest = `sha256:${'b'.repeat(64)}`;
		const out = (await projectActions[action](
			fakeEvent({
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/${action}`,
				form
			}).event as never
		)) as { imageDeploy?: ImageDeployState };
		assert.ok(out.imageDeploy, `${action} returned a dialog state: ${JSON.stringify(out)}`);
		return out.imageDeploy;
	}

	const statusBody = { container: 'web', state: 'running', exit_code: null, restart_count: 0, started_at: '2026-10-14T00:00:00Z', finished_at: null, digest: `sha256:${'b'.repeat(64)}`, ports: [] };
	const rollbackBody = {
		deploy: {
			id: '00000000-0000-4000-8000-0000000000e2',
			entry_id: '00000000-0000-4000-8000-0000000000c1',
			host_id: HOST_ID,
			digest: `sha256:${'b'.repeat(64)}`,
			spec_hash: 'ab'.repeat(32),
			outcome: 'succeeded',
			exit_code: 0,
			started_at: '2026-10-14T00:00:00Z',
			finished_at: '2026-10-14T00:01:00Z',
			by: USER.id,
			via: 'console'
		},
		status: statusBody,
		lines: ['rolled back']
	};

	describe('with the API', { concurrency: false }, () => {
		const originalFetch = globalThis.fetch;
		before(() => useApi('https://api.test'));
		after(() => {
			globalThis.fetch = originalFetch;
			restoreEnv();
		});

		test('a finished rollback links to the copy', async () => {
			const state = await actionState('catalogRollback', (path) => (path.endsWith('/rollback') ? envelope(rollbackBody) : null));
			assert.equal(state.outcome?.outcome, 'succeeded');
			assert.equal(deployHtml({ result: state }).includes('View logs'), true);
		});

		test('a pending confirmation has no link', async () => {
			const state = await actionState('catalogDeploy', (path) =>
				path.endsWith('/deploy')
					? envelope({ confirmation_id: 'A'.repeat(43), plan: 'Deploy web on pi1', expires_at: '2026-10-14T00:00:00Z' })
					: null
			);
			assert.notEqual(state.confirmation, null);
			assert.equal(deployHtml({ result: state }).includes('View logs'), false);
			// Even next to an outcome, a pending confirmation gets no link.
			assert.equal(deployHtml({ result: { ...state, outcome: rollbackBody.deploy as ImageDeploy } }).includes('View logs'), false);
		});

		test('a remove result has no link', async () => {
			const state = await actionState('catalogRemove', (path) => (path.endsWith('/remove') ? envelope({ status: { ...statusBody, state: 'missing' } }) : null));
			assert.equal(state.outcome, null);
			assert.notEqual(state.status, null);
			assert.equal(deployHtml({ result: state }).includes('View logs'), false);
		});
	});

	test('no link before a result, without a host, without a project, or in flight', () => {
		assert.equal(deployHtml({ result: null }).includes('View logs'), false);
		assert.equal(deployHtml({ result: result({ hostId: '' }) }).includes('View logs'), false);
		assert.equal(deployHtml({ result: result(), projectId: null }).includes('View logs'), false);
		assert.equal(deployHtml({ result: result(), inFlight: 'deploy' }).includes('View logs'), false);
	});

	test('a plain click closes the dialog; a modified or handled click does not', () => {
		let closed = 0;
		const handler = onPlainClick(() => (closed += 1));
		const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
		handler(click);
		assert.equal(closed, 1);
		for (const other of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
			handler({ ...click, ...other });
		}
		assert.equal(closed, 1);
		assert.doesNotThrow(() => onPlainClick(undefined)(click));
		const page = readFileSync(new URL('../src/routes/projects/[id]/+page.svelte', import.meta.url), 'utf8');
		assert.match(page, /projectId=\{data\.project\.id\}/);
	});
});

describe('Catalog & services tab with catalog.logs', () => {
	const linked = catalogUrl({ 'catalog.host': HOST_ID, 'catalog.q': 'web', 'catalog.logs': 'web' });

	test('the matching row is selected and its Logs drawer starts open', () => {
		const html = renderServices(linked, [row()]);
		const tag = rowTag(html, SERVICE_ID);
		assert.match(tag, /aria-current="true"/);
		assert.match(tag, /data-state="selected"/);
		assert.match(tag, /data-\[state=selected\]:bg-muted/);
		// A bar on the left edge, so the selection does not rely on colour alone.
		assert.match(html, /<td class="px-2 py-1.5 align-middle whitespace-normal max-sm:w-full max-sm:max-w-0 shadow-\[inset_3px_0_0_var\(--primary\)\]" data-selected-bar/);
		assert.match(logsButton(html), /aria-expanded="true"/);
		assert.equal(html.includes('data-logs-missing'), false);
	});

	test('without catalog.logs nothing is selected and the drawer is closed', () => {
		const html = renderServices(catalogUrl({ 'catalog.host': HOST_ID, 'catalog.q': 'web' }), [row()]);
		assert.doesNotMatch(rowTag(html, SERVICE_ID), /aria-current/);
		assert.match(logsButton(html), /aria-expanded="false"/);
	});

	test('an invalid catalog.logs is ignored', () => {
		const html = renderServices(catalogUrl({ 'catalog.host': HOST_ID, 'catalog.logs': 'Bad Name' }), [row()]);
		assert.doesNotMatch(rowTag(html, SERVICE_ID), /aria-current/);
		assert.equal(html.includes('data-logs-missing'), false);
	});

	test('a copy on another host or a row of another project is not selected; the not-listed line shows', () => {
		const rows = [row({ host_id: OTHER_HOST, host_name: 'pi2' }), row({ id: SECOND_ID, project_id: OTHER_PROJECT, project_name: 'Share' })];
		const html = renderServices(linked, rows);
		// With pi1 chosen the pi2 copy is filtered out, and another project's row is never listed.
		assert.equal(html.includes(`id="service-${SERVICE_ID}"`), false);
		assert.equal(html.includes(`id="service-${SECOND_ID}"`), false);
		assert.equal(html.includes('aria-expanded="true"'), false);
		const everyHost = renderServices(catalogUrl({ 'catalog.q': 'web' }), rows);
		assert.doesNotMatch(rowTag(everyHost, SERVICE_ID), /aria-current/);
		assert.match(html, /<p[^>]*data-logs-missing[^>]*>web isn't listed on this host yet\. Refresh in a moment\.<\/p>/);
	});

	test('no copy at all shows the not-listed line with the usual empty table', () => {
		const html = renderServices(linked, []);
		assert.equal(html.includes('data-logs-missing'), true);
		// The link also searches, so the host-only empty text does not apply.
		assert.equal(html.includes('No catalog entries.'), true);
		assert.equal(html.includes('Nothing in the catalog runs on this host.'), false);
	});

	test('a copy whose entry the Kind filter hides is not selected; the not-listed line shows', () => {
		const html = renderServices(`${linked}&catalog.kind=job`, [row()]);
		assert.equal(html.includes(`id="service-${SERVICE_ID}"`), false);
		assert.equal(html.includes('data-logs-missing'), true);
	});

	test('the not-listed line stays away when the load failed', () => {
		const html = renderServices(linked, [], { message: 'The API returned an unexpected response.' });
		assert.equal(html.includes('data-logs-missing'), false);
	});

	test('a host that is not in the list is not a request', () => {
		const html = renderServices(catalogUrl({ 'catalog.host': OTHER_PROJECT, 'catalog.logs': 'web' }), [row()]);
		assert.doesNotMatch(rowTag(html, SERVICE_ID), /aria-current/);
		assert.equal(html.includes('data-logs-missing'), false);
	});

	test('a matching row whose state is still being read is selected; its drawer waits', () => {
		const html = renderServices(linked, [row({ runtime: undefined })]);
		assert.match(rowTag(html, SERVICE_ID), /aria-current="true"/);
		assert.equal(html.includes('data-row-checking'), true);
		// No Logs button yet, so no drawer; the entry itself is open (its toggle says so).
		assert.equal(html.includes('aria-label="Logs web'), false);
		assert.match(html, /<button[^>]*aria-expanded="true"[^>]*aria-label="Services of web"/);
	});
});

describe('LogsDrawer initialOpen', () => {
	function drawer(initialOpen?: boolean): string {
		return render(LogsDrawer, {
			props: { entryName: 'web', entryKind: 'image', hostId: HOST_ID, hostName: 'pi1', action: '?/catalogLogs', initialOpen }
		}).body;
	}

	test('opens on mount only when asked; a later request opens it and nothing closes it', () => {
		// The pre effect that applies a later request runs only in the browser (Main Dev's browser check).
		assert.equal(openOnRequest(false, true), true);
		assert.equal(openOnRequest(true, false), true);
		assert.equal(openOnRequest(false, false), false);
		assert.match(logsButton(drawer(true)), /aria-expanded="true"/);
		assert.match(logsButton(drawer(false)), /aria-expanded="false"/);
		assert.match(logsButton(drawer()), /aria-expanded="false"/);
	});
});
