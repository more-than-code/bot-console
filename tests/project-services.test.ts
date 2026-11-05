import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { isActionFailure, isRedirect } from '@sveltejs/kit';
import { render } from 'svelte/server';
import type { Host, ProbeView, ProcessSample, ProjectServiceRow } from '../src/lib/api-types.ts';
import RenameForm from '../src/lib/components/RenameForm.svelte';
import { CHECKS_NEED_API, UNREAD_HEALTH_CHECKS } from '../src/lib/health-checks.ts';
import { serviceHostReachable } from '../src/lib/host-view.ts';
import { chosenHost, COPIES_CAPPED_NOTE, hostChoices } from '../src/lib/catalog-copies.ts';
import { nextRenameOpen, servicesRenameView } from '../src/lib/project-action.ts';
import ProcessesTab from '../src/routes/hosts/[id]/ProcessesTab.svelte';
import { load as hostLoad } from '../src/routes/hosts/[id]/+page.server.ts';
import ProjectPage from '../src/routes/projects/[id]/+page.svelte';
import { actions as projectActions, load as projectLoad } from '../src/routes/projects/[id]/+page.server.ts';
import { formatLatency, formatWhen } from '../src/lib/format.ts';

import { parseHost, parseListPayload, parseProjectService, parseService, parseServicePage } from '../src/lib/server/shape.ts';
import { actionUrlFrom } from '../src/lib/url.ts';
import {
	containsToken,
	envelope,
	fakeEvent,
	installFetch,
	PROJECT,
	restoreEnv,
	TOKEN,
	useApi,
	USER,
	type FetchCall
} from './harness.ts';
import { imageCatalogEntry, programCatalogEntry, renderCopies } from './copies.ts';
import { setPageUrl } from './stubs/app-state.ts';

const HOST_ID = '00000000-0000-4000-8000-0000000000aa';
const SERVICE_ID = '00000000-0000-4000-8000-0000000000bb';
const CHECK_ID = '00000000-0000-4000-8000-0000000000cc';
const OTHER_ID = '00000000-0000-4000-8000-000000000099';
const SECOND_ID = '00000000-0000-4000-8000-000000000098';

const HOST: Host = {
	id: HOST_ID,
	project_id: PROJECT.id,
	name: 'pi1',
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
	programs: null
};

const OTHER = { ...PROJECT, id: OTHER_ID, name: 'Share', slug: 'share', role: 'admin' as const };
const SECOND = { ...PROJECT, id: SECOND_ID, name: 'Second', slug: 'second', role: 'viewer' as const };

function baseService(overrides: Record<string, unknown> = {}) {
	return {
		id: SERVICE_ID,
		name: 'api',
		source: 'discovered',
		kind: 'process',
		ports: [8080],
		health: null,
		...overrides
	};
}

/** An owned copy of catalog entry `api` on pi1, as the services list returns it. */
function projectItem(overrides: Record<string, unknown> = {}) {
	return {
		...baseService({ source: 'owned', catalog_entry: 'api' }),
		host_id: HOST_ID,
		display_name: null,
		owner_user: 'ada',
		project_id: PROJECT.id,
		host_name: 'pi1',
		host_status: 'online',
		project_name: 'Lab',
		last_seen_at: '2026-10-14T00:00:00Z',
		health_checks: [],
		...overrides
	};
}

function pageData<T>(value: T): Exclude<T, void | undefined | null> {
	if (value == null) assert.fail('missing page data');
	return value as Exclude<T, void | undefined | null>;
}

/** Catalog entry `api` (a program), as the catalog list returns it. */
const API_ENTRY = programCatalogEntry('api', ['logs'], '00000000-0000-4000-8000-0000000000c2');

function shell(call: FetchCall, services: (call: FetchCall) => Response): Response {
	const id = PROJECT.id;
	if (call.url.pathname === `/v1/projects/${id}/services`) return services(call);
	if (call.url.pathname === `/v1/projects/${id}/catalog`) return envelope({ items: [API_ENTRY], next_cursor: null });
	if (call.url.pathname === `/v1/projects/${id}/hosts`) return envelope({ items: [HOST], next_cursor: null });
	if (call.url.pathname === `/v1/projects/${id}/members`) return envelope({ items: [], next_cursor: null });
	if (call.url.pathname === `/v1/projects/${id}/join-tokens`) return envelope({ items: [], next_cursor: null });
	if (call.url.pathname === `/v1/projects/${id}`) return envelope(PROJECT);
	if (call.url.pathname.startsWith('/v1/services/')) return envelope({ health_checks: [] });
	return envelope(null, 500, 'error', 'unexpected');
}

function decode(value: string): string {
	return value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
}

test('shape keeps v1.2 names and fails a closed project-services envelope', () => {
	const named = parseService(baseService({ display_name: 'hi\u0007', owner_user: 'ada', project_id: PROJECT.id, host_id: HOST_ID }));
	assert.equal(named?.display_name, 'hi\uFFFD');
	assert.equal(named?.owner_user, 'ada');
	assert.equal(named?.project_id, PROJECT.id);
	assert.equal(JSON.stringify(named).includes('token'), false);

	const old = parseService(baseService());
	assert.equal(old?.display_name, null);
	assert.equal(old?.owner_user, null);
	assert.equal(old?.project_id, null);
	assert.equal(old?.host_id, null);
	assert.equal(old?.gone_at, null);
	assert.equal(parseService(baseService({ gone_at: null }))?.gone_at, null);
	assert.equal(parseService(baseService({ gone_at: '2026-10-15T14:00:00Z' }))?.gone_at, '2026-10-15T14:00:00Z');
	assert.equal(parseService(baseService({ gone_at: 1 })), null);
	assert.equal(parseService(baseService({ gone_at: true })), null);
	assert.equal(parseService(baseService({ gone_at: { at: '2026-10-15T14:00:00Z' } })), null);
	assert.equal(parseService(baseService({ gone_at: '2026-10-15T14:00:00Z\u0007' })), null);

	assert.equal(parseService(baseService({ display_name: 1 })), null);
	assert.equal(parseService(baseService({ project_id: 'not-a-uuid' })), null);
	assert.equal(parseService(baseService({ owner_user: 'u'.repeat(81) }))?.owner_user, `${'u'.repeat(79)}\u2026`);
	assert.equal(parseService(baseService({ display_name: 'a'.repeat(64) }))?.display_name, 'a'.repeat(64));
	assert.equal(parseService(baseService({ display_name: 'a'.repeat(65) }))?.display_name, `${'a'.repeat(63)}\u2026`);
	assert.equal(parseHost(HOST)?.relation, 'owner');
	assert.equal(parseHost(HOST)?.share_level, null);
	assert.equal(parseHost({ ...HOST, relation: 'shared', share_level: 'deploy' })?.share_level, 'deploy');
	assert.equal(parseHost({ ...HOST, relation: 'shared', share_level: null }), null);
	assert.equal(parseHost({ ...HOST, relation: 'owner', share_level: 'metrics' }), null);
	const { relation: _relation, share_level: _level, ...legacyHost } = HOST;
	assert.equal(parseHost(legacyHost), null);

	const page = parseServicePage({
		items: [projectItem()],
		total: 3,
		next_cursor: 'next',
		prev_cursor: ''
	});
	assert.equal(page?.total, 3);
	assert.equal(page?.nextCursor, 'next');
	assert.equal(page?.prevCursor, null);
	assert.equal(parseServicePage({ items: [], next_cursor: null, prev_cursor: null }), null);
	assert.equal(parseServicePage({ items: [], total: -1, next_cursor: null, prev_cursor: null }), null);
	assert.equal(parseServicePage({ items: [], total: 1, next_cursor: 'c'.repeat(513), prev_cursor: null }), null);
	assert.equal(parseServicePage({ items: [], total: 1, next_cursor: 'bad\u0007', prev_cursor: null }), null);
	assert.equal(parseProjectService(projectItem())?.host_name, 'pi1');
	assert.equal(parseProjectService(baseService({ host_id: HOST_ID })), null);
	assert.equal(parseListPayload({ items: [{ id: 'x' }], next_cursor: 'more' })?.next, 'more');
	assert.equal(parseListPayload({ items: [], next_cursor: null })?.raw.length, 0);
});

