import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, mock, test } from 'node:test';
import { isActionFailure, isRedirect } from '@sveltejs/kit';
import { render } from 'svelte/server';
import type { Host, ProbeView, ProjectServiceRow } from '../src/lib/api-types.ts';
import {
	HEALTH_CLOSE_FALLBACK_MS,
	HEALTH_FORM,
	HEALTH_NEEDS_CONFIRMATION,
	UNREAD_HEALTH_CHECKS,
	addHttpCheck,
	blankCheck,
	draftFromChecks,
	draftsFromForm,
	healthCheckPayload,
	healthChecksSaveState,
	healthFailureOutcome,
	healthFormRows,
	healthNoticeOnCloseComplete,
	payloadHasConfirmation,
	probeRequestBody,
	removeCheck,
	scheduleHealthCloseFallback,
	validateHealthChecks,
	type CheckDraft
} from '../src/lib/health-checks.ts';
import ServicesSection from '../src/routes/projects/[id]/ServicesSection.svelte';
import { actions as projectActions } from '../src/routes/projects/[id]/+page.server.ts';
import { containsToken, envelope, fakeEvent, installFetch, PROJECT, restoreEnv, TOKEN, useApi, USER } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

const HOST_ID = '00000000-0000-4000-8000-0000000000aa';
const SERVICE_ID = '00000000-0000-4000-8000-0000000000bb';
const CHECK_ID = '00000000-0000-4000-8000-0000000000cc';
const OTHER_ID = '00000000-0000-4000-8000-000000000099';
const INTERVAL_MESSAGE = 'Interval must be between 30 and 300 seconds.';

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

const PROBE: ProbeView = {
	service: 'api',
	protocol: 'http',
	port: 80,
	path: '/health',
	result: 'up',
	http_status: 200,
	latency_ms: 3,
	checked_at: '2026-10-14T00:00:00Z'
};

function serviceDetail(ports: number[]) {
	return {
		id: SERVICE_ID,
		name: 'api',
		source: 'discovered',
		kind: 'process',
		ports,
		health: null
	};
}

function serviceRow(overrides: Partial<ProjectServiceRow> = {}): ProjectServiceRow {
	return {
		id: SERVICE_ID,
		name: 'port-80',
		source: 'discovered',
		kind: 'process',
		ports: [80, 443],
		health: { status: 'up', last_checked_at: '2026-10-14T00:00:00Z', latency_ms: 4, source: null },
		last_seen_at: null,
		gone_at: null,
		display_name: 'Widget',
		owner_user: 'ada',
		project_id: PROJECT.id,
		host_id: HOST_ID,
		host_name: 'pi1',
		host_status: 'online',
		project_name: 'Lab',
		checks: [{ id: CHECK_ID, protocol: 'http', port: 80, path: '/health', enabled: true }],
		checksMessage: null,
		catalog_entry: null,
		container_name: null,
		image_digest: null,
		...overrides
	};
}

