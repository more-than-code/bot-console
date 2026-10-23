import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { isActionFailure, isRedirect } from '@sveltejs/kit';
import { render } from 'svelte/server';
import type { Host, HostPrograms, ImageDeploy, ImageEntry, ImageHealthPolicy, ImageSpec } from '../src/lib/api-types.ts';
import { imageHealthPolicyBlockReason } from '../src/lib/catalog.ts';
import StatusBadge from '../src/lib/components/StatusBadge.svelte';
import {
	blankImageDraft,
	healthPolicyRule,
	imageDraftFromForm,
	imageRequestBody,
	imageSpecFromDraft,
	isDefaultHealthPolicy,
	isImageEntryName,
	autoRollbackDigest,
	rollbackChoices,
	type ImageDraft
} from '../src/lib/image-spec.ts';
import { parseHostPrograms, parseImageDeploy, parseImageSpec } from '../src/lib/server/shape.ts';
import CatalogDeployForm from '../src/routes/projects/[id]/CatalogDeployForm.svelte';
import CatalogImageForm from '../src/routes/projects/[id]/CatalogImageForm.svelte';
import { actions as projectActions } from '../src/routes/projects/[id]/+page.server.ts';
import { envelope, fakeEvent, installFetch, PROJECT, restoreEnv, TOKEN, useApi, USER } from './harness.ts';

const HOST_ID = '00000000-0000-4000-8000-0000000000aa';
const OTHER_HOST_ID = '00000000-0000-4000-8000-0000000000ab';
const ENTRY_ID = '00000000-0000-4000-8000-0000000000c1';
const HASH = 'ab'.repeat(32);
const GATE = "This host's agent does not support health policies";
const CHECK = { test: ['CMD', 'true'], interval_sec: 30, timeout_sec: 5, retries: 3, start_period_sec: 0 };

function wireSpec(kind: ImageSpec['kind'] = 'service'): Record<string, unknown> {
	return {
		kind,
		image: 'ghcr.io/acme/web:1',
		command: null,
		entrypoint: null,
		ports: [],
		env: {},
		env_sets: [],
		secret_env: {},
		volumes: [],
		files: [],
		restart: kind === 'job' ? 'no' : 'unless-stopped',
		user: '',
		healthy_after_sec: kind === 'service' ? 30 : 0,
		memory_mb: null,
		timeout_sec: kind === 'job' ? 600 : 0
	};
}

function serviceDraft(patch: Partial<ImageDraft> = {}): ImageDraft {
	return { ...blankImageDraft(), image: 'ghcr.io/acme/web:1', ...patch };
}

function withCheck(patch: Partial<ImageDraft> = {}): ImageDraft {
	return serviceDraft({ healthTest: 'CMD\ntrue', ...patch });
}

function sentPolicy(draft: ImageDraft): unknown {
	const check = imageSpecFromDraft(draft, undefined, false);
	assert.equal(check.ok, true, check.ok ? '' : check.message);
	if (!check.ok) return undefined;
	const payload = imageRequestBody(check.spec, null).spec as Record<string, unknown>;
	return Object.hasOwn(payload, 'health_policy') ? payload.health_policy : undefined;
}

function entry(policy: ImageHealthPolicy | null, kind: ImageSpec['kind'] = 'service'): ImageEntry {
	const spec = parseImageSpec({ ...wireSpec(kind), healthcheck: kind === 'service' ? CHECK : null, health_policy: policy });
	if (!spec) throw new Error('fixture spec');
	return {
		id: ENTRY_ID,
		project_id: PROJECT.id,
		name: 'web',
		kind: 'image',
		spec,
		spec_hash: HASH,
		command_display: 'ghcr.io/acme/web:1',
		created_by: USER.id,
		created_at: '2026-10-14T00:00:00Z',
		updated_at: '2026-10-14T00:00:00Z',
		my_actions: ['deploy']
	};
}

function programs(healthPolicy: boolean): HostPrograms {
	return { enabled: true, run_as: ['joe'], allow_shell: true, policy_hash: 'policy-1', images: true, docker: true, files: false, logging: false, health_policy: healthPolicy };
}

function host(id: string, name: string, healthPolicy: boolean): Host {
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
		programs: programs(healthPolicy)
	};
}

function deployForm(item: ImageEntry, hosts: Host[], history: ImageDeploy[] = []): string {
	return render(CatalogDeployForm, {
		props: {
			entry: item,
			hosts,
			deployAction: '?/catalogDeploy',
			rollbackAction: '?/catalogRollback',
			removeAction: '?/catalogRemove',
			confirmAction: '?/catalogConfirm',
			historyAction: '?/catalogDeploys',
			result: {
				name: item.name,
				resultId: '00000000-0000-4000-8000-000000000199',
				hostId: hosts[0]?.id ?? '',
				workload: item.spec.kind,
				waitSec: 30,
				outcome: history[0] ?? null,
				status: null,
				lines: [],
				history,
				confirmation: null,
				confirmKind: null,
				message: null
			}
		}
	}).body;
}

