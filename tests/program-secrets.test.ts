import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { isActionFailure, isRedirect } from '@sveltejs/kit';
import { render } from 'svelte/server';
import type { Approval, Host, HostPrograms } from '../src/lib/api-types.ts';
import {
	PROGRAM_SECRET_RESTART_NOTE,
	PROGRAM_SECRET_START_NOTE,
	PROGRAM_SECRETS_BLOCK,
	PROJECT_NOT_LISTED_BLOCK,
	programRunBlockReason,
	programUsesSecrets,
	projectListedBlockReason
} from '../src/lib/catalog.ts';
import { hostPolicyLine } from '../src/lib/host-view.ts';
import { cleanEnvSources, envSourcesFromForm } from '../src/lib/image-spec.ts';
import { parseApproval, parseHost, parseHostPrograms, parseProgramSpec } from '../src/lib/server/shape.ts';
import { notRunningPairs, restartNote, serviceControls, startNote, stateTip, type ServiceEntryRef } from '../src/lib/service-actions.ts';
import CatalogApprovals from '../src/routes/hosts/[id]/CatalogApprovals.svelte';
import CatalogIdleRow from '../src/routes/projects/[id]/CatalogIdleRow.svelte';
import OverviewTab from '../src/routes/hosts/[id]/OverviewTab.svelte';
import CatalogEntryDialog from '../src/routes/projects/[id]/CatalogEntryDialog.svelte';
import CatalogEntryForm from '../src/routes/projects/[id]/CatalogEntryForm.svelte';
import CatalogRunForm from '../src/routes/projects/[id]/CatalogRunForm.svelte';
import { actions as projectActions } from '../src/routes/projects/[id]/+page.server.ts';
import { envelope, fakeEvent, installFetch, PROJECT, restoreEnv, TOKEN, useApi, USER } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';
import { copyRow, programCatalogEntry, renderCopies } from './copies.ts';

const HOST_ID = '22222222-2222-4222-8222-222222222222';
const HASH = 'a'.repeat(64);

function decode(value: string): string {
	return value.replaceAll('&amp;', '&').replaceAll('&#39;', "'").replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>');
}

function policy(overrides: Partial<HostPrograms> = {}): HostPrograms {
	return {
		enabled: true,
		run_as: ['joe'],
		allow_shell: false,
		policy_hash: 'policy-1',
		images: true,
		docker: true,
		files: false,
		logging: false,
		health_policy: false,
		secrets: false,
		projects: null,
		project_listed: null,
		...overrides
	};
}

function host(programs: HostPrograms | null = policy(), overrides: Partial<Host> = {}): Host {
	return {
		id: HOST_ID,
		project_id: PROJECT.id,
		name: 'pi1',
		node_type: 'pi',
		os: 'linux',
		arch: 'arm64',
		always_on: true,
		agent_version: '0.2.8',
		status: 'online',
		last_seen_at: '2026-11-13T00:00:00Z',
		enrolled_at: '2026-11-01T00:00:00Z',
		revoked_at: null,
		relation: 'owner',
		share_level: null,
		programs,
		...overrides
	};
}

function ref(secrets: boolean): ServiceEntryRef {
	return { name: 'tra', kind: 'program', my_actions: ['run', 'stop', 'restart', 'logs', 'status'], runAs: 'joe', shell: false, secrets };
}

const RAW_PROGRAMS = { enabled: true, run_as: ['joe'], allow_shell: false, policy_hash: 'policy-1' };

