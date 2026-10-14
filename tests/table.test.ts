import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import DataTable from '../src/lib/components/DataTable.svelte';
import { setPageUrl } from './stubs/app-state.ts';
import { withQuery } from '../src/lib/table-href.ts';
import { compareValues, slicePage } from '../src/lib/table-query.ts';
import {
	applyTable,
	ariaSort,
	compareCells,
	pageRows,
	pagerVisible,
	readServerTableQuery,
	readTableQuery,
	searchHiddenFields,
	searchRows,
	serverApiParams,
	serverHostHiddenFields,
	serverPageBounds,
	serverPagerText,
	serverPagerVisible,
	serverSearchHiddenFields,
	serverSortHref,
	serverTableHref,
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

const serverColumns: Column<{ name: string }>[] = [
	{ key: 'name', label: 'Name', sortable: true },
	{ key: 'host', label: 'Host', sortable: true },
	{ key: 'kind', label: 'Kind', sortable: true },
	{ key: 'status', label: 'Status', sortable: true },
	{ key: 'last_seen', label: 'Last seen', sortable: true, firstDir: 'desc' },
	{ key: 'ports', label: 'Ports' }
];

test('server table params map onto the API query', () => {
	const host = '00000000-0000-4000-8000-0000000000aa';
	const full = readServerTableQuery(
		new URLSearchParams(`services.q=api&services.host=${host}&services.sort=status&services.dir=desc&services.cursor=abc`),
		'services',
		serverColumns,
		{ sort: 'name', dir: 'asc' }
	);
	assert.equal(full.qTooLong, false);
	assert.equal(full.hostRejected, false);
	assert.equal(full.cursorDropped, false);
	const params = serverApiParams(full, 25);
	assert.equal(params.get('q'), 'api');
	assert.equal(params.get('host_id'), host);
	assert.equal(params.get('sort'), 'status');
	assert.equal(params.get('dir'), 'desc');
	assert.equal(params.get('limit'), '25');
	assert.equal(params.get('cursor'), 'abc');

	const defaults = serverApiParams(
		readServerTableQuery(new URLSearchParams('tab=services'), 'services', serverColumns, { sort: 'name', dir: 'asc' }),
		25
	);
	assert.equal(defaults.has('q'), false);
	assert.equal(defaults.has('host_id'), false);
	assert.equal(defaults.has('cursor'), false);
	assert.equal(defaults.get('sort'), 'name');
	assert.equal(defaults.get('dir'), 'asc');
	assert.equal(defaults.get('limit'), '25');

	const lastSeen = readServerTableQuery(new URLSearchParams('services.sort=last_seen'), 'services', serverColumns, {
		sort: 'name',
		dir: 'asc'
	});
	assert.equal(lastSeen.sort, 'last_seen');
	assert.equal(lastSeen.dir, 'desc');

	const badSort = readServerTableQuery(
		new URLSearchParams('services.sort=ports&services.dir=desc'),
		'services',
		serverColumns,
		{ sort: 'name', dir: 'asc' }
	);
	assert.equal(badSort.sort, 'name');
	assert.equal(badSort.dir, 'asc');
	assert.equal(serverApiParams(badSort).get('sort'), 'name');

	const badHost = readServerTableQuery(new URLSearchParams('services.host=pi1'), 'services', serverColumns, {
		sort: 'name',
		dir: 'asc'
	});
	assert.equal(badHost.host, null);
	assert.equal(badHost.hostRejected, true);
	assert.equal(serverApiParams(badHost).has('host_id'), false);

	const longCursor = 'c'.repeat(513);
	const badCursor = readServerTableQuery(new URLSearchParams(`services.cursor=${longCursor}`), 'services', serverColumns, {
		sort: 'name',
		dir: 'asc'
	});
	assert.equal(badCursor.cursor, null);
	assert.equal(badCursor.cursorDropped, true);
	const controlCursor = readServerTableQuery(
		new URLSearchParams('services.cursor=bad%07'),
		'services',
		serverColumns,
		{ sort: 'name', dir: 'asc' }
	);
	assert.equal(controlCursor.cursor, null);
	assert.equal(controlCursor.cursorDropped, true);

	const tooLong = readServerTableQuery(new URLSearchParams(`services.q=${'a'.repeat(101)}`), 'services', serverColumns, {
		sort: 'name',
		dir: 'asc'
	});
	assert.equal(tooLong.qTooLong, true);
	assert.equal(tooLong.q, '');
	assert.equal(serverApiParams(tooLong).has('q'), false);

	const pastClientCap = new URLSearchParams();
	pastClientCap.set('services.q', 'a'.repeat(201));
	const huge = readServerTableQuery(pastClientCap, 'services', serverColumns, { sort: 'name', dir: 'asc' });
	assert.equal(huge.qTooLong, true);
	assert.equal(huge.q, '');
	assert.equal(serverApiParams(huge).has('q'), false);

	const padded = new URLSearchParams();
	padded.set('services.q', `  ${'b'.repeat(101)}`);
	const paddedQuery = readServerTableQuery(padded, 'services', serverColumns, { sort: 'name', dir: 'asc' });
	assert.equal(paddedQuery.qTooLong, true);
	assert.equal(serverApiParams(paddedQuery).has('q'), false);

	const nul = new URLSearchParams();
	nul.set('services.q', 'bad\0name');
	const nulQuery = readServerTableQuery(nul, 'services', serverColumns, { sort: 'name', dir: 'asc' });
	assert.equal(nulQuery.qTooLong, true);
	assert.equal(nulQuery.q, '');
	assert.equal(serverApiParams(nulQuery).has('q'), false);

	const exact = readServerTableQuery(new URLSearchParams(`services.q=${'a'.repeat(100)}`), 'services', serverColumns, {
		sort: 'name',
		dir: 'asc'
	});
	assert.equal(exact.qTooLong, false);
	assert.equal(exact.q, 'a'.repeat(100));
	assert.equal(serverApiParams(exact).get('q'), 'a'.repeat(100));
});

test('a server sort, search, or host change drops the cursor', () => {
	const url = new URL(
		'http://console.example/projects/1?tab=services&services.q=api&services.sort=name&services.dir=asc&services.host=00000000-0000-4000-8000-0000000000aa&services.cursor=abc&services.page=2'
	);
	const query = { sort: 'name', dir: 'asc' as const };
	assert.equal(serverSortHref(url, 'services', { key: 'host' }, query).includes('services.cursor'), false);
	assert.equal(serverSortHref(url, 'services', { key: 'host' }, query).includes('services.page'), false);
	assert.equal(serverTableHref(url, 'services', { q: 'web' }).includes('services.cursor'), false);
	assert.equal(serverTableHref(url, 'services', { host: null }).includes('services.cursor'), false);
	const next = serverTableHref(url, 'services', { cursor: 'next' });
	assert.equal(new URL(next, url.origin).searchParams.get('services.cursor'), 'next');
	assert.equal(new URL(next, url.origin).searchParams.get('services.q'), 'api');
	assert.equal(new URL(next, url.origin).searchParams.get('services.sort'), 'name');
	assert.equal(
		serverSortHref(url, 'services', { key: 'last_seen', firstDir: 'desc' }, query).includes('services.dir=desc'),
		true
	);

	const search = new URLSearchParams(url.search);
	assert.deepEqual(
		serverSearchHiddenFields(search, 'services').map((field) => field.name),
		['tab', 'services.sort', 'services.dir', 'services.host']
	);
	assert.deepEqual(
		serverHostHiddenFields(search, 'services').map((field) => field.name),
		['tab', 'services.q', 'services.sort', 'services.dir']
	);
});

test('server pager text uses the cursors it can see', () => {
	assert.deepEqual(serverPageBounds(40, 25, null, 'next'), { from: 1, to: 25, total: 40 });
	assert.equal(serverPagerText(1, 25, 40), 'Showing 1\u201325 of 40');
	assert.deepEqual(serverPageBounds(40, 15, 'prev', null), { from: 26, to: 40, total: 40 });
	assert.equal(serverPagerText(26, 40, 40), 'Showing 26\u201340 of 40');
	assert.deepEqual(serverPageBounds(80, 25, 'prev', 'next'), { from: 0, to: 25, total: 80 });
	assert.equal(serverPagerText(0, 25, 80), 'Showing 25 of 80');
	assert.equal(serverPagerVisible(2, 2, '', null, null), false);
	assert.equal(serverPagerVisible(40, 2, '', null, 'next'), true);
	assert.equal(serverPagerVisible(40, 2, '', 'prev', null), true);
	assert.equal(serverPagerVisible(25, 25, 'api', null, null), true);
	assert.equal(serverPagerVisible(0, 0, '', null, null), false);
});

test('a server-mode data table keeps the given row order and pages with cursors', () => {
	type Item = { id: string; name: string };
	const columns: Column<Item>[] = [
		{ key: 'name', label: 'Name', sortable: true, value: (item) => item.name }
	];
	const row = createRawSnippet<[Item]>((item) => ({
		render: () => `<tr><td>${item().name}</td></tr>`
	}));
	const rows: Item[] = [
		{ id: 'b', name: 'beta' },
		{ id: 'a', name: 'alpha' }
	];
	setPageUrl('http://console.example/projects/1?tab=services');
	const both = render(DataTable, {
		props: {
			rows,
			columns,
			id: 'services',
			labelledBy: 'services-heading',
			empty: 'No services reported.',
			row,
			server: { total: 40, prevCursor: 'prev-token', nextCursor: 'next-token' }
		}
	} as never).body.replaceAll('&amp;', '&');
	assert.ok(both.indexOf('>beta<') < both.indexOf('>alpha<'));
	assert.equal(both.includes('/projects/1?tab=services&services.cursor=prev-token'), true);
	assert.equal(both.includes('/projects/1?tab=services&services.cursor=next-token'), true);
	assert.match(both, /class="pager"/);

	const first = render(DataTable, {
		props: {
			rows,
			columns,
			id: 'services',
			labelledBy: 'services-heading',
			empty: 'No services reported.',
			row,
			server: { total: 40, prevCursor: null, nextCursor: 'next-token' }
		}
	} as never).body.replaceAll('&amp;', '&');
	assert.equal(first.includes('Showing 1\u20132 of 40'), true);
	assert.equal(first.includes('/projects/1?tab=services&services.cursor=next-token'), true);

	const onePage = render(DataTable, {
		props: {
			rows,
			columns,
			id: 'services',
			labelledBy: 'services-heading',
			empty: 'No services reported.',
			row,
			server: { total: 2, prevCursor: null, nextCursor: null }
		}
	} as never).body;
	assert.equal(onePage.includes('class="pager"'), false);
});

test('a client-mode data table sorts and pages the rows it was given', () => {
	type Item = { id: string; name: string };
	const columns: Column<Item>[] = [
		{ key: 'name', label: 'Name', sortable: true, value: (item) => item.name }
	];
	const row = createRawSnippet<[Item]>((item) => ({
		render: () => `<tr><td>${item().name}</td></tr>`
	}));
	const rows: Item[] = [
		{ id: 'g', name: 'gamma' },
		{ id: 'a', name: 'alpha' },
		{ id: 'b', name: 'beta' }
	];
	const props = {
		rows,
		columns,
		id: 'roster',
		pageSize: 1,
		labelledBy: 'roster-heading',
		empty: 'None.',
		row
	};
	setPageUrl('http://console.example/projects/1?roster.sort=name&roster.dir=asc');
	const first = render(DataTable, { props } as never).body.replaceAll('&amp;', '&');
	assert.equal(first.includes('>alpha<'), true);
	assert.equal(first.includes('>beta<'), false);
	assert.equal(first.includes('>gamma<'), false);
	assert.equal(first.includes('Showing 1\u20131 of 3'), true);
	assert.equal(first.includes('roster.page=2'), true);

	setPageUrl('http://console.example/projects/1?roster.sort=name&roster.dir=asc&roster.page=2');
	const second = render(DataTable, { props } as never).body.replaceAll('&amp;', '&');
	assert.equal(second.includes('>beta<'), true);
	assert.equal(second.includes('>alpha<'), false);
	assert.equal(second.includes('>gamma<'), false);
	assert.equal(second.includes('Showing 2\u20132 of 3'), true);
});

test('aria-sort is ascending, descending, or none', () => {
	const name = { key: 'name', sortable: true };
	assert.equal(ariaSort(name, { sort: 'name', dir: 'asc' }), 'ascending');
	assert.equal(ariaSort(name, { sort: 'name', dir: 'desc' }), 'descending');
	assert.equal(ariaSort(name, { sort: 'ports', dir: 'asc' }), 'none');
	assert.equal(ariaSort({ key: 'source' }, { sort: 'source', dir: 'asc' }), undefined);
});
