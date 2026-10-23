import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { isActionFailure, isRedirect } from '@sveltejs/kit';
import { render } from 'svelte/server';
import type { CatalogGrant, Host, Member, ProgramEntry, ProjectServiceRow } from '../src/lib/api-types.ts';
import {
	APPROVAL_WAIT,
	hoistPreviewEnv,
	previewToken,
	reuseIdempotencyKey,
	runAsChoices,
	shellRisk,
	shouldApplyPreviewUpdate,
	submitCatalogPreview
} from '../src/lib/catalog.ts';
import type { CatalogEditorState, CatalogRunState } from '../src/lib/project-action.ts';
import CatalogApprovals from '../src/routes/hosts/[id]/CatalogApprovals.svelte';
import HostPage from '../src/routes/hosts/[id]/+page.svelte';
import { actions as hostActions } from '../src/routes/hosts/[id]/+page.server.ts';
import CatalogEntryForm from '../src/routes/projects/[id]/CatalogEntryForm.svelte';
import CatalogPermissionsForm from '../src/routes/projects/[id]/CatalogPermissionsForm.svelte';
import CatalogRunDialog from '../src/routes/projects/[id]/CatalogRunDialog.svelte';
import CatalogRunForm from '../src/routes/projects/[id]/CatalogRunForm.svelte';
import CatalogSection from '../src/routes/projects/[id]/CatalogSection.svelte';
import ProjectPage from '../src/routes/projects/[id]/+page.svelte';
import ServicesSection from '../src/routes/projects/[id]/ServicesSection.svelte';
import { actions as projectActions, load as projectLoad } from '../src/routes/projects/[id]/+page.server.ts';
import {
	parseApproval,
	parseCatalogEntry,
	parseCatalogGrants,
	parseCatalogPreview,
	parseHost,
	parseProgramLogs,
	parseService
} from '../src/lib/server/shape.ts';
import { envelope, fakeEvent, installFetch, PROJECT, restoreEnv, TOKEN, useApi, USER } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

const HOST_ID = '00000000-0000-4000-8000-0000000000aa';
const BLOCKED_ID = '00000000-0000-4000-8000-0000000000ab';
const ENTRY_ID = '00000000-0000-4000-8000-0000000000c1';
const MEMBER_ID = '00000000-0000-4000-8000-0000000000d1';
const SERVICE_ID = '00000000-0000-4000-8000-0000000000bb';
const HASH = 'ab'.repeat(32);
const KEY = 'run-key-1';

const programs = { enabled: true, run_as: ['joe'], allow_shell: true, policy_hash: 'policy-1', images: false, docker: false, files: false, logging: false, health_policy: false };

function host(overrides: Partial<Host> = {}): Host {
	return {
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
		programs,
		...overrides
	};
}

function entry(my_actions: ProgramEntry['my_actions'], overrides: Partial<ProgramEntry> = {}): ProgramEntry {
	return {
		id: ENTRY_ID,
		project_id: PROJECT.id,
		name: 'web',
		kind: 'program',
		spec: {
			dir: '/srv/app',
			exec: 'npm',
			args: ['run', 'dev'],
			shell: false,
			run_as: 'joe',
			env: {},
			port: 3031,
			restart: 'on-failure'
		},
		spec_hash: HASH,
		command_display: 'npm run dev',
		created_by: USER.id,
		created_at: '2026-10-14T00:00:00Z',
		updated_at: '2026-10-14T00:00:00Z',
		my_actions,
		...overrides
	};
}

function member(): Member {
	return { user_id: MEMBER_ID, email: 'bea@example.com', name: 'Bea', role: 'admin', created_at: '2026-10-13T00:00:00Z' };
}

function decode(value: string): string {
	return value.replaceAll('&amp;', '&').replaceAll('&#39;', "'");
}

function controlTag(html: string, tag: string, marker: string): string {
	const at = html.indexOf(marker);
	assert.ok(at >= 0, marker);
	const start = html.lastIndexOf(`<${tag}`, at);
	assert.ok(start >= 0, marker);
	const end = html.indexOf('>', start);
	assert.ok(end > start, marker);
	return html.slice(start, end + 1);
}

function entrySource(): string {
	return readFileSync(new URL('../src/routes/projects/[id]/CatalogEntryForm.svelte', import.meta.url), 'utf8');
}

function labels(html: string): string[] {
	return [...html.matchAll(/aria-label="([^"]*)"/g)].map((match) => match[1] ?? '');
}