function renderServices(extra: Record<string, unknown> = {}, row: ProjectServiceRow = serviceRow()) {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=services`);
	return render(ServicesSection, {
		props: {
			projectId: PROJECT.id,
			projectName: 'Lab',
			hosts: [HOST],
			canAdmin: true,
			rows: [row],
			total: 1,
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
	}).body.replaceAll('&amp;', '&').replaceAll('&quot;', '"');
}

function formFrom(drafts: readonly CheckDraft[]): Record<string, string[]> {
	const form: Record<string, string[]> = {
		[HEALTH_FORM.protocol]: [],
		[HEALTH_FORM.port]: [],
		[HEALTH_FORM.path]: [],
		[HEALTH_FORM.interval]: [],
		[HEALTH_FORM.expectMin]: [],
		[HEALTH_FORM.expectMax]: [],
		[HEALTH_FORM.enabled]: []
	};
	for (const row of healthFormRows(drafts)) {
		form[HEALTH_FORM.protocol]?.push(row.protocol);
		form[HEALTH_FORM.port]?.push(row.port);
		form[HEALTH_FORM.path]?.push(row.path);
		form[HEALTH_FORM.interval]?.push(row.interval);
		form[HEALTH_FORM.expectMin]?.push(row.expectMin);
		form[HEALTH_FORM.expectMax]?.push(row.expectMax);
		form[HEALTH_FORM.enabled]?.push(row.enabled);
	}
	return form;
}

function formData(drafts: readonly CheckDraft[]): FormData {
	const form = new FormData();
	const fields = formFrom(drafts);
	for (const [name, values] of Object.entries(fields)) {
		for (const value of values) form.append(name, value);
	}
	return form;
}

function oneTcp(interval: string): FormData {
	const form = new FormData();
	form.append(HEALTH_FORM.protocol, 'tcp');
	form.append(HEALTH_FORM.port, '80');
	form.append(HEALTH_FORM.path, '');
	form.append(HEALTH_FORM.interval, interval);
	form.append(HEALTH_FORM.expectMin, '200');
	form.append(HEALTH_FORM.expectMax, '399');
	form.append(HEALTH_FORM.enabled, '1');
	return form;
}

function replacedDraft(): CheckDraft[] {
	const tcp80 = blankCheck('tcp', 80, 'tcp-80');
	tcp80.intervalSec = 45;
	const tcp443 = blankCheck('tcp', 443, 'tcp-443');
	tcp443.intervalSec = 90;
	tcp443.enabled = false;
	const next = addHttpCheck([tcp80, tcp443], 80, 'http-80');
	const http = next.drafts.find((row) => row.protocol === 'http');
	assert.ok(http);
	http.path = '/health';
	http.intervalSec = 30;
	http.expectMin = 201;
	http.expectMax = 299;
	return next.drafts;
}

function saveEvent(form: Record<string, string | readonly string[]>) {
	return fakeEvent({
		url: `http://console.example/projects/${PROJECT.id}?tab=services&/saveHealthChecks`,
		session: TOKEN,
		user: USER,
		projects: [PROJECT],
		params: { id: PROJECT.id },
		form: { service_id: SERVICE_ID, ...form }
	}).event as never;
}

function probeEvent(form: Record<string, string | readonly string[]>) {
	return fakeEvent({
		url: `http://console.example/projects/${PROJECT.id}?tab=services&/probe`,
		session: TOKEN,
		user: USER,
		projects: [PROJECT],
		params: { id: PROJECT.id },
		form: { service_id: SERVICE_ID, ...form }
	}).event as never;
}

function failureData(value: unknown): {
	healthField?: string | null;
	healthMessage?: string | null;
	healthIndex?: number | null;
	message?: string;
	probeMessage?: string | null;
	probeIndex?: number | null;
	editorProbe?: boolean;
} {
	assert.equal(isActionFailure(value), true);
	if (!isActionFailure(value)) assert.fail('expected a failure');
	return value.data as unknown as {
		healthField?: string | null;
		healthMessage?: string | null;
		healthIndex?: number | null;
		message?: string;
		probeMessage?: string | null;
		probeIndex?: number | null;
		editorProbe?: boolean;
	};
}

