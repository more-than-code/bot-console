import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render } from 'svelte/server';
import type { CatalogEntry } from '../src/lib/api-types.ts';
import { catalogDefaultSort, LAST_DEPLOYED_SORT, lastDeployedValue } from '../src/lib/catalog.ts';
import { formatAgo, formatWhen } from '../src/lib/format.ts';
import { parseCatalogEntry } from '../src/lib/server/shape.ts';
import CatalogSection from '../src/routes/projects/[id]/CatalogSection.svelte';
import { PROJECT, USER } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

const HASH = 'cd'.repeat(32);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const SORTABLE_KEYS = ['name', 'kind', 'command', 'run_as', 'port', LAST_DEPLOYED_SORT];

/** A program entry as the API sends it. `last` is left out when undefined (an older API). */
function raw(id: string, name: string, last?: unknown): Record<string, unknown> {
	const value: Record<string, unknown> = {
		id: `00000000-0000-4000-8000-0000000000${id}`,
		project_id: PROJECT.id,
		name,
		kind: 'program',
		spec_hash: HASH,
		command_display: 'npm run dev',
		created_by: USER.id,
		created_at: '2026-10-14T00:00:00Z',
		updated_at: '2026-10-14T00:00:00Z',
		my_actions: [],
		spec: { dir: '/srv/app', exec: 'npm', args: ['run', 'dev'], shell: false, run_as: 'joe', env: {}, port: 3031, restart: 'on-failure' }
	};
	if (last !== undefined) value.last_deployed_at = last;
	return value;
}

function entry(id: string, name: string, last?: unknown): CatalogEntry {
	const parsed = parseCatalogEntry(raw(id, name, last));
	assert.ok(parsed, `entry ${name} parses`);
	return parsed;
}

function iso(ms: number): string {
	return new Date(ms).toISOString();
}

function decode(html: string): string {
	return html.replaceAll('&amp;', '&').replaceAll('&#39;', "'").replaceAll('&quot;', '"');
}