describe('project services', { concurrency: false }, () => {
	const originalFetch = globalThis.fetch;

	before(() => {
		useApi('https://api.test');
	});

	after(() => {
		globalThis.fetch = originalFetch;
		restoreEnv();
	});

	function loadAt(url: string, projects = [PROJECT]) {
		return projectLoad(
			fakeEvent({ url, session: TOKEN, user: USER, projects, params: { id: PROJECT.id } }).event as never
		);
	}

	test('each tab fetches only what it shows, and independent calls overlap', async () => {
		const id = PROJECT.id;
		let inFlight = 0;
		let maxInFlight = 0;
		const respond = async (call: FetchCall): Promise<Response> => {
			if (call.url.pathname === `/v1/projects/${id}`) return envelope(PROJECT);
			inFlight += 1;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 5));
			inFlight -= 1;
			if (call.url.pathname === `/v1/projects/${id}/services`) {
				return envelope({ items: [], total: 0, next_cursor: null, prev_cursor: null });
			}
			if (call.url.pathname === `/v1/projects/${id}/hosts`) return envelope({ items: [HOST], next_cursor: null });
			return envelope({ items: [], next_cursor: null });
		};
		const expected: Record<string, string[]> = {
			// An admin's Hosts tab also lists join tokens for the Add a host card.
			hosts: ['hosts', 'join-tokens'],
			// Catalog & services: the entries, their running copies, the hosts they run on, and members for Permissions.
			catalog: ['catalog', 'hosts', 'members', 'services'],
			members: ['invites', 'members'],
			tokens: ['join-tokens'],
			settings: ['env-sets', 'files', 'registries']
		};
		const overlap: Record<string, number> = {};
		for (const [tab, want] of Object.entries(expected)) {
			maxInFlight = 0;
			const calls = installFetch(respond);
			const data = pageData(await loadAt(`http://console.example/projects/${id}?tab=${tab}`));
			assert.equal(data.tab, tab);
			const sections = calls
				.map((call) => call.url.pathname)
				.filter((path) => path !== `/v1/projects/${id}`)
				.map((path) => path.slice(`/v1/projects/${id}/`.length))
				.sort();
			assert.deepEqual(sections, want, tab);
			overlap[tab] = maxInFlight;
		}
		assert.equal(overlap.catalog, 4);
		assert.equal(overlap.members, 2);
		assert.equal(overlap.hosts, 2);
	});

	test('an old tab=services link redirects to the merged tab with its params mapped', async () => {
		const calls = installFetch(() => envelope(null, 500, 'error', 'should not load'));
		await assert.rejects(
			async () => {
				await loadAt(
					`http://console.example/projects/${PROJECT.id}?tab=services&services.q=api&services.host=${HOST_ID}&services.sort=status&services.dir=desc&services.cursor=abc&show=all&services.logs=api`
				);
			},
			(err: unknown) =>
				isRedirect(err) &&
				err.status === 303 &&
				err.location === `/projects/${PROJECT.id}?tab=catalog&catalog.q=api&catalog.host=${HOST_ID}&catalog.logs=api`
		);
		assert.equal(calls.length, 0);
	});

	test('the copies load sends view, include and limit once, and groups owned rows of this project by entry', async () => {
		const calls = installFetch((call) =>
			shell(call, () =>
				envelope({
					items: [
						projectItem(),
						projectItem({ id: CHECK_ID, source: 'discovered', catalog_entry: null }),
						projectItem({ id: OTHER_ID, project_id: OTHER_ID, project_name: 'Share' }),
						projectItem({ id: SECOND_ID, catalog_entry: 'unlisted' })
					],
					total: 4,
					next_cursor: null,
					prev_cursor: null
				})
			)
		);
		const data = pageData(await loadAt(`http://console.example/projects/${PROJECT.id}?tab=catalog&catalog.q=api&catalog.host=${HOST_ID}`));
		const listed = calls.filter((call) => call.url.pathname === `/v1/projects/${PROJECT.id}/services`);
		assert.equal(listed.length, 1);
		const params = listed[0]?.url.searchParams;
		assert.deepEqual([...(params?.keys() ?? [])].sort(), ['include', 'limit', 'view']);
		assert.equal(params?.get('view'), 'deploybot');
		assert.equal(params?.get('include'), 'health_checks');
		assert.equal(params?.get('limit'), '200');
		assert.equal(data.tab, 'catalog');
		assert.deepEqual(Object.keys(data.copies), ['api']);
		assert.deepEqual(data.copies.api?.map((row: ProjectServiceRow) => row.id), [SERVICE_ID]);
		assert.equal(data.copiesMessage, null);
		assert.equal(data.copiesComplete, true);

		// A host outside the project's own and deploy-shared hosts is ignored with a notice.
		const metricsId = '00000000-0000-4000-8000-0000000000ee';
		const unreachableUrl = `http://console.example/projects/${PROJECT.id}?tab=catalog&catalog.host=${metricsId}`;
		installFetch((call) => {
			if (call.url.pathname === `/v1/projects/${PROJECT.id}/hosts`) {
				return envelope({
					items: [HOST, { ...HOST, id: metricsId, name: 'metrics-box', relation: 'shared', share_level: 'metrics' }],
					next_cursor: null
				});
			}
			return shell(call, () => envelope({ items: [projectItem()], total: 1, next_cursor: null, prev_cursor: null }));
		});
		const unreachable = pageData(await loadAt(unreachableUrl));
		setPageUrl(unreachableUrl);
		const unreachableHtml = decode(render(ProjectPage, { props: { data: unreachable as never, form: null } }).body);
		assert.match(unreachableHtml, /role="alert"/);
		assert.match(unreachableHtml, /That host is not available for this project\./);
		// The filter is ignored: the entry still lists its copy (collapsed, so its table is not rendered yet).
		assert.match(unreachableHtml, /data-entry="api"[\s\S]*1 on pi1/);

		installFetch((call) => shell(call, () => envelope({ items: [projectItem()], next_cursor: null })));
		const malformed = pageData(await loadAt(`http://console.example/projects/${PROJECT.id}?tab=catalog`));
		assert.deepEqual(malformed.copies, {});
		assert.equal(malformed.copiesComplete, false);
		assert.equal(malformed.copiesMessage, 'The API returned an unexpected response.');
	});

	test('the copies load follows next_cursor for at most five pages and then says so', async () => {
		let n = 0;
		const calls = installFetch((call) =>
			shell(call, () => {
				n += 1;
				const id = `00000000-0000-4000-8200-${n.toString(16).padStart(12, '0')}`;
				return envelope({ items: [projectItem({ id, host_name: `pi${n}` })], total: 9, next_cursor: `c${n}`, prev_cursor: null });
			})
		);
		const url = `http://console.example/projects/${PROJECT.id}?tab=catalog`;
		const data = pageData(await loadAt(url));
		const pages = calls.filter((call) => call.url.pathname === `/v1/projects/${PROJECT.id}/services`);
		assert.deepEqual(
			pages.map((call) => call.url.searchParams.get('cursor')),
			[null, 'c1', 'c2', 'c3', 'c4']
		);
		assert.equal(data.copies.api?.length, 5);
		assert.equal(data.copiesMessage, COPIES_CAPPED_NOTE);
		setPageUrl(url);
		const html = decode(render(ProjectPage, { props: { data: data as never, form: null } }).body);
		assert.match(html, /role="status"[^>]*>(?:(?!<\/div>)[\s\S])*Some running copies could not be listed\./);

		const twoPages = installFetch((call) =>
			shell(call, () =>
				call.url.searchParams.has('cursor')
					? envelope({ items: [projectItem({ id: CHECK_ID, host_name: 'a-first' })], total: 2, next_cursor: null, prev_cursor: 'p' })
					: envelope({ items: [projectItem()], total: 2, next_cursor: 'n', prev_cursor: null })
			)
		);
		const both = pageData(await loadAt(url));
		assert.equal(twoPages.filter((call) => call.url.pathname.endsWith('/services')).length, 2);
		// Host-name order under the entry.
		assert.deepEqual(both.copies.api?.map((row: ProjectServiceRow) => row.host_name), ['a-first', 'pi1']);
		assert.equal(both.copiesMessage, null);
	});

	test('a row repeated on a later page is one copy, and hosts sort without case first', async () => {
		installFetch((call) =>
			shell(call, () =>
				call.url.searchParams.has('cursor')
					? envelope({
							items: [projectItem({ host_name: 'pi1' }), projectItem({ id: CHECK_ID, host_name: 'Pi2' }), projectItem({ id: SECOND_ID, host_name: 'pi10' })],
							total: 3,
							next_cursor: null,
							prev_cursor: 'p'
						})
					: envelope({ items: [projectItem({ host_name: 'pi1' })], total: 3, next_cursor: 'n', prev_cursor: null })
			)
		);
		const data = pageData(await loadAt(`http://console.example/projects/${PROJECT.id}?tab=catalog`));
		assert.deepEqual(data.copies.api?.map((row: ProjectServiceRow) => row.id), [SERVICE_ID, SECOND_ID, CHECK_ID]);
		assert.deepEqual(data.copies.api?.map((row: ProjectServiceRow) => row.host_name), ['pi1', 'pi10', 'Pi2']);
		assert.equal(data.copiesComplete, true);
	});

	test('a failure on a later page lists no copies and shows the message', async () => {
		for (const [second, message] of [
			[() => envelope(null, 503, 'unavailable', 'api down'), 'api down'],
			[() => envelope({ items: 'nope' }), 'The API returned an unexpected response.']
		] as const) {
			installFetch((call) =>
				shell(call, () =>
					call.url.searchParams.has('cursor') ? second() : envelope({ items: [projectItem()], total: 2, next_cursor: 'n', prev_cursor: null })
				)
			);
			const data = pageData(await loadAt(`http://console.example/projects/${PROJECT.id}?tab=catalog`));
			assert.deepEqual(data.copies, {}, message);
			assert.equal(data.copiesMessage, message);
			assert.equal(data.copiesComplete, false);
			assert.equal(data.notRunningKnown, false);
		}
	});

	test('a malformed row of another project is skipped, not left out, so not-running rows stay', async () => {
		const runnable = programCatalogEntry('api', ['run'], '00000000-0000-4000-8000-0000000000c2');
		const programs = { enabled: true, run_as: ['joe'], allow_shell: false, policy_hash: 'p', images: true, docker: true, files: false, logging: false, health_policy: false };
		installFetch((call) => {
			if (call.url.pathname === `/v1/projects/${PROJECT.id}/catalog`) return envelope({ items: [runnable], next_cursor: null });
			if (call.url.pathname === `/v1/projects/${PROJECT.id}/hosts`) return envelope({ items: [{ ...HOST, programs }], next_cursor: null });
			return shell(call, () =>
				envelope({ items: [{ id: OTHER_ID, project_id: OTHER_ID, name: 'broken' }], total: 1, next_cursor: null, prev_cursor: null })
			);
		});
		const data = pageData(await loadAt(`http://console.example/projects/${PROJECT.id}?tab=catalog`));
		assert.equal(data.copiesOmitted, 0);
		assert.equal(data.copiesComplete, true);
		assert.equal(data.notRunningKnown, true);
		assert.deepEqual(data.notRunning.map((pair: { entry: { name: string }; host: { name: string } }) => `${pair.entry.name}@${pair.host.name}`), ['api@pi1']);

		// A malformed row of this project is left out: the list is incomplete.
		installFetch((call) => {
			if (call.url.pathname === `/v1/projects/${PROJECT.id}/catalog`) return envelope({ items: [runnable], next_cursor: null });
			return shell(call, () =>
				envelope({ items: [{ id: OTHER_ID, project_id: PROJECT.id, name: 'broken' }], total: 1, next_cursor: null, prev_cursor: null })
			);
		});
		const mine = pageData(await loadAt(`http://console.example/projects/${PROJECT.id}?tab=catalog`));
		assert.equal(mine.copiesOmitted, 1);
		assert.equal(mine.copiesComplete, false);
		assert.equal(mine.notRunningKnown, false);
	});

	test('status reads stop after 100 container copies; the rest are unknown and the tab says so', async () => {
		const web = imageCatalogEntry('web', ['run', 'stop', 'logs'], '00000000-0000-4000-8000-0000000000c1');
		const db = imageCatalogEntry('db', ['run', 'stop', 'logs'], '00000000-0000-4000-8000-0000000000c3');
		const container = (n: number, entry: string) =>
			projectItem({
				id: `00000000-0000-4000-8300-${n.toString(16).padStart(12, '0')}`,
				host_id: `00000000-0000-4000-8400-${n.toString(16).padStart(12, '0')}`,
				host_name: `h${String(n).padStart(3, '0')}`,
				name: entry,
				catalog_entry: entry,
				kind: 'container'
			});
		// Catalog order web, then db: web's 60 copies are read first, then the first 40 of db's 60.
		const items = [...Array.from({ length: 60 }, (_, n) => container(n, 'db')), ...Array.from({ length: 60 }, (_, n) => container(100 + n, 'web'))];
		const calls = installFetch((call) => {
			if (call.url.pathname === `/v1/projects/${PROJECT.id}/catalog`) return envelope({ items: [web, db], next_cursor: null });
			if (call.url.pathname.endsWith('/status')) {
				return envelope({ container: 'c', state: 'running', exit_code: null, restart_count: 0, started_at: null, finished_at: null, digest: null, ports: [] });
			}
			return shell(call, () => envelope({ items, total: items.length, next_cursor: null, prev_cursor: null }));
		});
		const url = `http://console.example/projects/${PROJECT.id}?tab=catalog`;
		const data = pageData(await loadAt(url));
		const states = (await data.serviceStates) as Record<string, unknown>;
		assert.equal(calls.filter((call) => call.url.pathname.endsWith('/status')).length, 100);
		assert.equal(Object.keys(states).length, 100);
		assert.equal(data.statusCapped, true);
		assert.equal(data.copies.web?.every((row: ProjectServiceRow) => row.runtime === undefined), true);
		const db40 = data.copies.db ?? [];
		assert.equal(db40.filter((row: ProjectServiceRow) => row.runtime === undefined).length, 40);
		assert.deepEqual(db40[59]?.runtime, { state: 'unknown', restarts: null });
		setPageUrl(url);
		const html = decode(render(ProjectPage, { props: { data: data as never, form: null } }).body);
		assert.match(html, /role="status"[^>]*>(?:(?!<\/div>)[\s\S])*Live state is shown for the first 100 copies\./);
	});

	test('an image entry with no copy says Not deployed only when the copy list is complete', async () => {
		const web = imageCatalogEntry('web', [], '00000000-0000-4000-8000-0000000000c1');
		const url = `http://console.example/projects/${PROJECT.id}?tab=catalog`;
		const loadWith = async (services: (call: FetchCall) => Response) => {
			installFetch((call) => {
				if (call.url.pathname === `/v1/projects/${PROJECT.id}/catalog`) return envelope({ items: [web], next_cursor: null });
				return shell(call, services);
			});
			return pageData(await loadAt(url));
		};
		const complete = await loadWith(() => envelope({ items: [], total: 0, next_cursor: null, prev_cursor: null }));
		setPageUrl(url);
		assert.match(decode(render(ProjectPage, { props: { data: complete as never, form: null } }).body), /Not deployed(?! yet)/);
		// Five pages and more: the page cap notice, and no claim that web has no copy.
		const capped = await loadWith((call) =>
			envelope({ items: [projectItem({ id: `00000000-0000-4000-8500-00000000000${call.url.searchParams.get('cursor')?.length ?? 0}` })], total: 9, next_cursor: `${call.url.searchParams.get('cursor') ?? ''}x`, prev_cursor: null })
		);
		assert.equal(capped.copiesMessage, COPIES_CAPPED_NOTE);
		assert.equal(capped.copiesComplete, false);
		const cappedHtml = decode(render(ProjectPage, { props: { data: capped as never, form: null } }).body);
		assert.equal(cappedHtml.includes('Some running copies could not be listed.'), true);
		assert.doesNotMatch(cappedHtml, /Not deployed/);
	});

	test('rename keeps the table query and keeps a rejected value', async () => {
		const url = `http://console.example/projects/${PROJECT.id}?tab=catalog&catalog.q=api&catalog.sort=name&catalog.dir=asc&catalog.host=${HOST_ID}&/rename`;
		const calls = installFetch((call) => {
			assert.equal(call.method, 'PATCH');
			assert.equal(call.url.pathname, `/v1/services/${SERVICE_ID}`);
			return envelope(null);
		});
		await assert.rejects(
			async () => {
				await projectActions.rename(
					fakeEvent({
						url,
						session: TOKEN,
						user: USER,
						projects: [PROJECT],
						params: { id: PROJECT.id },
						form: { service_id: SERVICE_ID, display_name: '  Widget  ' }
					}).event as never
				);
			},
			(err: unknown) => {
				if (!isRedirect(err) || err.status !== 303) return false;
				const dest = new URL(err.location, 'http://console.example');
				assert.equal(dest.pathname, `/projects/${PROJECT.id}`);
				assert.equal(dest.searchParams.get('tab'), 'catalog');
				assert.equal(dest.searchParams.get('catalog.q'), 'api');
				assert.equal(dest.searchParams.get('catalog.sort'), 'name');
				assert.equal(dest.searchParams.get('catalog.dir'), 'asc');
				assert.equal(dest.searchParams.get('catalog.host'), HOST_ID);
				assert.equal(dest.searchParams.has('/rename'), false);
				return true;
			}
		);
		assert.equal(calls[0]?.body, JSON.stringify({ display_name: 'Widget' }));

		const cleared = installFetch(() => envelope(null));
		await assert.rejects(async () => {
			await projectActions.rename(
				fakeEvent({
					url,
					session: TOKEN,
					user: USER,
					projects: [PROJECT],
					params: { id: PROJECT.id },
					form: { service_id: SERVICE_ID, display_name: 'keep me', clear: '1' }
				}).event as never
			);
		});
		assert.equal(cleared[0]?.body, JSON.stringify({ display_name: null }));

		const empty = installFetch(() => envelope(null));
		const blank = await projectActions.rename(
			fakeEvent({
				url,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: { service_id: SERVICE_ID, display_name: '   ' }
			}).event as never
		);
		assert.equal(empty.length, 0);
		assert.equal(isActionFailure(blank), true);
		if (!isActionFailure(blank)) assert.fail('expected a local rejection');
		assert.equal(blank.status, 400);
		const blankData = blank.data as unknown as { displayName?: string };
		assert.equal(blankData.displayName, '   ');

		for (const [status, code] of [
			[409, 'conflict'],
			[400, 'bad_request'],
			[403, 'forbidden']
		] as const) {
			installFetch(() => envelope(null, status, code, code));
			const rejected = await projectActions.rename(
				fakeEvent({
					url,
					session: TOKEN,
					user: USER,
					projects: [PROJECT],
					params: { id: PROJECT.id },
					form: { service_id: SERVICE_ID, display_name: '  Widget  ' }
				}).event as never
			);
			assert.equal(isActionFailure(rejected), true);
			if (!isActionFailure(rejected)) assert.fail(code);
			assert.equal(rejected.status, status);
			const rejectedData = rejected.data as unknown as { message?: string; displayName?: string; renameServiceId?: string };
			assert.equal(rejectedData.message, code);
			assert.equal(rejectedData.displayName, '  Widget  ');
			assert.equal(rejectedData.renameServiceId, SERVICE_ID);
			assert.equal((rejected.data as unknown as { scope?: string }).scope, 'catalog');
			const view = servicesRenameView({
				scope: 'catalog',
				message: rejectedData.message,
				renameServiceId: rejectedData.renameServiceId,
				displayName: rejectedData.displayName
			});
			assert.equal(view.open, true);
			assert.equal(view.renameServiceId, SERVICE_ID);
			assert.equal(view.typedName, '  Widget  ');
			setPageUrl(url);
			const rejectedHtml = decode(
				render(RenameForm, {
					props: {
						action: actionUrlFrom(new URL(url), 'rename'),
						serviceId: view.renameServiceId ?? SERVICE_ID,
						value: view.typedName ?? '',
						message: rejectedData.message ?? null
					}
				}).body
			);
			assert.match(rejectedHtml, /role="alert"/);
			assert.equal(rejectedHtml.includes(code), true);
			assert.equal(rejectedHtml.includes('value="  Widget  "'), true);
			assert.match(rejectedHtml, /name="display_name"/);
			assert.equal(namedControl(rejectedHtml, 'clear', '1'), true);
		}

		const projectRename = installFetch(() => envelope(null));
		await assert.rejects(async () => {
			await projectActions.rename(
				fakeEvent({
					url: `http://console.example/projects/${PROJECT.id}?tab=settings`,
					session: TOKEN,
					user: USER,
					projects: [PROJECT],
					params: { id: PROJECT.id },
					form: { name: 'Lab 2' }
				}).event as never
			);
		});
		assert.equal(projectRename[0]?.url.pathname, `/v1/projects/${PROJECT.id}`);
		assert.equal(projectRename[0]?.body, JSON.stringify({ name: 'Lab 2' }));
	});

	test('probe from the project tab posts only check_id and keeps the service id', async () => {
		const calls = installFetch((call) => {
			assert.equal(call.method, 'POST');
			assert.equal(call.url.pathname, `/v1/services/${SERVICE_ID}/probe`);
			return envelope({
				service: 'api',
				protocol: 'http',
				port: 8080,
				path: '/health',
				result: 'up',
				http_status: 200,
				latency_ms: 3,
				checked_at: '2026-10-14T00:00:00Z'
			});
		});
		const probe = await projectActions.probe(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=catalog&catalog.q=api&/probe`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: { service_id: SERVICE_ID, check_id: CHECK_ID }
			}).event as never
		);
		assert.equal(isActionFailure(probe), false);
		if (!probe || isActionFailure(probe)) assert.fail('expected a probe result');
		assert.equal(probe.scope, 'catalog');
		assert.equal(probe.probeServiceId, SERVICE_ID);
		assert.equal(probe.probe?.result, 'up');
		assert.equal(calls[0]?.body, JSON.stringify({ check_id: CHECK_ID }));
		assert.equal(containsToken(probe), false);
	});

	test('host tab=services redirects for an owner member, a share member, or neither', async () => {
		const ownerCalls = installFetch((call) => {
			if (call.url.pathname === `/v1/hosts/${HOST_ID}`) return envelope(HOST);
			return envelope(null, 500, 'error', 'unexpected');
		});
		await assert.rejects(
			async () => {
				await hostLoad(
					fakeEvent({
						url: `http://console.example/hosts/${HOST_ID}?tab=services&range=7d`,
						session: TOKEN,
						user: USER,
						projects: [PROJECT, OTHER],
						params: { id: HOST_ID }
					}).event as never
				);
			},
			(err: unknown) =>
				isRedirect(err) &&
				err.status === 303 &&
				err.location === `/projects/${PROJECT.id}?tab=catalog&catalog.host=${HOST_ID}`
		);
		assert.equal(
			ownerCalls.some((call) => call.url.pathname.includes('/projects/')),
			false
		);

		const THIRD_ID = '00000000-0000-4000-8000-000000000097';
		const THIRD = { ...PROJECT, id: THIRD_ID, name: 'Third', slug: 'third', role: 'viewer' as const };
		const shareCalls = installFetch((call) => {
			if (call.url.pathname === `/v1/hosts/${HOST_ID}`) return envelope(HOST);
			if (call.url.pathname === `/v1/projects/${OTHER_ID}/hosts`) return envelope({ items: [], next_cursor: 'more' });
			if (call.url.pathname === `/v1/projects/${SECOND_ID}/hosts`) return envelope({ items: [HOST], next_cursor: 'more' });
			if (call.url.pathname === `/v1/projects/${THIRD_ID}/hosts`) return envelope({ items: [HOST], next_cursor: null });
			return envelope(null, 500, 'error', 'unexpected');
		});
		await assert.rejects(
			async () => {
				await hostLoad(
					fakeEvent({
						url: `http://console.example/hosts/${HOST_ID}?tab=services`,
						session: TOKEN,
						user: USER,
						projects: [OTHER, SECOND, THIRD],
						params: { id: HOST_ID }
					}).event as never
				);
			},
			(err: unknown) =>
				isRedirect(err) &&
				err.status === 303 &&
				err.location === `/projects/${SECOND_ID}?tab=catalog&catalog.host=${HOST_ID}`
		);
		const shareLists = shareCalls.filter((call) => call.url.pathname.endsWith('/hosts') && call.url.pathname.includes('/projects/'));
		assert.deepEqual(
			shareLists.map((call) => call.url.pathname),
			[`/v1/projects/${OTHER_ID}/hosts`, `/v1/projects/${SECOND_ID}/hosts`]
		);
		for (const call of shareLists) {
			assert.equal(call.url.searchParams.get('limit'), '200');
			assert.equal(call.url.searchParams.has('cursor'), false);
		}
		assert.equal(shareCalls.some((call) => call.url.pathname.includes(THIRD_ID)), false);

		const neitherCalls = installFetch((call) => {
			if (call.url.pathname === `/v1/hosts/${HOST_ID}`) return envelope(HOST);
			if (call.url.pathname === `/v1/projects/${OTHER_ID}/hosts`) return envelope({ items: [], next_cursor: null });
			if (call.url.pathname === `/v1/projects/${PROJECT.id}`) return envelope(PROJECT);
			if (call.url.pathname.endsWith('/metrics')) return envelope(null, 503, 'unavailable', 'down');
			return envelope(null, 500, 'error', 'unexpected');
		});
		const neither = pageData(
			await hostLoad(
				fakeEvent({
					url: `http://console.example/hosts/${HOST_ID}?tab=services`,
					session: TOKEN,
					user: USER,
					projects: [OTHER],
					params: { id: HOST_ID }
				}).event as never
			)
		);
		assert.equal(neither.tab, 'overview');
		assert.equal(neither.message, null);
		assert.equal(neitherCalls.some((call) => call.url.pathname.endsWith('/services')), false);

		const scans = Array.from({ length: 21 }, (_, index) => {
			const n = index + 1;
			const id = `00000000-0000-4000-8100-${n.toString(16).padStart(12, '0')}`;
			return { ...PROJECT, id, name: `Scan ${n}`, slug: `scan-${n}`, role: 'viewer' as const };
		});
		const capCalls = installFetch((call) => {
			if (call.url.pathname === `/v1/hosts/${HOST_ID}`) return envelope(HOST);
			if (call.url.pathname.endsWith('/hosts')) return envelope({ items: [], next_cursor: 'more' });
			if (call.url.pathname === `/v1/projects/${PROJECT.id}`) return envelope(PROJECT);
			if (call.url.pathname.endsWith('/metrics')) return envelope(null, 503, 'unavailable', 'down');
			return envelope(null, 500, 'error', 'unexpected');
		});
		const capped = pageData(
			await hostLoad(
				fakeEvent({
					url: `http://console.example/hosts/${HOST_ID}?tab=services`,
					session: TOKEN,
					user: USER,
					projects: scans,
					params: { id: HOST_ID }
				}).event as never
			)
		);
		assert.equal(capped.tab, 'overview');
		assert.equal(capped.message, null);
		const scanned = capCalls.filter((call) => /\/v1\/projects\/[^/]+\/hosts$/.test(call.url.pathname));
		assert.equal(scanned.length, 20);
		assert.equal(
			scanned.some((call) => call.url.pathname.includes(scans[20]?.id ?? 'missing')),
			false
		);
		assert.equal(
			scanned.every((call) => call.url.searchParams.get('limit') === '200' && !call.url.searchParams.has('cursor')),
			true
		);
	});

	test('a process links to the catalog copy only when the caller is a member', async () => {
		const DISCOVERED_ID = '00000000-0000-4000-8000-0000000000dd';
		const serviceBody = {
			items: [
				baseService({ project_id: PROJECT.id, display_name: 'API', name: 'deploybot-lab-api.service', source: 'owned', catalog_entry: 'api' }),
				baseService({ id: DISCOVERED_ID, project_id: PROJECT.id, name: 'nginx' })
			],
			next_cursor: null
		};
		async function loadProcesses(projects: typeof PROJECT[]) {
			const calls = installFetch((call) => {
				if (call.url.pathname === `/v1/hosts/${HOST_ID}`) return envelope(HOST);
				if (call.url.pathname === `/v1/projects/${PROJECT.id}`) return envelope(PROJECT);
				if (call.url.pathname === `/v1/hosts/${HOST_ID}/processes`) {
					return envelope({
						sampled_at: '2026-10-14T00:00:00Z',
						items: [
							{
								pid: 3,
								process_name: 'node',
								user: 'bot',
								cmdline: 'node',
								service_id: SERVICE_ID,
								cpu_usage: 1,
								memory_rss: 1,
								memory_usage: 1,
								num_threads: 1,
								started_at: '2026-10-14T00:00:00Z'
							}
						]
					});
				}
				if (call.url.pathname === `/v1/hosts/${HOST_ID}/services`) return envelope(serviceBody);
				return envelope(null, 500, 'error', 'unexpected');
			});
			const data = pageData(
				await hostLoad(
					fakeEvent({
						url: `http://console.example/hosts/${HOST_ID}?tab=processes`,
						session: TOKEN,
						user: USER,
						projects,
						params: { id: HOST_ID }
					}).event as never
				)
			);
			return { calls, data };
		}

		const member = await loadProcesses([PROJECT]);
		assert.equal(member.data.serviceLinks[SERVICE_ID]?.label, 'API');
		assert.equal(
			member.data.serviceLinks[SERVICE_ID]?.href,
			`/projects/${PROJECT.id}?tab=catalog&catalog.host=${HOST_ID}&catalog.q=api`
		);
		// A discovered service has no row on that tab, so it is not a link.
		assert.equal(member.data.serviceLinks[DISCOVERED_ID]?.label, 'nginx');
		assert.equal(member.data.serviceLinks[DISCOVERED_ID]?.href, null);
		assert.equal(member.data.message, null);

		const stranger = await loadProcesses([OTHER]);
		assert.equal(stranger.data.serviceLinks[SERVICE_ID]?.label, 'API');
		assert.equal(stranger.data.serviceLinks[SERVICE_ID]?.href, null);

		const denied = installFetch((call) => {
			if (call.url.pathname === `/v1/hosts/${HOST_ID}`) return envelope(HOST);
			if (call.url.pathname === `/v1/projects/${PROJECT.id}`) return envelope(PROJECT);
			if (call.url.pathname.endsWith('/processes')) {
				return envelope({
					sampled_at: '2026-10-14T00:00:00Z',
					items: [
						{
							pid: 3,
							process_name: 'node',
							user: 'bot',
							cmdline: 'node',
							service_id: SERVICE_ID,
							cpu_usage: 1,
							memory_rss: 1,
							memory_usage: 1,
							num_threads: 1,
							started_at: '2026-10-14T00:00:00Z'
						}
					]
				});
			}
			if (call.url.pathname.endsWith('/services')) return envelope(null, 403, 'forbidden', 'no');
			return envelope(null, 500, 'error', 'unexpected');
		});
		const hidden = pageData(
			await hostLoad(
				fakeEvent({
					url: `http://console.example/hosts/${HOST_ID}?tab=processes`,
					session: TOKEN,
					user: USER,
					projects: [PROJECT],
					params: { id: HOST_ID }
				}).event as never
			)
		);
		assert.equal(hidden.message, null);
		assert.equal(hidden.processesMessage, null);
		assert.equal(hidden.processes?.items.length, 1);
		assert.deepEqual(hidden.serviceLinks, {});
		assert.equal(denied.some((call) => call.url.pathname.endsWith('/services')), true);
	});

	test('display name accepts 64 characters and rejects 65 or a control character before PATCH', async () => {
		const url = `http://console.example/projects/${PROJECT.id}?tab=catalog&/rename`;
		const accepted = 'a'.repeat(64);
		const calls = installFetch((call) => {
			assert.equal(call.method, 'PATCH');
			assert.equal(call.url.pathname, `/v1/services/${SERVICE_ID}`);
			return envelope(null);
		});
		await assert.rejects(async () => {
			await projectActions.rename(
				fakeEvent({
					url,
					session: TOKEN,
					user: USER,
					projects: [PROJECT],
					params: { id: PROJECT.id },
					form: { service_id: SERVICE_ID, display_name: accepted }
				}).event as never
			);
		});
		assert.equal(calls[0]?.body, JSON.stringify({ display_name: accepted }));

		for (const display_name of ['a'.repeat(65), 'bad\u0007name']) {
			const rejectedCalls = installFetch(() => envelope(null, 500, 'error', 'should not patch'));
			const rejected = await projectActions.rename(
				fakeEvent({
					url,
					session: TOKEN,
					user: USER,
					projects: [PROJECT],
					params: { id: PROJECT.id },
					form: { service_id: SERVICE_ID, display_name }
				}).event as never
			);
			assert.equal(rejectedCalls.length, 0);
			assert.equal(isActionFailure(rejected), true);
			if (!isActionFailure(rejected)) assert.fail('expected a local rejection');
			assert.equal(rejected.status, 400);
			const data = rejected.data as unknown as { message?: string; displayName?: string };
			assert.equal(data.message, 'Enter a display name (1–64 characters).');
			assert.equal(data.displayName, display_name);
		}
	});

	test('a viewer load shows the merged tab, no rename, and the checks reach the copy (for the dialog)', async () => {
		installFetch((call) => {
			if (call.url.pathname === `/v1/projects/${PROJECT.id}`) return envelope({ ...PROJECT, role: 'viewer' });
			if (call.url.pathname === `/v1/projects/${PROJECT.id}/hosts`) return envelope({ items: [HOST], next_cursor: null });
			if (call.url.pathname === `/v1/projects/${PROJECT.id}/members`) return envelope({ items: [], next_cursor: null });
			if (call.url.pathname === `/v1/projects/${PROJECT.id}/catalog`) return envelope({ items: [API_ENTRY], next_cursor: null });
			if (call.url.pathname === `/v1/projects/${PROJECT.id}/services`) {
				return envelope({
					items: [projectItem({ health_checks: [{ id: CHECK_ID, protocol: 'http', port: 80, path: '/health', enabled: true }] })],
					total: 1,
					next_cursor: null,
					prev_cursor: null
				});
			}
			return envelope(null, 500, 'error', 'unexpected');
		});
		const url = `http://console.example/projects/${PROJECT.id}?tab=catalog`;
		const data = pageData(
			await projectLoad(
				fakeEvent({
					url,
					session: TOKEN,
					user: USER,
					projects: [{ ...PROJECT, role: 'viewer' }],
					params: { id: PROJECT.id }
				}).event as never
			)
		);
		assert.equal(data.tab, 'catalog');
		assert.equal(data.canAdmin, false);
		assert.equal(data.copies.api?.[0]?.checks.length, 1);
		setPageUrl(url);
		const html = decode(render(ProjectPage, { props: { data: data as never, form: null } }).body);
		assert.match(html, /aria-current="page">Catalog & services</);
		assert.equal(html.includes('tab=services'), false);
		assert.equal(html.includes('aria-label="Rename '), false);
		// Health-check lines and Probe live in the Health checks dialog, not in the services table.
		assert.equal(html.includes('aria-label="Probe api http 80"'), false);
	});

	test('a services list error sets the notice and keeps the entries', async () => {
		const cases = [
			[400, 'bad_request', 'bad search'],
			[403, 'forbidden', 'not allowed'],
			[503, 'unavailable', 'api down'],
			[504, 'timeout', 'too slow']
		] as const;
		for (const [status, code, msg] of cases) {
			installFetch((call) => shell(call, () => envelope(null, status, code, msg)));
			const url = `http://console.example/projects/${PROJECT.id}?tab=catalog`;
			const failed = pageData(
				await projectLoad(
					fakeEvent({
						url,
						session: TOKEN,
						user: USER,
						projects: [PROJECT],
						params: { id: PROJECT.id }
					}).event as never
				)
			);
			assert.deepEqual(failed.copies, {});
			assert.equal(failed.copiesMessage, msg);
			assert.equal(failed.catalog.length, 1);
			setPageUrl(url);
			const html = decode(render(ProjectPage, { props: { data: failed as never, form: null } }).body);
			assert.match(html, /role="alert"/);
			assert.equal(html.includes(msg), true);
			// Unknown copies: no entry claims it is not deployed.
			assert.equal(html.includes('data-entry="api"'), true);
			assert.equal(html.includes('Not deployed yet.'), false);
		}
	});

	test('a row without health_checks says the API is too old, and a malformed one says unread', async () => {
		const legacy: Record<string, unknown> = projectItem();
		delete legacy.health_checks;
		installFetch((call) =>
			shell(call, () =>
				envelope({
					items: [legacy, projectItem({ id: CHECK_ID, health_checks: 'bad' })],
					total: 2,
					next_cursor: null,
					prev_cursor: null
				})
			)
		);
		const data = pageData(await loadAt(`http://console.example/projects/${PROJECT.id}?tab=catalog`));
		const apiCopies: ProjectServiceRow[] = data.copies.api ?? [];
		const byId = new Map(apiCopies.map((row) => [row.id, row]));
		assert.equal(byId.get(SERVICE_ID)?.checksMessage, CHECKS_NEED_API);
		assert.deepEqual(byId.get(SERVICE_ID)?.checks, []);
		assert.equal(byId.get(CHECK_ID)?.checksMessage, UNREAD_HEALTH_CHECKS);
		assert.deepEqual(byId.get(CHECK_ID)?.checks, []);
	});

	test('gone_at from the list payload reaches the loaded row', async () => {
		const gone = '2026-10-15T14:00:00Z';
		installFetch((call) =>
			shell(call, () =>
				envelope({ items: [projectItem({ gone_at: gone })], total: 1, next_cursor: null, prev_cursor: null })
			)
		);
		const data = pageData(await loadAt(`http://console.example/projects/${PROJECT.id}?tab=catalog`));
		assert.equal(data.copies.api?.[0]?.gone_at, gone);
		assert.equal(data.copiesMessage, null);
	});
});

