import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RECENT_HOST_WINDOW, STALE_AFTER, STALE_AFTER_MS } from '../src/lib/limits.ts';
import { isMissingMetricShape } from '../src/lib/pg-error.ts';
import { assembleSnapshots, type RegistryInfo } from '../src/lib/snapshot.ts';

const generatedAt = '2026-10-11T07:00:00.000Z';

function row(name: string, role: string | null = null): RegistryInfo {
	return { name, lanIp: null, tailscaleIp: null, role, runs: null };
}

test('stale window constants stay paired', () => {
	assert.equal(STALE_AFTER, '2 minutes');
	assert.equal(STALE_AFTER_MS, 120_000);
	assert.equal(RECENT_HOST_WINDOW, '7 days');
});

test('registry host with no metric rows is stale and keeps null metrics', () => {
	const hosts = assembleSnapshots({
		registry: [{ name: 'new-node', lanIp: '192.0.2.10', tailscaleIp: null, role: 'workstation', runs: 'builds' }],
		discovered: [],
		samples: [],
		generatedAt,
		staleMs: STALE_AFTER_MS
	});
	assert.equal(hosts.length, 1);
	assert.equal(hosts[0].name, 'new-node');
	assert.equal(hosts[0].online, false);
	assert.equal(hosts[0].lastReported, null);
	assert.equal(hosts[0].cpuPercent, null);
	assert.equal(hosts[0].tempC, null);
	assert.equal(hosts[0].diskPercent, null);
	assert.equal(hosts[0].role, 'workstation');
	assert.equal(hosts[0].runs, 'builds');
});

test('metric-only host is listed and a missing temp does not drop it', () => {
	const hosts = assembleSnapshots({
		registry: [{ ...row('pi1', 'coding-node'), lanIp: '192.0.2.11' }],
		discovered: ['pi1', 'mac-mini', '../bad', ''],
		samples: [
			{ host: 'pi1', time: '2026-10-11T06:59:30.000Z', cpuPercent: 1.26, tempC: 40, load1: 0.125 },
			{ host: 'mac-mini', time: '2026-10-11T06:59:00.000Z', cpuPercent: 8, memoryPercent: null, uptimeSeconds: 90.2 }
		],
		generatedAt,
		staleMs: STALE_AFTER_MS
	});
	assert.deepEqual(
		hosts.map((host) => host.name),
		['mac-mini', 'pi1']
	);
	assert.equal(hosts[0].online, true);
	assert.equal(hosts[0].lanIp, null);
	assert.equal(hosts[0].role, null);
	assert.equal(hosts[0].cpuPercent, 8);
	assert.equal(hosts[0].memoryPercent, null);
	assert.equal(hosts[0].tempC, null);
	assert.equal(hosts[0].uptimeSeconds, 90);
	assert.equal(hosts[1].online, true);
	assert.equal(hosts[1].lanIp, '192.0.2.11');
	assert.equal(hosts[1].cpuPercent, 1.3);
	assert.equal(hosts[1].tempC, 40);
	assert.equal(hosts[1].load1, 0.13);
	assert.equal(hosts[1].role, 'coding-node');
});

test('a reading older than two minutes is stale and the boundary is inclusive', () => {
	const stale = assembleSnapshots({
		registry: [],
		discovered: ['gone-node'],
		samples: [{ host: 'gone-node', time: '2026-10-11T06:57:59.999Z', cpuPercent: 1 }],
		generatedAt,
		staleMs: STALE_AFTER_MS
	});
	assert.equal(stale[0].online, false);
	assert.equal(stale[0].cpuPercent, 1);
	assert.equal(stale[0].lastReported, '2026-10-11T06:57:59.999Z');

	const edge = assembleSnapshots({
		registry: [row('edge')],
		discovered: [],
		samples: [{ host: 'edge', time: '2026-10-11T06:58:00.000Z', diskPercent: 10 }],
		generatedAt,
		staleMs: STALE_AFTER_MS
	});
	assert.equal(edge[0].online, true);
	assert.equal(edge[0].diskPercent, 10);
});

test('unsafe names are dropped and the newest timestamp wins', () => {
	const hosts = assembleSnapshots({
		registry: [row('bad/name'), row('node-a')],
		discovered: ['node-a'],
		samples: [
			{ host: 'node-a', time: '2026-10-11T06:50:00.000Z', cpuPercent: 1 },
			{ host: 'node-a', time: '2026-10-11T06:59:00.000Z', memoryPercent: 2 }
		],
		generatedAt,
		staleMs: STALE_AFTER_MS
	});
	assert.deepEqual(
		hosts.map((host) => host.name),
		['node-a']
	);
	assert.equal(hosts[0].cpuPercent, 1);
	assert.equal(hosts[0].memoryPercent, 2);
	assert.equal(hosts[0].lastReported, '2026-10-11T06:59:00.000Z');
	assert.equal(hosts[0].online, true);
});

test('missing relation errors are the only ones treated as empty metrics', () => {
	assert.equal(isMissingMetricShape({ code: '42703' }), true);
	assert.equal(isMissingMetricShape({ code: '42P01' }), true);
	assert.equal(isMissingMetricShape({ code: '08006' }), false);
	assert.equal(isMissingMetricShape(new Error('connection refused')), false);
	assert.equal(isMissingMetricShape(null), false);
});
