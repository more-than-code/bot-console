import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { isRedirect } from '@sveltejs/kit';
import { render } from 'svelte/server';
import type { Host, ProjectServiceRow } from '../src/lib/api-types.ts';
import {
	NO_PORTS_FOR_CHECKS,
	blankCheck,
	catalogEntryHref,
	dockerCheckFromEntry,
	dockerCheckTimings,
	emptyChecksText,
	formatArgv
} from '../src/lib/health-checks.ts';
import { CATALOG_TABLE_ID } from '../src/lib/table.ts';
import { parseCatalogEntry } from '../src/lib/server/shape.ts';
import DockerHealthNote from '../src/routes/projects/[id]/DockerHealthNote.svelte';
import { load as projectLoad } from '../src/routes/projects/[id]/+page.server.ts';
import { envelope, fakeEvent, installFetch, PROJECT, restoreEnv, TOKEN, useApi, USER, type FetchCall } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

const HOST_ID = '00000000-0000-4000-8000-0000000000aa';
const SERVICE_ID = '00000000-0000-4000-8000-0000000000bb';
const OTHER_SERVICE_ID = '00000000-0000-4000-8000-0000000000bd';
const ENTRY_ID = '00000000-0000-4000-8000-0000000000c1';
const HASH = 'ab'.repeat(32);
const FOREIGN_PROJECT_ID = '00000000-0000-4000-8000-000000000077';

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

const DOCKER_HEALTH = { status: 'up', last_checked_at: '2026-10-14T00:00:00Z', latency_ms: null, source: 'docker' };

function serviceItem(overrides: Record<string, unknown> = {}) {
	return {
		id: SERVICE_ID,
		name: 'web',
		source: 'owned',
		kind: 'container',
		ports: [],
		health: DOCKER_HEALTH,
		host_id: HOST_ID,
		display_name: null,
		owner_user: null,
		project_id: PROJECT.id,
		host_name: 'pi1',
		host_status: 'online',
		project_name: 'Lab',
		last_seen_at: '2026-10-14T00:00:00Z',
		catalog_entry: 'web',
		container_name: 'web-1',
		image_digest: null,
		health_checks: [],
		...overrides
	};
}

function catalogItem(name: string, healthcheck: unknown) {
	return {
		id: ENTRY_ID,
		project_id: PROJECT.id,
		name,
		kind: 'image',
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
			timeout_sec: 0,
			healthcheck
		},
		spec_hash: HASH,
		command_display: 'ghcr.io/acme/web:1',
		created_by: USER.id,
		created_at: '2026-10-14T00:00:00Z',
		updated_at: '2026-10-14T00:00:00Z',
		my_actions: ['logs']
	};
}

