import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { render } from 'svelte/server';
import type { CatalogAction, Host, ImageDeploy, ImageEntry, ProjectServiceRow } from '../src/lib/api-types.ts';
import type { ImageDeployState } from '../src/lib/project-action.ts';
import type { ServiceEntryRef } from '../src/lib/service-actions.ts';
import { processServiceHref, serviceLogsHref } from '../src/lib/service-label.ts';
import {
	SERVICE_LOGS_PARAM,
	dropServiceLogs,
	serviceFilterKey,
	serviceLogsEntry,
	serviceLogsMissingNote,
	serviceLogsRow,
	serviceLogsStep,
	withoutServiceLogs
} from '../src/lib/service-view.ts';
import { serverHostHiddenFields, serverSearchHiddenFields, serverTableHref } from '../src/lib/table.ts';
import CatalogDeployForm from '../src/routes/projects/[id]/CatalogDeployForm.svelte';
import LogsDrawer from '../src/routes/projects/[id]/LogsDrawer.svelte';
import ServicesSection from '../src/routes/projects/[id]/ServicesSection.svelte';
import { actionUrlFrom, backTo, onPlainClick } from '../src/lib/url.ts';
import { actions as projectActions } from '../src/routes/projects/[id]/+page.server.ts';
import { envelope, fakeEvent, installFetch, PROJECT, restoreEnv, TOKEN, useApi, USER } from './harness.ts';
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

function entryRef(actions: CatalogAction[] = ALL, name = 'web'): ServiceEntryRef {
	return { name, kind: 'image', my_actions: actions, runAs: '', shell: false };
}

function servicesUrl(params: Record<string, string>): string {
	return `http://console.example/projects/${PROJECT.id}?${new URLSearchParams({ tab: 'services', ...params }).toString()}`;
}

function renderServices(url: string, rows: ProjectServiceRow[], extra: Record<string, unknown> = {}): string {
	setPageUrl(url);
	return render(ServicesSection, {
		props: {
			projectId: PROJECT.id,
			projectName: 'Lab',
			hosts: [host(), host(OTHER_HOST, 'pi2')],
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
			entries: [entryRef()],
			layout: 'wide',
			...extra
		}
	}).body;
}

/** The opening tag of one services row. */
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

