import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { isActionFailure, isRedirect } from '@sveltejs/kit';
import { render } from 'svelte/server';
import type { Host, ProbeView, ProcessSample, ProjectServiceRow } from '../src/lib/api-types.ts';
import ProcessesTab from '../src/routes/hosts/[id]/ProcessesTab.svelte';
import { load as hostLoad } from '../src/routes/hosts/[id]/+page.server.ts';
import ProjectPage from '../src/routes/projects/[id]/+page.svelte';
import ServicesSection from '../src/routes/projects/[id]/ServicesSection.svelte';
import { actions as projectActions, load as projectLoad } from '../src/routes/projects/[id]/+page.server.ts';
import { formatLatency, formatWhen } from '../src/lib/format.ts';
import { serviceEditCancelHref, serviceEditHref } from '../src/lib/service-label.ts';
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
	share_level: null
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

function projectItem(overrides: Record<string, unknown> = {}) {
	return {
		...baseService(),
		host_id: HOST_ID,
		display_name: null,
		owner_user: 'ada',
		project_id: PROJECT.id,
		host_name: 'pi1',
		host_status: 'online',
		project_name: 'Lab',
		last_seen_at: '2026-10-14T00:00:00Z',
		...overrides
	};
}

function pageData<T>(value: T): Exclude<T, void | undefined | null> {
	if (value == null) assert.fail('missing page data');
	return value as Exclude<T, void | undefined | null>;
}