describe('health check empty state', () => {
	test('no ports says why there is no check; ports keep "No health checks."', () => {
		assert.equal(emptyChecksText([], []), NO_PORTS_FOR_CHECKS);
		assert.equal(
			NO_PORTS_FOR_CHECKS,
			"This service reports no open ports, so a TCP or HTTP check isn't possible. Ports appear when the host reports them."
		);
		assert.equal(emptyChecksText([80], []), 'No health checks.');
		assert.equal(emptyChecksText([], [blankCheck('tcp', 80, 'a')]), null);
		assert.equal(emptyChecksText([80], [blankCheck('tcp', 80, 'a')]), null);
	});

	test('the dialog renders the empty-state text and the Docker note in the Docker branch', () => {
		// bits-ui does not include dialog content in SSR, so this checks the markup the dialog renders.
		const dialog = readFileSync(new URL('../src/routes/projects/[id]/HealthChecks.svelte', import.meta.url), 'utf8');
		assert.match(dialog, /emptyChecksText\(\s*ports\s*,\s*drafts\s*\)/);
		assert.match(dialog, /\{#if emptyText\}\s*<p\b[^>]*>\{emptyText\}<\/p>\s*\{\/if\}/);
		assert.equal(dialog.includes('>No health checks.<'), false);
		assert.match(dialog, /addCheckLabel\(\s*port\s*\)/);
		const branch = dialog.match(/\{#if health\?\.source === 'docker'\}([\s\S]*?)\{\/if\}/)?.[1] ?? '';
		assert.match(branch, /<DockerHealthNote\b[^>]*\{dockerCheck\}[^>]*\{catalogEntry\}[^>]*onNavigate=\{\(\) => \(open = false\)\}/);
		assert.equal(dialog.includes('{@html'), false);
		const note = readFileSync(new URL('../src/routes/projects/[id]/DockerHealthNote.svelte', import.meta.url), 'utf8');
		assert.equal(note.includes('{@html'), false);
	});

	test('the services table passes this project\'s catalog entry and the Docker check to the dialog', () => {
		const section = readFileSync(new URL('../src/routes/projects/[id]/ServicesSection.svelte', import.meta.url), 'utf8');
		const tag = section.match(/<HealthChecks\b[\s\S]*?\/>/)?.[0] ?? '';
		assert.match(tag, /catalogEntry=\{service\.project_id === projectId \? service\.catalog_entry : null\}/);
		assert.match(tag, /dockerCheck=\{service\.dockerCheck \?\? null\}/);
		const catalog = readFileSync(new URL('../src/routes/projects/[id]/CatalogSection.svelte', import.meta.url), 'utf8');
		assert.match(catalog, /id=\{CATALOG_TABLE_ID\}/);
		assert.equal(CATALOG_TABLE_ID, 'catalog');
	});
});

describe('Docker health note', () => {
	test('a catalog healthcheck shows the command, timings, and the catalog link', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=services`);
		const html = render(DockerHealthNote, {
			props: {
				dockerCheck: { test: ['sh', '-c', 'curl -f http://localhost/<x> || exit 1'], intervalSec: 10, timeoutSec: 2, retries: 4 },
				catalogEntry: 'web'
			}
		}).body;
		assert.equal(html.includes('Docker runs (from the catalog entry):'), true);
		assert.equal(html.includes('<code class="font-mono break-all">sh -c "curl -f http://localhost/&lt;x> || exit 1"</code>'), true);
		assert.equal(html.includes('<span class="whitespace-nowrap">every 10 s, timeout 2 s, 4 retries</span>'), true);
		assert.match(html, /<a [^>]*href="\?tab=catalog&amp;catalog\.q=web"[^>]*>Edit the Docker health check in the catalog<\/a>/);
		assert.match(html, /<span class="text-muted-foreground">Changes apply on the next deploy\.<\/span>/);
	});

	test('the image default and an unknown check', () => {
		const imageDefault = render(DockerHealthNote, { props: { dockerCheck: 'image-default', catalogEntry: 'web' } }).body;
		assert.equal(imageDefault.includes("Docker uses the image's own HEALTHCHECK.") || imageDefault.includes('Docker uses the image&#39;s own HEALTHCHECK.'), true);
		assert.equal(imageDefault.includes('Docker runs'), false);
		assert.equal(imageDefault.includes('Edit the Docker health check in the catalog'), true);
		const unknown = render(DockerHealthNote, { props: { dockerCheck: null, catalogEntry: 'web' } }).body;
		assert.equal(unknown.includes('Docker runs'), false);
		assert.equal(unknown.includes('HEALTHCHECK'), false);
		assert.equal(unknown.includes('Edit the Docker health check in the catalog'), true);
		const foreign = render(DockerHealthNote, { props: { dockerCheck: null, catalogEntry: null } }).body;
		assert.equal(foreign.includes('Edit the Docker health check'), false);
		assert.equal(foreign.includes('Changes apply'), false);
		assert.equal(catalogEntryHref('web-api'), '?tab=catalog&catalog.q=web-api');
	});

	test('an entry maps to its healthcheck, the image default, or unknown', () => {
		const custom = parseCatalogEntry(catalogItem('web', { test: ['probe'], interval_sec: 10, timeout_sec: 2, retries: 1, start_period_sec: 5 }));
		assert.deepEqual(dockerCheckFromEntry(custom ?? undefined), { test: ['probe'], intervalSec: 10, timeoutSec: 2, retries: 1 });
		const plain = parseCatalogEntry(catalogItem('web', null));
		assert.equal(dockerCheckFromEntry(plain ?? undefined), 'image-default');
		assert.equal(dockerCheckFromEntry(undefined), null);
	});

	test('a program entry gives null', () => {
		const program = {
			id: ENTRY_ID,
			project_id: PROJECT.id,
			name: 'web',
			kind: 'program',
			spec: {},
			spec_hash: HASH,
			command_display: 'web',
			created_by: USER.id,
			created_at: '2026-10-14T00:00:00Z',
			updated_at: '2026-10-14T00:00:00Z',
			my_actions: ['logs']
		} as unknown as Parameters<typeof dockerCheckFromEntry>[0];
		assert.equal(dockerCheckFromEntry(program), null);
	});

	test('timings say "1 retry" and "N retries"', () => {
		const check = { test: ['probe'], intervalSec: 30, timeoutSec: 5 };
		assert.equal(dockerCheckTimings({ ...check, retries: 1 }), 'every 30 s, timeout 5 s, 1 retry');
		assert.equal(dockerCheckTimings({ ...check, retries: 3 }), 'every 30 s, timeout 5 s, 3 retries');
	});

	test('formatArgv quotes an empty argument or one with whitespace or a quote', () => {
		assert.equal(formatArgv(['sh', '-c', 'curl -f http://x || exit 1']), 'sh -c "curl -f http://x || exit 1"');
		assert.equal(formatArgv(['curl', '-f', 'http://localhost/health']), 'curl -f http://localhost/health');
		assert.equal(formatArgv(['echo', '']), 'echo ""');
		assert.equal(formatArgv(['echo', 'say "hi"']), 'echo "say \\"hi\\""');
		assert.equal(formatArgv(['echo', 'it\'s']), 'echo "it\'s"');
		assert.equal(formatArgv(['a\tb']), '"a\tb"');
	});
});

describe('services load with Docker health', { concurrency: false }, () => {
	const originalFetch = globalThis.fetch;

	before(() => {
		useApi('https://api.test');
	});

	after(() => {
		globalThis.fetch = originalFetch;
		restoreEnv();
	});

	function respond(items: unknown[], catalog: () => Response) {
		return (call: FetchCall): Response => {
			const id = PROJECT.id;
			if (call.url.pathname === `/v1/projects/${id}`) return envelope(PROJECT);
			if (call.url.pathname === `/v1/projects/${id}/hosts`) return envelope({ items: [HOST], next_cursor: null });
			if (call.url.pathname === `/v1/projects/${id}/services`) {
				return envelope({ items, total: items.length, next_cursor: null, prev_cursor: null });
			}
			if (call.url.pathname === `/v1/projects/${id}/catalog`) return catalog();
			return envelope(null, 500, 'error', 'unexpected');
		};
	}

	async function loadServices(
		role: 'admin' | 'viewer' = 'admin'
	): Promise<{ services: ProjectServiceRow[]; servicesMessage: string | null; message: string | null }> {
		const loaded = await projectLoad(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=services`,
				session: TOKEN,
				user: USER,
				projects: [{ ...PROJECT, role }],
				params: { id: PROJECT.id }
			}).event as never
		);
		return loaded as never;
	}

	function catalogCalls(calls: FetchCall[]): number {
		return calls.filter((call) => call.url.pathname === `/v1/projects/${PROJECT.id}/catalog`).length;
	}

	test('no Docker row with a catalog entry makes no catalog call', async () => {
		const calls = installFetch(
			respond(
				[
					serviceItem({ health: { ...DOCKER_HEALTH, source: 'check' } }),
					serviceItem({ id: OTHER_SERVICE_ID, catalog_entry: null })
				],
				() => envelope({ items: [], next_cursor: null })
			)
		);
		const data = await loadServices();
		assert.equal(catalogCalls(calls), 0);
		assert.equal(data.services.length, 2);
		assert.equal(data.services.every((row) => row.dockerCheck === undefined), true);
	});

	test('Docker rows share one catalog call and get their entry healthcheck', async () => {
		const calls = installFetch(
			respond(
				[
					serviceItem(),
					serviceItem({ id: OTHER_SERVICE_ID, name: 'db', catalog_entry: 'db' }),
					serviceItem({ id: '00000000-0000-4000-8000-0000000000be', name: 'gone', catalog_entry: 'missing' })
				],
				() =>
					envelope({
						items: [
							catalogItem('web', { test: ['curl', '-f', 'http://localhost/'], interval_sec: 15, timeout_sec: 3, retries: 2, start_period_sec: 0 }),
							{ ...catalogItem('db', null), id: '00000000-0000-4000-8000-0000000000c2' }
						],
						next_cursor: null
					})
			)
		);
		const data = await loadServices();
		assert.equal(catalogCalls(calls), 1);
		const call = calls.find((item) => item.url.pathname === `/v1/projects/${PROJECT.id}/catalog`);
		assert.equal(call?.url.search, '');
		assert.deepEqual(data.services[0]?.dockerCheck, { test: ['curl', '-f', 'http://localhost/'], intervalSec: 15, timeoutSec: 3, retries: 2 });
		assert.equal(data.services[1]?.dockerCheck, 'image-default');
		assert.equal(data.services[2]?.dockerCheck, null);
		assert.equal(data.servicesMessage, null);
	});

	test('a failed catalog read leaves the Docker line unknown and shows no error', async () => {
		const calls = installFetch(respond([serviceItem()], () => envelope(null, 500, 'error', 'boom')));
		const data = await loadServices();
		assert.equal(catalogCalls(calls), 1);
		assert.equal(data.services.length, 1);
		assert.equal(data.services[0]?.dockerCheck, null);
		assert.equal(data.servicesMessage, null);
		assert.equal(data.message, null);
	});

	test('a 403 or 404 catalog read, or a malformed body, leaves the line unknown like the other loaders', async () => {
		for (const response of [
			() => envelope(null, 403, 'forbidden', 'no'),
			() => envelope(null, 404, 'not_found', 'no'),
			() => envelope({ entries: 'nope' })
		]) {
			installFetch(respond([serviceItem()], response));
			const data = await loadServices();
			assert.equal(data.services[0]?.dockerCheck, null);
			assert.equal(data.servicesMessage, null);
		}
	});

	test('a 401 catalog read redirects to sign in', async () => {
		installFetch(respond([serviceItem()], () => envelope(null, 401, 'unauthorized', 'expired')));
		await assert.rejects(loadServices(), (err: unknown) => isRedirect(err) && err.status === 303);
	});

	test('a row from another project gets no Docker check even when this catalog has that name', async () => {
		const calls = installFetch(
			respond(
				[serviceItem({ project_id: FOREIGN_PROJECT_ID, project_name: 'Other' })],
				() => envelope({ items: [catalogItem('web', null)], next_cursor: null })
			)
		);
		const data = await loadServices();
		assert.equal(catalogCalls(calls), 0);
		assert.equal(data.services[0]?.dockerCheck, undefined);

		const mixed = installFetch(
			respond(
				[serviceItem(), serviceItem({ id: OTHER_SERVICE_ID, project_id: FOREIGN_PROJECT_ID, project_name: 'Other' })],
				() => envelope({ items: [catalogItem('web', null)], next_cursor: null })
			)
		);
		const both = await loadServices();
		assert.equal(catalogCalls(mixed), 1);
		assert.equal(both.services[0]?.dockerCheck, 'image-default');
		assert.equal(both.services[1]?.dockerCheck, undefined);
	});

	test('a viewer makes no catalog call and gets no Docker check', async () => {
		const calls = installFetch(respond([serviceItem()], () => envelope({ items: [catalogItem('web', null)], next_cursor: null })));
		const data = await loadServices('viewer');
		assert.equal(catalogCalls(calls), 0);
		assert.equal(data.services[0]?.dockerCheck, undefined);
	});
});
