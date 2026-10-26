import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { render } from 'svelte/server';
import type { CatalogEntry, Host, ImageDeploy, ImageEntry, ImageHealthcheck, ImageSpec } from '../src/lib/api-types.ts';
import {
	FLIGHT_ACTIONS,
	deployProgressNote,
	flightLabel,
	flightOfRunKind,
	formatElapsed,
	healthWaitMinutes,
	healthWaitSeconds,
	type FlightAction
} from '../src/lib/catalog-flight.ts';
import { healthPolicyRule } from '../src/lib/image-spec.ts';
import CatalogDeployForm from '../src/routes/projects/[id]/CatalogDeployForm.svelte';
import CatalogRunForm from '../src/routes/projects/[id]/CatalogRunForm.svelte';
import CatalogSection from '../src/routes/projects/[id]/CatalogSection.svelte';
import { PROJECT, USER } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

const HOST_ID = '00000000-0000-4000-8000-0000000000aa';
const OTHER_HOST = '00000000-0000-4000-8000-0000000000ab';
const ENTRY_ID = '00000000-0000-4000-8000-0000000000c1';
const HASH = 'ab'.repeat(32);

function readSource(name: string): string {
	return readFileSync(new URL(`../src/routes/projects/[id]/${name}`, import.meta.url), 'utf8');
}

function isDisabled(tag: string): boolean {
	return /(?:^|\s)disabled(?:[\s=]|>)/.test(tag);
}

function openTag(html: string, marker: string, tag: string): string {
	const at = html.indexOf(marker);
	assert.ok(at >= 0, marker);
	const start = html.lastIndexOf(`<${tag}`, at);
	assert.ok(start >= 0, `${tag} before ${marker}`);
	const end = html.indexOf('>', start);
	assert.ok(end > start, marker);
	return html.slice(start, end + 1);
}

function imageSpec(healthcheck: ImageHealthcheck | null = null): ImageSpec {
	return {
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
		healthcheck,
		logging: null,
		health_policy: null
	};
}

function imageEntry(actions: ImageEntry['my_actions'], healthcheck: ImageHealthcheck | null = null): ImageEntry {
	return {
		id: ENTRY_ID,
		project_id: PROJECT.id,
		name: 'web',
		kind: 'image',
		spec: imageSpec(healthcheck),
		spec_hash: HASH,
		command_display: 'ghcr.io/acme/web:1',
		created_by: USER.id,
		created_at: '2026-10-14T00:00:00Z',
		updated_at: '2026-10-14T00:00:00Z',
		my_actions: actions
	};
}

function programEntry(): CatalogEntry {
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
		my_actions: ['run', 'stop', 'restart', 'logs', 'status']
	};
}

function host(id = HOST_ID, name = 'pi1'): Host {
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
		programs: { enabled: true, run_as: ['joe'], allow_shell: true, policy_hash: 'policy-1', images: true, docker: true, files: false, logging: false, health_policy: false }
	};
}

const ACTIONS = ['run', 'stop', 'restart', 'logs', 'status', 'deploy'] as const;

function section(entries: CatalogEntry[], canOwner = false): string {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
	return render(CatalogSection, {
		props: {
			canOwner,
			entries,
			omitted: 0,
			truncated: false,
			message: null,
			hosts: [host(), host(OTHER_HOST, 'pi2')],
			members: []
		}
	}).body;
}