function section(entries: CatalogEntry[], query = ''): string {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog${query}`);
	return decode(
		render(CatalogSection, {
			props: { canOwner: false, entries, omitted: 0, truncated: false, message: null, hosts: [], members: [] }
		}).body
	);
}

function tbody(html: string): string {
	const start = html.indexOf('<tbody');
	assert.ok(start >= 0, 'table body rendered');
	return html.slice(start, html.indexOf('</tbody>', start));
}

function rowNames(html: string): string[] {
	return [...tbody(html).matchAll(/<tr[^>]*>\s*<td class="p-2 align-middle">([^<]+)<\/td>/g)].map((match) => match[1]);
}

/** Inner HTML of each row's Last deployed cell, in table order. */
function lastCells(html: string): string[] {
	return [...tbody(html).matchAll(/<td [^>]*data-last-deployed[^>]*>([\s\S]*?)<\/td>/g)].map((match) => match[1].replace(/<!--[\s\S]*?-->/g, '').trim());
}

function headers(html: string): Array<[string, string]> {
	return [...html.matchAll(/<th(?=[\s>])([^>]*)>([\s\S]*?)<\/th>/g)].map((match) => [match[1], match[2]]);
}

test('last_deployed_at parses as RFC3339, null, or unknown without rejecting the entry', () => {
	assert.equal(entry('a1', 'alpha', '2026-10-30T01:02:03Z').last_deployed_at, '2026-10-30T01:02:03Z');
	assert.equal(entry('a2', 'bravo', '2026-10-30T09:02:03.123456+08:00').last_deployed_at, '2026-10-30T09:02:03.123456+08:00');
	assert.equal(entry('a3', 'charlie', null).last_deployed_at, null);
	// Older API: no key at all is unknown, which is not the same as null.
	const older = entry('a4', 'delta');
	assert.equal(Object.hasOwn(older, 'last_deployed_at'), false);
	assert.equal(older.last_deployed_at, undefined);
	// Malformed values are unknown too; the entry is kept.
	for (const bad of ['yesterday', '2026-10-30', '2026-10-30 01:02:03Z', '2026-13-45T99:99:99Z', 1793349699, true, {}, '', 'x'.repeat(80)]) {
		const parsed = parseCatalogEntry(raw('a5', 'echo', bad));
		assert.ok(parsed, `kept with ${JSON.stringify(bad)}`);
		assert.equal(Object.hasOwn(parsed, 'last_deployed_at'), false, JSON.stringify(bad));
	}
});

test('formatAgo gives just now, minutes, hours and days, and n/a for nothing', () => {
	const now = Date.parse('2026-10-30T12:00:00Z');
	assert.equal(formatAgo(iso(now), now), 'just now');
	assert.equal(formatAgo(iso(now - 59_000), now), 'just now');
	assert.equal(formatAgo(iso(now + 5 * MINUTE), now), 'just now');
	assert.equal(formatAgo(iso(now - MINUTE), now), '1 min ago');
	assert.equal(formatAgo(iso(now - 59 * MINUTE), now), '59 min ago');
	assert.equal(formatAgo(iso(now - 3 * HOUR - 5 * MINUTE), now), '3 h ago');
	assert.equal(formatAgo(iso(now - 23 * HOUR - 59 * MINUTE), now), '23 h ago');
	assert.equal(formatAgo(iso(now - 24 * HOUR), now), '1 d ago');
	assert.equal(formatAgo(iso(now - 40 * 24 * HOUR), now), '40 d ago');
	assert.equal(formatAgo('2026-10-30T20:00:00+08:00', now), 'just now');
	assert.equal(formatAgo(null, now), 'n/a');
	assert.equal(formatAgo('not a time', now), 'n/a');
});

test('lastDeployedValue sorts across offsets and is null for never or unknown', () => {
	assert.equal(lastDeployedValue({ last_deployed_at: '2026-10-30T09:00:00+08:00' }), '2026-10-30T01:00:00.000Z');
	assert.ok(
		(lastDeployedValue({ last_deployed_at: '2026-10-30T09:00:00+08:00' }) ?? '') <
			(lastDeployedValue({ last_deployed_at: '2026-10-30T02:00:00Z' }) ?? '')
	);
	assert.equal(lastDeployedValue({ last_deployed_at: null }), null);
	assert.equal(lastDeployedValue({}), null);
});

test('catalogDefaultSort: Last deployed newest first, ascending for another explicit column, none on an older API', () => {
	const known = [{ last_deployed_at: null }, {}];
	assert.deepEqual(catalogDefaultSort(known, null, SORTABLE_KEYS), { sort: LAST_DEPLOYED_SORT, dir: 'desc' });
	assert.deepEqual(catalogDefaultSort(known, LAST_DEPLOYED_SORT, SORTABLE_KEYS), { sort: LAST_DEPLOYED_SORT, dir: 'desc' });
	assert.deepEqual(catalogDefaultSort(known, 'bogus', SORTABLE_KEYS), { sort: LAST_DEPLOYED_SORT, dir: 'desc' });
	assert.deepEqual(catalogDefaultSort(known, 'name', SORTABLE_KEYS), { sort: LAST_DEPLOYED_SORT, dir: 'asc' });
	assert.deepEqual(catalogDefaultSort([{}, {}], null, SORTABLE_KEYS), { sort: null, dir: 'asc' });
	assert.deepEqual(catalogDefaultSort([], null, SORTABLE_KEYS), { sort: null, dir: 'asc' });
});

test('the Last deployed column follows Port, is sortable newest first and hidden below sm', () => {
	const html = section([entry('b1', 'alpha', iso(Date.now() - HOUR))]);
	const heads = headers(html);
	assert.match(heads[4][1], /Port/);
	assert.match(heads[5][1], /Last deployed/);
	assert.match(heads[5][0], /(^|\s)max-sm:hidden(\s|"|$)/);
	assert.doesNotMatch(heads[5][0], /text-right/);
	// Default sort is this column, descending.
	assert.match(heads[5][0], /aria-sort="descending"/);
	assert.match(heads[5][1], /aria-label="Sorted by Last deployed"/);
	assert.match(heads[0][0], /aria-sort="none"/);
	// Clicking Name starts ascending; the active Last deployed header toggles to ascending.
	assert.match(heads[0][1], /href="[^"]*catalog\.sort=name&catalog\.dir=asc"/);
	assert.match(heads[5][1], /href="[^"]*catalog\.sort=last_deployed&catalog\.dir=asc"/);
	const byName = headers(section([entry('b1', 'alpha', iso(Date.now() - HOUR))], '&catalog.sort=name&catalog.dir=asc'));
	assert.match(byName[5][1], /href="[^"]*catalog\.sort=last_deployed&catalog\.dir=desc"/);
});

test('cells show relative time with the absolute time as tooltip, Never for null, and a dash when unknown', () => {
	const deployedAt = iso(Date.now() - 3 * HOUR - 10 * MINUTE);
	const html = section([entry('c1', 'alpha', deployedAt), entry('c2', 'bravo', null), entry('c3', 'charlie')]);
	const [deployed, never, unknown] = lastCells(html);
	const when = formatWhen(deployedAt);
	assert.match(deployed, new RegExp(`<time[^>]*datetime="${deployedAt.replaceAll('.', '\\.')}"`));
	assert.ok(deployed.includes(`title="${when}"`), deployed);
	assert.match(deployed, /3 h ago<span class="sr-only">, /);
	assert.ok(deployed.includes(`<span class="sr-only">, ${when}</span>`), deployed);
	assert.equal(never, 'Never');
	assert.match(unknown, /<span aria-hidden="true">—<\/span><span class="sr-only">Unknown<\/span>/);
	assert.match(lastCells(section([entry('c4', 'delta', iso(Date.now()))]))[0], /just now/);
	for (const cell of [...tbody(html).matchAll(/<td ([^>]*data-last-deployed[^>]*)>/g)]) {
		assert.match(cell[1], /max-sm:hidden/);
	}
});

test('default order is newest Last deployed first, never-deployed last in name order', () => {
	const now = Date.now();
	// API order is by name.
	const entries = [
		entry('d1', 'alpha', null),
		entry('d2', 'bravo', iso(now - 2 * HOUR)),
		entry('d3', 'charlie', null),
		entry('d4', 'delta', iso(now - 5 * MINUTE)),
		entry('d5', 'echo', iso(now - 3 * 24 * HOUR)),
		entry('d6', 'foxtrot', null)
	];
	assert.deepEqual(rowNames(section(entries)), ['delta', 'bravo', 'echo', 'alpha', 'charlie', 'foxtrot']);
	// A bad sort param falls back to the same default.
	assert.deepEqual(rowNames(section(entries, '&catalog.sort=bogus')), ['delta', 'bravo', 'echo', 'alpha', 'charlie', 'foxtrot']);
	// Explicit params work as before; nulls stay last both ways.
	assert.deepEqual(rowNames(section(entries, '&catalog.sort=last_deployed&catalog.dir=asc')), [
		'echo',
		'bravo',
		'delta',
		'alpha',
		'charlie',
		'foxtrot'
	]);
	assert.deepEqual(rowNames(section(entries, '&catalog.sort=last_deployed')), ['delta', 'bravo', 'echo', 'alpha', 'charlie', 'foxtrot']);
	assert.deepEqual(rowNames(section(entries, '&catalog.sort=name&catalog.dir=asc')), ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']);
	assert.deepEqual(rowNames(section(entries, '&catalog.sort=name')), ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']);
	assert.deepEqual(rowNames(section(entries, '&catalog.sort=name&catalog.dir=desc')), ['foxtrot', 'echo', 'delta', 'charlie', 'bravo', 'alpha']);
});

test('an older API without the field keeps Name A–Z and shows a dash, with no error', () => {
	const entries = [entry('e1', 'alpha'), entry('e2', 'bravo'), entry('e3', 'charlie')];
	const html = section(entries);
	assert.deepEqual(rowNames(html), ['alpha', 'bravo', 'charlie']);
	assert.deepEqual(
		lastCells(html).map((cell) => cell.replace(/<[^>]+>/g, '')),
		['—Unknown', '—Unknown', '—Unknown']
	);
	const heads = headers(html);
	for (const [attrs] of heads.slice(0, 6)) assert.match(attrs, /aria-sort="none"/);
	assert.deepEqual(rowNames(section(entries, '&catalog.sort=name&catalog.dir=desc')), ['charlie', 'bravo', 'alpha']);
});