/** An owned copy of entry `widget`, labelled Widget, with one HTTP check. */
function serviceRow(projectName: string, overrides: Partial<ProjectServiceRow> = {}): ProjectServiceRow {
	return {
		id: SERVICE_ID,
		name: 'widget',
		source: 'owned',
		kind: 'process',
		ports: [80],
		health: { status: 'up', last_checked_at: null, latency_ms: 1, source: null },
		last_seen_at: null,
		gone_at: null,
		display_name: 'Widget',
		owner_user: 'ada',
		project_id: PROJECT.id,
		host_id: HOST_ID,
		host_name: 'pi1',
		host_status: 'online',
		project_name: projectName,
		checks: [{ id: CHECK_ID, protocol: 'http', port: 80, path: '/health', enabled: true }],
		checksMessage: null,
		catalog_entry: 'widget',
		container_name: null,
		image_digest: null,
		...overrides
	};
}

const hostRow = (projectId: string): Host => ({
	...HOST,
	project_id: projectId,
	status: 'online'
});

/** The merged tab with these rows under their entries; the page URL is whatever the test set. */
function renderServices(rows: ProjectServiceRow[], extra: Record<string, unknown> = {}) {
	const { hosts, canAdmin, ...rest } = extra as { hosts?: Host[]; canAdmin?: boolean };
	const entries = [...new Set(rows.map((row) => row.catalog_entry ?? 'widget'))].map((name) => programCatalogEntry(name, ['logs']));
	return renderCopies({ rows, entries, hosts: hosts ?? [hostRow(PROJECT.id)], canAdmin: canAdmin ?? true, url: currentUrl, ...rest });
}