function submitTag(html: string, label: string): string {
	const tag = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map((match) => match[0]).find((item) => item.includes('type="submit"') && item.includes(label));
	assert.ok(tag, label);
	return tag.slice(0, tag.indexOf('>') + 1);
}

function isDisabled(open: string): boolean {
	return /\sdisabled(?:=|\s|>)/.test(open);
}

function decode(value: string): string {
	return value.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

/** What a browser would post from the rendered form: named inputs (checkboxes only when checked) and textareas. */
function postedFields(html: string): Record<string, string[]> {
	const fields: Record<string, string[]> = {};
	const add = (name: string, value: string) => {
		(fields[name] ??= []).push(value);
	};
	for (const [tag] of html.matchAll(/<input\b[^>]*>/g)) {
		const name = tag.match(/\sname="([^"]*)"/)?.[1];
		if (!name) continue;
		if (/\stype="checkbox"/.test(tag) && !/\schecked/.test(tag)) continue;
		add(name, decode(tag.match(/\svalue="([^"]*)"/)?.[1] ?? ''));
	}
	for (const match of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)) {
		const name = match[1]?.match(/\sname="([^"]*)"/)?.[1];
		if (name) add(name, decode(match[2] ?? ''));
	}
	return fields;
}

function openTagWithId(html: string, id: string): string {
	const tag = [...html.matchAll(/<[a-z]+\b[^>]*>/g)].map((match) => match[0]).find((item) => item.includes(` id="${id}"`));
	assert.ok(tag, id);
	return tag;
}

function editHtml(policy: ImageHealthPolicy | null): string {
	return render(CatalogImageForm, { props: { mode: 'edit', entry: entry(policy), saveAction: '?/catalogUpdate', sets: [] } }).body;
}

/** Render the edit form for a stored policy, post its fields through the update action, and return the policy the API receives. */
function toFormData(fields: Record<string, string[]>): FormData {
	const form = new FormData();
	for (const [name, values] of Object.entries(fields)) for (const value of values) form.append(name, value);
	return form;
}

/**
 * Open the edit form for a stored policy, apply what the user does to the draft, re-render with that draft
 * (as the browser would show it), and return the fields that form posts.
 */
function editedFields(policy: ImageHealthPolicy | null, edit: (draft: ImageDraft) => void): Record<string, string[]> {
	const draft = imageDraftFromForm(toFormData(postedFields(editHtml(policy)))).draft;
	edit(draft);
	const html = render(CatalogImageForm, {
		props: { mode: 'edit', entry: entry(policy), saveAction: '?/catalogUpdate', sets: [], editor: { mode: 'edit', name: 'web', draft, field: null, message: null } }
	}).body;
	return postedFields(html);
}

