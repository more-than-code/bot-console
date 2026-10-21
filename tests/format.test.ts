import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	formatBytes,
	formatCapacity,
	formatLatency,
	formatLoad,
	formatPercent,
	formatProcessMemory,
	formatRate,
	formatTick,
	formatUptime,
	formatWhen
} from '../src/lib/format.ts';

test('formatWhen renders the time zone it is given', () => {
	const iso = '2026-10-10T17:44:46.000Z';
	const auckland = formatWhen(iso, 'Pacific/Auckland');
	assert.match(auckland, /11/);
	assert.match(auckland, /06:44:46/);
	assert.match(auckland, /NZDT/);
	const utc = formatWhen(iso, 'UTC');
	assert.match(utc, /10/);
	assert.match(utc, /17:44:46/);
	assert.match(utc, /UTC/);
	assert.equal(formatWhen(null, 'UTC'), 'n/a');
	assert.equal(formatWhen('not-a-date', 'UTC'), 'n/a');
	assert.equal(formatWhen(iso, 'Not/AZone'), formatWhen(iso));
});

test('formatWhen without a zone uses the runtime zone', () => {
	const iso = '2026-10-10T17:44:46.000Z';
	const local = new Intl.DateTimeFormat('en-NZ', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23',
		timeZoneName: 'short'
	}).format(new Date(iso));
	assert.equal(formatWhen(iso), local);
});

test('formatTick uses the clock for a short span and the date for a long one', () => {
	const iso = '2026-10-10T17:44:46.000Z';
	assert.match(formatTick(iso, 60 * 60 * 1000, 'Pacific/Auckland'), /06:44/);
	assert.match(formatTick(iso, 7 * 24 * 60 * 60 * 1000, 'Pacific/Auckland'), /11/);
	assert.match(formatTick(iso, 60 * 60 * 1000, 'UTC'), /17:44/);
	assert.equal(formatTick('nope', 1000, 'UTC'), '');
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

test('formatLatency and formatProcessMemory', () => {
	assert.equal(formatLatency(null), 'n/a');
	assert.equal(formatLatency(Number.NaN), 'n/a');
	assert.equal(formatLatency(-1), 'n/a');
	assert.equal(formatLatency(0), '0.0 ms');
	assert.equal(formatLatency(9.94), '9.9 ms');
	assert.equal(formatLatency(10), '10 ms');
	assert.equal(formatLatency(10.6), '11 ms');
	assert.equal(formatProcessMemory(null, null), 'n/a');
	assert.equal(formatProcessMemory(120 * 1024 * 1024, 4.2), '120 MB (4.2%)');
	assert.equal(formatProcessMemory(null, 4.2), '4.2%');
	assert.equal(formatProcessMemory(1024, null), '1 KB');
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