test('flight helpers format elapsed time, the health budget, and the in-flight label', () => {
	const elapsed: Array<[number, string]> = [
		[0, '0:00'],
		[42, '0:42'],
		[59, '0:59'],
		[60, '1:00'],
		[125, '2:05'],
		[61.9, '1:01'],
		[-4, '0:00']
	];
	for (const [seconds, want] of elapsed) assert.equal(formatElapsed(seconds), want);

	const check = (overrides: Partial<ImageHealthcheck>): ImageHealthcheck => ({
		test: ['true'],
		interval_sec: 30,
		timeout_sec: 5,
		retries: 3,
		start_period_sec: 0,
		...overrides
	});
	const budgets: Array<[ImageHealthcheck | null, number | null]> = [
		[null, null],
		[check({}), 120],
		[check({ timeout_sec: 61, interval_sec: 5, retries: 1 }), 61],
		[check({ timeout_sec: 60, interval_sec: 5, retries: 1, start_period_sec: 0 }), 60],
		[check({ timeout_sec: 10, interval_sec: 10, retries: 2, start_period_sec: 50 }), 80]
	];
	for (const [healthcheck, seconds] of budgets) {
		assert.equal(healthWaitSeconds(healthcheck), seconds);
		assert.equal(healthWaitMinutes(healthcheck), seconds == null ? null : Math.ceil(seconds / 60));
	}
	assert.equal(deployProgressNote(null), 'Pulls the image, starts the container.');
	assert.equal(
		deployProgressNote(check({})),
		'Pulls the image, starts the container, then waits until it is healthy (up to 2 min).'
	);
	assert.equal(
		deployProgressNote(check({ timeout_sec: 60, interval_sec: 5, retries: 1 })),
		'Pulls the image, starts the container, then waits until it is healthy (up to 1 min).'
	);

	const labels: Array<[FlightAction, string]> = [
		['deploy', 'Deploying…'],
		['run', 'Starting…'],
		['stop', 'Stopping…'],
		['restart', 'Restarting…'],
		['rollback', 'Rolling back…']
	];
	assert.deepEqual(labels.map(([action]) => action), [...FLIGHT_ACTIONS]);
	for (const [action, label] of labels) assert.equal(flightLabel(action), label);
	assert.equal(flightOfRunKind('logs'), null);
	assert.equal(flightOfRunKind('status'), null);
	assert.equal(flightOfRunKind('run'), 'run');
});

test('a catalog row keeps Deploy, Edit, Permissions and Delete; running copies act from Services', () => {
	for (const entry of [imageEntry([...ACTIONS]), programEntry()]) {
		const html = section([entry], true);
		for (const action of ['Run', 'Start', 'Stop', 'Restart', 'Logs', 'Status']) {
			assert.equal(html.includes(`aria-label="${action} web`), false, `${entry.kind} ${action}`);
		}
		assert.equal(html.includes('aria-label="Edit web"'), true, entry.kind);
		assert.equal(html.includes('aria-label="Permissions web"'), true, entry.kind);
		assert.equal(html.includes('aria-label="Delete web"'), true, entry.kind);
		assert.equal(html.includes('aria-label="Deploy web"'), entry.kind === 'image', entry.kind);
	}
	const source = readSource('CatalogSection.svelte');
	assert.equal(source.includes('CatalogRunDialog'), false);
	assert.equal(source.includes('ROW_ACTIONS'), false);
});