describe('health check draft behaviour', () => {
	test('draftFromChecks keeps the saved fields and fills the defaults', () => {
		const drafts = draftFromChecks([
			{
				id: CHECK_ID,
				protocol: 'http',
				port: 80,
				path: '/health',
				enabled: false,
				interval_sec: 45,
				expect_status_min: 201,
				expect_status_max: 299
			},
			{ id: OTHER_ID, protocol: 'tcp', port: 443, path: null, enabled: true }
		]);
		assert.deepEqual(drafts[0], {
			key: CHECK_ID,
			protocol: 'http',
			port: 80,
			path: '/health',
			intervalSec: 45,
			expectMin: 201,
			expectMax: 299,
			enabled: false
		});
		assert.equal(drafts[1]?.path, '');
		assert.equal(drafts[1]?.intervalSec, 60);
		assert.equal(drafts[1]?.expectMin, 200);
		assert.equal(drafts[1]?.expectMax, 399);
		assert.equal(drafts[1]?.enabled, true);
	});

	test('removeCheck drops only the chosen row', () => {
		const drafts = [blankCheck('tcp', 80, 'a'), blankCheck('http', 443, 'b'), blankCheck('tcp', 8080, 'c')];
		assert.deepEqual(
			removeCheck(drafts, 1).map((row) => row.key),
			['a', 'c']
		);
		assert.equal(drafts.length, 3);
	});

	test('healthFormRows keeps field values and save sends the HTTP check plus the other TCP check', () => {
		const drafts = replacedDraft();
		assert.deepEqual(healthFormRows(drafts), [
			{
				protocol: 'tcp',
				port: '443',
				path: '',
				interval: '90',
				expectMin: '200',
				expectMax: '399',
				enabled: '0'
			},
			{
				protocol: 'http',
				port: '80',
				path: '/health',
				interval: '30',
				expectMin: '201',
				expectMax: '299',
				enabled: '1'
			}
		]);
		const round = draftsFromForm(formData(drafts));
		assert.equal(round.ok, true);
		if (!round.ok) assert.fail('expected the form to parse');
		assert.deepEqual(healthCheckPayload(round.drafts), [
			{
				protocol: 'tcp',
				port: 443,
				path: null,
				interval_sec: 90,
				expect_status_min: 200,
				expect_status_max: 399,
				enabled: false
			},
			{
				protocol: 'http',
				port: 80,
				path: '/health',
				interval_sec: 30,
				expect_status_min: 201,
				expect_status_max: 299,
				enabled: true
			}
		]);
	});

	test('interval 30 and 300 are kept and 29 and 301 are rejected', () => {
		const issue = (seconds: number) => {
			const draft = blankCheck('tcp', 80, 'k');
			draft.intervalSec = seconds;
			return validateHealthChecks([draft], [80]).find((item) => item.field === 'interval')?.message;
		};
		assert.equal(issue(29), INTERVAL_MESSAGE);
		assert.equal(issue(30), undefined);
		assert.equal(issue(300), undefined);
		assert.equal(issue(301), INTERVAL_MESSAGE);
	});

	test('a blank interval stays blank and is not saved as 60', () => {
		const read = draftsFromForm(oneTcp(''));
		assert.equal(read.ok, true);
		if (!read.ok) assert.fail('expected the form to parse');
		assert.equal(read.drafts[0]?.intervalSec, null);
		assert.equal(
			validateHealthChecks(read.drafts, [80]).find((item) => item.field === 'interval')?.message,
			INTERVAL_MESSAGE
		);
	});

	test('a field failure stays open and anything else does not announce a save', () => {
		assert.equal(healthFailureOutcome({ healthField: 'interval', healthMessage: INTERVAL_MESSAGE }), 'bad_request');
		const bad = healthChecksSaveState({
			outcome: healthFailureOutcome({ healthField: 'interval', healthMessage: INTERVAL_MESSAGE }),
			message: INTERVAL_MESSAGE,
			field: 'interval'
		});
		assert.equal(bad.close, false);
		assert.equal(bad.notice, null);
		assert.equal(bad.field, 'interval');
		assert.equal(bad.message, INTERVAL_MESSAGE);
		assert.equal(healthFailureOutcome({ message: 'down' }), 'failure');
		const other = healthChecksSaveState({
			outcome: healthFailureOutcome({ message: 'down' }),
			message: 'down'
		});
		assert.equal(other.close, false);
		assert.equal(other.notice, null);
	});

	test('a probe body without a port list is refused', () => {
		const missing = probeRequestBody({
			protocol: 'tcp',
			port: '80',
			path: '',
			ports: undefined as unknown as number[]
		});
		assert.deepEqual(missing, { ok: false, field: 'port', message: 'Choose a port on this service.' });
	});

	test('a confirmation id is a confirmation and an empty one is not', () => {
		assert.equal(payloadHasConfirmation({ confirmation_id: 'cfm_0123456789abcdef' }), true);
		assert.equal(payloadHasConfirmation({ confirmation_id: '' }), false);
		assert.equal(payloadHasConfirmation({ checks: [] }), false);
		assert.equal(payloadHasConfirmation(null), false);
	});
});