let currentUrl = `http://console.example/projects/${PROJECT.id}?tab=catalog`;

function setUrl(url: string | URL): void {
	currentUrl = String(url);
	setPageUrl(url);
}
test('an owned container shows its container name by default; a rename shows alone with the container name on hover', () => {
	setUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
	const owned = serviceRow('Lab', {
		name: 'aihub-edvisor',
		source: 'owned',
		kind: 'container',
		display_name: null,
		catalog_entry: 'aihub-edvisor',
		container_name: 'ai-hub-aihub-edvisor'
	});
	const plain = decode(renderServices([owned]));
	assert.match(plain, /title="ai-hub-aihub-edvisor">ai-hub-aihub-edvisor</);
	const renamed = decode(renderServices([{ ...owned, display_name: 'Edvisor' }]));
	assert.match(renamed, /title="Edvisor \(container ai-hub-aihub-edvisor\)">Edvisor</);
	assert.equal(renamed.replace(/ title="[^"]*"/g, '').includes('ai-hub-aihub-edvisor'), false);
});

test('there is no Project column, another project\'s row is not listed, and rename follows the edit rule', () => {
	setUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog&catalog.q=widget`);
	const same = decode(renderServices([serviceRow('Lab')]));
	assert.equal(same.includes('>Project<'), false);
	assert.match(same, /data-row-menu="[^"]*\brename\b[^"]*"/);
	const mixed = decode(renderServices([serviceRow('Lab'), serviceRow('Other', { id: CHECK_ID, project_id: OTHER_ID, project_name: 'Other' })]));
	assert.equal(mixed.includes('>Project<'), false);
	assert.equal(mixed.includes(`id="service-${CHECK_ID}"`), false);

	setUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
	const viewer = decode(renderServices([serviceRow('Lab')], { canAdmin: false }));
	assert.doesNotMatch(viewer, /data-row-menu="[^"]*\brename\b/);

	// This project's copy on a host another project owns (a deploy share) can still be renamed.
	const shared = decode(renderServices([serviceRow('Lab', { project_id: PROJECT.id })], { hosts: [hostRow(OTHER_ID)] }));
	assert.match(shared, /data-row-menu="[^"]*\brename\b[^"]*"/);
});

test('the project probe form keeps the table query and shows the service label', () => {
	const probe: ProbeView = {
		service: 'raw-name',
		protocol: 'http',
		port: 80,
		path: '/health',
		result: 'open',
		http_status: 204,
		latency_ms: 4,
		checked_at: '2026-10-14T00:00:00Z'
	};
	const pageUrl = new URL(
		`http://console.example/projects/${PROJECT.id}?tab=catalog&catalog.q=widget&catalog.sort=name&catalog.dir=asc&catalog.page=2`
	);
	const action = actionUrlFrom(pageUrl, 'probe');
	assert.equal(action, '?tab=catalog&catalog.q=widget&catalog.sort=name&catalog.dir=asc&catalog.page=2&/probe');
	setUrl(pageUrl);
	const html = decode(
		renderServices([serviceRow('Lab')], {
			probe,
			probeServiceId: SERVICE_ID
		})
	);
	assert.match(html, /Widget/);
	assert.match(html, />pi1</);
	assert.equal(html.includes('raw-name'), false);
	assert.equal(html.includes('http 80 /health'), true);
	assert.equal(html.includes('open'), true);
	assert.equal(html.includes('204'), true);
	assert.equal(html.includes(formatLatency(probe.latency_ms)), true);
	assert.equal(html.includes(formatWhen(probe.checked_at)), true);
});

