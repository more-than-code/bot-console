import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { render } from 'svelte/server';
import type { Host, ImageDeploy, ImageEntry, ImageSpec } from '../src/lib/api-types.ts';
import { rollbackChoices, rollbackDigests, shortDigest } from '../src/lib/image-spec.ts';
import CatalogDeployForm from '../src/routes/projects/[id]/CatalogDeployForm.svelte';
import { PROJECT, USER } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

const HOST_ID = '00000000-0000-4000-8000-0000000000aa';
const ENTRY_ID = '00000000-0000-4000-8000-0000000000c1';
const HASH = 'ab'.repeat(32);
const SAME_IMAGE = 'Previous version (same image)';
const HINT = 'Restores the previous container with its earlier files and settings.';

function digest(ch: string): string {
	return `sha256:${ch.repeat(64)}`;
}

function imageSpec(kind: ImageSpec['kind'] = 'service'): ImageSpec {
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
		healthy_after_sec: 30,
		memory_mb: null,
		timeout_sec: 600,
		healthcheck: null
	};
}

function imageEntry(): ImageEntry {
	return {
		id: ENTRY_ID,
		project_id: PROJECT.id,
		name: 'web',
		kind: 'image',
		spec: imageSpec(),
		spec_hash: HASH,
		command_display: 'ghcr.io/acme/web:1',
		created_by: USER.id,
		created_at: '2026-10-14T00:00:00Z',
		updated_at: '2026-10-14T00:00:00Z',
		my_actions: ['deploy']
	};
}

function host(): Host {
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
		programs: { enabled: true, run_as: ['joe'], allow_shell: true, policy_hash: 'policy-1', images: true, docker: true, files: false }
	};
}

function row(id: string, outcome: ImageDeploy['outcome'], imageDigest: string | null): ImageDeploy {
	return {
		id,
		entry_id: ENTRY_ID,
		host_id: HOST_ID,
		digest: imageDigest,
		spec_hash: HASH,
		outcome,
		exit_code: outcome === 'failed' ? 1 : 0,
		started_at: '2026-10-14T00:00:00Z',
		finished_at: '2026-10-14T00:01:00Z',
		by: USER.id,
		via: 'console'
	};
}

const A = digest('a');
const B = digest('b');
const C = digest('c');
const D = digest('d');