function shell(call: FetchCall, services: (call: FetchCall) => Response): Response {
	const id = PROJECT.id;
	if (call.url.pathname === `/v1/projects/${id}/services`) return services(call);
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

	function serviceList(calls: FetchCall[]): FetchCall | undefined {
		return calls.find((call) => call.url.pathname === `/v1/projects/${PROJECT.id}/services`);
	}

	test('the services load maps each query param onto the API url', async () => {
		const host = HOST_ID;
		const calls = installFetch((call) =>
			shell(call, () =>
				envelope({
					items: [projectItem()],
					total: 4,
					next_cursor: 'n',
					prev_cursor: null
				})
			)
		);
		const data = pageData(
			await projectLoad(
				fakeEvent({
					url: `http://console.example/projects/${PROJECT.id}?tab=services&services.q=api&services.host=${host}&services.sort=status&services.dir=desc&services.cursor=abc`,
					session: TOKEN,
					user: USER,
					projects: [PROJECT],
					params: { id: PROJECT.id }
				}).event as never
			)
		);
		const listed = serviceList(calls);
		assert.ok(listed);
		assert.equal(listed.url.searchParams.get('q'), 'api');
		assert.equal(listed.url.searchParams.get('host_id'), host);
		assert.equal(listed.url.searchParams.get('sort'), 'status');
		assert.equal(listed.url.searchParams.get('dir'), 'desc');
		assert.equal(listed.url.searchParams.get('limit'), '25');
		assert.equal(listed.url.searchParams.get('cursor'), 'abc');
		assert.equal(data.tab, 'services');
		assert.equal(data.services[0]?.name, 'api');
		assert.equal(data.servicesTotal, 4);
		assert.equal(data.servicesNext, 'n');
		assert.equal(data.servicesMessage, null);

		const droppedUrl = `http://console.example/projects/${PROJECT.id}?tab=services&services.host=not-a-uuid&services.cursor=${'c'.repeat(513)}`;
		const droppedCalls = installFetch((call) =>
			shell(call, () => envelope({ items: [projectItem()], total: 1, next_cursor: null, prev_cursor: null }))
		);
		const dropped = pageData(
			await projectLoad(
				fakeEvent({
					url: droppedUrl,
					session: TOKEN,
					user: USER,
					projects: [PROJECT],
					params: { id: PROJECT.id }
				}).event as never
			)
		);
		const droppedList = serviceList(droppedCalls);
		assert.ok(droppedList);
		assert.equal(droppedList.url.searchParams.has('q'), false);
		assert.equal(droppedList.url.searchParams.has('host_id'), false);
		assert.equal(droppedList.url.searchParams.has('cursor'), false);
		assert.equal(droppedList.url.searchParams.get('sort'), 'name');
		assert.equal(droppedList.url.searchParams.get('dir'), 'asc');
		assert.equal(droppedList.url.searchParams.get('limit'), '25');
		assert.equal(dropped.services[0]?.name, 'api');
		assert.equal(dropped.servicesTotal, 1);
		assert.equal(
			dropped.servicesMessage,
			'That host is not available for this project. That page link is not valid.'
		);
		setPageUrl(droppedUrl);
		const droppedHtml = decode(render(ProjectPage, { props: { data: dropped as never, form: null } }).body);
		assert.match(droppedHtml, /role="alert"/);
		assert.match(droppedHtml, /That host is not available for this project\./);
		assert.match(droppedHtml, /That page link is not valid\./);

		const lastSeenCalls = installFetch((call) =>
			shell(call, () => envelope({ items: [], total: 0, next_cursor: null, prev_cursor: null }))
		);
		const lastSeen = pageData(
			await projectLoad(
				fakeEvent({
					url: `http://console.example/projects/${PROJECT.id}?tab=services&services.sort=last_seen`,
					session: TOKEN,
					user: USER,
					projects: [PROJECT],
					params: { id: PROJECT.id }
				}).event as never
			)
		);
		const lastSeenList = serviceList(lastSeenCalls);
		assert.ok(lastSeenList);
		assert.equal(lastSeenList.url.searchParams.get('sort'), 'last_seen');
		assert.equal(lastSeenList.url.searchParams.get('dir'), 'desc');
		assert.equal(lastSeen.services.length, 0);
		assert.equal(lastSeen.servicesMessage, null);

		const tooLong = installFetch((call) => shell(call, () => envelope(null, 500, 'error', 'should not list')));
		const refused = pageData(
			await projectLoad(
				fakeEvent({
					url: `http://console.example/projects/${PROJECT.id}?tab=services&services.q=${'a'.repeat(101)}`,
					session: TOKEN,
					user: USER,
					projects: [PROJECT],
					params: { id: PROJECT.id }
				}).event as never
			)
		);
		assert.equal(refused.servicesMessage, 'Search must be at most 100 characters.');
		assert.equal(tooLong.some((call) => call.url.pathname === `/v1/projects/${PROJECT.id}/services`), false);

		installFetch((call) => shell(call, () => envelope({ items: [projectItem()], next_cursor: null })));
		const malformed = pageData(
			await projectLoad(
				fakeEvent({
					url: `http://console.example/projects/${PROJECT.id}?tab=services`,
					session: TOKEN,
					user: USER,
					projects: [PROJECT],
					params: { id: PROJECT.id }
				}).event as never
			)
		);
		assert.equal(malformed.services.length, 0);
		assert.equal(malformed.servicesMessage, 'The API returned an unexpected response.');

		const metricsId = '00000000-0000-4000-8000-0000000000ee';
		const unreachableUrl = `http://console.example/projects/${PROJECT.id}?tab=services&services.host=${metricsId}`;
		const unreachableCalls = installFetch((call) => {
			if (call.url.pathname === `/v1/projects/${PROJECT.id}/hosts`) {
				return envelope({
					items: [HOST, { ...HOST, id: metricsId, name: 'metrics-box', relation: 'shared', share_level: 'metrics' }],
					next_cursor: null
				});
			}
			return shell(call, () => envelope({ items: [projectItem()], total: 2, next_cursor: null, prev_cursor: null }));
		});
		const unreachable = pageData(
			await projectLoad(
				fakeEvent({
					url: unreachableUrl,
					session: TOKEN,
					user: USER,
					projects: [PROJECT],
					params: { id: PROJECT.id }
				}).event as never
			)
		);
		const unreachableList = serviceList(unreachableCalls);
		assert.ok(unreachableList);
		assert.equal(unreachableList.url.searchParams.has('host_id'), false);
		assert.equal(unreachable.services[0]?.name, 'api');
		assert.equal(unreachable.servicesTotal, 2);
		assert.equal(unreachable.servicesMessage, 'That host is not available for this project.');
		setPageUrl(unreachableUrl);
		const unreachableHtml = decode(render(ProjectPage, { props: { data: unreachable as never, form: null } }).body);
		assert.match(unreachableHtml, /role="alert"/);
		assert.match(unreachableHtml, /That host is not available for this project\./);
	});

	test('rename keeps the table query, drops services.edit, and keeps a rejected value', async () => {
		const url = `http://console.example/projects/${PROJECT.id}?tab=services&services.q=api&services.sort=host&services.dir=asc&services.cursor=abc&services.edit=${SERVICE_ID}&/rename`;
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
				assert.equal(dest.searchParams.get('tab'), 'services');
				assert.equal(dest.searchParams.get('services.q'), 'api');
				assert.equal(dest.searchParams.get('services.sort'), 'host');
				assert.equal(dest.searchParams.get('services.dir'), 'asc');
				assert.equal(dest.searchParams.get('services.cursor'), 'abc');
				assert.equal(dest.searchParams.has('services.edit'), false);
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
			setPageUrl(url);
			const rejectedHtml = decode(
				renderServices([serviceRow('Lab')], {
					message: rejectedData.message,
					renameServiceId: rejectedData.renameServiceId,
					typedName: rejectedData.displayName
				})
			);
			assert.match(rejectedHtml, /role="alert"/);
			assert.equal(rejectedHtml.includes(code), true);
			assert.equal(rejectedHtml.includes('value="  Widget  "'), true);
			assert.match(rejectedHtml, /name="display_name"/);
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
				url: `http://console.example/projects/${PROJECT.id}?tab=services&services.q=api&services.cursor=abc&/probe`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: { service_id: SERVICE_ID, check_id: CHECK_ID }
			}).event as never
		);
		assert.equal(isActionFailure(probe), false);
		if (!probe || isActionFailure(probe)) assert.fail('expected a probe result');
		assert.equal(probe.scope, 'services');
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
				err.location === `/projects/${PROJECT.id}?tab=services&services.host=${HOST_ID}`
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
				err.location === `/projects/${SECOND_ID}?tab=services&services.host=${HOST_ID}`
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

	test('a process links to the service project only when the caller is a member', async () => {
		const serviceBody = {
			items: [baseService({ project_id: PROJECT.id, display_name: 'API', name: 'api' })],
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
			`/projects/${PROJECT.id}?tab=services&services.host=${HOST_ID}&services.q=api`
		);
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
		const url = `http://console.example/projects/${PROJECT.id}?tab=services&/rename`;
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

	test('a viewer load shows the services tab, no rename, and the probe control', async () => {
		installFetch((call) => {
			if (call.url.pathname === `/v1/projects/${PROJECT.id}`) return envelope({ ...PROJECT, role: 'viewer' });
			if (call.url.pathname === `/v1/projects/${PROJECT.id}/hosts`) return envelope({ items: [HOST], next_cursor: null });
			if (call.url.pathname === `/v1/projects/${PROJECT.id}/members`) return envelope({ items: [], next_cursor: null });
			if (call.url.pathname === `/v1/projects/${PROJECT.id}/services`) {
				return envelope({ items: [projectItem()], total: 1, next_cursor: null, prev_cursor: null });
			}
			if (call.url.pathname === `/v1/services/${SERVICE_ID}`) {
				return envelope({
					health_checks: [{ id: CHECK_ID, protocol: 'http', port: 80, path: '/health', enabled: true }]
				});
			}
			return envelope(null, 500, 'error', 'unexpected');
		});
		const url = `http://console.example/projects/${PROJECT.id}?tab=services`;
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
		assert.equal(data.tab, 'services');
		assert.equal(data.canAdmin, false);
		assert.equal(data.services[0]?.checks.length, 1);
		setPageUrl(url);
		const html = decode(render(ProjectPage, { props: { data: data as never, form: null } }).body);
		assert.match(html, /aria-current="page">Services</);
		assert.equal(html.includes('>Rename<'), false);
		assert.match(html, />Probe</);
	});

	test('a search over 100 characters or containing NUL is refused before the API', async () => {
		for (const raw of ['a'.repeat(201), `  ${'b'.repeat(101)}`, 'bad\0name']) {
			const url = new URL(`http://console.example/projects/${PROJECT.id}?tab=services`);
			url.searchParams.set('services.q', raw);
			const calls = installFetch((call) => shell(call, () => envelope(null, 500, 'error', 'should not list')));
			const refused = pageData(
				await projectLoad(
					fakeEvent({
						url: url.href,
						session: TOKEN,
						user: USER,
						projects: [PROJECT],
						params: { id: PROJECT.id }
					}).event as never
				)
			);
			assert.equal(calls.some((call) => call.url.pathname === `/v1/projects/${PROJECT.id}/services`), false);
			assert.equal(refused.servicesMessage, 'Search must be at most 100 characters.');
			assert.equal(refused.services.length, 0);
		}
	});

	test('a deploy-share host id is sent as host_id', async () => {
		const deployId = '00000000-0000-4000-8000-0000000000ef';
		const calls = installFetch((call) => {
			if (call.url.pathname === `/v1/projects/${PROJECT.id}/hosts`) {
				return envelope({
					items: [HOST, { ...HOST, id: deployId, name: 'deploy-box', relation: 'shared', share_level: 'deploy' }],
					next_cursor: null
				});
			}
			return shell(call, () => envelope({ items: [projectItem()], total: 1, next_cursor: null, prev_cursor: null }));
		});
		const data = pageData(
			await projectLoad(
				fakeEvent({
					url: `http://console.example/projects/${PROJECT.id}?tab=services&services.host=${deployId}`,
					session: TOKEN,
					user: USER,
					projects: [PROJECT],
					params: { id: PROJECT.id }
				}).event as never
			)
		);
		const listed = serviceList(calls);
		assert.ok(listed);
		assert.equal(listed.url.searchParams.get('host_id'), deployId);
		assert.equal(data.servicesMessage, null);
		assert.equal(data.services[0]?.name, 'api');
	});

	test('a services list error sets the notice', async () => {
		const cases = [
			[400, 'bad_request', 'bad search'],
			[403, 'forbidden', 'not allowed'],
			[503, 'unavailable', 'api down'],
			[504, 'timeout', 'too slow']
		] as const;
		for (const [status, code, msg] of cases) {
			installFetch((call) => shell(call, () => envelope(null, status, code, msg)));
			const url = `http://console.example/projects/${PROJECT.id}?tab=services`;
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
			assert.equal(failed.services.length, 0);
			assert.equal(failed.servicesMessage, msg);
			setPageUrl(url);
			const html = decode(render(ProjectPage, { props: { data: failed as never, form: null } }).body);
			assert.match(html, /role="alert"/);
			assert.equal(html.includes(msg), true);
		}
	});
});