describe('catalog', { concurrency: false }, () => {
	const originalFetch = globalThis.fetch;

	before(() => {
		useApi('https://api.test');
	});

	after(() => {
		globalThis.fetch = originalFetch;
		restoreEnv();
	});

	test('row actions follow my_actions, and owner controls stay hidden for admin and viewer', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const viewer = decode(
			render(CatalogSection, {
				props: {
					canOwner: false,
					entries: [entry(['logs'])],
					omitted: 0,
					truncated: false,
					message: null,
					hosts: [host()],
					members: []
				}
			}).body
		);
		const viewerLabels = labels(viewer);
		assert.equal(viewerLabels.includes('Logs web'), true);
		assert.equal(viewerLabels.includes('Run web'), false);
		assert.equal(viewerLabels.includes('Stop web'), false);
		assert.equal(viewerLabels.includes('Restart web'), false);
		assert.equal(viewerLabels.includes('Edit web'), false);
		assert.equal(viewerLabels.includes('Permissions web'), false);
		assert.equal(viewerLabels.includes('Delete web'), false);

		const owner = decode(
			render(CatalogSection, {
				props: {
					canOwner: true,
					entries: [entry(['run'])],
					omitted: 0,
					truncated: false,
					message: null,
					hosts: [host()],
					members: [member()]
				}
			}).body
		);
		const ownerLabels = labels(owner);
		assert.equal(ownerLabels.includes('Run web'), true);
		assert.equal(ownerLabels.includes('Edit web'), true);
		assert.equal(ownerLabels.includes('Permissions web'), true);
		assert.equal(ownerLabels.includes('Delete web'), true);
		assert.equal(ownerLabels.includes('Stop web'), false);
		assert.equal(ownerLabels.includes('Logs web'), false);
	});

	test('run posts host_id and an idempotency key, and logs does not', async () => {
		const calls = installFetch((call) => {
			assert.equal(call.method, 'POST');
			assert.equal(call.url.pathname, `/v1/projects/${PROJECT.id}/catalog/web/run`);
			return envelope({ unit: 'deploybot-lab-web.service', active_state: 'active', sub_state: 'running', main_pid: 9, started_at: null, ports: [3031] });
		});
		const ran = await projectActions.catalogRun(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogRun`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: { name: 'web', host_id: HOST_ID, idempotency_key: KEY }
			}).event as never
		);
		assert.equal(isActionFailure(ran), false);
		assert.equal(calls[0]?.body, JSON.stringify({ host_id: HOST_ID, idempotency_key: KEY }));

		const skipped = installFetch(() => envelope(null, 500, 'error', 'should not run'));
		const missing = await projectActions.catalogRun(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogRun`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: { name: 'web', host_id: HOST_ID }
			}).event as never
		);
		assert.equal(isActionFailure(missing), true);
		assert.equal(skipped.length, 0);

		const logCalls = installFetch(() => envelope({ unit: 'deploybot-lab-web.service', lines: ['ok'], truncated: false }));
		await projectActions.catalogLogs(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogLogs`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: { name: 'web', host_id: HOST_ID, idempotency_key: KEY }
			}).event as never
		);
		assert.equal(logCalls[0]?.body, JSON.stringify({ host_id: HOST_ID }));

		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const runProps = {
			kind: 'run' as const,
			entryName: 'web',
			runAs: 'joe',
			shell: false,
			hosts: [host(), host({ id: BLOCKED_ID, name: 'bare', programs: null })],
			action: '?/catalogRun',
			result: runState('run', 'waiting')
		};
		const runHtml = render(CatalogRunForm, { props: runProps }).body;
		assert.equal(readFileSync(new URL('../src/routes/projects/[id]/CatalogRunDialog.svelte', import.meta.url), 'utf8').includes('<CatalogRunForm'), true);
		assert.match(render(CatalogRunDialog, { props: runProps }).body, /aria-expanded="true"/);
		assert.equal(runHtml.includes('name="idempotency_key"'), true);
		assert.equal(runHtml.includes('This host does not allow programs.'), true);
		const logsHtml = render(CatalogRunForm, {
			props: {
				kind: 'logs',
				entryName: 'web',
				runAs: 'joe',
				shell: false,
				hosts: [host()],
				action: '?/catalogLogs',
				result: {
					name: 'web',
					kind: 'logs',
					resultId: '00000000-0000-4000-8000-0000000000e1',
					status: null,
					logs: { unit: 'unit', lines: ['<img src=x onerror=alert(1)>'], truncated: false },
					message: null
				}
			}
		}).body;
		assert.equal(logsHtml.includes('name="idempotency_key"'), false);
		assert.equal(logsHtml.includes('<img'), false);
		assert.equal(logsHtml.includes('&lt;img'), true);
		assert.equal(logsHtml.includes('onerror=alert(1)'), true);
	});

	test('a forbidden approval wait is the info notice', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const html = render(CatalogRunForm, {
			props: {
				kind: 'run',
				entryName: 'web',
				runAs: 'joe',
				shell: false,
				hosts: [host()],
				action: '?/catalogRun',
				result: runState('run', APPROVAL_WAIT)
			}
		}).body;
		assert.equal(html.includes(APPROVAL_WAIT), true);
		assert.equal(html.includes('role="status"'), true);
		assert.equal(html.includes('role="alert"'), false);
	});

	test('parse preview shows argv or the refusal, and the shell box shows the risk', async () => {
		const calls = installFetch(() =>
			envelope({ exec: 'npm', args: ['run', 'dev'], env: {}, command_display: 'npm run dev' })
		);
		const parsed = await projectActions.catalogParse(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogParse`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: editorForm({ command: 'npm run dev', shell: '' })
			}).event as never
		);
		assert.equal(isActionFailure(parsed), false);
		assert.equal(calls[0]?.body, JSON.stringify({ command: 'npm run dev', shell: false }));
		const editor = editorOf(parsed);
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const shown = decode(render(CatalogEntryForm, { props: dialogProps(editor) }).body);
		assert.equal(readFileSync(new URL('../src/routes/projects/[id]/CatalogEntryDialog.svelte', import.meta.url), 'utf8').toLowerCase().includes('container'), false);
		assert.equal(shown.includes('will run:'), true);
		assert.equal(shown.includes('>npm<'), true);
		assert.equal(shown.includes('>run<'), true);
		assert.equal(shown.includes('>dev<'), true);

		installFetch(() => envelope(null, 400, 'bad_request', 'pipes are not allowed'));
		const refused = await projectActions.catalogParse(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogParse`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: editorForm({ command: 'npm run dev | cat', shell: '1' })
			}).event as never
		);
		assert.equal(isActionFailure(refused), true);
		const refusal =
			refused != null && typeof refused === 'object' && 'data' in refused && refused.data != null && typeof refused.data === 'object' && 'catalogEditor' in refused.data
				? refused.data.catalogEditor
				: null;
		assert.equal(refusal?.preview, null);
		assert.equal(refusal?.previewMessage, 'pipes are not allowed');
		const refusedHtml = decode(render(CatalogEntryForm, { props: dialogProps(refusal ?? null) }).body);
		assert.equal(refusedHtml.includes('pipes are not allowed'), true);
		assert.equal(refusedHtml.includes('will run:'), false);
		assert.equal(refusedHtml.includes('Run through a shell'), true);
		assert.equal(refusedHtml.includes('anything in this line runs as joe'), true);
		assert.equal(refusedHtml.toLowerCase().includes('container'), false);
		assert.equal(refusedHtml.includes('>image<'), false);
	});

	test('permissions PUT sends role and member grants', async () => {
		const calls = installFetch((call) => {
			if (call.url.pathname.endsWith('/members')) {
				return envelope({ items: [member(), { ...member(), user_id: USER.id, role: 'owner', email: USER.email, name: USER.name }], next_cursor: null });
			}
			return envelope({ grants: [] });
		});
		await assert.rejects(
			async () => {
				await projectActions.catalogPermissions(
					fakeEvent({
						url: `http://console.example/projects/${PROJECT.id}?tab=catalog&permissions=web&/catalogPermissions`,
						session: TOKEN,
						user: USER,
						projects: [PROJECT],
						params: { id: PROJECT.id },
						form: {
							name: 'web',
							admin_run: '1',
							admin_stop: '1',
							admin_restart: '1',
							admin_logs: '1',
							viewer_logs: '1',
							member_0_user: MEMBER_ID,
							member_0_run: '1'
						}
					}).event as never
				);
			},
			(err: unknown) => isRedirect(err) && err.status === 303 && err.location === `/projects/${PROJECT.id}?tab=catalog`
		);
		const put = calls.find((call) => call.method === 'PUT');
		assert.equal(put?.url.pathname, `/v1/projects/${PROJECT.id}/catalog/web/permissions`);
		assert.deepEqual(JSON.parse(put?.body ?? ''), {
			grants: [
				{ subject: 'role:admin', actions: ['run', 'stop', 'restart', 'logs'] },
				{ subject: 'role:viewer', actions: ['logs'] },
				{ subject: `user:${MEMBER_ID}`, actions: ['run'] }
			]
		});

		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		assert.equal(
			readFileSync(new URL('../src/routes/projects/[id]/CatalogPermissions.svelte', import.meta.url), 'utf8').includes('<CatalogPermissionsForm'),
			true
		);
		const html = render(CatalogPermissionsForm, {
			props: {
				action: '?/catalogPermissions',
				name: 'web',
				loaded: true,
				message: null,
				members: [member()],
				grants: [
					{ subject: 'role:admin', actions: ['run', 'stop', 'restart', 'logs'] },
					{ subject: 'role:viewer', actions: ['logs'] },
					{ subject: `user:${MEMBER_ID}`, actions: ['run'] }
				] satisfies CatalogGrant[]
			}
		}).body;
		assert.equal(html.includes('name="admin_run"'), true);
		assert.equal(html.includes('name="viewer_logs"'), true);
		assert.equal(html.includes(`name="member_0_user"`), true);
		assert.equal(html.includes('name="member_0_run"'), true);
		const unloaded = render(CatalogPermissionsForm, {
			props: {
				action: '?/catalogPermissions',
				name: 'web',
				loaded: false,
				message: 'Could not load grants.',
				members: [],
				grants: []
			}
		}).body;
		assert.equal(unloaded.includes('>Save<'), false);
	});

	test('approvals stay hidden for non-admins, and approve posts the shown spec hash', async () => {
		setPageUrl(`http://console.example/hosts/${HOST_ID}?tab=overview`);
		const hidden = render(HostPage, { props: { data: hostPageData(false) as never, form: null } }).body;
		assert.equal(hidden.includes('Catalog approvals'), false);
		const shown = render(HostPage, { props: { data: hostPageData(true) as never, form: null } }).body;
		assert.equal(shown.includes('Catalog approvals'), true);
		const queue = render(CatalogApprovals, {
			props: {
				approvals: [approval()],
				omitted: 0,
				truncated: false,
				message: null
			}
		}).body;
		assert.equal(queue.includes(`value="${HASH}"`), true);
		assert.equal(queue.includes('/usr/bin/npm'), true);
		assert.equal(queue.includes('PORT=3031'), true);
		assert.equal(labels(queue).includes('Approve web'), true);
		assert.equal(labels(queue).includes('Revoke web'), true);

		const calls = installFetch((call) => {
			assert.equal(call.method, 'POST');
			assert.equal(call.url.pathname, `/v1/hosts/${HOST_ID}/catalog-approvals`);
			return envelope(approval());
		});
		await assert.rejects(
			async () => {
				await hostActions.approveCatalog(
					fakeEvent({
						url: `http://console.example/hosts/${HOST_ID}?tab=overview&/approveCatalog`,
						session: TOKEN,
						user: USER,
						projects: [PROJECT],
						params: { id: HOST_ID },
						form: { entry_id: ENTRY_ID, spec_hash: HASH }
					}).event as never
				);
			},
			(err: unknown) => isRedirect(err) && err.status === 303
		);
		assert.equal(calls[0]?.body, JSON.stringify({ entry_id: ENTRY_ID, spec_hash: HASH }));

		const skipped = installFetch(() => envelope(null, 500, 'error', 'should not approve'));
		const bad = await hostActions.approveCatalog(
			fakeEvent({
				url: `http://console.example/hosts/${HOST_ID}?/approveCatalog`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: HOST_ID },
				form: { entry_id: ENTRY_ID, spec_hash: 'not-a-hash' }
			}).event as never
		);
		assert.equal(isActionFailure(bad), true);
		assert.equal(skipped.length, 0);
	});

	test('a service that came from the catalog shows a catalog badge', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=services`);
		const marked = decode(render(ServicesSection, { props: serviceProps('web') }).body);
		assert.equal(marked.includes('>catalog<'), true);
		const plain = decode(render(ServicesSection, { props: serviceProps(null) }).body);
		assert.equal(plain.includes('>catalog<'), false);
	});

	test('the services filters apply when a select changes, with no Apply button', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=services`);
		const body = decode(render(ServicesSection, { props: serviceProps(null) }).body);
		assert.equal(body.includes('>Apply<'), false);
		// The change handler runs only in the browser, so check its wiring in the source.
		const section = readFileSync(new URL('../src/routes/projects/[id]/ServicesSection.svelte', import.meta.url), 'utf8');
		assert.match(section, /bind:value=\{hostValue\} onValueChange=\{applyFilters\}/);
		assert.match(section, /bind:value=\{showValue\} onValueChange=\{applyFilters\}/);
		assert.match(section, /await tick\(\);\s*filterForm\?\.requestSubmit\(\);/);
	});

	test('the new service button is owner-only', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const owner = render(ProjectPage, { props: { data: projectData(true) as never, form: null } }).body;
		assert.equal(owner.includes('New service'), true);
		assert.equal(owner.includes('Container'), true);
		const admin = render(ProjectPage, { props: { data: projectData(false) as never, form: null } }).body;
		assert.equal(admin.includes('New service'), false);
		assert.equal(admin.includes('Container'), false);
		assert.equal(admin.includes('Edit web'), true);
		assert.equal(admin.includes('Delete web'), false);
		assert.equal(admin.includes('Permissions web'), false);
		assert.equal(admin.includes('>Catalog<'), true);
	});

	test('catalog payloads fail closed', () => {
		const brokenHost = parseHost({ ...host(), programs: { enabled: 'yes' } });
		assert.equal(brokenHost?.id, HOST_ID);
		assert.equal(brokenHost?.programs, null);
		const service = {
			id: SERVICE_ID,
			name: 'api',
			source: 'discovered',
			kind: 'process',
			ports: [80],
			health: null
		};
		assert.equal(parseService(service)?.catalog_entry, null);
		assert.equal(parseService({ ...service, catalog_entry: 'Not A Name' }), null);
		assert.equal(parseService({ ...service, catalog_entry: 'web' })?.catalog_entry, 'web');
		assert.equal(parseCatalogEntry({ ...entry(['logs']), kind: 'image' }), null);
		assert.equal(parseCatalogEntry({ ...entry(['logs']), command_display: '<b>hi</b>' })?.command_display, '<b>hi</b>');
		assert.equal(parseCatalogEntry({ ...entry(['logs']), command_display: '' }), null);
		assert.equal(parseCatalogEntry({ ...entry(['logs']), my_actions: ['redeploy'] }), null);
		assert.equal(parseCatalogGrants({ grants: [{ subject: 'role:admin', actions: [] }] }), null);
		assert.equal(
			parseCatalogGrants({
				grants: [
					{ subject: 'role:admin', actions: ['logs'] },
					{ subject: 'role:admin', actions: ['run'] }
				]
			}),
			null
		);
		assert.equal(parseProgramLogs({ unit: 'unit', lines: ['ok', 1], truncated: false }), null);
		assert.equal(parseProgramLogs({ unit: 'unit', lines: ['bell\u0007'], truncated: false })?.lines[0], 'bell\uFFFD');
		assert.equal(parseApproval({ ...approval(), spec_hash: 'nope' }), null);
		const { env: _env, ...approvalWithoutEnv } = approval();
		assert.equal(parseApproval(approvalWithoutEnv), null);
		assert.equal(parseApproval({ ...approval(), args: 'npm' }), null);
		assert.equal(parseCatalogPreview({ exec: 'npm', args: ['run'], env: {}, command_display: '' }), null);
		const raw: Record<string, unknown> = { ...host() };
		delete raw.programs;
		assert.equal(parseHost(raw)?.programs, null);
	});

	test('catalog text keeps tabs and long command_display, and one long log line stays', () => {
		const tabbed = entry(['logs'], {
			command_display: `npm\trun ${'x'.repeat(9000)}`,
			spec: {
				...entry(['logs']).spec,
				dir: '/srv/app\t',
				args: ['run\t', 'dev<'],
				env: { PORT: '30\t31\u0007' }
			}
		});
		const parsed = parseCatalogEntry(tabbed);
		assert.equal(parsed?.kind, 'program');
		if (parsed?.kind !== 'program') return;
		assert.equal(parsed.command_display, tabbed.command_display);
		assert.equal(parsed.spec.dir, '/srv/app\t');
		assert.deepEqual(parsed.spec.args, ['run\t', 'dev<']);
		assert.equal(parsed.spec.env.PORT, '30\t31\u0007');
		assert.equal(JSON.stringify(parsed).includes('\uFFFD'), false);
		assert.equal(parseCatalogEntry({ ...entry(['logs']), command_display: 'npm\nrun' }), null);
		assert.equal(parseCatalogEntry({ ...entry(['logs']), spec: { ...entry(['logs']).spec, dir: '/srv/app\n' } }), null);

		const longLine = 'L'.repeat(9000);
		const logs = parseProgramLogs({ unit: 'unit', lines: ['short', longLine], truncated: false });
		assert.equal(logs?.lines[0], 'short');
		assert.equal(logs?.lines[1]?.length, 8192);
		assert.equal(logs?.lines[1]?.endsWith('\u2026'), true);
		assert.equal(logs?.truncated, false);
		const many = Array.from({ length: 1001 }, (_, index) => String(index));
		const capped = parseProgramLogs({ unit: 'unit', lines: many, truncated: false });
		assert.equal(capped?.lines.length, 1000);
		assert.equal(capped?.lines[0], '0');
		assert.equal(capped?.truncated, true);
	});

	test('a programs list the contract allows does not drop the host', () => {
		const names = Array.from({ length: 33 }, (_, index) => `u${String(index).padStart(2, '0')}`);
		const parsed = parseHost({
			...host(),
			programs: {
				enabled: true,
				allow_shell: true,
				run_as: [names[0], ...names],
				policy_hash: 'p'.repeat(129)
			}
		});
		assert.equal(parsed?.id, HOST_ID);
		assert.equal(parsed?.programs?.run_as.length, 34);
		assert.equal(parsed?.programs?.policy_hash.length, 129);
		assert.deepEqual(runAsChoices(parsed ? [parsed] : [], false), names);

		const tooMany = Array.from({ length: 257 }, (_, index) => `a${String(index).padStart(3, '0')}`);
		const capped = parseHost({
			...host(),
			programs: { enabled: true, allow_shell: false, run_as: tooMany, policy_hash: 'p' }
		});
		assert.equal(capped?.id, HOST_ID);
		assert.equal(capped?.programs, null);
	});

	test('preview env merges, save is not dropped, and the shell line names an account', () => {
		assert.equal(shouldApplyPreviewUpdate(false, 1, 2), true);
		assert.equal(shouldApplyPreviewUpdate(true, 1, 2), false);
		assert.equal(shouldApplyPreviewUpdate(true, 2, 2), true);
		assert.equal(shellRisk(''), null);
		assert.equal(shellRisk('joe'), 'anything in this line runs as joe');

		const entryForm = readFileSync(new URL('../src/routes/projects/[id]/CatalogEntryForm.svelte', import.meta.url), 'utf8');
		assert.equal(entryForm.includes('shouldApplyPreviewUpdate'), true);
		assert.equal(entryForm.includes('clearPreviewTimer'), true);
		assert.equal(entryForm.includes('if (mine !== requestId) return'), false);

		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const merged = decode(
			render(CatalogEntryForm, {
				props: dialogProps({
					mode: 'create',
					name: null,
					draft: {
						name: 'web',
						command: 'PORT=3031 npm run dev',
						shell: false,
						dir: '/srv/app',
						runAs: 'joe',
						port: '',
						restart: 'on-failure',
						env: []
					},
					preview: { exec: 'npm', args: ['run', 'dev'], env: { PORT: '3031' }, command_display: 'npm run dev' },
					previewMessage: null,
					message: null
				})
			}).body
		);
		assert.equal(merged.includes('value="PORT"'), true);
		assert.equal(merged.includes('value="3031"'), true);
		assert.equal(merged.includes('break-all'), true);

		const quiet = decode(
			render(CatalogEntryForm, {
				props: dialogProps({
					mode: 'create',
					name: null,
					draft: {
						name: 'web',
						command: 'npm run dev',
						shell: true,
						dir: '/srv/app',
						runAs: '',
						port: '',
						restart: 'on-failure',
						env: []
					},
					preview: null,
					previewMessage: null,
					message: null
				})
			}).body
		);
		assert.equal(quiet.includes('the selected account'), false);
		assert.equal(quiet.includes('anything in this line runs as'), false);
	});

	test('preview submits without name or directory, and a blocked submit is not remembered', () => {
		let remembered = false;
		const waiting = new Set<() => void>();
		function form(fire: boolean) {
			return {
				addEventListener(_type: 'submit', listener: () => void) {
					waiting.add(listener);
				},
				removeEventListener(_type: 'submit', listener: () => void) {
					waiting.delete(listener);
				},
				requestSubmit(submitter: unknown) {
					assert.equal(submitter, 'preview');
					if (!fire) return;
					for (const listener of [...waiting]) listener();
				}
			};
		}
		submitCatalogPreview(form(false), 'preview', () => {
			remembered = true;
		});
		assert.equal(remembered, false);
		assert.equal(waiting.size, 0);
		submitCatalogPreview(form(true), 'preview', () => {
			remembered = true;
		});
		assert.equal(remembered, true);
		assert.equal(waiting.size, 0);

		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const html = decode(render(CatalogEntryForm, { props: dialogProps(null) }).body);
		const formTag = html.match(/<form\b[^>]*>/);
		assert.ok(formTag);
		assert.equal(/\bnovalidate\b/.test(formTag[0]), false);
		const save = controlTag(html, 'button', 'Save');
		const preview = controlTag(html, 'button', 'Preview');
		assert.equal(/\bformnovalidate\b/.test(save), false);
		assert.equal(/\bformnovalidate\b/.test(preview), true);
		assert.equal(preview.includes('formaction="?/catalogParse"'), true);
		assert.equal(/\brequired\b/.test(controlTag(html, 'input', 'id="catalog-new-name"')), true);
		assert.equal(/\brequired\b/.test(controlTag(html, 'input', 'id="catalog-new-dir"')), true);
		assert.equal(/\brequired\b/.test(controlTag(html, 'input', 'id="catalog-new-command"')), true);

		const timerAt = entrySource().indexOf('previewTimer = setTimeout');
		const timerEnd = entrySource().indexOf('return () => clearPreviewTimer()', timerAt);
		const timer = entrySource().slice(timerAt, timerEnd);
		const callAt = timer.indexOf('submitCatalogPreview(');
		assert.ok(callAt >= 0);
		assert.ok(timer.indexOf('lastPreview =') > callAt);
		assert.equal(timer.includes('requestSubmit'), false);
	});

	test('permissions form is in the page, and cancel drops the permissions query', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog&permissions=web&catalog.q=we`);
		const html = decode(
			render(CatalogSection, {
				props: {
					canOwner: true,
					entries: [entry(['run'])],
					omitted: 0,
					truncated: false,
					message: null,
					hosts: [host()],
					members: [member()],
					permissions: {
						name: 'web',
						grants: [
							{ subject: 'role:admin', actions: ['run'] },
							{ subject: 'role:viewer', actions: ['logs'] }
						],
						message: null,
						loaded: true
					}
				}
			}).body
		);
		assert.equal(html.includes('name="admin_run"'), true);
		const cancel = html.match(/href="([^"]*)"[^>]*>(?:<!---->)?Cancel/);
		assert.ok(cancel);
		assert.equal(cancel[1], `/projects/${PROJECT.id}?tab=catalog&catalog.q=we`);
		assert.equal(cancel[1].includes('permissions'), false);
		const permissionsSource = readFileSync(new URL('../src/routes/projects/[id]/CatalogPermissions.svelte', import.meta.url), 'utf8');
		assert.equal(permissionsSource.includes('{#key name}'), true);
		assert.equal(permissionsSource.includes('Dialog.Content'), false);
		const formSource = readFileSync(new URL('../src/routes/projects/[id]/CatalogPermissionsForm.svelte', import.meta.url), 'utf8');
		assert.equal(formSource.includes('label={member.name}'), true);
	});

	test('run reuses one idempotency key, and dialogs scroll', () => {
		assert.equal(reuseIdempotencyKey('failure'), true);
		assert.equal(reuseIdempotencyKey('error'), true);
		assert.equal(reuseIdempotencyKey('success'), false);
		const runSource = readFileSync(new URL('../src/routes/projects/[id]/CatalogRunForm.svelte', import.meta.url), 'utf8');
		assert.equal(runSource.includes('reuseIdempotencyKey'), true);
		assert.equal(runSource.includes('cancel()'), true);
		assert.equal(runSource.includes("formData.set('idempotency_key', crypto.randomUUID())"), false);
		assert.equal(runSource.includes('— {reason}'), false);
		assert.equal(runSource.includes('aria-label="Log lines"'), true);
		assert.equal(runSource.includes('tabindex="0"'), true);
		const scroll = 'max-h-[calc(100dvh-2rem)] overflow-y-auto';
		assert.equal(readFileSync(new URL('../src/routes/projects/[id]/CatalogEntryDialog.svelte', import.meta.url), 'utf8').includes(scroll), true);
		assert.equal(readFileSync(new URL('../src/routes/projects/[id]/CatalogRunDialog.svelte', import.meta.url), 'utf8').includes(scroll), true);
		assert.equal(readFileSync(new URL('../src/routes/projects/[id]/CatalogPermissions.svelte', import.meta.url), 'utf8').includes(scroll), true);
		const catalogSource = readFileSync(new URL('../src/lib/catalog.ts', import.meta.url), 'utf8');
		assert.equal(catalogSource.includes('NODE_OPTIONS'), false);
		assert.equal(catalogSource.includes('LD_PRELOAD'), false);
		assert.equal(catalogSource.includes('That environment key is not allowed.'), false);
	});

	test('over-long fields are rejected, and the API env refusal is shown', async () => {
		const account = `a${'b'.repeat(31)}`;
		const allowed = host({ programs: { enabled: true, allow_shell: true, run_as: [account, 'joe'], policy_hash: 'policy-1', images: false, docker: false, files: false, logging: false, health_policy: false } });
		async function post(form: Record<string, string>) {
			const calls = installFetch((call) => {
				if (call.url.pathname.endsWith('/hosts')) return envelope({ items: [allowed], next_cursor: null });
				return envelope(null, 400, 'bad_request', 'should not post');
			});
			const result = await projectActions.catalogCreate(
				fakeEvent({
					url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogCreate`,
					session: TOKEN,
					user: USER,
					projects: [PROJECT],
					params: { id: PROJECT.id },
					form
				}).event as never
			);
			assert.equal(isActionFailure(result), true);
			assert.equal(calls.some((call) => call.method === 'POST'), false);
			return editorOf(result)?.message ?? null;
		}
		assert.equal((await post(editorForm({ run_as: `${account}c` })))?.includes('run-as'), true);
		assert.equal((await post(editorForm({ dir: `/${'a'.repeat(255)}` })))?.includes('255'), true);
		assert.equal((await post(editorForm({ name: `${'a'.repeat(48)}b` })))?.includes('Name'), true);
		assert.equal((await post(editorForm({ port: '000655359' })))?.includes('port'), true);

		const calls = installFetch((call) => {
			if (call.url.pathname.endsWith('/hosts')) return envelope({ items: [host()], next_cursor: null });
			return envelope(null, 400, 'bad_request', 'this variable changes what the program runs');
		});
		const refused = await projectActions.catalogCreate(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogCreate`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: editorForm({ env_key: 'NODE_OPTIONS', env_value: '--inspect' })
			}).event as never
		);
		assert.equal(isActionFailure(refused), true);
		assert.equal(editorOf(refused)?.message, 'this variable changes what the program runs');
		const body = calls.find((call) => call.method === 'POST')?.body ?? '';
		assert.equal(body.includes('NODE_OPTIONS'), true);
		assert.equal(body.includes('--inspect'), true);
	});

	test('a viewer catalog load omits env, exec, and args', async () => {
		const secret = 'db-password-owner-only';
		const execPath = '/opt/owner-only-bin';
		const item = entry(['logs'], {
			spec: {
				...entry(['logs']).spec,
				exec: execPath,
				args: ['--secret-arg'],
				env: { DATABASE_URL: secret }
			}
		});
		function answer(call: { url: URL; method: string }) {
			const path = call.url.pathname;
			if (path === `/v1/projects/${PROJECT.id}/catalog`) return envelope({ items: [item], next_cursor: null });
			if (path === `/v1/projects/${PROJECT.id}/hosts`) return envelope({ items: [host()], next_cursor: null });
			if (path === `/v1/projects/${PROJECT.id}/members`) return envelope({ items: [], next_cursor: null });
			if (path === `/v1/projects/${PROJECT.id}`) return envelope({ ...PROJECT, role: 'viewer' });
			if (path.endsWith('/join-tokens') || path.endsWith('/invites')) return envelope({ items: [], next_cursor: null });
			return envelope(null, 500, 'error', path);
		}
		installFetch(answer);
		const viewer = await projectLoad(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=catalog`,
				session: TOKEN,
				user: USER,
				projects: [{ ...PROJECT, role: 'viewer' }],
				params: { id: PROJECT.id }
			}).event as never
		);
		const viewerJson = JSON.stringify(viewer);
		assert.equal(viewerJson.includes(secret), false);
		assert.equal(viewerJson.includes(execPath), false);
		assert.equal(viewerJson.includes('--secret-arg'), false);
		assert.equal(viewerJson.includes('npm run dev'), true);

		installFetch((call) => {
			if (call.url.pathname === `/v1/projects/${PROJECT.id}`) return envelope(PROJECT);
			return answer(call);
		});
		const owner = await projectLoad(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=catalog`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id }
			}).event as never
		);
		const ownerJson = JSON.stringify(owner);
		assert.equal(ownerJson.includes(secret), true);
		assert.equal(ownerJson.includes(execPath), true);
		assert.equal(ownerJson.includes('--secret-arg'), true);
	});
});

function runState(kind: CatalogRunState['kind'], message: string): CatalogRunState {
	return {
		name: 'web',
		kind,
		resultId: '00000000-0000-4000-8000-0000000000e1',
		status: null,
		logs: null,
		message
	};
}

function editorForm(overrides: Record<string, string>): Record<string, string> {
	return {
		editor_mode: 'create',
		name: 'web',
		command: 'npm run dev',
		shell: '',
		dir: '/srv/app',
		run_as: 'joe',
		port: '3031',
		restart: 'on-failure',
		...overrides
	};
}

function editorOf(value: unknown): CatalogEditorState | null {
	if (value == null || typeof value !== 'object') return null;
	if ('catalogEditor' in value) return (value as { catalogEditor?: CatalogEditorState }).catalogEditor ?? null;
	if ('data' in value && value.data != null && typeof value.data === 'object' && 'catalogEditor' in value.data) {
		return (value.data as { catalogEditor?: CatalogEditorState }).catalogEditor ?? null;
	}
	return null;
}

function dialogProps(editor: CatalogEditorState | null) {
	return {
		mode: 'create' as const,
		hosts: [host()],
		saveAction: '?/catalogCreate',
		parseAction: '?/catalogParse',
		editor
	};
}

function approval() {
	return {
		entry_id: ENTRY_ID,
		entry_name: 'web',
		project_id: PROJECT.id,
		project_name: 'Lab',
		host_id: HOST_ID,
		spec_hash: HASH,
		command_display: 'npm run dev',
		exec: '/usr/bin/npm',
		args: ['run', 'dev'],
		env: { PORT: '3031' },
		dir: '/srv/app',
		run_as: 'joe',
		shell: false,
		status: 'pending' as const,
		requested_by: USER.id,
		requested_at: '2026-10-14T00:00:00Z',
		approved_by: null,
		approved_at: null
	};
}

function hostPageData(canApproveCatalog: boolean) {
	return {
		host: host(),
		projectName: 'Lab',
		tab: 'overview' as const,
		range: '1h' as const,
		processSort: 'cpu' as const,
		message: null,
		serviceLinks: {},
		metrics: [],
		processes: null,
		processesMessage: null,
		canApproveCatalog,
		approvals: canApproveCatalog ? [approval()] : [],
		approvalsOmitted: 0,
		approvalsTruncated: false,
		approvalsMessage: null
	};
}

function projectData(canOwner: boolean) {
	return {
		project: { ...PROJECT, role: canOwner ? 'owner' : 'admin' },
		userId: USER.id,
		message: null,
		tab: 'catalog' as const,
		canAdmin: true,
		canOwner,
		hosts: [host()],
		hostsOmitted: 0,
		hostsTruncated: false,
		hostsMessage: null,
		members: [member()],
		membersOmitted: 0,
		membersTruncated: false,
		membersMessage: null,
		tokens: [],
		tokensOmitted: 0,
		tokensTruncated: false,
		tokensMessage: null,
		invites: [],
		invitesOmitted: 0,
		invitesTruncated: false,
		invitesMessage: null,
		catalog: [entry(['logs'])],
		catalogOmitted: 0,
		catalogTruncated: false,
		catalogMessage: null,
		permissions: null,
		services: [],
		servicesTotal: 0,
		servicesPrev: null,
		servicesNext: null,
		servicesOmitted: 0,
		servicesMessage: null
	};
}

function serviceProps(catalogEntry: string | null) {
	const row: ProjectServiceRow = {
		id: SERVICE_ID,
		name: 'web',
		source: 'owned',
		kind: 'process',
		ports: [3031],
		health: null,
		last_seen_at: null,
		gone_at: null,
		display_name: null,
		owner_user: 'joe',
		project_id: PROJECT.id,
		host_id: HOST_ID,
		host_name: 'pi1',
		host_status: 'online',
		project_name: 'Lab',
		catalog_entry: catalogEntry,
		checks: [],
		checksMessage: null,
		container_name: null,
		image_digest: null
	};
	return {
		projectId: PROJECT.id,
		projectName: 'Lab',
		hosts: [host()],
		canAdmin: false,
		rows: [row],
		total: 1,
		prevCursor: null,
		nextCursor: null,
		omitted: 0,
		message: null,
		probe: null,
		probeServiceId: null,
		renameServiceId: null,
		typedName: null
	};
}


function selectValueText(html: string): string[] {
	return [...html.matchAll(/data-slot="select-value"[^>]*>([\s\S]*?)<\/span>/g)].map((match) =>
		(match[1] ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
	);
}

test('the run dialog host control shows the host name, not its id', () => {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
	const html = render(CatalogRunForm, {
		props: { kind: 'stop', entryName: 'web', runAs: 'joe', shell: false, hosts: [host()], action: '?/catalogStop', result: null }
	}).body;
	const radios = [...html.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]).filter((tag) => tag.includes('role="radio"'));
	assert.equal(radios.some((tag) => tag.includes('break-all') && tag.includes('whitespace-normal') && tag.includes('aria-checked="true"')), true);
	assert.match(html, /role="radio"[^>]*>(?:<!---->)?pi1/);
	assert.equal(html.includes(`>${HOST_ID}<`), false);
	assert.match(html, new RegExp(`<input\\b(?=[^>]*name="host_id")(?=[^>]*value="${HOST_ID}")`));
});

test('the permissions member select shows the member name, not the user id', () => {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
	const members: Member[] = [
		{ user_id: MEMBER_ID, email: 'bea@example.com', name: 'Bea', role: 'admin', created_at: '2026-10-13T00:00:00Z' }
	];
	const html = render(CatalogPermissionsForm, {
		props: {
			action: '?/catalogPermissions',
			name: 'web',
			grants: [{ subject: `user:${MEMBER_ID}`, actions: ['run'] }] satisfies CatalogGrant[],
			members,
			message: null,
			loaded: true
		}
	}).body;
	assert.deepEqual(selectValueText(html), ['Bea']);
	assert.match(html, new RegExp(`<input\\b(?=[^>]*name="member_0_user")(?=[^>]*value="${MEMBER_ID}")`));

	// A member that is gone, or has a blank name, shows the id rather than a blank or misleading label.
	const GONE = '00000000-0000-4000-8000-0000000000d9';
	const fallback = render(CatalogPermissionsForm, {
		props: {
			action: '?/catalogPermissions',
			name: 'web',
			grants: [
				{ subject: `user:${GONE}`, actions: ['run'] },
				{ subject: `user:${MEMBER_ID}`, actions: ['logs'] }
			] satisfies CatalogGrant[],
			members: [{ ...members[0], name: '  ' }],
			message: null,
			loaded: true
		}
	}).body;
	assert.deepEqual(selectValueText(fallback), [GONE, MEMBER_ID]);
});

test('hoisted KEY=value words leave the command and win over an existing row', () => {
	const preview = { exec: 'pnpm', args: ['run', 'dev'], env: { NODE_ENV: 'production' }, command_display: 'pnpm run dev' };
	const line = 'NODE_ENV=production pnpm run dev';
	assert.deepEqual(hoistPreviewEnv(line, false, [], line, preview), {
		command: 'pnpm run dev',
		env: [{ key: 'NODE_ENV', value: 'production' }]
	});
	assert.deepEqual(
		hoistPreviewEnv(line, false, [{ key: 'NODE_ENV', value: 'development' }, { key: 'PORT', value: '3031' }], line, preview),
		{ command: 'pnpm run dev', env: [{ key: 'NODE_ENV', value: 'production' }, { key: 'PORT', value: '3031' }] }
	);
	// Already applied: the field holds command_display, not the previewed line.
	assert.equal(hoistPreviewEnv('pnpm run dev', false, [{ key: 'NODE_ENV', value: 'production' }], line, preview), null);
	// The operator typed the prefix again: it is stripped again.
	assert.deepEqual(hoistPreviewEnv(line, false, [{ key: 'NODE_ENV', value: 'production' }], line, preview), {
		command: 'pnpm run dev',
		env: [{ key: 'NODE_ENV', value: 'production' }]
	});
	assert.equal(previewToken(false, 'pnpm run dev'), '0\npnpm run dev');
	assert.notEqual(previewToken(true, 'pnpm run dev'), previewToken(false, 'pnpm run dev'));
	// Shell mode splits nothing, so nothing moves.
	assert.equal(hoistPreviewEnv(line, true, [], line, preview), null);
	// Nothing hoisted: the typed line stays even when command_display is shorter.
	const plain = { exec: 'pnpm', args: ['run', 'dev'], env: {}, command_display: 'pnpm run dev' };
	assert.equal(hoistPreviewEnv('pnpm run dev --watch', false, [{ key: 'PORT', value: '3031' }], 'pnpm run dev --watch', plain), null);

	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
	const draft = { name: 'web', command: line, shell: false, dir: '/srv/web', runAs: 'joe', port: '', restart: 'on-failure' as const, env: [] };
	const html = decode(
		render(CatalogEntryForm, {
			props: dialogProps({ mode: 'create', name: null, draft, preview, previewMessage: null, message: null })
		}).body
	);
	assert.match(html, /<input\b(?=[^>]*name="command")(?=[^>]*value="pnpm run dev")/);
	assert.match(html, /<input\b(?=[^>]*name="env_key")(?=[^>]*value="NODE_ENV")/);
	assert.match(html, /<input\b(?=[^>]*name="env_value")(?=[^>]*value="production")/);
	assert.equal(html.includes('will run:'), true);
	assert.equal(html.includes('>pnpm<'), true);
});