describe('services.logs link helpers', () => {
	test('serviceLogsHref is the Services link for that host and entry plus services.logs', () => {
		const href = serviceLogsHref(PROJECT.id, HOST_ID, 'web');
		assert.equal(href.startsWith(`${processServiceHref(PROJECT.id, HOST_ID, 'web')}&`), true);
		const url = new URL(href, 'http://console.example');
		assert.equal(url.pathname, `/projects/${PROJECT.id}`);
		assert.equal(url.searchParams.get('tab'), 'services');
		assert.equal(url.searchParams.get('services.host'), HOST_ID);
		assert.equal(url.searchParams.get('services.q'), 'web');
		assert.equal(url.searchParams.get(SERVICE_LOGS_PARAM), 'web');
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

	test('withoutServiceLogs drops only services.logs', () => {
		const url = new URL(servicesUrl({ 'services.host': HOST_ID, 'services.q': 'web', 'services.logs': 'web', show: 'all' }));
		const next = new URL(withoutServiceLogs(url), 'http://console.example');
		assert.equal(next.searchParams.has(SERVICE_LOGS_PARAM), false);
		assert.equal(next.searchParams.get('services.host'), HOST_ID);
		assert.equal(next.searchParams.get('services.q'), 'web');
		assert.equal(next.searchParams.get('show'), 'all');
		assert.equal(next.searchParams.get('tab'), 'services');
	});

	test('table links and filter forms never carry services.logs on', () => {
		const url = new URL(servicesUrl({ 'services.host': HOST_ID, 'services.q': 'web', 'services.logs': 'web' }));
		const names = (fields: Array<{ name: string }>) => fields.map((field) => field.name);
		assert.equal(names(serverHostHiddenFields(url.searchParams, 'services')).includes(SERVICE_LOGS_PARAM), false);
		assert.equal(names(serverSearchHiddenFields(url.searchParams, 'services')).includes(SERVICE_LOGS_PARAM), false);
		assert.equal(serverTableHref(url, 'services', { sort: 'name' }).includes('services.logs'), false);
		assert.equal(serverTableHref(url, 'services', { cursor: 'abc' }).includes('services.logs'), false);
		assert.equal(serviceLogsMissingNote('web'), "web isn't listed on this host yet. Refresh in a moment.");
	});
});

describe('services.logs after use', () => {
	const linked = new URL(servicesUrl({ 'services.host': HOST_ID, 'services.q': 'web', 'services.logs': 'web' }));
	const path = `/projects/${PROJECT.id}`;

	test('action URLs and the redirect after an action drop services.logs and keep the rest', () => {
		const action = actionUrlFrom(linked, 'rename');
		assert.equal(action.includes('services.logs'), false);
		assert.equal(action.includes(`services.host=${HOST_ID}`), true);
		assert.equal(action.endsWith('&/rename'), true);
		const posted = new URL(`http://console.example${path}?${linked.searchParams.toString()}&/rename`);
		const back = backTo(posted);
		assert.equal(back.includes('services.logs'), false);
		assert.equal(back, `${path}?tab=services&services.host=${HOST_ID}&services.q=web`);
	});

	test('the step waits for the row state, then opens and clears once', () => {
		assert.equal(serviceLogsStep({ done: false, rowId: null, controls: null }), 'none');
		assert.equal(serviceLogsStep({ done: false, rowId: SERVICE_ID, controls: 'checking' }), 'wait');
		assert.equal(serviceLogsStep({ done: false, rowId: SERVICE_ID, controls: { logs: true } }), 'open-and-clear');
		// No grant for any action: still selected and cleared, no drawer.
		assert.equal(serviceLogsStep({ done: false, rowId: SERVICE_ID, controls: null }), 'open-and-clear');
		assert.equal(serviceLogsStep({ done: true, rowId: SERVICE_ID, controls: { logs: true } }), 'none');
	});

	test('dropServiceLogs replaces once with the URL without services.logs', () => {
		replaceStateCalls.length = 0;
		assert.equal(dropServiceLogs(linked, path, 'web', replaceState), true);
		assert.deepEqual(replaceStateCalls, [`${path}?tab=services&services.host=${HOST_ID}&services.q=web`]);
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

	test('the filter key changes with search, host, page, or Show, and not with services.logs or sort', () => {
		const key = serviceFilterKey(linked.searchParams);
		const changed = (name: string, value: string) => {
			const params = new URLSearchParams(linked.searchParams);
			params.set(name, value);
			return serviceFilterKey(params);
		};
		assert.notEqual(changed('services.q', 'api'), key);
		assert.notEqual(changed('services.host', OTHER_HOST), key);
		assert.notEqual(changed('services.cursor', 'abc'), key);
		assert.notEqual(changed('show', 'all'), key);
		assert.equal(changed('services.sort', 'host'), key);
		const without = new URLSearchParams(linked.searchParams);
		without.delete('services.logs');
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

	test('a result on a host links to that Services row and its logs', () => {
		const html = deployHtml({ result: result() });
		assert.equal(html.includes('View logs in Services'), true);
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

		test('a finished rollback links to the Services row', async () => {
			const state = await actionState('catalogRollback', (path) => (path.endsWith('/rollback') ? envelope(rollbackBody) : null));
			assert.equal(state.outcome?.outcome, 'succeeded');
			assert.equal(deployHtml({ result: state }).includes('View logs in Services'), true);
		});

		test('a pending confirmation has no link', async () => {
			const state = await actionState('catalogDeploy', (path) =>
				path.endsWith('/deploy')
					? envelope({ confirmation_id: 'A'.repeat(43), plan: 'Deploy web on pi1', expires_at: '2026-10-14T00:00:00Z' })
					: null
			);
			assert.notEqual(state.confirmation, null);
			assert.equal(deployHtml({ result: state }).includes('View logs in Services'), false);
			// Even next to an outcome, a pending confirmation gets no link.
			assert.equal(deployHtml({ result: { ...state, outcome: rollbackBody.deploy as ImageDeploy } }).includes('View logs in Services'), false);
		});

		test('a remove result has no link', async () => {
			const state = await actionState('catalogRemove', (path) => (path.endsWith('/remove') ? envelope({ status: { ...statusBody, state: 'missing' } }) : null));
			assert.equal(state.outcome, null);
			assert.notEqual(state.status, null);
			assert.equal(deployHtml({ result: state }).includes('View logs in Services'), false);
		});
	});

	test('no link before a result, without a host, without a project, or in flight', () => {
		assert.equal(deployHtml({ result: null }).includes('View logs in Services'), false);
		assert.equal(deployHtml({ result: result({ hostId: '' }) }).includes('View logs in Services'), false);
		assert.equal(deployHtml({ result: result(), projectId: null }).includes('View logs in Services'), false);
		assert.equal(deployHtml({ result: result(), inFlight: 'deploy' }).includes('View logs in Services'), false);
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

describe('Services tab with services.logs', () => {
	const linked = servicesUrl({ 'services.host': HOST_ID, 'services.q': 'web', 'services.logs': 'web' });

	test('the matching row is selected and its Logs drawer starts open', () => {
		const html = renderServices(linked, [row()]);
		const tag = rowTag(html, SERVICE_ID);
		assert.match(tag, /aria-current="true"/);
		assert.match(tag, /data-state="selected"/);
		assert.match(tag, /data-\[state=selected\]:bg-muted/);
		// A bar on the left edge, so the selection does not rely on colour alone.
		assert.match(html, /<td class="[^"]*shadow-\[inset_3px_0_0_var\(--primary\)\][^"]*" data-selected-bar/);
		assert.match(logsButton(html), /aria-expanded="true"/);
		assert.equal(html.includes('data-logs-missing'), false);
	});

	test('without services.logs nothing is selected and the drawer is closed', () => {
		const html = renderServices(servicesUrl({ 'services.host': HOST_ID, 'services.q': 'web' }), [row()]);
		assert.doesNotMatch(rowTag(html, SERVICE_ID), /aria-current/);
		assert.match(logsButton(html), /aria-expanded="false"/);
	});

	test('an invalid services.logs is ignored', () => {
		const html = renderServices(servicesUrl({ 'services.host': HOST_ID, 'services.logs': 'Bad Name' }), [row()]);
		assert.doesNotMatch(rowTag(html, SERVICE_ID), /aria-current/);
		assert.equal(html.includes('data-logs-missing'), false);
	});

	test('a row on another host or of another project is not selected; the not-listed line shows', () => {
		const html = renderServices(linked, [
			row({ host_id: OTHER_HOST, host_name: 'pi2' }),
			row({ id: SECOND_ID, project_id: OTHER_PROJECT, project_name: 'Share' })
		]);
		assert.doesNotMatch(rowTag(html, SERVICE_ID), /aria-current/);
		assert.doesNotMatch(rowTag(html, SECOND_ID), /aria-current/);
		assert.equal(html.includes('aria-expanded="true"'), false);
		assert.match(html, /<p[^>]*data-logs-missing[^>]*>web isn't listed on this host yet\. Refresh in a moment\.<\/p>/);
	});

	test('no row at all shows the not-listed line with the usual empty table', () => {
		const html = renderServices(linked, []);
		assert.equal(html.includes('data-logs-missing'), true);
		assert.equal(html.includes('No services'), true);
	});

	test('the not-listed line stays away when the load failed', () => {
		const html = renderServices(linked, [], { message: 'The API returned an unexpected response.' });
		assert.equal(html.includes('data-logs-missing'), false);
	});

	test('a host that is not in the list is not a request', () => {
		const html = renderServices(servicesUrl({ 'services.host': OTHER_PROJECT, 'services.logs': 'web' }), [row()]);
		assert.doesNotMatch(rowTag(html, SERVICE_ID), /aria-current/);
		assert.equal(html.includes('data-logs-missing'), false);
	});

	test('a matching row whose state is still being read is selected; its drawer waits', () => {
		const html = renderServices(linked, [row({ runtime: undefined })]);
		assert.match(rowTag(html, SERVICE_ID), /aria-current="true"/);
		assert.equal(html.includes('data-row-checking'), true);
		assert.equal(html.includes('aria-expanded="true"'), false);
	});
});

describe('LogsDrawer initialOpen', () => {
	function drawer(initialOpen?: boolean): string {
		return render(LogsDrawer, {
			props: { entryName: 'web', entryKind: 'image', hostId: HOST_ID, hostName: 'pi1', action: '?/catalogLogs', initialOpen }
		}).body;
	}

	test('opens on mount only when asked', () => {
		assert.match(logsButton(drawer(true)), /aria-expanded="true"/);
		assert.match(logsButton(drawer(false)), /aria-expanded="false"/);
		assert.match(logsButton(drawer()), /aria-expanded="false"/);
	});
});