test('a process row links for a member and stays plain text otherwise', () => {
	const sample: ProcessSample = {
		sampled_at: '2026-10-14T00:00:00Z',
		skipped: 0,
		items: [
			{
				pid: 3,
				process_name: 'node',
				user: 'bot',
				cmdline: 'node',
				service_id: SERVICE_ID,
				cpu_usage: 1,
				memory_rss: 1,
				memory_usage: 1,
				num_threads: 1,
				started_at: '2026-10-14T00:00:00Z'
			},
			{
				pid: 4,
				process_name: 'orphan',
				user: 'bot',
				cmdline: 'orphan',
				service_id: CHECK_ID,
				cpu_usage: 1,
				memory_rss: 1,
				memory_usage: 1,
				num_threads: 1,
				started_at: '2026-10-14T00:00:00Z'
			}
		]
	};
	const href = `/projects/${PROJECT.id}?tab=catalog&catalog.host=${HOST_ID}&catalog.q=api`;
	setPageUrl(`http://console.example/hosts/${HOST_ID}?tab=processes`);
	const linked = decode(
		render(ProcessesTab, {
			props: {
				sort: 'cpu',
				processes: sample,
				message: null,
				serviceLinks: { [SERVICE_ID]: { label: 'API', href } }
			}
		}).body
	);
	assert.equal(linked.includes(href), true);
	assert.equal(
		[...linked.matchAll(/<a\b[^>]*>API<\/a>/g)].some((match) => match[0].includes(`href="${href}"`)),
		true
	);
	assert.match(linked, />node</);
	assert.match(linked, />orphan</);
	assert.equal(linked.includes('>node</a>'), false);
	assert.match(linked, />service</);
	assert.equal(linked.includes('>service</a>'), false);
	assert.match(linked, />Process</);
	assert.match(linked, />Service</);

	const plain = decode(
		render(ProcessesTab, {
			props: {
				sort: 'cpu',
				processes: { ...sample, items: [sample.items[0]] },
				message: null,
				serviceLinks: { [SERVICE_ID]: { label: 'API', href: null } }
			}
		}).body
	);
	assert.equal(plain.includes(href), false);
	assert.match(plain, />node</);
	assert.match(plain, />API</);
	assert.equal(plain.includes('>API</a>'), false);
	assert.equal(plain.includes('>node</a>'), false);
});

