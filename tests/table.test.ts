import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withQuery } from '../src/lib/table-href.ts';
import { compareValues, slicePage } from '../src/lib/table-query.ts';
import {
	applyTable,
	ariaSort,
	compareCells,
	pageRows,
	pagerVisible,
	readTableQuery,
	searchHiddenFields,
	searchRows,
	sortHref,
	sortRows,
	tableHref,
	type Column
} from '../src/lib/table.ts';

test('compareValues keeps nulls last in both directions', () => {
	assert.equal(compareValues(1, null, 'asc'), -1);
	assert.equal(compareValues(null, 1, 'desc'), 1);
	assert.equal(compareValues(1, 2, 'desc'), 1);
	assert.equal(compareValues('b', 'A', 'asc'), 1);
});

test('slicePage returns the requested window and an empty page past the end', () => {
	assert.deepEqual(slicePage(['a', 'b', 'c'], null, null), ['a', 'b', 'c']);
	assert.deepEqual(slicePage(['a', 'b', 'c'], 2, 2), ['c']);
	assert.deepEqual(slicePage(['a', 'b', 'c'], 4, 2), []);
});

test('withQuery omits empty values and keeps a stable key order', () => {
	assert.equal(withQuery('/services', { host: null, q: null }), '/services');
	assert.equal(
		withQuery('/processes', { page: '2', host: 'pi1', q: 'node' }, { page: null }),
		'/processes?host=pi1&q=node'
	);
});

type Sample = { name: string; n: number | null; note: string };

const columns: Column<Sample>[] = [
	{ key: 'name', label: 'Name', sortable: true, searchable: true, value: (row) => row.name },
	{ key: 'n', label: 'N', numeric: true, sortable: true, searchable: true, value: (row) => row.n },
	{ key: 'note', label: 'Note', value: (row) => row.note }
];

const rows: Sample[] = [
	{ name: 'b', n: 10, note: 'hidden' },
	{ name: 'A', n: 2, note: 'skip' },
	{ name: 'a', n: 2, note: 'also' },
	{ name: 'c', n: null, note: 'tail' }
];

test('sort is ascending or descending, numeric or text, and stable on ties', () => {
	assert.deepEqual(
		sortRows(rows, columns, 'name', 'asc').map((row) => row.name),
		['A', 'a', 'b', 'c']
	);
	assert.deepEqual(
		sortRows(rows, columns, 'name', 'desc').map((row) => row.name),
		['c', 'b', 'A', 'a']
	);
	assert.deepEqual(
		sortRows(rows, columns, 'n', 'asc').map((row) => row.name),
		['A', 'a', 'b', 'c']
	);
	assert.deepEqual(
		sortRows(rows, columns, 'n', 'desc').map((row) => row.n),
		[10, 2, 2, null]
	);
	const textOrder = sortRows(
		[
			{ name: '10', n: 0, note: '' },
			{ name: '2', n: 0, note: '' },
			{ name: '1', n: 0, note: '' }
		],
		columns,
		'name',
		'asc'
	).map((row) => row.name);
	assert.deepEqual(textOrder, ['1', '10', '2']);
	assert.equal(compareCells(10, 2, 'asc', true), 8);
	assert.equal(compareCells('10', '2', 'asc', false), -1);
	const tied: Array<{ id: string; name: string }> = [
		{ id: 'a', name: 'same' },
		{ id: 'b', name: 'same' },
		{ id: 'c', name: 'same' }
	];
	const tieColumns: Column<{ id: string; name: string }>[] = [
		{ key: 'name', label: 'Name', sortable: true, value: (row) => row.name }
	];
	assert.deepEqual(
		sortRows(tied, tieColumns, 'name', 'asc').map((row) => row.id),
		['a', 'b', 'c']
	);
	assert.deepEqual(
		sortRows(tied, tieColumns, 'name', 'desc').map((row) => row.id),
		['a', 'b', 'c']
	);
});

test('search is a case-insensitive substring of searchable columns only', () => {
	assert.deepEqual(
		searchRows(rows, columns, 'A').map((row) => row.name),
		['A', 'a']
	);
	assert.equal(searchRows(rows, columns, 'hidden').length, 0);
	assert.equal(searchRows(rows, columns, '  ').length, rows.length);
	assert.deepEqual(
		searchRows(rows, columns, '10').map((row) => row.name),
		['b']
	);
});

test('paging clamps a page past the end to the last page', () => {
	const paged = pageRows(['a', 'b', 'c', 'd', 'e'], 2, 2);
	assert.deepEqual(paged.rows, ['c', 'd']);
	assert.equal(paged.from, 3);
	assert.equal(paged.to, 4);
	assert.equal(paged.total, 5);
	assert.equal(paged.page, 2);
	const last = pageRows(['a', 'b', 'c', 'd', 'e'], 9, 2);
	assert.equal(last.page, 3);
	assert.deepEqual(last.rows, ['e']);
	assert.equal(last.from, 5);
	assert.equal(last.to, 5);
	assert.deepEqual(pageRows([], 4, 25).rows, []);
	assert.equal(pageRows([], 4, 25).page, 1);
	assert.equal(pagerVisible(25, 25, ''), false);
	assert.equal(pagerVisible(26, 25, ''), true);
	assert.equal(pagerVisible(3, 25, 'node'), true);
});

