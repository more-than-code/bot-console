import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import type { EnvSet, Host, ProjectServiceRow } from '../src/lib/api-types.ts';
import {
	blockInFlightSubmit,
	elapsedSeconds,
	flightFocusReturn,
	flightFocusTarget
} from '../src/lib/catalog-flight.ts';
import { COPY_FAILED_NOTE, COPY_FAILURE_MS, shownDigestFailure } from '../src/lib/copy-text.ts';
import CatalogRunForm from '../src/routes/projects/[id]/CatalogRunForm.svelte';
import CatalogRunResult from '../src/routes/projects/[id]/CatalogRunResult.svelte';
import EnvSetTable from '../src/routes/projects/[id]/EnvSetTable.svelte';
import ServicesSection from '../src/routes/projects/[id]/ServicesSection.svelte';
import { initialAddDraft, setAddSecret } from '../src/routes/projects/[id]/env-add-variable.ts';
import { PROJECT } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

const HOST_ID = '00000000-0000-4000-8000-0000000000aa';
const SERVICE_ID = '00000000-0000-4000-8000-0000000000bb';
const DIGEST = `sha256:${'ab'.repeat(32)}`;

function readRoute(name: string): string {
	return readFileSync(new URL(`../src/routes/projects/[id]/${name}`, import.meta.url), 'utf8');
}

function readLib(name: string): string {
	return readFileSync(new URL(`../src/lib/${name}`, import.meta.url), 'utf8');
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
	return html.slice(start, end + 1);
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
		programs: { enabled: true, run_as: ['joe'], allow_shell: true, policy_hash: 'policy-1', images: true, docker: true, files: false, logging: false, health_policy: false }
	};
}

function renderResult(message: string): string {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=services`);
	return render(CatalogRunResult, {
		props: {
			close: createRawSnippet(() => ({ render: () => '<button type="button">Close</button>' })),
			result: { name: 'web', hostId: host().id, serviceId: null, kind: 'run', resultId: '00000000-0000-4000-8000-0000000000e1', status: null, logs: null, message }
		}
	}).body;
}

test('an in-flight submit stays focusable and a second submit is blocked', () => {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=services`);
	const html = render(CatalogRunForm, {
		props: { kind: 'run', entryName: 'web', hostId: host().id, action: '?/catalogRun', entryKind: 'image' }
	}).body;
	const submit = openTag(html, 'Start', 'button');
	assert.equal(isDisabled(submit), false);

	let submitted = 0;
	const attempt = (inFlight: boolean) => {
		if (blockInFlightSubmit(inFlight)) return;
		submitted += 1;
	};
	attempt(true);
	assert.equal(submitted, 0);
	attempt(false);
	assert.equal(submitted, 1);

	const run = readRoute('CatalogRunForm.svelte');
	const deploy = readRoute('CatalogDeployForm.svelte');
	assert.ok(run.indexOf('if (blockInFlightSubmit(busy))') < run.indexOf('submitting = true'));
	assert.match(run, /if \(blockInFlightSubmit\(busy\)\) event\.preventDefault\(\)/);
	assert.match(deploy, /if \(blockInFlightSubmit\(submitting \|\| busy\)\)/);
	assert.match(deploy, /if \(blockInFlightSubmit\(activeFlight === 'deploy'\)\) event\.preventDefault\(\)/);
	assert.match(deploy, /if \(blockInFlightSubmit\(rollingThis\)\) event\.preventDefault\(\)/);
});

