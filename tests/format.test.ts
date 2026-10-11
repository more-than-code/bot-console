import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	formatLoad,
	formatPercent,
	formatRate,
	formatTick,
	formatUptime,
	formatWhen
} from '../src/lib/format.ts';

test('formatWhen renders Pacific/Auckland', () => {
	const text = formatWhen('2026-10-10T17:44:46.000Z');
	assert.match(text, /11/);
	assert.match(text, /06:44:46/);
	assert.match(text, /NZDT/);
	assert.equal(formatWhen(null), 'n/a');
	assert.equal(formatWhen('not-a-date'), 'n/a');
});

test('formatTick uses the clock for a short span and the date for a long one', () => {
	const iso = '2026-10-10T17:44:46.000Z';
	assert.match(formatTick(iso, 60 * 60 * 1000), /06:44/);
	assert.match(formatTick(iso, 7 * 24 * 60 * 60 * 1000), /11/);
	assert.equal(formatTick('nope', 1000), '');
});

test('formatUptime', () => {
	assert.equal(formatUptime(null), 'n/a');
	assert.equal(formatUptime(-5), 'n/a');
	assert.equal(formatUptime(0), '0m');
	assert.equal(formatUptime(59), '0m');
	assert.equal(formatUptime(60), '1m');
	assert.equal(formatUptime(3600), '1h 0m');
	assert.equal(formatUptime(86400), '1d 0h');
	assert.equal(formatUptime(90061), '1d 1h');
});

test('formatPercent and formatLoad', () => {
	assert.equal(formatPercent(null), 'n/a');
	assert.equal(formatPercent(0), '0.0%');
	assert.equal(formatPercent(12.34), '12.3%');
	assert.equal(formatLoad(0), '0.00');
	assert.equal(formatLoad(1.236), '1.24');
});

test('formatRate', () => {
	assert.equal(formatRate(null), 'n/a');
	assert.equal(formatRate(-1), 'n/a');
	assert.equal(formatRate(0), '0 B/s');
	assert.equal(formatRate(999), '999 B/s');
	assert.equal(formatRate(1000), '1.00 KB/s');
	assert.equal(formatRate(1500), '1.50 KB/s');
	assert.equal(formatRate(15_000), '15.0 KB/s');
	assert.equal(formatRate(150_000), '150 KB/s');
	assert.equal(formatRate(2_500_000), '2.50 MB/s');
});