async function savedPolicy(policy: ImageHealthPolicy | null, change?: (fields: Record<string, string[]>) => void, posted?: Record<string, string[]>): Promise<unknown> {
	const calls = installFetch(() => envelope({ id: ENTRY_ID }));
	const fields = posted ?? postedFields(editHtml(policy));
	change?.(fields);
	await assert.rejects(
		async () => {
			await projectActions.catalogUpdate(
				fakeEvent({
					session: TOKEN,
					user: USER,
					projects: [PROJECT],
					params: { id: PROJECT.id },
					url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogUpdate`,
					form: fields
				}).event as never
			);
		},
		(err: unknown) => isRedirect(err) && err.status === 303
	);
	assert.equal(calls.length, 1);
	assert.equal(calls[0]?.method, 'PUT');
	const body = JSON.parse(calls[0]?.body ?? '{}') as { spec?: Record<string, unknown> };
	return body.spec && Object.hasOwn(body.spec, 'health_policy') ? body.spec.health_policy : undefined;
}

function deployRow(id: string, outcome: ImageDeploy['outcome'], via: ImageDeploy['via'], digest: string | null): ImageDeploy {
	return {
		id,
		entry_id: ENTRY_ID,
		host_id: HOST_ID,
		digest,
		spec_hash: HASH,
		outcome,
		exit_code: null,
		started_at: '2026-10-14T00:00:00Z',
		finished_at: '2026-10-14T00:00:00Z',
		by: via === 'agent' ? null : USER.id,
		via
	};
}

describe('health failure policy: form and payload', () => {
	test('defaults send no health_policy', () => {
		assert.equal(sentPolicy(serviceDraft()), undefined);
		assert.equal(sentPolicy(withCheck()), undefined);
		// With Do nothing the number fields are hidden: an out-of-range value there is dropped, not refused.
		assert.equal(sentPolicy(withCheck({ healthUnhealthyAfter: '5', healthMaxActions: '99' })), undefined);
	});

	test('filled-in numbers and stored keys are sent even at their defaults', () => {
		// With Do nothing, numbers count only when the stored entry kept them there.
		assert.equal(sentPolicy(withCheck({ healthUnhealthyAfter: '90', healthMaxActions: '5' })), undefined);
		assert.deepEqual(
			sentPolicy(
				withCheck({
					healthUnhealthyAfter: '200',
					healthMaxActions: '',
					healthKeepKeys: ['unhealthy_after_sec', 'max_actions_per_hour'],
					healthStored: { unhealthyAfter: '90', maxActions: '5' }
				})
			),
			{
				unhealthy_after_sec: 90,
				max_actions_per_hour: 5
			}
		);
		assert.deepEqual(sentPolicy(withCheck({ healthOnUnhealthy: 'restart', healthUnhealthyAfter: '45', healthMaxActions: '3' })), {
			on_unhealthy: 'restart',
			unhealthy_after_sec: 45,
			max_actions_per_hour: 3
		});
		assert.deepEqual(sentPolicy(serviceDraft({ healthKeepKeys: ['on_deploy_failure', 'on_unhealthy'] })), { on_deploy_failure: 'rollback', on_unhealthy: 'none' });
	});

	test('only keys that differ from the defaults are sent', () => {
		assert.deepEqual(sentPolicy(serviceDraft({ healthOnDeployFailure: 'keep' })), { on_deploy_failure: 'keep' });
		assert.deepEqual(sentPolicy(serviceDraft({ healthOnDeployFailure: 'stop' })), { on_deploy_failure: 'stop' });
		assert.deepEqual(sentPolicy(withCheck({ healthOnUnhealthy: 'rollback', healthUnhealthyAfter: '120' })), { on_unhealthy: 'rollback', unhealthy_after_sec: 120 });
		assert.deepEqual(sentPolicy(withCheck({ healthOnDeployFailure: 'stop', healthOnUnhealthy: 'restart', healthUnhealthyAfter: '15', healthMaxActions: '10' })), {
			on_deploy_failure: 'stop',
			on_unhealthy: 'restart',
			unhealthy_after_sec: 15,
			max_actions_per_hour: 10
		});
	});

	test('bounds name the field', () => {
		for (const value of ['14', '601', '1.5', 'x', '-1']) {
			const check = imageSpecFromDraft(withCheck({ healthOnUnhealthy: 'restart', healthUnhealthyAfter: value }), undefined, false);
			assert.equal(check.ok, false, value);
			if (!check.ok) assert.equal(check.field, 'health_policy.unhealthy_after_sec');
		}
		for (const value of ['0', '11', 'x']) {
			const check = imageSpecFromDraft(withCheck({ healthOnUnhealthy: 'restart', healthMaxActions: value }), undefined, false);
			assert.equal(check.ok, false, value);
			if (!check.ok) assert.equal(check.field, 'health_policy.max_actions_per_hour');
		}
		const enumBad = imageSpecFromDraft(serviceDraft({ healthOnDeployFailure: 'explode' as ImageDraft['healthOnDeployFailure'] }), undefined, false);
		assert.equal(enumBad.ok, false);
		if (!enumBad.ok) assert.equal(enumBad.field, 'health_policy.on_deploy_failure');
	});

	test('Restart or Roll back without the Docker health check is a field error', () => {
		for (const action of ['restart', 'rollback'] as const) {
			const check = imageSpecFromDraft(serviceDraft({ healthOnUnhealthy: action }), undefined, false);
			assert.equal(check.ok, false, action);
			if (!check.ok) {
				assert.equal(check.field, 'health_policy.on_unhealthy');
				assert.equal(check.message, 'Restart and Roll back need a Docker health check command. Fill in the Command field above.');
			}
		}
		const keep = imageSpecFromDraft(withCheck({ healthOnDeployFailure: 'keep', healthOnUnhealthy: 'restart' }), undefined, false);
		assert.equal(keep.ok, false);
		if (!keep.ok) {
			assert.equal(keep.field, 'health_policy.on_unhealthy');
			assert.equal(keep.message, 'Keep running cannot be combined with an automatic action.');
		}
		assert.equal(imageSpecFromDraft(withCheck({ healthOnDeployFailure: 'keep', healthOnUnhealthy: 'rollback' }), undefined, false).ok, false);
		assert.equal(imageSpecFromDraft(withCheck({ healthOnDeployFailure: 'stop', healthOnUnhealthy: 'rollback' }), undefined, false).ok, true);
		// A deploy-failure choice alone does not need the health check.
		assert.equal(imageSpecFromDraft(serviceDraft({ healthOnDeployFailure: 'keep' }), undefined, false).ok, true);
	});

	test('a job never sends a policy', () => {
		const job = imageSpecFromDraft(serviceDraft({ workload: 'job', healthOnDeployFailure: 'keep', healthOnUnhealthy: 'restart' }), undefined, false);
		assert.equal(job.ok, true);
		if (!job.ok) return;
		assert.equal(job.spec.health_policy, null);
		assert.equal(Object.hasOwn(imageRequestBody(job.spec, null).spec as Record<string, unknown>, 'health_policy'), false);
	});

	test('the server form reads the four fields', () => {
		const form = new FormData();
		form.set('workload', 'service');
		form.set('image', 'ghcr.io/acme/web:1');
		form.set('restart', 'unless-stopped');
		form.set('health_test', 'CMD\ntrue');
		form.set('health_on_deploy_failure', 'stop');
		form.set('health_on_unhealthy', 'restart');
		form.set('health_unhealthy_after_sec', '60');
		form.set('health_max_actions_per_hour', '2');
		const read = imageDraftFromForm(form);
		assert.equal(read.message, null);
		assert.deepEqual(sentPolicy(read.draft), { on_deploy_failure: 'stop', on_unhealthy: 'restart', unhealthy_after_sec: 60, max_actions_per_hour: 2 });

		const tampered = new FormData();
		tampered.set('health_on_deploy_failure', 'explode');
		tampered.set('health_on_unhealthy', 'reboot');
		tampered.set('health_unhealthy_after_sec', '123456');
		const fallback = imageDraftFromForm(tampered).draft;
		assert.equal(fallback.healthOnDeployFailure, 'rollback');
		assert.equal(fallback.healthOnUnhealthy, 'none');
		assert.equal(fallback.healthUnhealthyAfter, 'x');
	});

	test('the group renders for services only, with the numbers only when an action is chosen', () => {
		const plain = render(CatalogImageForm, { props: { mode: 'edit', entry: entry(null), saveAction: '?/catalogUpdate', sets: [] } }).body;
		assert.match(plain, /When health fails/);
		assert.match(plain, /If a deploy fails/);
		assert.match(plain, /If it turns unhealthy later/);
		assert.match(plain, />\s*Roll back\s*</);
		assert.match(plain, />\s*Do nothing\s*</);
		assert.equal(plain.includes('Unhealthy for (seconds)'), false);
		assert.equal(plain.includes('Max actions per hour'), false);

		const acting = render(CatalogImageForm, {
			props: { mode: 'edit', entry: entry({ on_deploy_failure: 'keep', on_unhealthy: 'restart', unhealthy_after_sec: 90 }), saveAction: '?/catalogUpdate', sets: [] }
		}).body;
		assert.match(acting, />\s*Keep running\s*</);
		assert.match(acting, />\s*Restart\s*</);
		assert.match(acting, /Unhealthy for \(seconds\)/);
		assert.match(acting, /Max actions per hour/);
		const after = acting.match(/<input\b[^>]*id="catalog-image-web-unhealthy-after"[^>]*>/)?.[0] ?? '';
		assert.match(after, /value="90"/);
		assert.match(after, /placeholder="45"/);
		const max = acting.match(/<input\b[^>]*id="catalog-image-web-max-actions"[^>]*>/)?.[0] ?? '';
		assert.match(max, /placeholder="3"/);
		assert.equal(max.includes('value="'), false);

		const job = render(CatalogImageForm, { props: { mode: 'edit', entry: entry(null, 'job'), saveAction: '?/catalogUpdate', sets: [] } }).body;
		assert.equal(job.includes('When health fails'), false);
	});
});

describe('image entry names', () => {
	test('names ending in -old are reserved like -prev', () => {
		const message = 'Name must start with a letter or digit, use lowercase letters, digits, and hyphens, and must not end with -, -prev, or -old.';
		for (const name of ['web-old', 'web-prev']) {
			const check = imageSpecFromDraft(serviceDraft({ name }), undefined, true);
			assert.equal(check.ok, false, name);
			if (!check.ok) {
				assert.equal(check.field, 'name');
				assert.equal(check.message, message);
			}
			assert.equal(isImageEntryName(name), false, name);
		}
		for (const name of ['web-old2', 'old', 'web-older']) {
			assert.equal(isImageEntryName(name), true, name);
			const check = imageSpecFromDraft(serviceDraft({ name }), undefined, true);
			assert.equal(check.ok, true, name);
			if (check.ok) assert.equal(check.name, name);
		}
	});
});

describe('health failure policy: deploy dialog', () => {
	test('the rule line states the active policy', () => {
		assert.equal(healthPolicyRule(null), 'Health rule: If this deploy fails: roll back. If it turns unhealthy later: do nothing.');
		assert.equal(
			healthPolicyRule({ on_unhealthy: 'restart' }),
			'Health rule: If this deploy fails: roll back. If it turns unhealthy later: restart after 45 s (up to 3 times an hour).'
		);
		assert.equal(
			healthPolicyRule({ on_deploy_failure: 'stop', on_unhealthy: 'restart', unhealthy_after_sec: 60, max_actions_per_hour: 1 }),
			'Health rule: If this deploy fails: stop the new container. If it turns unhealthy later: restart after 60 s (up to once an hour).'
		);
		assert.equal(
			healthPolicyRule({ on_deploy_failure: 'keep' }),
			'Health rule: If this deploy fails: keep the new container running. If it turns unhealthy later: do nothing.'
		);
		assert.equal(
			healthPolicyRule({ on_unhealthy: 'rollback' }),
			'Health rule: If this deploy fails: roll back. If it turns unhealthy later: roll back after 45 s (once per deploy).'
		);
		const html = deployForm(entry({ on_unhealthy: 'restart' }), [host(HOST_ID, 'pi1', true)]);
		assert.match(html, /Health rule: If this deploy fails: roll back\. If it turns unhealthy later: restart after 45 s \(up to 3 times an hour\)\./);
		assert.equal(deployForm(entry(null, 'job'), [host(HOST_ID, 'pi1', true)]).includes('If this deploy fails'), false);
	});

	test('a non-default policy is blocked on a host without the capability', () => {
		assert.equal(isDefaultHealthPolicy(null), true);
		assert.equal(isDefaultHealthPolicy({}), true);
		assert.equal(isDefaultHealthPolicy({ on_deploy_failure: 'rollback', on_unhealthy: 'none', unhealthy_after_sec: 45, max_actions_per_hour: 3 }), true);
		assert.equal(isDefaultHealthPolicy({ unhealthy_after_sec: 60 }), false);
		assert.equal(imageHealthPolicyBlockReason({ programs: programs(false) }, false), null);
		assert.equal(imageHealthPolicyBlockReason({ programs: programs(true) }, true), null);
		assert.equal(imageHealthPolicyBlockReason({ programs: programs(false) }, true), GATE);
		assert.equal(imageHealthPolicyBlockReason({ programs: null }, true), GATE);

		const old = host(HOST_ID, 'pi1', false);
		const capable = host(OTHER_HOST_ID, 'pi3', true);
		const blocked = deployForm(entry({ on_deploy_failure: 'keep' }), [old, capable]);
		assert.match(blocked, /pi1: This host&#39;s agent does not support health policies|pi1: This host's agent does not support health policies/);
		assert.equal(blocked.includes('pi3: This host'), false);
		assert.equal(isDisabled(submitTag(blocked, 'Deploy')), true);

		const fine = deployForm(entry({ on_deploy_failure: 'keep' }), [capable]);
		assert.equal(isDisabled(submitTag(fine, 'Deploy')), false);

		// Defaults deploy everywhere, including a stored all-default object.
		for (const policy of [null, { on_unhealthy: 'none' as const }]) {
			const html = deployForm(entry(policy), [old]);
			assert.equal(html.includes('does not support health policies'), false);
			assert.equal(isDisabled(submitTag(html, 'Deploy')), false);
		}
	});
});

describe('health failure policy: rollback buttons', () => {
	const A = `sha256:${'a'.repeat(64)}`;
	const B = `sha256:${'b'.repeat(64)}`;
	const history = [
		deployRow('00000000-0000-4000-8000-000000000331', 'succeeded', 'console', B),
		deployRow('00000000-0000-4000-8000-000000000332', 'succeeded', 'console', A)
	];

	test('Roll back is disabled with the reason on a host without the capability', () => {
		const html = deployForm(entry({ on_unhealthy: 'restart' }), [host(HOST_ID, 'pi1', false)], history);
		const button = submitTag(html, 'Roll back to');
		assert.equal(isDisabled(button), true);
		assert.match(button, /aria-describedby="rollback-web-blocked"/);
		assert.match(html, /<p id="rollback-web-blocked"[^>]*>\s*pi1: This host(&#39;|')s agent does not support health policies\s*<\/p>/);
	});

	test('Roll back is enabled on a capable host and for a default policy', () => {
		for (const [policy, capable] of [
			[{ on_unhealthy: 'restart' }, true],
			[null, false]
		] as const) {
			const html = deployForm(entry(policy), [host(HOST_ID, 'pi1', capable)], history);
			const button = submitTag(html, 'Roll back to');
			assert.equal(isDisabled(button), false);
			assert.equal(button.includes('aria-describedby'), false);
			assert.equal(html.includes('rollback-web-blocked'), false);
		}
	});
});

describe('health failure policy: history', () => {
	test('automatic outcomes have readable labels', () => {
		assert.match(render(StatusBadge, { props: { status: 'auto_restarted' } }).body, /Automatic restart/);
		assert.match(render(StatusBadge, { props: { status: 'auto_rolled_back' } }).body, /Automatic rollback/);
		assert.match(render(StatusBadge, { props: { status: 'auto_gave_up' } }).body, /Automatic: gave up/);
		assert.match(render(StatusBadge, { props: { status: 'rolled_back' } }).body, /rolled_back/);
	});

	test('agent rows show Deploybot agent and no user', () => {
		const A = `sha256:${'a'.repeat(64)}`;
		const history = [
			deployRow('00000000-0000-4000-8000-000000000301', 'auto_restarted', 'agent', A),
			deployRow('00000000-0000-4000-8000-000000000302', 'succeeded', 'console', A)
		];
		const html = deployForm(entry({ on_unhealthy: 'restart' }), [host(HOST_ID, 'pi1', true)], history);
		const rows = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((match) => match[1] ?? '');
		assert.equal(rows.length, 2);
		assert.match(rows[0] ?? '', /Automatic restart/);
		assert.match(rows[0] ?? '', /Deploybot agent/);
		assert.equal(rows[1]?.includes('Deploybot agent'), false);
		assert.match(rows[1] ?? '', /succeeded/);
	});

	test('a failed automatic action is labelled and shows no digest', () => {
		assert.match(render(StatusBadge, { props: { status: 'auto_failed' } }).body, /Automatic action failed/);
		const history = [
			deployRow('00000000-0000-4000-8000-000000000321', 'auto_failed', 'agent', null),
			deployRow('00000000-0000-4000-8000-000000000322', 'succeeded', 'console', `sha256:${'a'.repeat(64)}`)
		];
		const rows = [...deployForm(entry({ on_unhealthy: 'restart' }), [host(HOST_ID, 'pi1', true)], history).matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map(
			(match) => match[1] ?? ''
		);
		assert.match(rows[0] ?? '', /Automatic action failed/);
		assert.equal(rows[0]?.includes('no digest'), false);
		assert.equal(rows[0]?.includes('sha256'), false);
	});

	test('an automatic rollback makes its digest current', () => {
		const A = `sha256:${'a'.repeat(64)}`;
		const B = `sha256:${'b'.repeat(64)}`;
		const C = `sha256:${'c'.repeat(64)}`;
		const history = [
			deployRow('00000000-0000-4000-8000-000000000311', 'auto_rolled_back', 'agent', B),
			deployRow('00000000-0000-4000-8000-000000000312', 'succeeded', 'console', C),
			deployRow('00000000-0000-4000-8000-000000000313', 'succeeded', 'console', B),
			deployRow('00000000-0000-4000-8000-000000000314', 'succeeded', 'console', A)
		];
		assert.equal(autoRollbackDigest(history), B);
		// B is current after the automatic rollback, so it is not a target and gets no same-image offer.
		assert.deepEqual(rollbackChoices(history), [
			{ digest: C, sameImage: false },
			{ digest: A, sameImage: false }
		]);
		// Deploy A, deploy B, automatic rollback to A: A would be a no-op, so only B is offered.
		const backToA = [
			deployRow('00000000-0000-4000-8000-000000000316', 'auto_rolled_back', 'agent', A),
			deployRow('00000000-0000-4000-8000-000000000317', 'succeeded', 'console', B),
			deployRow('00000000-0000-4000-8000-000000000318', 'succeeded', 'console', A)
		];
		assert.deepEqual(rollbackChoices(backToA), [{ digest: B, sameImage: false }]);
		// A later manual deploy takes over as current again.
		const redeployed = [deployRow('00000000-0000-4000-8000-000000000319', 'succeeded', 'console', B), ...backToA];
		assert.equal(autoRollbackDigest(redeployed), null);
		assert.deepEqual(rollbackChoices(redeployed), [{ digest: B, sameImage: true }, { digest: A, sameImage: false }]);
		// Restart and gave-up rows do not change the targets.
		const restarted = [
			deployRow('00000000-0000-4000-8000-000000000315', 'auto_restarted', 'agent', C),
			deployRow('00000000-0000-4000-8000-000000000320', 'auto_gave_up', 'agent', C),
			...history.slice(1)
		];
		assert.deepEqual(rollbackChoices(restarted), rollbackChoices(history.slice(1)));
	});
});

describe('health failure policy: shape parsing', () => {
	test('ImageSpec health_policy keeps stored keys and drops bad values', () => {
		const base = { ...wireSpec('service'), healthcheck: CHECK };
		assert.equal(parseImageSpec(base)?.health_policy, null);
		assert.equal(parseImageSpec({ ...base, health_policy: null })?.health_policy, null);
		assert.deepEqual(parseImageSpec({ ...base, health_policy: {} })?.health_policy, {});
		assert.deepEqual(parseImageSpec({ ...base, health_policy: { on_unhealthy: 'restart' } })?.health_policy, { on_unhealthy: 'restart' });
		const full = { on_deploy_failure: 'stop', on_unhealthy: 'rollback', unhealthy_after_sec: 600, max_actions_per_hour: 10 };
		assert.deepEqual(parseImageSpec({ ...base, health_policy: full })?.health_policy, full);
		assert.deepEqual(parseImageSpec({ ...base, health_policy: { unhealthy_after_sec: 15, max_actions_per_hour: 1 } })?.health_policy, { unhealthy_after_sec: 15, max_actions_per_hour: 1 });
		for (const bad of [
			[],
			'restart',
			{ on_deploy_failure: 'explode' },
			{ on_unhealthy: 'reboot' },
			{ unhealthy_after_sec: 14 },
			{ unhealthy_after_sec: 601 },
			{ unhealthy_after_sec: 45.5 },
			{ unhealthy_after_sec: '45' },
			{ max_actions_per_hour: 0 },
			{ max_actions_per_hour: 11 },
			{ on_unhealthy: 'restart', extra: true }
		]) {
			assert.equal(parseImageSpec({ ...base, health_policy: bad }), null, JSON.stringify(bad));
		}
		assert.equal(parseImageSpec({ ...wireSpec('job'), health_policy: { on_deploy_failure: 'keep' } }), null);
		assert.equal(parseImageSpec({ ...wireSpec('job'), health_policy: null })?.health_policy, null);
	});

	test('HostPrograms health_policy is false when absent', () => {
		const base = { enabled: true, run_as: ['joe'], allow_shell: true, policy_hash: 'policy-1' };
		assert.equal(parseHostPrograms(base)?.health_policy, false);
		assert.equal(parseHostPrograms({ ...base, health_policy: null })?.health_policy, false);
		assert.equal(parseHostPrograms({ ...base, health_policy: true })?.health_policy, true);
		assert.equal(parseHostPrograms({ ...base, health_policy: 'yes' }), null);
	});

	test('ImageDeploy accepts agent rows with a null user and new outcomes', () => {
		const row = {
			id: '00000000-0000-4000-8000-000000000401',
			entry_id: ENTRY_ID,
			host_id: HOST_ID,
			digest: `sha256:${'a'.repeat(64)}`,
			spec_hash: HASH,
			outcome: 'auto_gave_up',
			exit_code: null,
			started_at: '2026-10-14T00:00:00Z',
			finished_at: '2026-10-14T00:00:00Z',
			by: null,
			via: 'agent'
		};
		const failed = parseImageDeploy({ ...row, outcome: 'auto_failed', digest: null });
		assert.equal(failed?.outcome, 'auto_failed');
		assert.equal(failed?.digest, null);
		assert.equal(failed?.by, null);
		assert.equal(failed?.via, 'agent');
		for (const outcome of ['auto_restarted', 'auto_rolled_back', 'auto_gave_up']) {
			const parsed = parseImageDeploy({ ...row, outcome });
			assert.equal(parsed?.outcome, outcome);
			assert.equal(parsed?.by, null);
			assert.equal(parsed?.via, 'agent');
		}
		assert.equal(parseImageDeploy({ ...row, by: undefined })?.by, null);
		assert.equal(parseImageDeploy({ ...row, by: USER.id })?.by, USER.id);
		assert.equal(parseImageDeploy({ ...row, by: 'not-a-uuid' }), null);
		// A user action must still name its user.
		assert.equal(parseImageDeploy({ ...row, via: 'console', outcome: 'succeeded' }), null);
		assert.equal(parseImageDeploy({ ...row, via: 'console', outcome: 'succeeded', by: USER.id })?.by, USER.id);
		assert.equal(parseImageDeploy({ ...row, via: 'robot' }), null);
		assert.equal(parseImageDeploy({ ...row, outcome: 'auto_exploded' }), null);
	});
});

describe('health failure policy: edit round trip', { concurrency: false }, () => {
	const originalFetch = globalThis.fetch;
	before(() => useApi('https://api.test'));
	after(() => {
		globalThis.fetch = originalFetch;
		restoreEnv();
	});

	test('the edit form renders the four fields with the stored values', () => {
		const html = editHtml({ on_unhealthy: 'restart', unhealthy_after_sec: 90 });
		const fields = postedFields(html);
		assert.deepEqual(fields.health_on_deploy_failure, ['rollback']);
		assert.deepEqual(fields.health_on_unhealthy, ['restart']);
		assert.deepEqual(fields.health_unhealthy_after_sec, ['90']);
		assert.deepEqual(fields.health_max_actions_per_hour, ['']);
		assert.deepEqual(fields.health_keep_key, ['on_unhealthy']);
		// The hint comes before the error slot and describes the select.
		assert.match(openTagWithId(html, 'catalog-image-web-on-unhealthy'), /aria-describedby="catalog-image-web-unhealthy-hint"/);
		assert.match(html, /id="catalog-image-web-unhealthy-hint"[^>]*>Needs the Docker health check command above\.</);
	});

	test('saving an unchanged edit sends the stored policy', async () => {
		for (const stored of [
			{ on_unhealthy: 'restart', unhealthy_after_sec: 90 },
			{ unhealthy_after_sec: 90 },
			{ on_unhealthy: 'restart', unhealthy_after_sec: 45 },
			{ on_deploy_failure: 'stop' },
			{ on_deploy_failure: 'rollback', on_unhealthy: 'none', unhealthy_after_sec: 45, max_actions_per_hour: 3 },
			{ on_unhealthy: 'rollback', max_actions_per_hour: 2 }
		] satisfies ImageHealthPolicy[]) {
			assert.deepEqual(await savedPolicy(stored), stored, JSON.stringify(stored));
		}
		assert.equal(await savedPolicy(null), undefined);
	});

	test('Do nothing sends numbers only when the stored entry kept them under Do nothing', async () => {
		// a. Stored restart with numbers, switched to Do nothing: the hidden numbers are not sent.
		const switched = await savedPolicy({ on_unhealthy: 'restart', unhealthy_after_sec: 90, max_actions_per_hour: 2 }, (fields) => {
			fields.health_on_unhealthy = ['none'];
		});
		assert.deepEqual(switched, { on_unhealthy: 'none' });
		assert.equal(isDefaultHealthPolicy(switched as ImageHealthPolicy), true);
		// b. Stored Do nothing with a number, saved unchanged: the number is kept.
		assert.deepEqual(await savedPolicy({ on_unhealthy: 'none', unhealthy_after_sec: 90 }), { on_unhealthy: 'none', unhealthy_after_sec: 90 });
		// c. New policy: Restart, 90 typed, then back to Do nothing: the hidden numbers post but are not sent.
		const backOut = await savedPolicy(null, (fields) => {
			assert.equal(fields.health_keep_key, undefined);
			fields.health_on_unhealthy = ['none'];
			fields.health_unhealthy_after_sec = ['90'];
			fields.health_max_actions_per_hour = ['5'];
		});
		assert.equal(backOut, undefined);
		// d. Stored restart with a number, kept: unchanged.
		assert.deepEqual(await savedPolicy({ on_unhealthy: 'restart', unhealthy_after_sec: 90 }), { on_unhealthy: 'restart', unhealthy_after_sec: 90 });
	});

	test('under Do nothing a kept number is the stored value, not an edit made while an action was chosen', async () => {
		const stored = { on_unhealthy: 'none', unhealthy_after_sec: 90 } satisfies ImageHealthPolicy;
		// e. Restart, 200, back to Do nothing.
		const edited = editedFields(stored, (draft) => {
			draft.healthOnUnhealthy = 'restart';
			draft.healthUnhealthyAfter = '200';
			draft.healthOnUnhealthy = 'none';
		});
		assert.equal(edited.health_unhealthy_after_sec, undefined);
		assert.deepEqual(edited.health_stored_unhealthy_after_sec, ['90']);
		assert.deepEqual(await savedPolicy(stored, undefined, edited), stored);
		// f. Restart, field emptied, back to Do nothing.
		const emptied = editedFields(stored, (draft) => {
			draft.healthOnUnhealthy = 'restart';
			draft.healthUnhealthyAfter = '';
			draft.healthOnUnhealthy = 'none';
		});
		assert.deepEqual(await savedPolicy(stored, undefined, emptied), stored);
		// g. Switched to Restart with 120: the visible field is sent.
		const acting = editedFields(stored, (draft) => {
			draft.healthOnUnhealthy = 'restart';
			draft.healthUnhealthyAfter = '120';
		});
		// The stored value is posted with any action (read only under Do nothing).
		assert.deepEqual(acting.health_stored_unhealthy_after_sec, ['90']);
		assert.deepEqual(await savedPolicy(stored, undefined, acting), { on_unhealthy: 'restart', unhealthy_after_sec: 120 });
	});

	test('a refused save keeps the stored number for a later Do nothing', async () => {
		const stored = { on_unhealthy: 'none', unhealthy_after_sec: 90 } satisfies ImageHealthPolicy;
		const fields = editedFields(stored, (draft) => {
			draft.healthOnUnhealthy = 'restart';
			draft.healthUnhealthyAfter = '5';
		});
		const calls = installFetch(() => envelope({ id: ENTRY_ID }));
		const refused = await projectActions.catalogUpdate(
			fakeEvent({
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogUpdate`,
				form: fields
			}).event as never
		);
		assert.equal(calls.length, 0);
		assert.equal(isActionFailure(refused), true);
		if (!isActionFailure(refused)) return;
		const editor = (refused.data as unknown as { imageEditor?: { draft: ImageDraft; field: string | null } }).imageEditor;
		assert.equal(editor?.field, 'health_policy.unhealthy_after_sec');
		assert.ok(editor);
		const draft = editor.draft;
		assert.equal(draft.healthStored.unhealthyAfter, '90');
		draft.healthOnUnhealthy = 'none';
		const html = render(CatalogImageForm, {
			props: { mode: 'edit', entry: entry(stored), saveAction: '?/catalogUpdate', sets: [], editor: { mode: 'edit', name: 'web', draft, field: null, message: null } }
		}).body;
		assert.deepEqual(await savedPolicy(stored, undefined, postedFields(html)), stored);
	});

	test('a new entry with Do nothing renders no hidden number inputs', () => {
		const html = render(CatalogImageForm, { props: { mode: 'create', saveAction: '?/catalogCreate', sets: [], setsStatus: 'ready', editor: null } }).body;
		const fields = postedFields(html);
		for (const name of ['health_unhealthy_after_sec', 'health_max_actions_per_hour', 'health_stored_unhealthy_after_sec', 'health_stored_max_actions_per_hour', 'health_keep_key']) {
			assert.equal(fields[name], undefined, name);
		}
		// Stored inputs follow the keep keys; an entry stored with an action keeps no Do-nothing numbers.
		const actingFields = postedFields(editHtml({ on_unhealthy: 'restart', unhealthy_after_sec: 90 }));
		assert.equal(actingFields.health_stored_unhealthy_after_sec, undefined);
	});

	test('the hint precedes the error notice on a refused save', () => {
		const message = 'Restart and Roll back need a Docker health check command. Fill in the Command field above.';
		const draft = serviceDraft({ healthOnUnhealthy: 'restart' });
		const html = render(CatalogImageForm, {
			props: { mode: 'create', saveAction: '?/catalogCreate', sets: [], editor: { mode: 'create', name: null, draft, field: 'health_policy.on_unhealthy', message } }
		}).body;
		const hintAt = html.indexOf('id="catalog-image-new-unhealthy-hint"');
		const errorAt = html.indexOf(message);
		assert.equal(hintAt >= 0 && errorAt > hintAt, true);
		assert.match(openTagWithId(html, 'catalog-image-new-on-unhealthy'), /aria-describedby="catalog-image-new-unhealthy-hint catalog-image-new-error"/);
	});
});