function serviceRow(projectName: string, overrides: Partial<ProjectServiceRow> = {}): ProjectServiceRow {
	return {
		id: SERVICE_ID,
		name: 'port-80',
		source: 'discovered',
		kind: 'process',
		ports: [80],
		health: { status: 'up', last_checked_at: null, latency_ms: 1 },
		last_seen_at: null,
		display_name: 'Widget',
		owner_user: 'ada',
		project_id: PROJECT.id,
		host_id: HOST_ID,
		host_name: 'pi1',
		host_status: 'online',
		project_name: projectName,
		checks: [{ id: CHECK_ID, protocol: 'http', port: 80, path: '/health', enabled: true }],
		checksMessage: null,
		...overrides
	};
}

const hostRow = (projectId: string): Host => ({
	...HOST,
	project_id: projectId,
	status: 'online'
});

function renderServices(rows: ProjectServiceRow[], extra: Record<string, unknown> = {}) {
	return render(ServicesSection, {
		props: {
			projectId: PROJECT.id,
			projectName: 'Lab',
			hosts: [hostRow(PROJECT.id)],
			canAdmin: true,
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
			...extra
		}
	}).body;
}

test('the Project column renders only when a row is from another project', () => {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=services&services.q=api`);
	const same = decode(renderServices([serviceRow('Lab')]));
	assert.equal(same.includes('>Project<'), false);
	const mixed = decode(renderServices([serviceRow('Lab'), serviceRow('Other', { id: CHECK_ID, project_name: 'Other' })]));
	assert.equal(mixed.includes('>Project<'), true);
	assert.equal(same.includes('>Rename<'), true);

	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=services`);
	const viewer = decode(
		renderServices([serviceRow('Lab')], {
			canAdmin: false
		})
	);
	assert.equal(viewer.includes('>Rename<'), false);

	const foreign = decode(
		renderServices([serviceRow('Other', { project_id: OTHER_ID, project_name: 'Other' })], {
			hosts: [hostRow(OTHER_ID)]
		})
	);
	assert.equal(foreign.includes('>Rename<'), false);

	const shared = decode(
		renderServices([serviceRow('Lab', { project_id: PROJECT.id })], {
			hosts: [hostRow(OTHER_ID)]
		})
	);
	assert.equal(shared.includes('>Rename<'), true);
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
		`http://console.example/projects/${PROJECT.id}?tab=services&services.q=api&services.sort=name&services.dir=asc&services.cursor=abc`
	);
	const action = actionUrlFrom(pageUrl, 'probe');
	assert.equal(action, '?tab=services&services.q=api&services.sort=name&services.dir=asc&services.cursor=abc&/probe');
	assert.equal(action.includes('services.q=api'), true);
	assert.equal(action.includes('services.sort'), true);
	assert.equal(action.includes('&/probe'), true);
	assert.equal(action.includes('services.edit'), false);
	setPageUrl(pageUrl);
	const html = decode(
		renderServices([serviceRow('Lab')], {
			probe,
			probeServiceId: SERVICE_ID
		})
	);
	assert.equal(html.includes(`action="${action}"`), true);
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
	const href = `/projects/${PROJECT.id}?tab=services&services.host=${HOST_ID}&services.q=api`;
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
	assert.equal(linked.includes(`<a href="${href}">API</a>`), true);
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