describe('health check close announcement', () => {
	test('the dialog announces the save when it finishes closing, or after 1s', () => {
		assert.equal(HEALTH_CLOSE_FALLBACK_MS, 1000);
		mock.timers.enable({ apis: ['setTimeout'] });
		try {
			const arm = () => {
				let announced: string | null = null;
				let pending: string | null = SERVICE_ID;
				let waiting = true;
				const finishClose = (isOpen: boolean) => {
					const next = healthNoticeOnCloseComplete(pending, isOpen);
					pending = next.pending;
					if (next.announce != null) announced = next.announce;
					if (!isOpen) waiting = false;
				};
				scheduleHealthCloseFallback(() => {
					if (waiting) finishClose(false);
				});
				return { finishClose, announced: () => announced };
			};
			const closed = arm();
			closed.finishClose(true);
			assert.equal(closed.announced(), null);
			closed.finishClose(false);
			assert.equal(closed.announced(), SERVICE_ID);
			mock.timers.tick(HEALTH_CLOSE_FALLBACK_MS);
			assert.equal(closed.announced(), SERVICE_ID);

			const timed = arm();
			mock.timers.tick(HEALTH_CLOSE_FALLBACK_MS - 1);
			assert.equal(timed.announced(), null);
			mock.timers.tick(1);
			assert.equal(timed.announced(), SERVICE_ID);
		} finally {
			mock.timers.reset();
		}
	});
});