test('a failed rename opens from the action result and a success closes it', () => {
	assert.deepEqual(nextRenameOpen({ open: false, sawFailure: false }, true), { open: true, sawFailure: true });
	assert.deepEqual(nextRenameOpen({ open: true, sawFailure: true }, true), { open: true, sawFailure: true });
	assert.deepEqual(nextRenameOpen({ open: false, sawFailure: true }, true), { open: false, sawFailure: true });
	assert.deepEqual(nextRenameOpen({ open: true, sawFailure: true }, false), { open: false, sawFailure: false });
	assert.deepEqual(nextRenameOpen({ open: true, sawFailure: false }, false), { open: true, sawFailure: false });
	assert.deepEqual(nextRenameOpen({ open: false, sawFailure: false }, false), { open: false, sawFailure: false });

	const failed = servicesRenameView({
		scope: 'catalog',
		message: 'conflict',
		renameServiceId: SERVICE_ID,
		displayName: '  Widget  '
	});
	assert.equal(failed.open, true);
	assert.equal(failed.renameServiceId, SERVICE_ID);
	assert.equal(failed.typedName, '  Widget  ');
	assert.deepEqual(servicesRenameView(null), { renameServiceId: null, typedName: null, open: false });
	assert.deepEqual(servicesRenameView({ scope: 'hosts', message: 'no' }), {
		renameServiceId: null,
		typedName: null,
		open: false
	});
	assert.deepEqual(servicesRenameView({ scope: 'catalog', message: 'saved' }), {
		renameServiceId: null,
		typedName: null,
		open: false
	});
	const opened = servicesRenameView({ scope: 'catalog', renameServiceId: SERVICE_ID });
	assert.equal(opened.open, true);
	assert.equal(opened.typedName, null);
});

