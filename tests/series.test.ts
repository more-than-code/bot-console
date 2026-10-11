import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeSeries } from '../src/lib/series.ts';

test('mergeSeries aligns buckets, rounds, and sorts', () => {
	const points = mergeSeries({
		cpu: [
			{ t: '2026-10-11T06:44:30.000Z', value: 1.26 },
			{ t: '2026-10-11T06:44:00.000Z', value: null }
		],
		memory: [{ t: '2026-10-11T06:44:00.000Z', value: 40.04 }],
		disk: [],
		temp: [{ t: '2026-10-11T06:44:30.000Z', value: 55.55 }],
		load1: [{ t: '2026-10-11T06:44:30.000Z', value: 0.125 }],
		net: [{ t: '2026-10-11T06:44:30.000Z', rx: 5321.09, tx: 0 }],
		diskio: [{ t: '2026-10-11T06:44:00.000Z', read: 10.04, write: null }]
	});

	assert.deepEqual(
		points.map((point) => point.t),
		['2026-10-11T06:44:00.000Z', '2026-10-11T06:44:30.000Z']
	);
	assert.equal(points[0].cpu, null);
	assert.equal(points[0].memory, 40);
	assert.equal(points[0].diskRead, 10);
	assert.equal(points[0].diskWrite, null);
	assert.equal(points[1].cpu, 1.3);
	assert.equal(points[1].temp, 55.6);
	assert.equal(points[1].load1, 0.13);
	assert.equal(points[1].netRx, 5321.1);
	assert.equal(points[1].netTx, 0);
	assert.equal(points[1].memory, null);
});