describe('health check editor fixes', () => {
	before(() => {
		useApi('https://api.test');
	});

	after(() => {
		restoreEnv();
	});

	test('an unread row disables Health checks and does not offer Save', () => {
		const html = renderServices({}, serviceRow({ checks: [], checksMessage: 'The API is unavailable.' }));
		assert.match(html, /disabled[^>]*aria-label="Health checks could not be read\."/);
		assert.equal(html.includes(`title="${UNREAD_HEALTH_CHECKS}"`), true);
		assert.equal(html.includes('name="hc_protocol"'), false);
		assert.equal(html.includes('>Save<'), false);
		assert.equal(html.includes('The API is unavailable.'), true);
		const viewer = renderServices({ canAdmin: false }, serviceRow({ checks: [], checksMessage: 'checks not loaded' }));
		assert.equal(viewer.includes(UNREAD_HEALTH_CHECKS), false);
	});

	test('a failed save names the field error on that control', () => {
		// bits-ui does not include dialog content in SSR, so this checks the markup the dialog renders.
		const dialog = readFileSync(new URL('../src/routes/projects/[id]/HealthChecks.svelte', import.meta.url), 'utf8');
		for (const field of ['protocol', 'port', 'path', 'interval', 'expect']) {
			assert.equal(dialog.includes(`describedBy(index, '${field}')`), true, field);
			assert.equal(dialog.includes(`errorId(index, '${field}')`), true, field);
		}
		assert.equal(dialog.includes('aria-invalid='), true);
		assert.equal(dialog.includes('kind="error"'), true);
		assert.equal(dialog.includes('role="alert"'), false);
		assert.equal(dialog.includes('focusInvalid('), true);
		assert.equal(dialog.includes("for={fieldId(index, 'protocol')}"), true);
		assert.equal(dialog.includes("id={fieldId(index, 'protocol')}"), true);
		assert.equal(dialog.includes("for={fieldId(index, 'port')}"), true);
		assert.equal(dialog.includes("id={fieldId(index, 'port')}"), true);
		assert.equal(dialog.includes('tabindex="-1"'), true);
	});

	test('an editor probe result is status on that row and a probe error is an alert there', () => {
		const dialog = readFileSync(new URL('../src/routes/projects/[id]/HealthChecks.svelte', import.meta.url), 'utf8');
		const probeAt = dialog.indexOf("fieldId(index, 'probe')");
		assert.equal(probeAt > 0, true);
		const infoAt = dialog.lastIndexOf('kind="info"', probeAt);
		assert.equal(infoAt > 0 && probeAt - infoAt < 400, true);
		assert.equal(dialog.includes("fieldId(index, 'probe-error')"), true);
		assert.equal(dialog.includes("getElementById(fieldId(probeIndex, 'probe'))"), true);
		for (const label of ['Service', 'Protocol', 'Port', 'Path', 'Result']) {
			assert.equal(dialog.includes(`>${label}<`), true, label);
		}
	});

	test('save does not PUT when its own read of the service fails', async () => {
		const calls = installFetch(() => envelope(null, 500, 'error', 'gone'));
		const failed = await projectActions.saveHealthChecks(
			saveEvent({
				[HEALTH_FORM.protocol]: ['tcp'],
				[HEALTH_FORM.port]: ['80'],
				[HEALTH_FORM.path]: [''],
				[HEALTH_FORM.interval]: ['60'],
				[HEALTH_FORM.expectMin]: ['200'],
				[HEALTH_FORM.expectMax]: ['399'],
				[HEALTH_FORM.enabled]: ['1']
			})
		);
		assert.equal(calls.some((call) => call.method === 'PUT'), false);
		assert.equal(calls.some((call) => call.method === 'GET'), true);
		const data = failureData(failed);
		assert.equal(data.healthMessage, 'gone');
		assert.equal(data.message, undefined);
		assert.equal(containsToken(failed), false);
	});

	test('a confirmation id stays in the dialog and does not announce a save', async () => {
		const calls = installFetch((call) => {
			if (call.method === 'GET') return envelope(serviceDetail([80]));
			return envelope({ confirmation_id: 'cfm_0123456789abcdef', plan: 'replace', expires_at: '2026-10-18T00:00:00Z' }, 202);
		});
		const failed = await projectActions.saveHealthChecks(
			saveEvent({
				[HEALTH_FORM.protocol]: ['http'],
				[HEALTH_FORM.port]: ['80'],
				[HEALTH_FORM.path]: ['/health'],
				[HEALTH_FORM.interval]: ['60'],
				[HEALTH_FORM.expectMin]: ['200'],
				[HEALTH_FORM.expectMax]: ['399'],
				[HEALTH_FORM.enabled]: ['1']
			})
		);
		assert.equal(isRedirect(failed), false);
		assert.equal(calls.some((call) => call.method === 'PUT'), true);
		const data = failureData(failed);
		assert.equal(data.healthField, 'form');
		assert.equal(data.healthMessage, HEALTH_NEEDS_CONFIRMATION);
		assert.equal(data.message, undefined);
		const view = healthChecksSaveState({
			outcome: healthFailureOutcome(data),
			message: data.healthMessage,
			field: data.healthField
		});
		assert.equal(view.close, false);
		assert.equal(view.notice, null);
		assert.equal(containsToken(failed), false);
	});

	test('save of the replaced draft puts the HTTP check and the TCP check on the other port', async () => {
		const calls = installFetch((call) => (call.method === 'GET' ? envelope(serviceDetail([80, 443])) : envelope({ checks: [] })));
		await assert.rejects(
			async () => {
				await projectActions.saveHealthChecks(saveEvent(formFrom(replacedDraft())));
			},
			(err: unknown) => isRedirect(err) && err.status === 303
		);
		assert.equal(
			calls.find((call) => call.method === 'PUT')?.body,
			JSON.stringify({
				checks: [
					{
						protocol: 'tcp',
						port: 443,
						path: null,
						interval_sec: 90,
						expect_status_min: 200,
						expect_status_max: 399,
						enabled: false
					},
					{
						protocol: 'http',
						port: 80,
						path: '/health',
						interval_sec: 30,
						expect_status_min: 201,
						expect_status_max: 299,
						enabled: true
					}
				]
			})
		);
	});

	test('a draft probe on a port that is not on the service does not call the probe', async () => {
		const calls = installFetch((call) => {
			if (call.method === 'GET') return envelope(serviceDetail([80]));
			return envelope(null, 500, 'error', 'should not probe');
		});
		const failed = await projectActions.probe(
			probeEvent({ protocol: 'tcp', port: '9', path: '', probe_index: '0' })
		);
		assert.equal(calls.filter((call) => call.method === 'GET').length, 1);
		assert.equal(calls.filter((call) => call.method === 'POST').length, 0);
		assert.equal(calls.filter((call) => call.method === 'PUT').length, 0);
		const data = failureData(failed);
		assert.equal(data.healthField, 'port');
		assert.equal(data.healthIndex, 0);
		assert.equal(data.healthMessage, 'Choose a port on this service.');
		assert.equal(data.message, undefined);
		assert.equal(data.editorProbe, true);
	});

	test('a draft probe with a bad HTTP path makes no API call', async () => {
		const calls = installFetch(() => envelope(null, 500, 'error', 'should not fetch'));
		const failed = await projectActions.probe(
			probeEvent({ protocol: 'http', port: '80', path: 'health', probe_index: '1' })
		);
		assert.equal(calls.length, 0);
		const data = failureData(failed);
		assert.equal(data.healthField, 'path');
		assert.equal(data.healthIndex, 1);
		assert.equal(data.probeMessage, null);
	});

	test('an allowed draft probe posts once and does not PUT', async () => {
		const calls = installFetch((call) => {
			if (call.method === 'GET') return envelope(serviceDetail([80]));
			return envelope(PROBE);
		});
		const probe = await projectActions.probe(
			probeEvent({ protocol: 'http', port: '80', path: '/health', probe_index: '0' })
		);
		assert.deepEqual(
			calls.map((call) => call.method),
			['GET', 'POST']
		);
		assert.equal(calls[1]?.url.pathname, `/v1/services/${SERVICE_ID}/probe`);
		assert.equal(calls[1]?.body, JSON.stringify({ protocol: 'http', port: 80, path: '/health' }));
		assert.equal(calls.some((call) => call.method === 'PUT'), false);
		assert.equal(isActionFailure(probe), false);
		if (!probe || isActionFailure(probe)) assert.fail('expected a probe result');
		assert.equal(probe.editorProbe, true);
		assert.equal(probe.probeIndex, 0);
		assert.equal(probe.probe?.result, 'up');
		assert.equal(containsToken(probe), false);
	});

	test('an editor probe error is returned on the row and not as the section message', async () => {
		const calls = installFetch((call) => {
			if (call.method === 'GET') return envelope(serviceDetail([80]));
			return envelope(null, 502, 'error', 'probe failed');
		});
		const failed = await projectActions.probe(
			probeEvent({ protocol: 'http', port: '80', path: '/health', probe_index: '0' })
		);
		assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
		const data = failureData(failed);
		assert.equal(data.probeMessage, 'probe failed');
		assert.equal(data.probeIndex, 0);
		assert.equal(data.healthField, null);
		assert.equal(data.message, undefined);
		assert.equal(data.editorProbe, true);

		const thrown = installFetch(() => {
			throw new Error('socket');
		});
		const blew = await projectActions.probe(
			probeEvent({ protocol: 'tcp', port: '80', path: '', probe_index: '0' })
		);
		assert.equal(thrown.filter((call) => call.method === 'POST').length, 0);
		const boom = failureData(blew);
		assert.equal(boom.probeMessage, 'The API is unavailable.');
		assert.equal(boom.message, undefined);
	});
});

