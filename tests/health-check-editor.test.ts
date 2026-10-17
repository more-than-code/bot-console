import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { isActionFailure, isRedirect } from '@sveltejs/kit';
import { render } from 'svelte/server';
import type { Host, ProjectServiceRow } from '../src/lib/api-types.ts';
import {
	HEALTH_CHECK_NOTE,
	HEALTH_FORM,
	SAVED_HEALTH_CHECKS,
	addHttpCheck,
	addTcpCheck,
	blankCheck,
	canEditHealthChecks,
	draftsFromForm,
	fieldForHealthMessage,
	healthCheckPayload,
	healthChecksSaveState,
	healthFailureOutcome,
	healthFormRows,
	healthNoticeOnAction,
	healthNoticeOnCloseComplete,
	healthNoticeOnDialog,
	healthNoticeOnView,
	probeRequestBody,
	servicesHealthView,
	setCheckPort,
	setCheckProtocol,
	tcpSuggestionLabel,
	tcpSuggestions,
	validateHealthChecks,
	type CheckDraft
} from '../src/lib/health-checks.ts';
import { parseHealthChecks } from '../src/lib/server/shape.ts';
import ServicesSection from '../src/routes/projects/[id]/ServicesSection.svelte';
import { actions as projectActions } from '../src/routes/projects/[id]/+page.server.ts';
import { containsToken, envelope, fakeEvent, installFetch, PROJECT, restoreEnv, TOKEN, useApi, USER } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

const HOST_ID = '00000000-0000-4000-8000-0000000000aa';
const SERVICE_ID = '00000000-0000-4000-8000-0000000000bb';
const CHECK_ID = '00000000-0000-4000-8000-0000000000cc';
const OTHER_ID = '00000000-0000-4000-8000-000000000099';

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

function httpCheck(port: number, path = '/health', key = 'http'): CheckDraft {
	return { ...blankCheck('http', port, key), path };
}

function rows(count: number, port = 80): CheckDraft[] {
	return Array.from({ length: count }, (_, index) => blankCheck('tcp', port, `k${index}`));
}

function formFrom(drafts: readonly CheckDraft[]): FormData {
	const form = new FormData();
	for (const row of healthFormRows(drafts)) {
		form.append(HEALTH_FORM.protocol, row.protocol);
		form.append(HEALTH_FORM.port, row.port);
		form.append(HEALTH_FORM.path, row.path);
		form.append(HEALTH_FORM.interval, row.interval);
		form.append(HEALTH_FORM.expectMin, row.expectMin);
		form.append(HEALTH_FORM.expectMax, row.expectMax);
		form.append(HEALTH_FORM.enabled, row.enabled);
	}
	return form;
}

function issue(drafts: CheckDraft[], ports: number[], field: string): string | undefined {
	return validateHealthChecks(drafts, ports).find((item) => item.field === field)?.message;
}

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

function checkFields(row: {
	protocol: string;
	port: string;
	path: string;
	interval: string;
	expectMin: string;
	expectMax: string;
	enabled: string;
}): Record<string, readonly string[]> {
	return {
		[HEALTH_FORM.protocol]: [row.protocol],
		[HEALTH_FORM.port]: [row.port],
		[HEALTH_FORM.path]: [row.path],
		[HEALTH_FORM.interval]: [row.interval],
		[HEALTH_FORM.expectMin]: [row.expectMin],
		[HEALTH_FORM.expectMax]: [row.expectMax],
		[HEALTH_FORM.enabled]: [row.enabled]
	};
}