describe('previous version of the same image', () => {
	test('the current digest is offered first when it was deployed twice', () => {
		const twice = [
			row('00000000-0000-4000-8000-000000000101', 'succeeded', A),
			row('00000000-0000-4000-8000-000000000102', 'succeeded', A)
		];
		assert.deepEqual(rollbackChoices(twice), [{ digest: A, sameImage: true }]);
		assert.deepEqual(rollbackDigests(twice), [A]);

		const unchanged = [
			row('00000000-0000-4000-8000-000000000103', 'unchanged', A),
			row('00000000-0000-4000-8000-000000000104', 'succeeded', A)
		];
		assert.deepEqual(rollbackChoices(unchanged), [{ digest: A, sameImage: true }]);

		const failedBetween = [
			row('00000000-0000-4000-8000-000000000105', 'succeeded', A),
			row('00000000-0000-4000-8000-000000000106', 'failed', A),
			row('00000000-0000-4000-8000-000000000107', 'unchanged', A)
		];
		assert.deepEqual(rollbackChoices(failedBetween), [{ digest: A, sameImage: true }]);
	});

	test('a current digest seen once is not offered', () => {
		assert.deepEqual(rollbackChoices([]), []);
		assert.deepEqual(
			rollbackChoices([row('00000000-0000-4000-8000-000000000111', 'succeeded', A)]),
			[]
		);
		assert.deepEqual(
			rollbackChoices([
				row('00000000-0000-4000-8000-000000000112', 'failed', A),
				row('00000000-0000-4000-8000-000000000113', 'succeeded', A)
			]),
			[]
		);
		assert.deepEqual(
			rollbackChoices([
				row('00000000-0000-4000-8000-000000000114', 'succeeded', A),
				row('00000000-0000-4000-8000-000000000115', 'failed', A)
			]),
			[]
		);
		const html = deployHtml([
			row('00000000-0000-4000-8000-000000000116', 'succeeded', A),
			row('00000000-0000-4000-8000-000000000117', 'succeeded', B)
		]);
		assert.equal(html.includes(SAME_IMAGE), false);
		assert.equal(html.includes(HINT), false);
		assert.equal(html.includes(`Roll back to ${shortDigest(B)}`), true);
		assert.equal(html.includes(`value="${A}"`), false);
	});

	test('mixed digests keep today\'s list and add the same-image choice when it applies', () => {
		const once = [
			row('00000000-0000-4000-8000-000000000121', 'failed', D),
			row('00000000-0000-4000-8000-000000000122', 'succeeded', A),
			row('00000000-0000-4000-8000-000000000123', 'succeeded', B),
			row('00000000-0000-4000-8000-000000000124', 'unchanged', C),
			row('00000000-0000-4000-8000-000000000125', 'succeeded', D)
		];
		assert.deepEqual(rollbackChoices(once), [
			{ digest: B, sameImage: false },
			{ digest: C, sameImage: false }
		]);

		const repeated = [
			row('00000000-0000-4000-8000-000000000126', 'succeeded', A),
			row('00000000-0000-4000-8000-000000000127', 'succeeded', A),
			row('00000000-0000-4000-8000-000000000128', 'succeeded', B),
			row('00000000-0000-4000-8000-000000000129', 'unchanged', C)
		];
		assert.deepEqual(rollbackChoices(repeated), [
			{ digest: A, sameImage: true },
			{ digest: B, sameImage: false },
			{ digest: C, sameImage: false }
		]);

		const between = [
			row('00000000-0000-4000-8000-00000000012a', 'succeeded', A),
			row('00000000-0000-4000-8000-00000000012b', 'succeeded', B),
			row('00000000-0000-4000-8000-00000000012c', 'succeeded', A)
		];
		assert.deepEqual(rollbackChoices(between), [
			{ digest: A, sameImage: true },
			{ digest: B, sameImage: false }
		]);
		assert.equal(rollbackChoices(between).some((choice) => choice.digest === B && choice.sameImage), false);
	});

	test('only three distinct succeeded or unchanged digests are considered', () => {
		const four = [
			row('00000000-0000-4000-8000-000000000131', 'succeeded', A),
			row('00000000-0000-4000-8000-000000000132', 'succeeded', B),
			row('00000000-0000-4000-8000-000000000133', 'unchanged', C),
			row('00000000-0000-4000-8000-000000000134', 'succeeded', D)
		];
		assert.deepEqual(rollbackDigests(four), [B, C]);
		assert.equal(rollbackDigests(four).includes(D), false);

		const repeatedThenFourth = [
			row('00000000-0000-4000-8000-000000000135', 'succeeded', A),
			row('00000000-0000-4000-8000-000000000136', 'succeeded', A),
			row('00000000-0000-4000-8000-000000000137', 'succeeded', B),
			row('00000000-0000-4000-8000-000000000138', 'unchanged', C),
			row('00000000-0000-4000-8000-000000000139', 'succeeded', D)
		];
		assert.deepEqual(rollbackChoices(repeatedThenFourth), [
			{ digest: A, sameImage: true },
			{ digest: B, sameImage: false },
			{ digest: C, sameImage: false }
		]);

		const repeatAfterWindow = [
			row('00000000-0000-4000-8000-00000000013a', 'succeeded', A),
			row('00000000-0000-4000-8000-00000000013b', 'succeeded', B),
			row('00000000-0000-4000-8000-00000000013c', 'unchanged', C),
			row('00000000-0000-4000-8000-00000000013d', 'succeeded', A),
			row('00000000-0000-4000-8000-00000000013e', 'succeeded', D)
		];
		assert.deepEqual(rollbackChoices(repeatAfterWindow), [
			{ digest: B, sameImage: false },
			{ digest: C, sameImage: false }
		]);
	});

	test('the deploy form renders the same-image label, hint, and rollback fields', () => {
		const source = readFileSync(new URL('../src/routes/projects/[id]/CatalogDeployForm.svelte', import.meta.url), 'utf8');
		assert.match(source, /rollbackChoices\(history\)/);
		assert.match(source, /use:enhance=\{rollbackEnhance\(item\.digest\)\}/);
		assert.match(source, /formData\.set\('idempotency_key', key\)/);

		const history = [
			row('00000000-0000-4000-8000-000000000141', 'succeeded', A),
			row('00000000-0000-4000-8000-000000000142', 'unchanged', A),
			row('00000000-0000-4000-8000-000000000143', 'succeeded', B)
		];
		const html = deployHtml(history);
		const same = formContaining(html, SAME_IMAGE);
		const older = formContaining(html, `Roll back to ${shortDigest(B)}`);
		assert.equal(html.includes(SAME_IMAGE), true);
		assert.equal(html.includes(HINT), true);
		assert.equal(html.split(HINT).length - 1, 1);
		assert.equal(html.includes(`Roll back to ${shortDigest(A)}`), false);
		assert.ok(html.indexOf(SAME_IMAGE) < html.indexOf(`Roll back to ${shortDigest(B)}`));
		assert.equal(same.includes(`name="host_id"`), true);
		assert.equal(same.includes(`value="${HOST_ID}"`), true);
		assert.equal(same.includes(`name="digest"`), true);
		assert.equal(same.includes(`value="${A}"`), true);
		assert.equal(same.includes(HINT), true);
		assert.equal(older.includes(HINT), false);
		assert.equal(older.includes(`value="${B}"`), true);
		assert.deepEqual(fieldNames(same), fieldNames(older));
		assert.equal(same.includes('action="?/catalogRollback"'), true);
		assert.equal(older.includes('action="?/catalogRollback"'), true);
	});
});

function deployHtml(history: ImageDeploy[]): string {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
	return render(CatalogDeployForm, {
		props: {
			entry: imageEntry(),
			hosts: [host()],
			deployAction: '?/catalogDeploy',
			rollbackAction: '?/catalogRollback',
			removeAction: '?/catalogRemove',
			confirmAction: '?/catalogConfirm',
			historyAction: '?/catalogDeploys',
			result: {
				name: 'web',
				resultId: '00000000-0000-4000-8000-000000000199',
				hostId: HOST_ID,
				workload: 'service',
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

function formContaining(html: string, needle: string): string {
	const forms = html.split(/<form\b/).slice(1).map((part) => `<form${part.split('</form>')[0]}`);
	const found = forms.find((form) => form.includes(needle));
	assert.equal(found != null, true, needle);
	return found ?? '';
}

function fieldNames(form: string): string[] {
	return [...form.matchAll(/name="([^"]+)"/g)].map((match) => match[1] ?? '').sort();
}