test('the health-check dialog wires failures, the close fallback, and the unread control', () => {
	const root = new URL('../src/', import.meta.url);
	const read = (name: string) => readFileSync(new URL(name, root), 'utf8');
	const dialog = read('routes/projects/[id]/HealthChecks.svelte');
	assert.equal(dialog.includes('healthFailureOutcome('), true);
	assert.equal(dialog.includes('scheduleHealthCloseFallback('), true);
	assert.equal(dialog.includes('finishClose(false)'), true);
	assert.equal(dialog.includes('UNREAD_HEALTH_CHECKS'), true);
	assert.equal(dialog.includes('aria-describedby={describedBy('), true);
	assert.equal(dialog.includes('focusInvalid('), true);
	assert.equal(dialog.includes('kind="info"'), true);
	const server = read('routes/projects/[id]/+page.server.ts');
	assert.equal(server.includes('ports: detail.ports'), true);
	assert.equal(server.includes('payloadHasConfirmation('), true);
	assert.equal(server.includes('editorProbeFailure('), true);
	const formAt = dialog.indexOf('class="flex shrink-0 flex-wrap items-center gap-2 border-t border-border pt-3"');
	const saveAt = dialog.indexOf('>Save<');
	const scrollAt = dialog.indexOf('overflow-y-auto');
	assert.equal(formAt > scrollAt && saveAt > formAt, true);
});