test('an unknown sort resets direction even when dir is valid', () => {
	const search = new URLSearchParams('services.sort=nope&services.dir=desc');
	const query = readTableQuery(search, 'services', columns, { sort: 'name', dir: 'asc' });
	assert.deepEqual(query, { q: '', sort: 'name', dir: 'asc', page: 1 });
	const kept = readTableQuery(new URLSearchParams('services.dir=desc'), 'services', columns, {
		sort: 'name',
		dir: 'asc'
	});
	assert.equal(kept.sort, 'name');
	assert.equal(kept.dir, 'desc');
});

test('bad table params fall back to defaults and namespaced params do not collide', () => {
	const search = new URLSearchParams(
		'hosts.q=pi&hosts.sort=name&services.q=%00&services.sort=nope&services.dir=sideways&services.page=0'
	);
	const services = readTableQuery(search, 'services', columns, { sort: 'name', dir: 'asc' });
	assert.deepEqual(services, { q: '', sort: 'name', dir: 'asc', page: 1 });
	const hosts = readTableQuery(search, 'hosts', columns, { sort: 'n', dir: 'desc' });
	assert.equal(hosts.q, 'pi');
	assert.equal(hosts.sort, 'name');
	assert.equal(hosts.dir, 'desc');
	const missing = readTableQuery(new URLSearchParams(), 'services', columns, { sort: 'n', dir: 'desc' });
	assert.deepEqual(missing, { q: '', sort: 'n', dir: 'desc', page: 1 });
	const long = 'x'.repeat(201);
	const tooLong = readTableQuery(new URLSearchParams(`services.q=${long}`), 'services', columns, {
		sort: 'name',
		dir: 'asc'
	});
	assert.equal(tooLong.q, '');
	const view = applyTable(rows, columns, { q: 'a', sort: 'n', dir: 'asc', page: 9 }, 1);
	assert.equal(view.page, 2);
	assert.deepEqual(
		view.rows.map((row) => row.name),
		['a']
	);
});

test('table links change only the named table params', () => {
	const url = new URL('http://console.example/hosts/1?tab=processes&range=1h&processes.q=node&processes.page=3&services.q=api');
	assert.equal(
		tableHref(url, 'processes', { sort: 'cpu', dir: 'desc', page: null }),
		'/hosts/1?tab=processes&range=1h&processes.q=node&services.q=api&processes.sort=cpu&processes.dir=desc'
	);
	assert.equal(tableHref(url, 'processes', { page: 1 }).includes('processes.page'), false);
});

test('sort links toggle the active column and clear the page', () => {
	const url = new URL(
		'http://console.example/hosts/1?tab=services&services.q=api&services.sort=name&services.dir=asc&services.page=3&hosts.q=pi'
	);
	const query = { sort: 'name', dir: 'asc' as const };
	assert.equal(
		sortHref(url, 'services', { key: 'name' }, query),
		'/hosts/1?tab=services&services.q=api&services.sort=name&services.dir=desc&hosts.q=pi'
	);
	assert.equal(
		sortHref(url, 'services', { key: 'ports' }, query),
		'/hosts/1?tab=services&services.q=api&services.sort=ports&services.dir=asc&hosts.q=pi'
	);
	assert.equal(
		sortHref(url, 'services', { key: 'name' }, { sort: 'name', dir: 'desc' }),
		'/hosts/1?tab=services&services.q=api&services.sort=name&services.dir=asc&hosts.q=pi'
	);
});

test('a column opens in firstDir and then toggles', () => {
	const url = new URL(
		'http://console.example/hosts/1?tab=processes&processes.sort=pid&processes.dir=asc&processes.page=2'
	);
	const query = { sort: 'pid', dir: 'asc' as const };
	assert.equal(
		sortHref(url, 'processes', { key: 'cpu', firstDir: 'desc' }, query),
		'/hosts/1?tab=processes&processes.sort=cpu&processes.dir=desc'
	);
	assert.equal(
		sortHref(url, 'processes', { key: 'user' }, query),
		'/hosts/1?tab=processes&processes.sort=user&processes.dir=asc'
	);
	const active = new URL('http://console.example/hosts/1?tab=processes&processes.sort=cpu&processes.dir=desc&processes.page=4');
	assert.equal(
		sortHref(active, 'processes', { key: 'cpu', firstDir: 'desc' }, { sort: 'cpu', dir: 'desc' }),
		'/hosts/1?tab=processes&processes.sort=cpu&processes.dir=asc'
	);
	assert.equal(
		sortHref(active, 'processes', { key: 'memory', firstDir: 'desc' }, { sort: 'cpu', dir: 'desc' }),
		'/hosts/1?tab=processes&processes.sort=memory&processes.dir=desc'
	);
});

test('the search form keeps sort and direction and drops q and page', () => {
	const search = new URLSearchParams(
		'tab=services&services.q=api&services.sort=ports&services.dir=desc&services.page=2&hosts.q=pi'
	);
	assert.deepEqual(searchHiddenFields(search, 'services'), [
		{ name: 'tab', value: 'services' },
		{ name: 'services.sort', value: 'ports' },
		{ name: 'services.dir', value: 'desc' },
		{ name: 'hosts.q', value: 'pi' }
	]);
});

test('aria-sort is ascending, descending, or none', () => {
	const name = { key: 'name', sortable: true };
	assert.equal(ariaSort(name, { sort: 'name', dir: 'asc' }), 'ascending');
	assert.equal(ariaSort(name, { sort: 'name', dir: 'desc' }), 'descending');
	assert.equal(ariaSort(name, { sort: 'ports', dir: 'asc' }), 'none');
	assert.equal(ariaSort({ key: 'source' }, { sort: 'source', dir: 'asc' }), undefined);
});