test('the rename dialog posts display_name only when that row may be renamed', () => {
	const url = new URL(`http://console.example/projects/${PROJECT.id}?tab=catalog&catalog.q=widget`);
	setUrl(url);
	const html = decode(renderServices([serviceRow('Lab')]));
	assert.match(html, /data-row-menu="[^"]*\brename\b[^"]*"/);
	assert.equal(html.includes('name="display_name"'), false);

	const action = actionUrlFrom(url, 'rename');
	const form = decode(
		render(RenameForm, {
			props: { action, serviceId: SERVICE_ID, value: 'Widget' }
		}).body
	);
	assert.equal(form.includes(`action="${action}"`), true);
	assert.match(form, /method="POST"/);
	assert.equal(hiddenInput(form, 'service_id', SERVICE_ID), true);
	assert.match(form, /name="display_name"/);
	assert.match(form, /maxlength="64"/);
	assert.match(form, />Save</);
	assert.equal(namedControl(form, 'clear', '1'), true);
	assert.match(form, />Clear</);

	const blocked = decode(renderServices([serviceRow('Lab')], { canAdmin: false }));
	assert.equal(blocked.includes('name="display_name"'), false);
	assert.doesNotMatch(blocked, /data-row-menu="[^"]*\brename\b/);
	assert.equal(blocked.includes('>Save<'), false);
	assert.equal(blocked.includes('Widget'), true);

	setUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
	const unknownHost = decode(renderServices([serviceRow('Lab')], { hosts: [] }));
	assert.match(unknownHost, /data-row-menu="[^"]*\brename\b[^"]*"/);
	assert.equal(unknownHost.includes('name="display_name"'), false);
});

