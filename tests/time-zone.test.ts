import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render } from 'svelte/server';
import { formatWhen } from '../src/lib/format.ts';
import LocalTime from '../src/lib/components/LocalTime.svelte';
import {
	parseTimeZone,
	systemTimeZone,
	TIME_ZONE_COOKIE,
	TIME_ZONE_MAX_AGE,
	timeZoneCookie
} from '../src/lib/time-zone.ts';

test('parseTimeZone keeps a real IANA name and drops anything else', () => {
	assert.equal(parseTimeZone('Pacific/Auckland'), 'Pacific/Auckland');
	assert.equal(parseTimeZone('UTC'), 'UTC');
	assert.equal(parseTimeZone('America/North_Dakota/New_Salem'), 'America/North_Dakota/New_Salem');
	assert.equal(parseTimeZone(null), null);
	assert.equal(parseTimeZone(''), null);
	assert.equal(parseTimeZone('Not/AZone'), null);
	assert.equal(parseTimeZone('Pacific/Auckland/Extra/No'), null);
	assert.equal(parseTimeZone('Pacific/Auckland<script>'), null);
	assert.equal(parseTimeZone(`Pacific/${'A'.repeat(40)}`), null);
	assert.equal(parseTimeZone(systemTimeZone()), systemTimeZone());
});

test('timeZoneCookie is readable by script and does not echo a raw zone into the name', () => {
	const cookie = timeZoneCookie('Pacific/Auckland', false);
	assert.equal(
		cookie,
		`${TIME_ZONE_COOKIE}=Pacific%2FAuckland; Path=/; Max-Age=${TIME_ZONE_MAX_AGE}; SameSite=Lax`
	);
	assert.equal(cookie.includes('HttpOnly'), false);
	assert.equal(timeZoneCookie('UTC', true).endsWith('; Secure'), true);
});

test('LocalTime renders the runtime zone and leaves a missing instant as n/a', () => {
	const iso = '2026-10-10T17:44:46.000Z';
	const html = render(LocalTime, { props: { iso } }).body;
	assert.equal(html.includes(`datetime="${iso}"`), true);
	assert.equal(html.includes(formatWhen(iso)), true);
	const missing = render(LocalTime, { props: { iso: null } }).body;
	assert.equal(missing.includes('n/a'), true);
	assert.equal(missing.includes('<time'), false);
});