test('services.edit renders the rename form only when that row may be renamed', () => {
	const url = new URL(
		`http://console.example/projects/${PROJECT.id}?tab=services&services.q=api&services.edit=${SERVICE_ID}`
	);
	setPageUrl(url);
	const html = decode(renderServices([serviceRow('Lab')]));
	const action = actionUrlFrom(url, 'rename');
	assert.equal(html.includes(`action="${action}"`), true);
	assert.match(html, /method="POST"/);
	assert.match(html, new RegExp(`name="service_id"[^>]*value="${SERVICE_ID}"`));
	assert.match(html, /name="display_name"/);
	assert.match(html, /maxlength="64"/);
	assert.match(html, />Save</);
	assert.match(html, /name="clear"[^>]*value="1"/);
	assert.match(html, />Clear</);
	assert.equal(html.includes(`href="${serviceEditCancelHref(url)}"`), true);
	assert.equal(html.includes('>Rename<'), false);

	const blocked = decode(
		renderServices([serviceRow('Other', { project_id: OTHER_ID, project_name: 'Other' })], {
			hosts: [hostRow(OTHER_ID)]
		})
	);
	assert.equal(blocked.includes('name="display_name"'), false);
	assert.equal(blocked.includes('>Rename<'), false);
	assert.equal(blocked.includes('>Save<'), false);
	assert.equal(blocked.includes('Widget'), true);

	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=services`);
	const unknownHost = decode(renderServices([serviceRow('Lab')], { hosts: [] }));
	assert.match(unknownHost, />Rename</);
	assert.equal(unknownHost.includes(serviceEditHref(new URL(`http://console.example/projects/${PROJECT.id}?tab=services`), SERVICE_ID)), true);
});