test('the run dialog posts the row host and offers no host choice', () => {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=services`);
	const html = render(CatalogRunForm, {
		props: { kind: 'run', entryName: 'web', hostId: HOST_ID, action: '?/catalogRun', entryKind: 'image' }
	}).body;
	assert.match(html, new RegExp(`name="host_id"[^>]*value="${HOST_ID}"|value="${HOST_ID}"[^>]*name="host_id"`));
	assert.equal(html.includes('role="radiogroup"'), false);
	assert.equal(html.includes('role="radio"'), false);
	assert.match(html, />\s*Start\s*</);
});

test('an in-flight deploy shows a spinner, a label, and a timer', () => {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
	// The run form goes in flight only on a browser submit; idle it offers its own action.
	const idle = render(CatalogRunForm, {
		props: { kind: 'run', entryName: 'web', hostId: HOST_ID, action: '?/catalogRun', entryKind: 'image' }
	}).body;
	assert.equal(idle.includes('aria-busy="true"'), false);
	assert.match(idle, />\s*Start\s*</);

	const props = {
		entry: imageEntry(['deploy']),
		hosts: [host()],
		deployAction: '?/catalogDeploy',
		rollbackAction: '?/catalogRollback',
		removeAction: '?/catalogRemove',
		confirmAction: '?/catalogConfirm',
		historyAction: '?/catalogDeploys'
	};
	const deploying = render(CatalogDeployForm, { props: { ...props, result: null, inFlight: 'deploy' as const } }).body;
	assert.match(deploying, /Deploying…/);
	assert.match(deploying, /motion-safe:animate-spin/);
	assert.match(deploying, /Elapsed 0:00/);
	assert.match(deploying, /Pulls the image, starts the container\./);
	// The health policy rule line says "unhealthy"; the progress note must not mention a health wait.
	assert.equal(deploying.replace(healthPolicyRule(null), '').includes('healthy'), false);
	const deployingButton = openTag(deploying, 'Deploying…', 'button');
	assert.equal(isDisabled(deployingButton), false);
	assert.equal(deployingButton.includes('aria-disabled="true"'), true);
	assert.equal(deployingButton.includes('aria-busy="true"'), true);
	assert.equal(isDisabled(openTag(deploying, '>pi1', 'button')), true);

	const check: ImageHealthcheck = { test: ['true'], interval_sec: 30, timeout_sec: 5, retries: 3, start_period_sec: 0 };
	const healthy = render(CatalogDeployForm, {
		props: { ...props, entry: imageEntry(['deploy'], check), result: null, inFlight: 'deploy' as const }
	}).body;
	assert.match(healthy, /then waits until it is healthy \(up to 2 min\)\./);

	const older = `sha256:${'b'.repeat(64)}`;
	const newer = `sha256:${'a'.repeat(64)}`;
	const deploy = (id: string, digest: string): ImageDeploy => ({
		id,
		entry_id: ENTRY_ID,
		host_id: HOST_ID,
		digest,
		spec_hash: HASH,
		outcome: 'succeeded',
		exit_code: 0,
		started_at: '2026-10-14T00:00:00Z',
		finished_at: '2026-10-14T00:01:00Z',
		by: USER.id,
		via: 'console'
	});
	const rolling = render(CatalogDeployForm, {
		props: {
			...props,
			inFlight: 'rollback' as const,
			flightDigest: older,
			result: {
				name: 'web',
				resultId: '00000000-0000-4000-8000-0000000000eb',
				hostId: HOST_ID,
				workload: 'service' as const,
				waitSec: 30,
				outcome: null,
				status: null,
				lines: [],
				history: [deploy('00000000-0000-4000-8000-0000000000e1', newer), deploy('00000000-0000-4000-8000-0000000000e2', older)],
				confirmation: null,
				confirmKind: null,
				message: null
			}
		}
	}).body;
	assert.match(rolling, /Rolling back…/);
	assert.match(rolling, /Elapsed 0:00/);
	const rollingButton = openTag(rolling, 'Rolling back…', 'button');
	assert.equal(isDisabled(rollingButton), false);
	assert.equal(rollingButton.includes('aria-disabled="true"'), true);
	assert.equal(rollingButton.includes('aria-busy="true"'), true);

	const runDialog = readSource('CatalogRunDialog.svelte');
	const deployDialog = readSource('CatalogDeployDialog.svelte');
	for (const source of [runDialog, deployDialog]) {
		assert.match(source, /showCloseButton=\{!flight\}/);
		assert.match(source, /escapeKeydownBehavior=\{flight \? 'ignore' : 'close'\}/);
		assert.match(source, /interactOutsideBehavior=\{flight \? 'ignore' : 'close'\}/);
		assert.match(source, /<Dialog\.Close type="button" disabled=\{flight\}>Cancel<\/Dialog\.Close>/);
	}
	assert.equal(readSource('CatalogSection.svelte').includes('disabled={rowBusy === entry.name}'), true);
	assert.equal(readSource('ServiceRowActions.svelte').includes('<fieldset disabled={busy}'), true);
	assert.equal(runDialog.includes('<CatalogRunForm'), true);
	assert.equal(deployDialog.includes('<CatalogDeployForm'), true);
});