test('focus returns to the result notice, or the submit button when there is none', () => {
	assert.equal(flightFocusTarget(true), 'notice');
	assert.equal(flightFocusTarget(false), 'submit');
	// A run result is its own view: the notice is focusable and Close is the only control.
	const html = renderResult('The host rejected the request.');
	assert.match(html, /tabindex="-1"/);
	assert.match(html, /The host rejected the request\./);
	assert.equal(html.includes('type="submit"'), false);
	const deploy = readRoute('CatalogDeployForm.svelte');
	assert.match(deploy, /flightFocusTarget\(hasNotice\)/);
	assert.match(deploy, /noticeEl\.focus\(\)/);
	assert.match(deploy, /deploySubmitEl\)\?\.focus\(\)/);

	let focused = '';
	const button = { focus() { focused = 'submit'; } };
	const dialog = {
		focus() { focused = 'dialog'; },
		querySelector(selector: string) {
			return selector === 'button[aria-busy="true"]' ? button : null;
		}
	};
	assert.equal(flightFocusReturn(dialog), 'submit');
	assert.equal(focused, 'submit');
	const empty = { focus() { focused = 'dialog'; }, querySelector() { return null; } };
	assert.equal(flightFocusReturn(empty), 'dialog');
	assert.equal(focused, 'dialog');

	for (const name of ['CatalogRunDialog.svelte', 'CatalogDeployDialog.svelte']) {
		const source = readRoute(name);
		assert.match(source, /tabindex=\{flight \? -1 : undefined\}/);
		assert.match(source, /addEventListener\('focusout'/);
		assert.match(source, /flightFocusReturn\(node\)/);
	}
});

test('a secret preview has hidden text and the glyphs are hidden from assistive tech', () => {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=settings`);
	const set: EnvSet = {
		name: 'app',
		keys: [
			{ key: 'API_TOKEN', is_secret: true, value: null, preview: 'supe\u2026' },
			{ key: 'EMPTY', is_secret: true, value: null, preview: null }
		],
		updated_at: '2026-10-14T00:00:00Z',
		updated_by: '00000000-0000-4000-8000-0000000000d1'
	};
	const html = render(EnvSetTable, {
		props: { set, putAction: '?/putEnvKey', deleteAction: '?/deleteEnvKey', deleteSetAction: '?/deleteEnvSet', makeSecretAction: '?/makeEnvKeysSecret', mergeAction: '?/mergeEnvSet' }
	}).body;
	assert.equal(html.split('<span class="sr-only">secret, preview only</span>').length - 1, 2);
	assert.equal(html.includes('aria-label="secret, preview only"'), false);
	assert.match(html, /<span class="select-none" aria-hidden="true">supe…<\/span>/);
	assert.match(html, /<span class="select-none" aria-hidden="true"><\/span>/);
});

test('an icon-only copy failure shows the digest below the name line and then clears', () => {
	const at = 1_700_000_000_000;
	assert.equal(shownDigestFailure(DIGEST, at, at + COPY_FAILURE_MS - 1), DIGEST);
	assert.equal(shownDigestFailure(DIGEST, at, at + COPY_FAILURE_MS), null);
	assert.equal(shownDigestFailure(DIGEST, null, at), null);
	assert.equal(shownDigestFailure('', at, at + 1), null);
	assert.equal(COPY_FAILURE_MS, 8000);

	const services = readRoute('ServicesSection.svelte');
	const groupAt = services.indexOf('class="ml-auto inline-flex shrink-0 items-center gap-1"');
	const groupEnd = services.indexOf('</span>', groupAt);
	const failureAt = services.indexOf('{digestFailure.value}');
	assert.ok(groupAt > 0 && failureAt > groupEnd);
	assert.match(services, /class="font-mono text-sm break-all select-text"/);
	assert.match(services, /\{COPY_FAILED_NOTE\}/);
	assert.match(services, /note === COPIED_NOTE/);
	assert.match(services, /shownDigestFailure\(current\.value, current\.failedAt, Date\.now\(\)\)/);
	const copy = readLib('components/CopyButton.svelte');
	const template = copy.slice(copy.indexOf('{#if iconOnly}'));
	const labeledAt = template.indexOf('{:else}');
	assert.equal(template.slice(0, labeledAt).includes('COPY_FAILED_NOTE'), false);
	assert.equal(template.slice(labeledAt).includes('note === COPY_FAILED_NOTE'), true);
	assert.equal(COPY_FAILED_NOTE, 'Copy failed. Select the text and copy it manually.');
});

test('service label and container name use a definite max width', () => {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=services`);
	const row: ProjectServiceRow = {
		id: SERVICE_ID,
		name: 'web',
		source: 'owned',
		kind: 'container',
		ports: [80],
		health: null,
		last_seen_at: '2026-10-14T12:00:00Z',
		gone_at: null,
		display_name: 'A very long service label that should truncate',
		owner_user: 'root',
		project_id: PROJECT.id,
		host_id: HOST_ID,
		host_name: 'pi1',
		host_status: 'online',
		project_name: 'Lab',
		catalog_entry: null,
		container_name: 'a-very-long-container-name',
		image_digest: null,
		checks: [],
		checksMessage: null
	};
	const html = render(ServicesSection, {
		props: {
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
		}
	}).body;
	assert.match(html, /class="inline-block max-w-48 min-w-0 truncate"/);
	assert.match(html, /class="text-muted-foreground inline-block max-w-40 min-w-0 truncate font-mono text-sm"/);
	assert.equal(html.includes('title="A very long service label that should truncate"'), true);
	assert.equal(html.includes('title="a-very-long-container-name"'), true);
});