function serviceRow(overrides: Partial<ProjectServiceRow> = {}): ProjectServiceRow {
	return {
		id: SERVICE_ID,
		name: 'port-80',
		source: 'discovered',
		kind: 'process',
		ports: [80, 443],
		health: { status: 'up', last_checked_at: '2026-10-14T00:00:00Z', latency_ms: 4 },
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

function renderServices(extra: Record<string, unknown> = {}, row: ProjectServiceRow = serviceRow(), hosts: Host[] = [HOST]) {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=services`);
	return render(ServicesSection, {
		props: {
			projectId: PROJECT.id,
			projectName: 'Lab',
			hosts,
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

describe('health check validation', () => {
	test('an http check needs a path that starts with /', () => {
		const missing = httpCheck(80, '');
		assert.equal(issue([missing], [80], 'path'), 'Enter a path that starts with /.');
		const bare = httpCheck(80, 'health');
		assert.equal(issue([bare], [80], 'path'), 'Enter a path that starts with /.');
		assert.equal(issue([httpCheck(80, '/health')], [80], 'path'), undefined);
	});

	test('a path that starts with // or contains a space is rejected', () => {
		assert.equal(
			issue([httpCheck(80, '//health')], [80], 'path'),
			'Enter a path that starts with a single / and has no spaces or @ \\ ? #.'
		);
		assert.equal(issue([httpCheck(80, '/health check')], [80], 'path')?.includes('single /'), true);
	});

	test('a port that is not on the service is rejected', () => {
		assert.equal(issue([blankCheck('tcp', 9, 'a')], [80], 'port'), 'Choose a port on this service.');
		assert.equal(issue([blankCheck('tcp', 80, 'a')], [80], 'port'), undefined);
	});

	test('eleven checks are rejected and ten are kept', () => {
		const eleven = validateHealthChecks(rows(11), [80]);
		assert.equal(eleven.some((item) => item.field === 'checks' && item.message === 'At most 10 health checks.'), true);
		assert.deepEqual(validateHealthChecks(rows(10), [80]), []);
		const read = draftsFromForm(formFrom(rows(11)));
		assert.equal(read.ok, false);
		if (read.ok) return;
		assert.equal(read.field, 'checks');
		assert.equal(read.message, 'At most 10 health checks.');
	});

	test('an interval of 20 or 400 is rejected', () => {
		const low = blankCheck('tcp', 80, 'a');
		low.intervalSec = 20;
		assert.equal(issue([low], [80], 'interval'), 'Interval must be between 30 and 300 seconds.');
		const high = blankCheck('tcp', 80, 'b');
		high.intervalSec = 400;
		assert.equal(issue([high], [80], 'interval'), 'Interval must be between 30 and 300 seconds.');
		assert.equal(issue([blankCheck('tcp', 80, 'c')], [80], 'interval'), undefined);
	});

	test('expected status must stay inside 200..399 and min must not pass max', () => {
		const low = httpCheck(80);
		low.expectMin = 199;
		assert.equal(issue([low], [80], 'expect'), 'Expected status must be between 200 and 399.');
		const high = httpCheck(80);
		high.expectMax = 400;
		assert.equal(issue([high], [80], 'expect'), 'Expected status must be between 200 and 399.');
		const order = httpCheck(80);
		order.expectMin = 300;
		order.expectMax = 250;
		assert.equal(issue([order], [80], 'expect'), 'Expected status min must be at most the max.');
		assert.equal(issue([httpCheck(80)], [80], 'expect'), undefined);
	});
});

describe('health check suggestions', () => {
	test('a port with no check is offered as a TCP check', () => {
		assert.deepEqual(tcpSuggestions([80, 443], [blankCheck('tcp', 80, 'a')]), [443]);
		assert.equal(tcpSuggestionLabel(443), 'Add TCP check on 443');
	});

	test('a port that already has an HTTP check is not offered', () => {
		assert.deepEqual(tcpSuggestions([80], [httpCheck(80)]), []);
	});

	test('a port that already has a TCP check is not offered', () => {
		assert.deepEqual(tcpSuggestions([80, 80], [blankCheck('tcp', 80, 'a')]), []);
	});

	test('a service with no ports has no suggestion', () => {
		assert.deepEqual(tcpSuggestions([], []), []);
	});

	test('the eleventh suggestion does not grow the draft', () => {
		const next = addTcpCheck(rows(10), 443, 'extra');
		assert.equal(next.drafts.length, 10);
		assert.equal(next.notice, null);
	});
});

describe('redundant TCP checks', () => {
	test('adding HTTP drops the TCP row on that port, keeps another port, and names the notice', () => {
		const next = addHttpCheck(
			[blankCheck('tcp', 80, 'tcp-80'), blankCheck('tcp', 443, 'tcp-443')],
			80,
			'http-80'
		);
		assert.deepEqual(
			next.drafts.map((row) => [row.protocol, row.port]),
			[
				['tcp', 443],
				['http', 80]
			]
		);
		assert.equal(next.notice, 'Replaced the TCP check on 80 (HTTP covers it).');
	});

	test('switching the TCP row itself to HTTP shows the same notice', () => {
		const next = setCheckProtocol([blankCheck('tcp', 80, 'tcp-80')], 0, 'http');
		assert.equal(next.drafts.length, 1);
		assert.equal(next.drafts[0]?.protocol, 'http');
		assert.equal(next.drafts[0]?.port, 80);
		assert.equal(next.notice, 'Replaced the TCP check on 80 (HTTP covers it).');
	});

	test('moving an HTTP row onto a TCP port drops that TCP row and keeps a TCP row on another port', () => {
		const next = setCheckPort(
			[blankCheck('tcp', 80, 'tcp-80'), blankCheck('tcp', 443, 'tcp-443'), httpCheck(8080, '/health', 'http')],
			2,
			80
		);
		assert.deepEqual(
			next.drafts.map((row) => [row.key, row.protocol, row.port]),
			[
				['tcp-443', 'tcp', 443],
				['http', 'http', 80]
			]
		);
		assert.equal(next.notice, 'Replaced the TCP check on 80 (HTTP covers it).');
	});

	test('moving a TCP row onto a port that already has HTTP keeps both rows', () => {
		const next = setCheckPort([httpCheck(80), blankCheck('tcp', 443, 'tcp-443')], 1, 80);
		assert.deepEqual(
			next.drafts.map((row) => [row.protocol, row.port]),
			[
				['http', 80],
				['tcp', 80]
			]
		);
		assert.equal(next.notice, null);
	});
});

describe('health check save state', () => {
	test('the dialog note says checks use loopback and not HTTPS', () => {
		assert.equal(
			HEALTH_CHECK_NOTE,
			'Checks run on the host against 127.0.0.1:<port>. HTTPS and virtual hosts are not supported yet.'
		);
	});

	test('success closes the dialog and names the saved line', () => {
		assert.deepEqual(healthChecksSaveState({ outcome: 'success' }), {
			close: true,
			notice: SAVED_HEALTH_CHECKS,
			field: null,
			message: null
		});
		assert.equal(SAVED_HEALTH_CHECKS, 'Saved health checks.');
	});

	test('bad_request stays open with the message on the field', () => {
		assert.deepEqual(healthChecksSaveState({ outcome: 'bad_request', field: 'path', message: 'path must start with /' }), {
			close: false,
			notice: null,
			field: 'path',
			message: 'path must start with /'
		});
	});

	test('another failure stays open and does not announce a save', () => {
		const view = healthChecksSaveState({ outcome: 'failure', message: 'The API is unavailable.' });
		assert.equal(view.close, false);
		assert.equal(view.notice, null);
		assert.equal(view.message, 'The API is unavailable.');
	});

	test('a field failure is bad_request and anything else is a failure', () => {
		assert.equal(healthFailureOutcome({ healthField: 'path' }), 'bad_request');
		assert.equal(healthFailureOutcome({ healthField: '' }), 'failure');
		assert.equal(healthFailureOutcome({ message: 'down' }), 'failure');
	});

	test('an API message is placed on the field it names', () => {
		assert.equal(fieldForHealthMessage('path must start with /'), 'path');
		assert.equal(fieldForHealthMessage('interval must be at least 30'), 'interval');
		assert.equal(fieldForHealthMessage('expected status out of range'), 'expect');
		assert.equal(fieldForHealthMessage('port is not on the service'), 'port');
		assert.equal(fieldForHealthMessage('at most 10 health checks'), 'checks');
		assert.equal(fieldForHealthMessage('no'), 'form');
	});
});

describe('saved health-check notice', () => {
	test('any named action except the save clears the line', () => {
		assert.equal(healthNoticeOnAction(SERVICE_ID, 'rename'), null);
		assert.equal(healthNoticeOnAction(SERVICE_ID, 'probe'), null);
		assert.equal(healthNoticeOnAction(SERVICE_ID, 'saveHealthChecks'), SERVICE_ID);
		assert.equal(healthNoticeOnAction(SERVICE_ID, null), SERVICE_ID);
	});

	test('leaving Services or switching projects clears the line', () => {
		const seen = { projectId: PROJECT.id, tab: 'services' };
		assert.equal(healthNoticeOnView(SERVICE_ID, seen, { projectId: PROJECT.id, tab: 'hosts' }).notice, null);
		assert.equal(healthNoticeOnView(SERVICE_ID, seen, { projectId: OTHER_ID, tab: 'services' }).notice, null);
		assert.equal(healthNoticeOnView(SERVICE_ID, seen, { projectId: PROJECT.id, tab: 'services' }).notice, SERVICE_ID);
	});

	test('opening the dialog clears the line and the close announces it', () => {
		assert.equal(healthNoticeOnDialog(SERVICE_ID, false, true), null);
		assert.equal(healthNoticeOnDialog(SERVICE_ID, true, false), SERVICE_ID);
		assert.deepEqual(healthNoticeOnCloseComplete(SERVICE_ID, true), { pending: SERVICE_ID, announce: null });
		assert.deepEqual(healthNoticeOnCloseComplete(SERVICE_ID, false), { pending: null, announce: SERVICE_ID });
	});

	test('a services action carries the editor fields and another scope does not', () => {
		assert.deepEqual(
			servicesHealthView({
				scope: 'services',
				healthServiceId: SERVICE_ID,
				healthField: 'path',
				healthIndex: 1,
				healthMessage: 'missing',
				editorProbe: true
			}),
			{ serviceId: SERVICE_ID, field: 'path', index: 1, message: 'missing', editorProbe: true }
		);
		assert.deepEqual(servicesHealthView({ scope: 'catalog', healthMessage: 'missing', editorProbe: true }), {
			serviceId: null,
			field: null,
			index: null,
			message: null,
			editorProbe: false
		});
	});
});

describe('health check permission', () => {
	test('a viewer cannot edit and an admin can, including only its own service on a share', () => {
		const base = { projectId: PROJECT.id, serviceProjectId: PROJECT.id, hostOwnerProjectId: PROJECT.id };
		assert.equal(canEditHealthChecks({ ...base, canAdmin: false }), false);
		assert.equal(canEditHealthChecks({ ...base, canAdmin: true }), true);
		assert.equal(
			canEditHealthChecks({
				canAdmin: true,
				projectId: PROJECT.id,
				serviceProjectId: OTHER_ID,
				hostOwnerProjectId: OTHER_ID
			}),
			false
		);
		assert.equal(
			canEditHealthChecks({
				canAdmin: true,
				projectId: PROJECT.id,
				serviceProjectId: PROJECT.id,
				hostOwnerProjectId: OTHER_ID
			}),
			true
		);
	});

	test('a viewer row has no Health checks button', () => {
		const html = renderServices({ canAdmin: false });
		assert.equal(html.includes('aria-label="Health checks '), false);
		assert.equal(html.includes('aria-label="Rename '), false);
	});

	test('an admin row has the Health checks button and the saved line', () => {
		const html = renderServices();
		assert.match(html, /aria-label="Health checks Widget"/);
		assert.equal(html.includes('name="hc_protocol"'), false);
		const saved = renderServices({ savedHealthId: SERVICE_ID });
		assert.equal(saved.includes('Saved health checks.'), true);
		const other = renderServices({ savedHealthId: OTHER_ID });
		assert.equal(other.includes('Saved health checks.'), false);
	});

	test('a sharing admin does not see the button on another project service', () => {
		const foreign = renderServices(
			{},
			serviceRow({ project_id: OTHER_ID, project_name: 'Other' }),
			[{ ...HOST, project_id: OTHER_ID }]
		);
		assert.equal(foreign.includes('aria-label="Health checks '), false);
	});
});

describe('health check probe body', () => {
	test('TCP sends a null path and HTTP sends the path', () => {
		const tcp = probeRequestBody({ protocol: 'tcp', port: '80', path: '/ignored', ports: [80] });
		assert.deepEqual(tcp, { ok: true, body: { protocol: 'tcp', port: 80, path: null } });
		const http = probeRequestBody({ protocol: 'http', port: '443', path: '/health', ports: [80, 443] });
		assert.deepEqual(http, { ok: true, body: { protocol: 'http', port: 443, path: '/health' } });
	});

	test('a probe port outside the service is rejected', () => {
		const rejected = probeRequestBody({ protocol: 'tcp', port: '9', path: '', ports: [80] });
		assert.deepEqual(rejected, { ok: false, field: 'port', message: 'Choose a port on this service.' });
	});

	test('a TCP write uses the default status range', () => {
		const draft = blankCheck('tcp', 80, 'tcp');
		draft.expectMin = 10;
		draft.expectMax = 10;
		assert.deepEqual(healthCheckPayload([draft]), [
			{
				protocol: 'tcp',
				port: 80,
				path: null,
				interval_sec: 60,
				expect_status_min: 200,
				expect_status_max: 399,
				enabled: true
			}
		]);
	});
});

describe('health check actions', () => {
	before(() => {
		useApi('https://api.test');
	});

	after(() => {
		restoreEnv();
	});

	test('save reads the service, PUTs the checks, and redirects back to the query', async () => {
		const calls = installFetch((call) => {
			if (call.method === 'GET') return envelope(serviceDetail([80, 443]));
			return envelope({ checks: [] });
		});
		const url = `http://console.example/projects/${PROJECT.id}?tab=services&services.q=api&/saveHealthChecks`;
		await assert.rejects(
			async () => {
				await projectActions.saveHealthChecks(
					fakeEvent({
						url,
						session: TOKEN,
						user: USER,
						projects: [PROJECT],
						params: { id: PROJECT.id },
						form: { service_id: SERVICE_ID, ...checkFields({ protocol: 'http', port: '80', path: '/health', interval: '60', expectMin: '200', expectMax: '399', enabled: '1' }) }
					}).event as never
				);
			},
			(err: unknown) =>
				isRedirect(err) && err.status === 303 && err.location === `/projects/${PROJECT.id}?tab=services&services.q=api`
		);
		assert.equal(calls[0]?.method, 'GET');
		assert.equal(calls[0]?.url.pathname, `/v1/services/${SERVICE_ID}`);
		assert.equal(calls[1]?.method, 'PUT');
		assert.equal(calls[1]?.url.pathname, `/v1/services/${SERVICE_ID}/health-checks`);
		assert.equal(
			calls[1]?.body,
			JSON.stringify({
				checks: [
					{
						protocol: 'http',
						port: 80,
						path: '/health',
						interval_sec: 60,
						expect_status_min: 200,
						expect_status_max: 399,
						enabled: true
					}
				]
			})
		);
		assert.equal(calls[1]?.body?.includes('idempotency_key'), false);
	});

	test('an empty set is saved and an invalid port is not put', async () => {
		const empty = installFetch((call) => (call.method === 'GET' ? envelope(serviceDetail([80])) : envelope(null)));
		await assert.rejects(async () => {
			await projectActions.saveHealthChecks(
				fakeEvent({
					url: `http://console.example/projects/${PROJECT.id}?tab=services&/saveHealthChecks`,
					session: TOKEN,
					user: USER,
					projects: [PROJECT],
					params: { id: PROJECT.id },
					form: { service_id: SERVICE_ID }
				}).event as never
			);
		});
		assert.equal(empty[1]?.body, JSON.stringify({ checks: [] }));

		const invalid = installFetch((call) => {
			if (call.method === 'PUT') return envelope(null, 500, 'error', 'should not put');
			return envelope(serviceDetail([80]));
		});
		const failed = await projectActions.saveHealthChecks(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=services&/saveHealthChecks`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: {
					service_id: SERVICE_ID,
					...checkFields({ protocol: 'tcp', port: '9', path: '', interval: '60', expectMin: '200', expectMax: '399', enabled: '1' })
				}
			}).event as never
		);
		assert.equal(invalid.some((call) => call.method === 'PUT'), false);
		assert.equal(isActionFailure(failed), true);
		if (!isActionFailure(failed)) assert.fail('expected a field failure');
		const data = failed.data as unknown as { healthField?: string; healthMessage?: string; message?: string };
		assert.equal(data.healthField, 'port');
		assert.equal(data.healthMessage, 'Choose a port on this service.');
		assert.equal(data.message, undefined);
		assert.equal(containsToken(failed), false);
	});

	test('an API bad_request stays on the field and does not set the section message', async () => {
		installFetch((call) => {
			if (call.method === 'GET') return envelope(serviceDetail([80]));
			return envelope(null, 400, 'bad_request', 'path must start with /');
		});
		const failed = await projectActions.saveHealthChecks(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=services&/saveHealthChecks`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: {
					service_id: SERVICE_ID,
					...checkFields({ protocol: 'http', port: '80', path: '/health', interval: '60', expectMin: '200', expectMax: '399', enabled: '1' })
				}
			}).event as never
		);
		assert.equal(isActionFailure(failed), true);
		if (!isActionFailure(failed)) assert.fail('expected a bad request');
		const data = failed.data as unknown as { healthField?: string; healthMessage?: string; message?: string; scope?: string };
		assert.equal(data.scope, 'services');
		assert.equal(data.healthField, 'path');
		assert.equal(data.healthMessage, 'path must start with /');
		assert.equal(data.message, undefined);
	});

	test('a draft probe posts protocol, port, and path', async () => {
		const calls = installFetch((call) => {
			if (call.method === 'GET') return envelope(serviceDetail([80, 443]));
			return envelope({
				service: 'api',
				protocol: 'http',
				port: 80,
				path: '/health',
				result: 'up',
				http_status: 200,
				latency_ms: 3,
				checked_at: '2026-10-14T00:00:00Z'
			});
		});
		const probe = await projectActions.probe(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=services&/probe`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: { service_id: SERVICE_ID, protocol: 'http', port: '80', path: '/health' }
			}).event as never
		);
		const posted = calls.filter((call) => call.method === 'POST');
		assert.equal(posted.length, 1);
		assert.equal(posted[0]?.body, JSON.stringify({ protocol: 'http', port: 80, path: '/health' }));
		assert.equal(isActionFailure(probe), false);
		if (!probe || isActionFailure(probe)) assert.fail('expected a probe result');
		assert.equal(probe.editorProbe, true);
		assert.equal(probe.probeServiceId, SERVICE_ID);
		assert.equal(probe.probe?.result, 'up');
		assert.equal(containsToken(probe), false);
	});

	test('a saved check still posts only check_id', async () => {
		const calls = installFetch(() =>
			envelope({
				service: 'api',
				protocol: 'tcp',
				port: 80,
				path: null,
				result: 'open',
				http_status: null,
				latency_ms: 1,
				checked_at: '2026-10-14T00:00:00Z'
			})
		);
		const probe = await projectActions.probe(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=services&/probe`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: { service_id: SERVICE_ID, check_id: CHECK_ID, protocol: 'http', port: '80', path: '/health' }
			}).event as never
		);
		assert.equal(calls[0]?.body, JSON.stringify({ check_id: CHECK_ID }));
		assert.equal(isActionFailure(probe), false);
		if (!probe || isActionFailure(probe)) assert.fail('expected a probe result');
		assert.equal(probe.editorProbe, undefined);
		assert.equal(probe.probe?.result, 'open');
	});

	test('a TCP draft probe sends a null path', async () => {
		const calls = installFetch((call) => {
			if (call.method === 'GET') return envelope(serviceDetail([80, 443]));
			return envelope({
				service: 'api',
				protocol: 'tcp',
				port: 443,
				path: null,
				result: 'open',
				http_status: null,
				latency_ms: 2,
				checked_at: '2026-10-14T00:00:00Z'
			});
		});
		await projectActions.probe(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=services&/probe`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: { service_id: SERVICE_ID, protocol: 'tcp', port: '443', path: '/ignored' }
			}).event as never
		);
		const posted = calls.filter((call) => call.method === 'POST');
		assert.equal(posted.length, 1);
		assert.equal(posted[0]?.body, JSON.stringify({ protocol: 'tcp', port: 443, path: null }));
	});
});

describe('parsed health checks', () => {
	test('a check without interval or expect uses the defaults and keeps an out-of-range integer', () => {
		const parsed = parseHealthChecks([
			{ id: CHECK_ID, protocol: 'tcp', port: 80, path: null, enabled: true }
		]);
		assert.equal(parsed?.[0]?.interval_sec, 60);
		assert.equal(parsed?.[0]?.expect_status_min, 200);
		assert.equal(parsed?.[0]?.expect_status_max, 399);
		const kept = parseHealthChecks([
			{ id: CHECK_ID, protocol: 'tcp', port: 80, path: null, enabled: true, interval_sec: 20 }
		]);
		assert.equal(kept?.[0]?.interval_sec, 20);
		assert.equal(
			parseHealthChecks([
				{ id: CHECK_ID, protocol: 'tcp', port: 80, path: null, enabled: true, interval_sec: 60.5 }
			]),
			null
		);
	});
});

test('the services editor calls the health-check functions', () => {
	const root = new URL('../src/', import.meta.url);
	const read = (name: string) => readFileSync(new URL(name, root), 'utf8');
	const anchors: Array<[string, string]> = [
		['lib/health-checks.ts', 'return canRenameService('],
		['routes/projects/[id]/HealthChecks.svelte', 'HEALTH_CHECK_NOTE'],
		['routes/projects/[id]/HealthChecks.svelte', 'tcpSuggestions('],
		['routes/projects/[id]/HealthChecks.svelte', 'setCheckProtocol('],
		['routes/projects/[id]/HealthChecks.svelte', 'setCheckPort('],
		['routes/projects/[id]/HealthChecks.svelte', 'addTcpCheck('],
		['routes/projects/[id]/HealthChecks.svelte', 'removeCheck('],
		['routes/projects/[id]/HealthChecks.svelte', 'validateHealthChecks('],
		['routes/projects/[id]/HealthChecks.svelte', 'healthChecksSaveState('],
		['routes/projects/[id]/HealthChecks.svelte', 'probeRequestBody('],
		['routes/projects/[id]/HealthChecks.svelte', 'healthFormRows('],
		['routes/projects/[id]/HealthChecks.svelte', 'healthNoticeOnCloseComplete('],
		['routes/projects/[id]/HealthChecks.svelte', 'draftFromChecks('],
		['routes/projects/[id]/+page.svelte', 'healthNoticeOnView('],
		['routes/projects/[id]/+page.svelte', 'healthNoticeOnAction('],
		['routes/projects/[id]/+page.svelte', 'healthNoticeOnDialog('],
		['routes/projects/[id]/+page.svelte', 'servicesHealthView('],
		['routes/projects/[id]/+page.server.ts', 'validateHealthChecks('],
		['routes/projects/[id]/+page.server.ts', 'draftsFromForm('],
		['routes/projects/[id]/+page.server.ts', 'healthCheckPayload('],
		['routes/projects/[id]/+page.server.ts', 'probeRequestBody('],
		['routes/projects/[id]/+page.server.ts', 'fieldForHealthMessage('],
		['routes/projects/[id]/ServicesSection.svelte', 'canEditHealthChecks('],
		['routes/projects/[id]/ServicesSection.svelte', 'SAVED_HEALTH_CHECKS'],
		['routes/projects/[id]/ServicesSection.svelte', '{#if renameAllowed(service)}']
	];
	for (const [file, needle] of anchors) {
		assert.equal(read(file).includes(needle), true, `${file} missing ${needle}`);
	}
	const section = read('routes/projects/[id]/ServicesSection.svelte');
	const gate = section.slice(section.indexOf('{#if renameAllowed(service)}'), section.indexOf('{/if}', section.indexOf('{#if renameAllowed(service)}')));
	assert.equal(gate.includes('<RenameService'), true);
	assert.equal(gate.includes('<HealthChecks'), true);
});