describe('program secrets and the projects allowlist (console)', { concurrency: false }, () => {
	before(() => useApi('https://api.test'));
	after(() => restoreEnv());

	test('HostPrograms reads secrets, projects and project_listed; older hellos read as false and unknown', () => {
		const older = parseHostPrograms(RAW_PROGRAMS);
		assert.equal(older?.secrets, false);
		assert.equal(older?.projects, null);
		assert.equal(older?.project_listed, null);
		const owner = parseHostPrograms({ ...RAW_PROGRAMS, secrets: true, projects: ['home-lab', 'acme'], project_listed: true });
		assert.deepEqual([owner?.secrets, owner?.projects, owner?.project_listed], [true, ['home-lab', 'acme'], true]);
		// A sharing project gets project_listed only.
		const sharer = parseHostPrograms({ ...RAW_PROGRAMS, project_listed: false });
		assert.deepEqual([sharer?.projects, sharer?.project_listed], [null, false]);
		assert.equal(parseHostPrograms({ ...RAW_PROGRAMS, secrets: 'yes' }), null);
		assert.equal(parseHostPrograms({ ...RAW_PROGRAMS, projects: ['Bad Slug'] }), null);
		assert.equal(parseHostPrograms({ ...RAW_PROGRAMS, projects: Array.from({ length: 33 }, (_, i) => `p${i}`) }), null);
		assert.equal(parseHostPrograms({ ...RAW_PROGRAMS, project_listed: 'no' }), null);
		// A repeated slug is dropped, not refused (refusing would read as "no programs").
		assert.deepEqual(parseHostPrograms({ ...RAW_PROGRAMS, projects: ['a', 'b', 'a'] })?.projects, ['a', 'b']);
	});

	test('parseHost keeps the allowlist only for the owning project', () => {
		const raw = { ...host(), programs: { ...RAW_PROGRAMS, projects: ['home-lab', 'other'], project_listed: true } };
		assert.deepEqual(parseHost(raw)?.programs?.projects, ['home-lab', 'other']);
		const shared = parseHost({ ...raw, relation: 'shared', share_level: 'deploy' });
		assert.equal(shared?.programs?.projects, null);
		assert.equal(shared?.programs?.project_listed, true);
	});

	test('ProgramSpec and Approval read env set references; an older API has none', () => {
		const base = { dir: '/srv/tra', exec: '/usr/bin/gh', args: [], shell: false, run_as: 'joe', env: {}, port: null, restart: 'on-failure' };
		assert.deepEqual(parseProgramSpec(base)?.env_sets, []);
		assert.deepEqual(parseProgramSpec(base)?.secret_env, {});
		const spec = parseProgramSpec({ ...base, env_sets: ['gh'], secret_env: { GH_TOKEN: 'gh.GH_TOKEN' } });
		assert.deepEqual([spec?.env_sets, spec?.secret_env], [['gh'], { GH_TOKEN: 'gh.GH_TOKEN' }]);
		assert.equal(parseProgramSpec({ ...base, secret_env: { GH_TOKEN: 'no-dot' } }), null);
		const approval = parseApproval({ ...approvalRow(), env_sets: ['gh'], secret_env: { GH_TOKEN: 'gh.GH_TOKEN' } });
		assert.deepEqual(approval?.secret_env, { GH_TOKEN: 'gh.GH_TOKEN' });
		const { env_sets: _sets, secret_env: _secret, ...older } = approvalRow();
		const unreported = parseApproval(older);
		assert.deepEqual([unreported?.env_sets, unreported?.secret_env], [null, null]);
		assert.equal(parseApproval({ ...older, env_sets: null, secret_env: null })?.env_sets, null);
		assert.equal(parseApproval({ ...approvalRow(), env_sets: 'gh' }), null);
		// Unknown means the console cannot say the entry has no secrets.
		assert.equal(programUsesSecrets({ env_sets: null, secret_env: null }), true);
	});

	test('block reasons: secrets need programs.secrets, and an unlisted project blocks Start and Deploy', () => {
		assert.equal(programUsesSecrets({ env_sets: [], secret_env: {} }), false);
		assert.equal(programUsesSecrets({ env_sets: ['gh'], secret_env: {} }), true);
		assert.equal(programUsesSecrets({ env_sets: [], secret_env: { GH_TOKEN: 'gh.GH_TOKEN' } }), true);
		assert.equal(programRunBlockReason(host(), false), null);
		assert.equal(programRunBlockReason(host(), true), PROGRAM_SECRETS_BLOCK);
		assert.equal(PROGRAM_SECRETS_BLOCK, "This host's agent does not support program secrets.");
		assert.equal(programRunBlockReason(host(policy({ secrets: true })), true), null);
		const unlisted = host(policy({ secrets: true, project_listed: false }));
		assert.equal(programRunBlockReason(unlisted, false), PROJECT_NOT_LISTED_BLOCK);
		assert.equal(projectListedBlockReason(unlisted), PROJECT_NOT_LISTED_BLOCK);
		assert.equal(
			PROJECT_NOT_LISTED_BLOCK,
			"This host's allowlist does not include this project. The host owner adds it to `projects` in `/etc/bot-agent/runner.toml`."
		);
		// An older agent (list unknown) blocks nothing.
		assert.equal(projectListedBlockReason(host(policy({ project_listed: null }))), null);
		assert.equal(projectListedBlockReason(host(policy({ project_listed: true }))), null);
	});

	test('Start is blocked with the reason; Restart and Stop are not; the secret notes ride along', () => {
		const stopped = serviceControls(ref(true), 'online', { state: 'stopped', restarts: null }, PROGRAM_SECRETS_BLOCK);
		assert.deepEqual([stopped.stateAction, stopped.blockedReason, stopped.secrets], [null, PROGRAM_SECRETS_BLOCK, true]);
		const running = serviceControls(ref(true), 'online', { state: 'running', restarts: 0 }, PROJECT_NOT_LISTED_BLOCK);
		assert.deepEqual([running.stateAction, running.restart, running.blockedReason], ['stop', true, null]);
		assert.equal(serviceControls(ref(false), 'online', { state: 'stopped', restarts: null }).stateAction, 'run');
		// A "Not started" row is still listed for a host whose policy allows the program, so the reason shows.
		const pairs = notRunningPairs([ref(true)], [host()], {});
		assert.equal(pairs.length, 1);
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const idle = decode(
			render(CatalogIdleRow, { props: { entry: 'tra', entryRef: pairs[0].entry, host: pairs[0].host, id: 'idle-tra' } }).body
		);
		assert.equal(idle.includes(PROGRAM_SECRETS_BLOCK), true);
		assert.match(idle, /<button[^>]*aria-label="Start tra on pi1"[^>]*aria-disabled="true"|<button[^>]*aria-disabled="true"[^>]*aria-label="Start tra on pi1"/);
		const unlisted = { ...pairs[0].host, programs: policy({ secrets: true, project_listed: false }) };
		const idleUnlisted = decode(render(CatalogIdleRow, { props: { entry: 'tra', entryRef: ref(false), host: unlisted, id: 'idle-tra' } }).body);
		assert.equal(idleUnlisted.includes(PROJECT_NOT_LISTED_BLOCK), true);
	});

	test('copy rows: Start shows the reason and is not enabled; Stop and Restart stay enabled', () => {
		const actions = ['run', 'stop', 'restart', 'logs', 'status'] as const;
		const entry = programCatalogEntry('tra', [...actions]);
		if (entry.kind !== 'program') throw new Error('program entry');
		const withSets = { ...entry, spec: { ...entry.spec, env_sets: ['gh'] } };
		const program = { kind: 'process', catalog_entry: 'tra', name: 'tra', container_name: null } as const;
		const isStopped = { gone_at: '2026-11-13T00:00:00Z', runtime: { state: 'stopped', restarts: null } } as const;
		const isRunning = { gone_at: null, runtime: { state: 'running', restarts: null } } as const;
		function startTag(html: string): string {
			const tags = [...html.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);
			return tags.find((tag) => tag.includes('aria-label="Start tra on pi1"')) ?? '';
		}
		function enabled(html: string, label: string): boolean {
			const tag = [...html.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]).find((item) => item.includes(`aria-label="${label}"`));
			assert.ok(tag, label);
			return !/aria-disabled="true"|\sdisabled(?:=|\s|>)/.test(tag);
		}
		// (a) A stopped copy of an entry with sets, on a host whose agent lacks programs.secrets.
		const stopped = decode(
			renderCopies({
				rows: [copyRow({ ...program, ...isStopped })],
				entries: [withSets],
				hosts: [{ ...host(), id: copyRow().host_id }]
			})
		);
		assert.equal(stopped.includes(PROGRAM_SECRETS_BLOCK), true);
		assert.match(startTag(stopped), /aria-disabled="true"/);
		// (b) A running copy on a host whose allowlist leaves the project out: Stop and Restart are not blocked.
		const running = decode(
			renderCopies({
				rows: [copyRow({ ...program, ...isRunning })],
				entries: [withSets],
				hosts: [{ ...host(policy({ secrets: true, project_listed: false })), id: copyRow().host_id }]
			})
		);
		assert.equal(enabled(running, 'Stop tra on pi1'), true);
		assert.equal(enabled(running, 'Restart tra on pi1'), true);
		assert.equal(running.includes(PROJECT_NOT_LISTED_BLOCK), false);
		// Stopped there instead: Start shows the allowlist reason.
		const stoppedUnlisted = decode(
			renderCopies({
				rows: [copyRow({ ...program, ...isStopped })],
				entries: [entry],
				hosts: [{ ...host(policy({ project_listed: false })), id: copyRow().host_id }]
			})
		);
		assert.equal(stoppedUnlisted.includes(PROJECT_NOT_LISTED_BLOCK), true);
		assert.match(startTag(stoppedUnlisted), /aria-disabled="true"/);
	});

	test('Start and Restart dialogs say when a changed secret takes effect', () => {
		for (const [kind, note] of [['run', PROGRAM_SECRET_START_NOTE], ['restart', PROGRAM_SECRET_RESTART_NOTE]] as const) {
			const html = decode(render(CatalogRunForm, { props: { kind, entryName: 'tra', hostId: HOST_ID, action: '?/catalogRun', note } }).body);
			assert.equal(html.includes(note), true, kind);
		}
		assert.equal(PROGRAM_SECRET_RESTART_NOTE.includes('next Start'), true);
		// The tooltips are not server-rendered; ServiceRowActions passes these straight to them.
		const stopped = serviceControls(ref(true), 'online', { state: 'stopped', restarts: null });
		const running = serviceControls(ref(true), 'online', { state: 'running', restarts: 0 });
		assert.equal(stateTip(stopped), PROGRAM_SECRET_START_NOTE);
		assert.equal(startNote(stopped), PROGRAM_SECRET_START_NOTE);
		assert.equal(startNote(running), null);
		assert.equal(restartNote(running), PROGRAM_SECRET_RESTART_NOTE);
		const plain = serviceControls(ref(false), 'online', { state: 'running', restarts: 0 });
		assert.equal(restartNote(plain), null);
		assert.equal(stateTip(serviceControls(ref(false), 'online', { state: 'stopped', restarts: null })), undefined);
	});

	test('the env sources reader and validation are shared with the container form', () => {
		const form = new FormData();
		for (const name of ['b', 'a']) form.append('env_set', name);
		form.append('secret_key', 'GH_TOKEN');
		form.append('secret_set', 'gh');
		form.append('secret_name', 'GH_TOKEN');
		const read = envSourcesFromForm(form);
		assert.deepEqual(read, { envSets: ['b', 'a'], secrets: [{ key: 'GH_TOKEN', set: 'gh', name: 'GH_TOKEN' }], message: null });
		const clean = cleanEnvSources(read.envSets, read.secrets);
		assert.deepEqual(clean, { ok: true, envSets: ['b', 'a'], secretEnv: { GH_TOKEN: 'gh.GH_TOKEN' } });
		assert.equal(cleanEnvSources(Array.from({ length: 9 }, (_, i) => `s${i}`), []).ok, false);
		assert.deepEqual(cleanEnvSources([], [{ key: 'NODE_OPTIONS', set: 'gh', name: 'X' }]), {
			ok: false,
			field: 'secret_env',
			message: 'This variable changes what the program runs.'
		});
		const uneven = new FormData();
		uneven.append('secret_key', 'GH_TOKEN');
		assert.equal(envSourcesFromForm(uneven).message, 'Each secret env row needs a key, a set, and a name.');
	});

	test('a program save posts env_sets and secret_env references; an entry without them posts neither', async () => {
		async function save(extra: Record<string, string | readonly string[]>) {
			const calls = installFetch((call) => {
				if (call.url.pathname.endsWith('/hosts')) return envelope({ items: [host()], next_cursor: null });
				return envelope({}, 201);
			});
			const result = await Promise.resolve(projectActions.catalogCreate(
				fakeEvent({
					url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogCreate`,
					session: TOKEN,
					user: USER,
					projects: [PROJECT],
					params: { id: PROJECT.id },
					form: { editor_mode: 'create', name: 'tra', command: 'gh api user', dir: '/srv/tra', run_as: 'joe', restart: 'on-failure', ...extra }
				}).event as never
			)).catch((err: unknown) => err);
			return { result, body: JSON.parse(calls.find((call) => call.method === 'POST')?.body ?? 'null') };
		}
		const withSets = await save({ env_set: ['gh', 'db'], secret_key: 'GH_TOKEN', secret_set: 'gh', secret_name: 'GH_TOKEN' });
		assert.equal(isRedirect(withSets.result), true);
		assert.deepEqual(withSets.body.env_sets, ['gh', 'db']);
		assert.deepEqual(withSets.body.secret_env, { GH_TOKEN: 'gh.GH_TOKEN' });
		const plain = await save({});
		assert.equal(Object.hasOwn(plain.body, 'env_sets'), false);
		assert.equal(Object.hasOwn(plain.body, 'secret_env'), false);
		const refused = await save({ secret_key: 'LD_PRELOAD', secret_set: 'gh', secret_name: 'X' });
		assert.equal(isActionFailure(refused.result), true);
		assert.equal(refused.body, null);
	});

	test('the program form shows Env sets and Secret env with precedence notes, and the secret help line', () => {
		const html = decode(
			render(CatalogEntryForm, {
				props: {
					mode: 'create',
					hosts: [host()],
					saveAction: '?/catalogCreate',
					parseAction: '?/catalogParse',
					sets: [{ name: 'gh', keys: ['GH_TOKEN'] }],
					setsStatus: 'ready',
					editor: {
						mode: 'create',
						name: null,
						draft: {
							name: 'tra',
							command: 'gh api user',
							shell: false,
							dir: '/srv/tra',
							runAs: 'joe',
							port: '',
							restart: 'on-failure',
							env: [{ key: 'GH_TOKEN', value: 'literal' }],
							envSets: ['gh'],
							secrets: [{ key: 'GH_TOKEN', set: 'gh', name: 'GH_TOKEN' }]
						},
						preview: null,
						previewMessage: null,
						message: null
					}
				}
			}).body
		);
		assert.equal(html.includes('>Env sets<'), true);
		assert.equal(html.includes('>Secret env<'), true);
		assert.match(html, /<input[^>]*value="gh"[^>]*name="env_set"/);
		assert.match(html, /<input[^>]*value="gh"[^>]*name="secret_set"/);
		assert.equal(html.includes('Overrides the value from env set gh and the secret env. This value is used.'), true);
		assert.equal(html.includes('A changed value takes effect at the next Start, not at Restart.'), true);
		// The container form uses the same component.
		const image = readFileSync(new URL('../src/routes/projects/[id]/CatalogImageForm.svelte', import.meta.url), 'utf8');
		assert.equal(image.includes('<EnvSourceFields'), true);
	});

	test('edit: the form hydrates set and secret references; a cleared edit PUTs neither field', async () => {
		const entry = programCatalogEntry('tra', ['run']);
		if (entry.kind !== 'program') throw new Error('program entry');
		const withSets = { ...entry, spec: { ...entry.spec, env_sets: ['gh', 'db'], secret_env: { GH_TOKEN: 'gh.GH_TOKEN', DB_PW: 'db.PASSWORD' } } };
		const html = render(CatalogEntryForm, {
			props: { mode: 'edit', entry: withSets, hosts: [host()], saveAction: '?/catalogUpdate', parseAction: '?/catalogParse', sets: [], setsStatus: 'ready' }
		}).body;
		const hidden = (name: string) => [...html.matchAll(new RegExp(`<input[^>]*value="([^"]*)"[^>]*name="${name}"`, 'g'))].map((match) => match[1]);
		assert.deepEqual(hidden('env_set'), ['gh', 'db']);
		assert.deepEqual(hidden('secret_set'), ['gh', 'db']);
		assert.deepEqual(hidden('secret_name'), ['GH_TOKEN', 'PASSWORD']);
		assert.match(html, /<input[^>]*value="DB_PW"[^>]*name="secret_key"/);

		const calls = installFetch((call) => {
			if (call.url.pathname.endsWith('/hosts')) return envelope({ items: [host()], next_cursor: null });
			return envelope({}, 200);
		});
		const result = await Promise.resolve(
			projectActions.catalogUpdate(
				fakeEvent({
					url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogUpdate`,
					session: TOKEN,
					user: USER,
					projects: [PROJECT],
					params: { id: PROJECT.id },
					form: { editor_mode: 'edit', entry_name: 'tra', command: 'gh api user', dir: '/srv/tra', run_as: 'joe', restart: 'on-failure' }
				}).event as never
			)
		).catch((err: unknown) => err);
		assert.equal(isRedirect(result), true);
		const put = calls.find((call) => call.method === 'PUT');
		assert.equal(put?.url.pathname, `/v1/projects/${PROJECT.id}/catalog/tra`);
		const body = JSON.parse(put?.body ?? '{}');
		assert.equal(Object.hasOwn(body, 'env_sets'), false);
		assert.equal(Object.hasOwn(body, 'secret_env'), false);
	});

	test('labels: the create button is Program, the drawer New program, the edit fallback program', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const html = render(CatalogEntryDialog, {
			props: { mode: 'create', hosts: [host()], saveAction: '?/catalogCreate', parseAction: '?/catalogParse', setsAction: '?/catalogEnvSets' }
		}).body;
		assert.match(html.replaceAll('<!---->', ''), /<\/svg>\s*Program\s*<\/button>/);
		assert.equal(html.includes('New service'), false);
		const source = readFileSync(new URL('../src/routes/projects/[id]/CatalogEntryDialog.svelte', import.meta.url), 'utf8');
		assert.equal(source.includes("mode === 'create' ? 'New program' : `Edit ${entry?.name ?? 'program'}`"), true);
		assert.equal(source.includes('New service'), false);
		assert.equal(source.includes("'service'"), false);
	});

	test('an approval from an older API reads "not reported", not "none"', () => {
		const { env_sets: _sets, secret_env: _secret, ...older } = approvalRow();
		const parsed = parseApproval(older);
		assert.ok(parsed);
		const html = render(CatalogApprovals, { props: { approvals: [parsed], omitted: 0, truncated: false, message: null } }).body;
		assert.equal(html.split('not reported').length - 1, 2);
	});

	test('a resolved value in an unexpected approval field never reaches the parsed row or the page', () => {
		const sentinel = 'sentinel-value-7f3a';
		const parsed = parseApproval({ ...approvalRow(), resolved_env: { GH_TOKEN: sentinel }, secret_values: [sentinel] });
		assert.ok(parsed);
		assert.equal(JSON.stringify(parsed).includes(sentinel), false);
		const html = render(CatalogApprovals, { props: { approvals: [parsed], omitted: 0, truncated: false, message: null } }).body;
		assert.equal(html.includes(sentinel), false);
		assert.equal(decode(html).includes('GH_TOKEN ← gh.GH_TOKEN'), true);
	});

	test('the approval view shows env set references, never a value', () => {
		const html = decode(
			render(CatalogApprovals, {
				props: { approvals: [{ ...approvalRow(), env: { PORT: '3031' } } as Approval], omitted: 0, truncated: false, message: null }
			}).body
		);
		assert.equal(html.includes('GH_TOKEN ← gh.GH_TOKEN'), true);
		assert.equal(html.includes('gh, db'), true);
		assert.equal(html.includes('PORT=3031'), true);
		assert.equal(html.includes('ghp_'), false);
	});

	test('Host policy line: owner-project members only, with the allowlist', () => {
		assert.equal(hostPolicyLine(host(policy({ projects: ['home-lab', 'acme'] }))), 'Programs on, Images on, Projects: home-lab, acme');
		assert.equal(hostPolicyLine(host(policy({ images: false, projects: [] }))), 'Programs on, Images off, Projects: none');
		assert.equal(hostPolicyLine(host(null)), 'Programs off, Images off, Projects: not reported');
		assert.equal(hostPolicyLine(host(policy(), { relation: 'shared', share_level: 'deploy' })), null);
		setPageUrl(`http://console.example/hosts/${HOST_ID}?tab=overview`);
		const props = { range: '1h' as const, metrics: [], snapshot: null };
		const owner = render(OverviewTab, { props: { ...props, host: host(policy({ projects: ['home-lab'] })) } }).body;
		assert.equal(owner.includes('Host policy'), true);
		assert.equal(owner.includes('Projects: home-lab'), true);
		const shared = render(OverviewTab, { props: { ...props, host: host(policy(), { relation: 'shared', share_level: 'deploy' }) } }).body;
		assert.equal(shared.includes('Host policy'), false);
	});

	test('llms.txt: the allowlist line names projects for programs and containers', () => {
		const text = readFileSync(new URL('../static/llms.txt', import.meta.url), 'utf8');
		assert.equal(text.includes('the projects that may run programs and containers on it'), true);
	});
});

function approvalRow() {
	return {
		entry_id: '33333333-3333-4333-8333-333333333333',
		entry_name: 'tra',
		project_id: PROJECT.id,
		project_name: 'Home lab',
		host_id: HOST_ID,
		spec_hash: HASH,
		command_display: 'gh api user',
		exec: '/usr/bin/gh',
		args: ['api', 'user'],
		env: {},
		env_sets: ['gh', 'db'],
		secret_env: { GH_TOKEN: 'gh.GH_TOKEN' },
		dir: '/srv/tra',
		run_as: 'joe',
		shell: false,
		status: 'pending',
		requested_by: USER.id,
		requested_at: '2026-11-13T00:00:00Z',
		approved_by: null,
		approved_at: null
	};
}
