import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RECENT_HOST_WINDOW, STALE_AFTER, STALE_AFTER_MS } from '../src/lib/limits.ts';
import { isMissingMetricShape } from '../src/lib/pg-error.ts';
import { assembleSnapshots, type RegistryInfo } from '../src/lib/snapshot.ts';
import { isHostDetail } from '../src/lib/types.ts';

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

test('capacity bytes are rounded onto the snapshot', () => {
	const hosts = assembleSnapshots({
		registry: [row('pi1', 'coding-node')],
		discovered: [],
		samples: [
			{
				host: 'pi1',
				time: '2026-10-11T06:59:30.000Z',
				memoryPercent: 14.89,
				memoryUsedBytes: 1221152768.4,
				memoryTotalBytes: 8200626176,
				memoryAvailableBytes: 6979473408.2,
				diskPercent: 12.335,
				diskUsedBytes: 7291064320,
				diskTotalBytes: 62290444288,
				diskFreeBytes: 51816525824
			}
		],
		generatedAt,
		staleMs: STALE_AFTER_MS
	});
	assert.equal(hosts[0].memoryPercent, 14.9);
	assert.equal(hosts[0].memoryUsedBytes, 1221152768);
	assert.equal(hosts[0].memoryTotalBytes, 8200626176);
	assert.equal(hosts[0].memoryAvailableBytes, 6979473408);
	assert.equal(hosts[0].diskPercent, 12.3);
	assert.equal(hosts[0].diskUsedBytes, 7291064320);
	assert.equal(hosts[0].diskTotalBytes, 62290444288);
	assert.equal(hosts[0].diskFreeBytes, 51816525824);
});

test('missing and non-finite capacity stays null and does not drop the host', () => {
	const hosts = assembleSnapshots({
		registry: [row('grok-bot-box', 'workstation'), row('pi2')],
		discovered: [],
		samples: [
			{
				host: 'pi2',
				time: '2026-10-11T06:59:00.000Z',
				memoryPercent: 4,
				memoryUsedBytes: Number.NaN,
				memoryTotalBytes: Number.POSITIVE_INFINITY,
				memoryAvailableBytes: 0,
				diskUsedBytes: -4.2
			}
		],
		generatedAt,
		staleMs: STALE_AFTER_MS
	});
	assert.equal(hosts[0].name, 'grok-bot-box');
	assert.equal(hosts[0].memoryUsedBytes, null);
	assert.equal(hosts[0].memoryTotalBytes, null);
	assert.equal(hosts[0].memoryAvailableBytes, null);
	assert.equal(hosts[0].diskUsedBytes, null);
	assert.equal(hosts[0].diskTotalBytes, null);
	assert.equal(hosts[0].diskFreeBytes, null);
	assert.equal(hosts[0].tempC, null);
	assert.equal(hosts[1].name, 'pi2');
	assert.equal(hosts[1].memoryPercent, 4);
	assert.equal(hosts[1].memoryUsedBytes, null);
	assert.equal(hosts[1].memoryTotalBytes, null);
	assert.equal(hosts[1].memoryAvailableBytes, 0);
	assert.equal(hosts[1].diskUsedBytes, null);
	assert.equal(hosts[1].diskTotalBytes, null);
	assert.equal(hosts[1].diskFreeBytes, null);
});

test('isHostDetail accepts nullable capacity fields and rejects a non-number', () => {
	const detail = {
		generatedAt,
		range: '1h' as const,
		host: { name: 'pi1' },
		points: []
	};
	assert.equal(isHostDetail(detail), true);
	assert.equal(
		isHostDetail({
			...detail,
			host: {
				name: 'pi1',
				memoryUsedBytes: 1,
				memoryTotalBytes: null,
				memoryAvailableBytes: 0,
				diskUsedBytes: 2,
				diskTotalBytes: 3,
				diskFreeBytes: 1
			}
		}),
		true
	);
	assert.equal(isHostDetail({ ...detail, host: { name: 'pi1', diskTotalBytes: '58' } }), false);
	assert.equal(isHostDetail({ ...detail, host: { name: 'pi1', memoryUsedBytes: Number.NaN } }), false);
});

test('missing relation errors are the only ones treated as empty metrics', () => {
	assert.equal(isMissingMetricShape({ code: '42703' }), true);
	assert.equal(isMissingMetricShape({ code: '42P01' }), true);
	assert.equal(isMissingMetricShape({ code: '08006' }), false);
	assert.equal(isMissingMetricShape(new Error('connection refused')), false);
	assert.equal(isMissingMetricShape(null), false);
});
