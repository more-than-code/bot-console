import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { isActionFailure } from '@sveltejs/kit';
import { actions as hostActions, load as hostLoad } from '../src/routes/hosts/[id]/+page.server.ts';
import { hostFormAction, METRIC_SPECS, type MetricChart } from '../src/lib/host-view.ts';
import { RANGES, type RangeKey } from '../src/lib/ranges.ts';
import { parseHealthChecks, parseProbe, parseProcessSample } from '../src/lib/server/shape.ts';
import { envelope, fakeEvent, installFetch, PROJECT, restoreEnv, TOKEN, useApi, USER, type FetchCall } from './harness.ts';

const HOST_ID = '00000000-0000-4000-8000-0000000000aa';
const SERVICE_ID = '00000000-0000-4000-8000-0000000000bb';
const CHECK_ID = '00000000-0000-4000-8000-0000000000cc';

const HOST = {
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
	revoked_at: null
};

const SERIES_NAME: Record<string, string> = {
	cpu: 'usage_percent',
	mem: 'used_percent',
	disk: 'used_percent',
	net: 'rx_bps',
	diskio: 'read_bps',
	system: 'load1',
	temp: 'celsius'
};

function metricBody(m: string, name: string) {
	return {
		m,
		from: '2026-10-14T00:00:00.000Z',
		to: '2026-10-14T01:00:00.000Z',
		step: 60,
		series: [
			{
				name,
				unit: '%',
				points: [
					['2026-10-14T00:30:00.000Z', 1.5],
					['2026-10-14T00:31:00.000Z', null]
				]
			}
		]
	};
}

function pageData<T>(value: T): Exclude<T, void | undefined | null> {
	if (value == null) assert.fail('missing page data');
	return value as Exclude<T, void | undefined | null>;
}

async function loadHost(url: string, handler: (call: FetchCall) => Response) {
	const calls = installFetch(handler);
	const data = pageData(
		await hostLoad(
			fakeEvent({
				url,
				session: TOKEN,
				user: USER,
				params: { id: HOST_ID }
			}).event as never
		)
	);
	return { calls, data };
}