test('the host filter lists owned hosts and deploy shares', () => {
	const deployId = '00000000-0000-4000-8000-0000000000ee';
	const metricsId = '00000000-0000-4000-8000-0000000000dd';
	setUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog&catalog.q=widget&catalog.sort=name&catalog.dir=desc&catalog.page=2`);
	const html = decode(
		renderServices([serviceRow('Lab')], {
			hosts: [
				hostRow(PROJECT.id),
				{ ...hostRow(OTHER_ID), id: deployId, name: 'deploy-box', relation: 'shared', share_level: 'deploy' },
				{ ...hostRow(OTHER_ID), id: metricsId, name: 'metrics-box', relation: 'shared', share_level: 'metrics' }
			]
		})
	);
	assert.match(html, /name="catalog\.host"/);
	assert.match(html, /All hosts/);
	assert.match(html, />pi1</);
	assert.equal(html.includes('metrics-box'), false);
	assert.equal(html.includes(metricsId), false);
	assert.equal(serviceHostReachable(hostRow(PROJECT.id)), true);
	assert.equal(serviceHostReachable({ relation: 'shared', share_level: 'deploy' }), true);
	assert.equal(serviceHostReachable({ relation: 'shared', share_level: 'metrics' }), false);
	const deployBox = { ...hostRow(OTHER_ID), id: deployId, name: 'deploy-box', relation: 'shared' as const, share_level: 'deploy' as const };
	const metricsBox = { ...hostRow(OTHER_ID), id: metricsId, name: 'metrics-box', relation: 'shared' as const, share_level: 'metrics' as const };
	const choices = hostChoices([hostRow(PROJECT.id), deployBox, metricsBox]);
	assert.deepEqual(choices.map((host) => host.name), ['pi1', 'deploy-box']);
	assert.deepEqual(chosenHost(deployId, choices), { hostId: deployId, notice: null });
	assert.deepEqual(chosenHost(metricsId, choices), { hostId: null, notice: 'That host is not available for this project.' });
	assert.deepEqual(chosenHost('not-a-uuid', choices), { hostId: null, notice: 'That host is not available for this project.' });
	assert.deepEqual(chosenHost(null, choices), { hostId: null, notice: null });
	assert.deepEqual(chosenHost('', choices), { hostId: null, notice: null });
	const methodAt = html.indexOf('method="GET"');
	const hostForm = html.slice(html.lastIndexOf('<form', methodAt), html.indexOf('</form>', methodAt));
	assert.equal(hiddenInput(hostForm, 'catalog.q', 'widget'), true);
	assert.equal(hiddenInput(hostForm, 'catalog.sort', 'name'), true);
	assert.equal(hiddenInput(hostForm, 'catalog.dir', 'desc'), true);
	assert.equal(hostForm.includes('catalog.page'), false);
});

function hiddenInput(html: string, name: string, value: string): boolean {
	return [...html.matchAll(/<input\b[^>]*>/g)].some((match) => {
		const tag = match[0];
		return tag.includes('type="hidden"') && tag.includes(`name="${name}"`) && tag.includes(`value="${value}"`);
	});
}

function namedControl(html: string, name: string, value: string): boolean {
	return [...html.matchAll(/<(?:button|input)\b[^>]*>/g)].some((match) => {
		const tag = match[0];
		return tag.includes(`name="${name}"`) && tag.includes(`value="${value}"`);
	});
}
