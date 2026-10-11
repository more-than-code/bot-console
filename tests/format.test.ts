import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	formatBytes,
	formatCapacity,
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

test('formatBytes uses 1024-based units and one decimal under 100', () => {
	assert.equal(formatBytes(0), '0 B');
	assert.equal(formatBytes(1024), '1 KB');
	assert.equal(formatBytes(1536), '1.5 KB');
	assert.equal(formatBytes(10.06 * 1024 ** 2), '10.1 MB');
	assert.equal(formatBytes(100 * 1024 ** 3), '100 GB');
	assert.equal(formatBytes(1024 ** 4), '1 TB');
});

test('formatBytes rejects null, zero-like invalid, and non-finite values', () => {
	assert.equal(formatBytes(null), 'n/a');
	assert.equal(formatBytes(undefined), 'n/a');
	assert.equal(formatBytes(Number.NaN), 'n/a');
	assert.equal(formatBytes(Number.POSITIVE_INFINITY), 'n/a');
	assert.equal(formatBytes(-1), 'n/a');
});

test('formatBytes keeps huge values on the largest unit', () => {
	assert.equal(formatBytes(250 * 1024 ** 5), '250 PB');
	assert.equal(formatBytes(1024 ** 5), '1 PB');
});

test('formatCapacity shows used and total in the total unit', () => {
	assert.equal(formatCapacity(0, 0, 0), '0 / 0 B (0.0%)');
	assert.equal(formatCapacity(1221152768, 8200626176, 14.9), '1.1 / 7.6 GB (14.9%)');
	assert.equal(formatCapacity(7291064320, 62290444288, 12.3), '6.8 / 58 GB (12.3%)');
	assert.equal(formatCapacity(1.5 * 1024 ** 4, 2 * 1024 ** 4, 75), '1.5 / 2 TB (75.0%)');
	assert.equal(formatCapacity(1024 ** 5, 250 * 1024 ** 5, 0.4), '1 / 250 PB (0.4%)');
	assert.equal(formatCapacity(null, 8200626176, 14.9), 'n/a / 7.6 GB (14.9%)');
	assert.equal(formatCapacity(1221152768, 8200626176, null), '1.1 / 7.6 GB');
	assert.equal(formatCapacity(Number.NaN, 1024 ** 3, Number.NaN), 'n/a / 1 GB');
});

test('formatCapacity falls back to the percent when total is missing', () => {
	assert.equal(formatCapacity(1221152768, null, 14.9), '14.9%');
	assert.equal(formatCapacity(null, undefined, 0), '0.0%');
	assert.equal(formatCapacity(1, Number.NaN, 10), '10.0%');
	assert.equal(formatCapacity(1, -5, 10), '10.0%');
});

test('formatCapacity is n/a when used, total, and percent are all missing', () => {
	assert.equal(formatCapacity(null, null, null), 'n/a');
	assert.equal(formatCapacity(undefined, undefined, undefined), 'n/a');
	assert.equal(formatCapacity(Number.NaN, Number.NaN, Number.NaN), 'n/a');
	assert.equal(formatCapacity(-1, null, Number.POSITIVE_INFINITY), 'n/a');
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