describe('host page', { concurrency: false }, () => {
	const originalFetch = globalThis.fetch;

	before(() => {
		useApi('https://api.test');
	});

	after(() => {
		globalThis.fetch = originalFetch;
		restoreEnv();
	});

	test('each tab calls only its API routes, and breadcrumbs use the project name', async () => {
		const overview = await loadHost(`http://console.example/hosts/${HOST_ID}?tab=overview&range=6h`, (call) => {
			if (call.url.pathname === `/v1/hosts/${HOST_ID}`) return envelope(HOST);
			if (call.url.pathname === `/v1/projects/${PROJECT.id}`) return envelope({ ...PROJECT, name: 'Lab' });
			if (call.url.pathname === `/v1/hosts/${HOST_ID}/metrics`) {
				const m = call.url.searchParams.get('m') ?? '';
				return envelope(metricBody(m, SERIES_NAME[m] ?? 'usage_percent'));
			}
			return envelope(null, 500, 'error', 'unexpected');
		});
		assert.equal(overview.data.projectName, 'Lab');
		assert.equal(overview.data.host?.name, 'pi1');
		assert.equal(overview.data.tab, 'overview');
		assert.equal(overview.data.message, null);
		const metrics = overview.calls.filter((call) => call.url.pathname.endsWith('/metrics'));
		assert.deepEqual(
			metrics.map((call) => call.url.searchParams.get('m')).sort(),
			METRIC_SPECS.map((spec) => spec.m).sort()
		);
		for (const call of metrics) {
			const from = Date.parse(call.url.searchParams.get('from') ?? '');
			const to = Date.parse(call.url.searchParams.get('to') ?? '');
			assert.equal(to - from, RANGES['6h'].ms);
			assert.equal(call.url.searchParams.has('step'), false);
		}
		assert.equal(overview.calls.some((call) => call.url.pathname.endsWith('/services')), false);
		assert.equal(overview.calls.some((call) => call.url.pathname.endsWith('/processes')), false);

		const services = await loadHost(`http://console.example/hosts/${HOST_ID}?tab=services`, (call) => {
			if (call.url.pathname === `/v1/hosts/${HOST_ID}`) return envelope(HOST);
			if (call.url.pathname === `/v1/projects/${PROJECT.id}`) return envelope(PROJECT);
			if (call.url.pathname === `/v1/hosts/${HOST_ID}/services`) {
				return envelope({
					items: [
						{
							id: SERVICE_ID,
							name: 'api',
							source: 'discovered',
							kind: 'process',
							ports: [8080],
							health: null
						}
					],
					next_cursor: null
				});
			}
			if (call.url.pathname === `/v1/services/${SERVICE_ID}`) return envelope({ health_checks: [] });
			return envelope(null, 500, 'error', 'unexpected');
		});
		assert.equal(services.data.services[0]?.name, 'api');
		assert.equal(services.calls.some((call) => call.url.pathname.endsWith('/metrics')), false);
		assert.equal(services.calls.some((call) => call.url.pathname.endsWith('/processes')), false);
		assert.equal(services.calls.some((call) => call.url.pathname === `/v1/services/${SERVICE_ID}`), true);

		const processes = await loadHost(
			`http://console.example/hosts/${HOST_ID}?tab=processes&sort=memory&q=node`,
			(call) => {
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
								cmdline: 'node server.js',
								service_id: SERVICE_ID,
								cpu_usage: 150,
								memory_rss: 4096,
								memory_usage: 1.5,
								num_threads: 4,
								started_at: '2026-10-14T00:00:00Z'
							}
						]
					});
				}
				return envelope(null, 500, 'error', 'unexpected');
			}
		);
		const processCall = processes.calls.find((call) => call.url.pathname.endsWith('/processes'));
		assert.ok(processCall);
		assert.equal(processCall?.url.searchParams.get('sort'), 'memory');
		assert.equal(processCall?.url.searchParams.get('limit'), '200');
		assert.equal(processCall?.url.searchParams.has('q'), false);
		assert.equal(processes.data.processes?.items[0]?.service_id, SERVICE_ID);
		assert.equal(processes.calls.some((call) => call.url.pathname.endsWith('/metrics')), false);
		assert.equal(processes.calls.some((call) => call.url.pathname.endsWith('/services')), false);

		const fallback = await loadHost(`http://console.example/hosts/${HOST_ID}?tab=processes&sort=nope`, (call) => {
			if (call.url.pathname === `/v1/hosts/${HOST_ID}`) return envelope(HOST);
			if (call.url.pathname === `/v1/projects/${PROJECT.id}`) return envelope(PROJECT);
			if (call.url.pathname.endsWith('/processes')) return envelope({ sampled_at: null, items: [] });
			return envelope(null, 500, 'error', 'unexpected');
		});
		const fallbackCall = fallback.calls.find((call) => call.url.pathname.endsWith('/processes'));
		assert.equal(fallbackCall?.url.searchParams.get('sort'), 'cpu');
		assert.equal(fallback.data.processes?.sampled_at, null);
	});

	test('one failing metric call leaves the host page and the other charts intact', async () => {
		const { data } = await loadHost(`http://console.example/hosts/${HOST_ID}?range=24h`, (call) => {
			if (call.url.pathname === `/v1/hosts/${HOST_ID}`) return envelope(HOST);
			if (call.url.pathname === `/v1/projects/${PROJECT.id}`) return envelope(PROJECT);
			if (call.url.pathname.endsWith('/metrics')) {
				const m = call.url.searchParams.get('m');
				if (m === 'cpu') return envelope(null, 503, 'unavailable', 'cpu unavailable');
				const from = Date.parse(call.url.searchParams.get('from') ?? '');
				const to = Date.parse(call.url.searchParams.get('to') ?? '');
				assert.equal(to - from, RANGES['24h'].ms);
				assert.equal(call.url.searchParams.has('step'), false);
				return envelope(metricBody(m ?? '', SERIES_NAME[m ?? ''] ?? 'used_percent'));
			}
			return envelope(null, 500, 'error', 'unexpected');
		});
		assert.equal(data.message, null);
		assert.equal(data.host?.name, 'pi1');
		assert.equal(data.tab, 'overview');
		assert.equal(data.range, '24h');
		const cpu = data.metrics.find((chart: MetricChart) => chart.m === 'cpu');
		const mem = data.metrics.find((chart: MetricChart) => chart.m === 'mem');
		assert.equal(cpu?.message, 'cpu unavailable');
		assert.equal(cpu?.series.length, 0);
		assert.equal(mem?.message, null);
		assert.equal(mem?.series[0]?.name, 'used_percent');
		assert.equal(mem?.series[0]?.points[1]?.value, null);
		assert.equal(data.metrics.length, METRIC_SPECS.length);
	});

	test('omitted range is the last hour', async () => {
		const { calls } = await loadHost(`http://console.example/hosts/${HOST_ID}`, (call) => {
			if (call.url.pathname === `/v1/hosts/${HOST_ID}`) return envelope(HOST);
			if (call.url.pathname === `/v1/projects/${PROJECT.id}`) return envelope(PROJECT);
			if (call.url.pathname.endsWith('/metrics')) {
				const from = Date.parse(call.url.searchParams.get('from') ?? '');
				const to = Date.parse(call.url.searchParams.get('to') ?? '');
				assert.equal(to - from, RANGES['1h'].ms);
				return envelope(metricBody(call.url.searchParams.get('m') ?? '', 'usage_percent'));
			}
			return envelope(null, 500, 'error', 'unexpected');
		});
		assert.equal(calls.filter((call) => call.url.pathname.endsWith('/metrics')).length, METRIC_SPECS.length);
	});

	test('breadcrumbs and the service anchor are wired to the project name and service id', () => {
		const hostPage = readFileSync(new URL('../src/routes/hosts/[id]/+page.svelte', import.meta.url), 'utf8');
		const projectPage = readFileSync(new URL('../src/routes/projects/[id]/+page.svelte', import.meta.url), 'utf8');
		const services = readFileSync(new URL('../src/routes/hosts/[id]/ServicesTab.svelte', import.meta.url), 'utf8');
		const processes = readFileSync(new URL('../src/routes/hosts/[id]/ProcessesTab.svelte', import.meta.url), 'utf8');
		assert.match(hostPage, /aria-label="Breadcrumb"|Breadcrumbs/);
		assert.match(hostPage, /data\.projectName/);
		assert.match(projectPage, /Breadcrumbs/);
		assert.match(projectPage, /data\.project\.name/);
		assert.match(services, /serviceDomId\(service\.id\)/);
		assert.match(processes, /serviceTabHref\(row\.service_id\)/);
		assert.match(processes, /filterProcesses/);
		const server = readFileSync(new URL('../src/routes/hosts/[id]/+page.server.ts', import.meta.url), 'utf8');
		assert.match(server, /depends\('host:metrics'\)/);
		for (const key of ['1h', '6h', '24h', '7d'] as RangeKey[]) {
			assert.ok(RANGES[key]);
		}
	});

	test('a probe result stays on the services tab and a snapshot keeps range=7d', async () => {
		const servicesTab = readFileSync(new URL('../src/routes/hosts/[id]/ServicesTab.svelte', import.meta.url), 'utf8');
		const overviewTab = readFileSync(new URL('../src/routes/hosts/[id]/OverviewTab.svelte', import.meta.url), 'utf8');
		const hostPage = readFileSync(new URL('../src/routes/hosts/[id]/+page.svelte', import.meta.url), 'utf8');
		const hostsSection = readFileSync(new URL('../src/routes/projects/[id]/HostsSection.svelte', import.meta.url), 'utf8');
		assert.match(servicesTab, /hostFormAction\('probe', \{ tab: 'services', range \}\)/);
		assert.match(servicesTab, /\{#if probe\}/);
		assert.match(overviewTab, /hostFormAction\('snapshot', \{ tab: 'overview', range \}\)/);
		assert.match(overviewTab, /\{#if snapshot\}/);
		assert.match(hostsSection, /hostFormAction\('askRevoke', \{ tab: 'hosts' \}\)/);
		assert.match(hostsSection, /hostFormAction\('revokeCredential', \{ tab: 'hosts' \}\)/);
		assert.match(hostPage, /data\.tab === 'services'[\s\S]*probe=\{form\?\.probe/);
		assert.match(hostPage, /data\.tab === 'overview'[\s\S]*snapshot=\{form\?\.snapshot/);

		const probeAction = hostFormAction('probe', { tab: 'services', range: '6h' });
		assert.equal(probeAction, '?tab=services&range=6h&/probe');
		const probeUrl = new URL(`http://console.example/hosts/${HOST_ID}${probeAction}`);
		assert.equal(probeUrl.searchParams.get('tab'), 'services');
		assert.equal(probeUrl.searchParams.get('range'), '6h');
		assert.equal(probeUrl.searchParams.has('/probe'), true);
		installFetch((call) => {
			if (call.url.pathname.endsWith('/probe')) {
				return envelope({ service: 'api', protocol: 'http', result: 'success', path: '/health' });
			}
			return envelope(null, 500, 'error', 'unexpected');
		});
		const probe = await hostActions.probe(
			fakeEvent({
				url: probeUrl.href,
				session: TOKEN,
				user: USER,
				params: { id: HOST_ID },
				form: { service_id: SERVICE_ID, check_id: CHECK_ID }
			}).event as never
		);
		assert.equal(isActionFailure(probe), false);
		if (!probe || isActionFailure(probe)) assert.fail('expected a probe result');
		assert.equal(probe.probe?.result, 'success');
		const services = await loadHost(probeUrl.href, (call) => {
			if (call.url.pathname === `/v1/hosts/${HOST_ID}`) return envelope(HOST);
			if (call.url.pathname === `/v1/projects/${PROJECT.id}`) return envelope(PROJECT);
			if (call.url.pathname === `/v1/hosts/${HOST_ID}/services`) return envelope({ items: [], next_cursor: null });
			return envelope(null, 500, 'error', 'unexpected');
		});
		assert.equal(services.data.tab, 'services');
		assert.equal(services.data.range, '6h');
		assert.equal(services.data.message, null);

		const snapshotAction = hostFormAction('snapshot', { tab: 'overview', range: '7d' });
		assert.equal(snapshotAction, '?tab=overview&range=7d&/snapshot');
		const snapshotUrl = new URL(`http://console.example/hosts/${HOST_ID}${snapshotAction}`);
		assert.equal(snapshotUrl.searchParams.has('/snapshot'), true);
		installFetch((call) => {
			if (call.url.pathname.endsWith('/snapshot')) return envelope({ sampled_at: '2026-10-14T00:00:00Z', cpu_percent: 3 });
			return envelope(null, 500, 'error', 'unexpected');
		});
		const snapshot = await hostActions.snapshot(
			fakeEvent({
				url: snapshotUrl.href,
				session: TOKEN,
				user: USER,
				params: { id: HOST_ID }
			}).event as never
		);
		assert.equal(isActionFailure(snapshot), false);
		if (!snapshot || isActionFailure(snapshot)) assert.fail('expected a snapshot result');
		assert.equal(snapshot.snapshot?.cpu_percent, 3);
		const overview = await loadHost(snapshotUrl.href, (call) => {
			if (call.url.pathname === `/v1/hosts/${HOST_ID}`) return envelope(HOST);
			if (call.url.pathname === `/v1/projects/${PROJECT.id}`) return envelope(PROJECT);
			if (call.url.pathname.endsWith('/metrics')) {
				const from = Date.parse(call.url.searchParams.get('from') ?? '');
				const to = Date.parse(call.url.searchParams.get('to') ?? '');
				assert.equal(to - from, RANGES['7d'].ms);
				assert.equal(call.url.searchParams.has('step'), false);
				return envelope(metricBody(call.url.searchParams.get('m') ?? '', 'usage_percent'));
			}
			return envelope(null, 500, 'error', 'unexpected');
		});
		assert.equal(overview.data.tab, 'overview');
		assert.equal(overview.data.range, '7d');
		assert.equal(overview.data.message, null);
		assert.equal(overview.calls.filter((call) => call.url.pathname.endsWith('/metrics')).length, METRIC_SPECS.length);
	});

	test('a control character in cmdline renders and a row without a pid is skipped', async () => {
		const truncated = parseProcessSample({
			sampled_at: '2026-10-14T00:00:00Z',
			items: [
				{
					pid: 1,
					process_name: 'n'.repeat(201),
					user: `${'u'.repeat(80)}\u0007`,
					cmdline: 'c'.repeat(8193),
					service_id: null,
					cpu_usage: 1,
					memory_rss: 1,
					memory_usage: 1,
					num_threads: 1,
					started_at: '2026-10-14T00:00:00Z'
				}
			]
		});
		assert.equal(truncated?.items[0]?.process_name, `${'n'.repeat(199)}\u2026`);
		assert.equal(truncated?.items[0]?.user, `${'u'.repeat(79)}\u2026`);
		assert.equal(truncated?.items[0]?.cmdline?.length, 8192);
		assert.equal(truncated?.items[0]?.cmdline?.endsWith('\u2026'), true);
		assert.equal(truncated?.skipped, 0);

		const { data } = await loadHost(`http://console.example/hosts/${HOST_ID}?tab=processes`, (call) => {
			if (call.url.pathname === `/v1/hosts/${HOST_ID}`) return envelope(HOST);
			if (call.url.pathname === `/v1/projects/${PROJECT.id}`) return envelope(PROJECT);
			if (call.url.pathname.endsWith('/processes')) {
				return envelope({
					sampled_at: '2026-10-14T00:00:00Z',
					items: [
						{
							pid: 4,
							process_name: 'node',
							user: 'bot',
							cmdline: 'echo\u0007ok',
							service_id: null,
							cpu_usage: 1,
							memory_rss: 1024,
							memory_usage: 1,
							num_threads: 1,
							started_at: '2026-10-14T00:00:00Z'
						},
						{ process_name: 'orphan', user: 'bot' }
					]
				});
			}
			return envelope(null, 500, 'error', 'unexpected');
		});
		assert.equal(data.tab, 'processes');
		assert.equal(data.message, null);
		assert.equal(data.processesMessage, null);
		assert.equal(data.processes?.skipped, 1);
		assert.equal(data.processes?.items.length, 1);
		assert.equal(data.processes?.items[0]?.cmdline, 'echo\uFFFDok');
		const processes = readFileSync(new URL('../src/routes/hosts/[id]/ProcessesTab.svelte', import.meta.url), 'utf8');
		assert.match(processes, /\{sample\.skipped\} rows skipped/);
		assert.match(processes, /\{row\.cmdline/);
	});

	test('health-check and probe paths accept 512 bytes', () => {
		const path = `/${'a'.repeat(511)}`;
		assert.equal(new TextEncoder().encode(path).byteLength, 512);
		const check = {
			id: CHECK_ID,
			protocol: 'http' as const,
			port: 8080,
			path,
			enabled: true
		};
		assert.equal(parseHealthChecks([check])?.[0]?.path, path);
		const probe = parseProbe({ protocol: 'http', result: 'success', path });
		assert.equal(probe?.path, path);
		const tooLong = `/${'a'.repeat(512)}`;
		assert.equal(new TextEncoder().encode(tooLong).byteLength, 513);
		assert.equal(parseHealthChecks([{ ...check, path: tooLong }]), null);
		assert.equal(parseProbe({ protocol: 'http', result: 'success', path: tooLong })?.path, null);
	});
});