test('the edit form sits in its row and the add form in a dialog', () => {
	const source = readRoute('EnvSetTable.svelte');
	const eachAt = source.indexOf('{#each set.keys');
	const editAt = source.indexOf("id={domId('edit-form', item.key)}");
	assert.ok(eachAt > 0 && editAt > eachAt);
	// The add form is no longer in the panel: it is the Add variables dialog's One variable tab.
	assert.equal(source.includes('name="op"'), false);
	assert.match(source, /<EnvAddVariablesDialog\b/);
	assert.doesNotMatch(source, /<EnvAddVariableDialog\b/);
	const dialog = readRoute('EnvAddVariablesDialog.svelte');
	assert.match(dialog, /<Input type="hidden" name="op" value="add" \/>/);
	assert.match(dialog, /<Dialog\.Trigger id=\{triggerId\}/);
	// At 375 px the dialog fields stack: one grid column, no side-by-side row.
	assert.match(dialog, /class="grid min-h-0 gap-3 overflow-y-auto"/);
	assert.equal(dialog.includes('sm:flex-row'), false);
});

test('the elapsed timer is the gap since the flight started', () => {
	assert.equal(elapsedSeconds(1_000, 3_500), 2);
	assert.equal(elapsedSeconds(1_000, 6_000), 5);
	assert.equal(elapsedSeconds(5_000, 1_000), 0);
	assert.equal(elapsedSeconds(Number.NaN, 10), 0);
	const source = readRoute('FlightStatus.svelte');
	assert.match(source, /elapsedSeconds\(startedAt, Date\.now\(\)\)/);
	assert.doesNotMatch(source, /role="status"|aria-live/);
	assert.doesNotMatch(source, /seconds \+= 1/);
});

test('toggling Secret in the Add variable dialog keeps the typed value', () => {
	// Secret starts unticked (Joe 2026-10-25); ticking it hides the typed value.
	assert.equal(initialAddDraft().secret, false);
	const drafted = { ...initialAddDraft(), key: 'TOKEN', value: 'kept-value', secret: true };
	const shown = setAddSecret(drafted, false);
	assert.equal(shown.value, 'kept-value');
	assert.equal(shown.secret, false);
	assert.equal(shown.key, 'TOKEN');
	// Toggling also ends a paste-again hint.
	assert.equal(setAddSecret({ ...drafted, retype: true }, false).retype, false);
	const hidden = setAddSecret(shown, true);
	assert.equal(hidden.value, 'kept-value');
	assert.equal(hidden.secret, true);
	const source = readRoute('EnvAddVariablesDialog.svelte');
	assert.equal(source.match(/id=\{id\('add-value'\)\}/g)?.length, 1);
	assert.match(source, /type=\{view\.draft\.secret \? 'password' : 'text'\}/);
	assert.match(source, /bind:value=\{view\.draft\.value\}/);
	assert.match(source, /draft: setAddSecret\(view\.draft, value === true\)/);
});