test('the host filter lists owned hosts and deploy shares', () => {
	const deployId = '00000000-0000-4000-8000-0000000000ee';
	const metricsId = '00000000-0000-4000-8000-0000000000dd';
	setPageUrl(
		`http://console.example/projects/${PROJECT.id}?tab=services&services.q=api&services.sort=host&services.dir=desc&services.cursor=abc`
	);
	const html = decode(
		renderServices([serviceRow('Lab')], {
			hosts: [
				hostRow(PROJECT.id),
				{ ...hostRow(OTHER_ID), id: deployId, name: 'deploy-box', relation: 'shared', share_level: 'deploy' },
				{ ...hostRow(OTHER_ID), id: metricsId, name: 'metrics-box', relation: 'shared', share_level: 'metrics' }
			]
		})
	);
	assert.match(html, /name="services\.host"/);
	assert.match(html, />All hosts</);
	assert.match(html, />pi1</);
	assert.match(html, />deploy-box</);
	assert.equal(html.includes('metrics-box'), false);
	assert.equal(html.includes(metricsId), false);
	assert.equal(html.includes(deployId), true);
	const hostForm = html.slice(html.indexOf('class="form-row"'), html.indexOf('</form>'));
	assert.equal(hiddenInput(hostForm, 'services.q', 'api'), true);
	assert.equal(hiddenInput(hostForm, 'services.sort', 'host'), true);
	assert.equal(hiddenInput(hostForm, 'services.dir', 'desc'), true);
	assert.equal(hostForm.includes('services.cursor'), false);
});

function hiddenInput(html: string, name: string, value: string): boolean {
	return [...html.matchAll(/<input\b[^>]*>/g)].some((match) => {
		const tag = match[0];
		return tag.includes('type="hidden"') && tag.includes(`name="${name}"`) && tag.includes(`value="${value}"`);
	});
}
