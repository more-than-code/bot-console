/** Sort, search, and paging over rows a page has already loaded. */

import { SEARCH_MAX } from './table-query';

export const DEFAULT_PAGE_SIZE = 25;

export type SortDir = 'asc' | 'desc';

export type Column<Row> = {
	key: string;
	label: string;
	numeric?: boolean;
	sortable?: boolean;
	searchable?: boolean;
	/** Sort value. Also the search text unless `searchValue` is set. Null sorts last. */
	value?: (row: Row) => string | number | null;
	/** Search text when it differs from the sort value. Null is skipped. */
	searchValue?: (row: Row) => string | number | null;
	/** Keep the label available to assistive tech without showing it. */
	srLabel?: boolean;
	/** Direction the first time this column is chosen. Default ascending. */
	firstDir?: SortDir;
};

export type TableQuery = {
	q: string;
	sort: string | null;
	dir: SortDir;
	page: number;
};

export type PageWindow<Row> = {
	rows: Row[];
	page: number;
	pages: number;
	from: number;
	to: number;
	total: number;
};

const PAGE_NUMBER = /^[1-9][0-9]*$/;

export function tableParam(id: string, key: 'q' | 'sort' | 'dir' | 'page' | 'host' | 'cursor' | 'edit'): string {
	return `${id}.${key}`;
}

function sortable<Row>(columns: readonly Column<Row>[], key: string | null): key is string {
	return key != null && columns.some((column) => column.sortable === true && column.key === key);
}

/** Blank, NUL, and over-long searches become the default (no search). */
export function readSearch(raw: string | null): string {
	if (raw == null) return '';
	const trimmed = raw.trim();
	if (trimmed === '' || trimmed.includes('\0') || trimmed.length > SEARCH_MAX) return '';
	return trimmed;
}

function readPage(raw: string | null): number {
	if (raw == null || raw === '' || !PAGE_NUMBER.test(raw)) return 1;
	const value = Number(raw);
	return Number.isSafeInteger(value) ? value : 1;
}

/**
 * Namespaced params only: `<id>.q`, `<id>.sort`, `<id>.dir`, `<id>.page`.
 * A missing or unknown sort uses the default. A bad direction or page does too.
 * A bad sort also resets direction, so one bad param cannot half-apply.
 */
export function readTableQuery<Row>(
	search: URLSearchParams,
	id: string,
	columns: readonly Column<Row>[],
	defaults: { sort: string | null; dir: SortDir }
): TableQuery {
	const fallback = sortable(columns, defaults.sort) ? defaults.sort : null;
	const rawSort = search.get(tableParam(id, 'sort'));
	const rawDir = search.get(tableParam(id, 'dir'));
	const dirIsValid = rawDir === 'asc' || rawDir === 'desc';
	const sortMissing = rawSort == null || rawSort === '';
	const sortValid = sortable(columns, rawSort);
	let sort = fallback;
	let dir = defaults.dir;
	if (sortMissing) {
		sort = fallback;
		dir = dirIsValid ? rawDir : defaults.dir;
	} else if (sortValid) {
		sort = rawSort;
		dir = dirIsValid ? rawDir : defaults.dir;
	}
	return {
		q: readSearch(search.get(tableParam(id, 'q'))),
		sort,
		dir,
		page: readPage(search.get(tableParam(id, 'page')))
	};
}

function asCell(value: string | number | null | undefined, numeric: boolean): string | number | null {
	if (value == null) return null;
	if (!numeric) return String(value);
	const number = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(number) ? number : null;
}

/** Nulls sort last in both directions. Ties return 0 so the caller can keep input order. */
export function compareCells(
	left: string | number | null | undefined,
	right: string | number | null | undefined,
	dir: SortDir,
	numeric: boolean
): number {
	const a = asCell(left, numeric);
	const b = asCell(right, numeric);
	if (a == null && b == null) return 0;
	if (a == null) return 1;
	if (b == null) return -1;
	let order = 0;
	if (typeof a === 'number' && typeof b === 'number') order = a - b;
	else {
		const textA = String(a).toLowerCase();
		const textB = String(b).toLowerCase();
		order = textA < textB ? -1 : textA > textB ? 1 : 0;
	}
	return dir === 'asc' ? order : -order;
}

/** Stable: equal values keep their original order in both directions. */
export function sortRows<Row>(
	rows: readonly Row[],
	columns: readonly Column<Row>[],
	sort: string | null,
	dir: SortDir
): Row[] {
	const column = columns.find((item) => item.key === sort && item.sortable && item.value);
	if (!column?.value) return [...rows];
	const valueOf = column.value;
	const numeric = column.numeric === true;
	return rows
		.map((row, index) => ({ row, index }))
		.sort((left, right) => {
			const order = compareCells(valueOf(left.row), valueOf(right.row), dir, numeric);
			return order === 0 ? left.index - right.index : order;
		})
		.map((item) => item.row);
}

/** Case-insensitive substring over searchable columns. An empty query returns every row. */
export function searchRows<Row>(rows: readonly Row[], columns: readonly Column<Row>[], q: string): Row[] {
	const needle = q.trim().toLowerCase();
	if (needle === '') return [...rows];
	const fields = columns.filter((column) => column.searchable && (column.searchValue ?? column.value));
	return rows.filter((row) =>
		fields.some((column) => {
			const read = column.searchValue ?? column.value;
			const value = read?.(row);
			return value != null && String(value).toLowerCase().includes(needle);
		})
	);
}

/** Page numbers past the end clamp to the last page. An empty list is page 1. */
export function pageRows<Row>(rows: readonly Row[], page: number, pageSize: number): PageWindow<Row> {
	const total = rows.length;
	const pages = Math.max(1, Math.ceil(total / pageSize));
	const current = Math.min(Math.max(page, 1), pages);
	const start = (current - 1) * pageSize;
	const slice = rows.slice(start, start + pageSize);
	return {
		rows: slice,
		page: current,
		pages,
		from: total === 0 ? 0 : start + 1,
		to: total === 0 ? 0 : start + slice.length,
		total
	};
}

export function applyTable<Row>(
	rows: readonly Row[],
	columns: readonly Column<Row>[],
	query: TableQuery,
	pageSize: number
): PageWindow<Row> {
	const searched = searchRows(rows, columns, query.q);
	const sorted = sortRows(searched, columns, query.sort, query.dir);
	return pageRows(sorted, query.page, pageSize);
}

/** A search, or more rows than one page, needs the pager. */
export function pagerVisible(total: number, pageSize: number, q: string): boolean {
	return q !== '' || total > pageSize;
}

/**
 * Same-page link. A null patch value deletes that namespaced param.
 * Page 1 is omitted. Params for other tables are left alone.
 */
export function tableHref(
	url: URL,
	id: string,
	patch: Partial<{ q: string | null; sort: string | null; dir: SortDir | null; page: number | null }>
): string {
	const params = new URLSearchParams(url.searchParams);
	const write = (key: 'q' | 'sort' | 'dir' | 'page', value: string | number | null | undefined) => {
		const name = tableParam(id, key);
		if (value == null || value === '' || (key === 'page' && (value === 1 || value === '1'))) params.delete(name);
		else params.set(name, String(value));
	};
	if ('q' in patch) write('q', patch.q);
	if ('sort' in patch) write('sort', patch.sort);
	if ('dir' in patch) write('dir', patch.dir);
	if ('page' in patch) write('page', patch.page);
	const qs = params.toString();
	return qs ? `${url.pathname}?${qs}` : url.pathname;
}

/**
 * First click uses the column's `firstDir` (ascending when omitted).
 * Clicking the active column toggles. The page param is cleared.
 */
export function sortHref(
	url: URL,
	id: string,
	column: { key: string; firstDir?: SortDir },
	query: { sort: string | null; dir: SortDir }
): string {
	const opening: SortDir = column.firstDir === 'desc' ? 'desc' : 'asc';
	const dir: SortDir = query.sort === column.key ? (query.dir === 'asc' ? 'desc' : 'asc') : opening;
	return tableHref(url, id, { sort: column.key, dir, page: null });
}

/** Search keeps the other params, including this table's sort and direction, and drops its q and page. */
export function searchHiddenFields(
	search: URLSearchParams,
	id: string
): Array<{ name: string; value: string }> {
	const skip = new Set([tableParam(id, 'q'), tableParam(id, 'page')]);
	const fields: Array<{ name: string; value: string }> = [];
	for (const [name, value] of search) {
		if (!skip.has(name)) fields.push({ name, value });
	}
	return fields;
}

/** `aria-sort` for one header. Unsortable columns do not set it. */
export function ariaSort(
	column: { key: string; sortable?: boolean },
	query: { sort: string | null; dir: SortDir }
): 'ascending' | 'descending' | 'none' | undefined {
	if (!column.sortable) return undefined;
	if (query.sort !== column.key) return 'none';
	return query.dir === 'asc' ? 'ascending' : 'descending';
}

/** API `q` cap for the project services list. Longer searches are refused before the call. */
export const SERVER_SEARCH_MAX = 100;

/** Opaque cursors longer than this are dropped. The project list uses the same cap. */
export const SERVER_CURSOR_MAX = 512;

const SERVER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SERVER_CONTROL = /[\u0000-\u001F\u007F]/;

export type ServerTableQuery = {
	q: string;
	sort: string;
	dir: SortDir;
	host: string | null;
	cursor: string | null;
	/**
	 * Trimmed `q` is longer than the API allows, or it contains NUL.
	 * The caller must not send it and must not treat it as an empty search.
	 */
	qTooLong: boolean;
	/** A non-empty host value was present and was not a UUID. */
	hostRejected: boolean;
	/** A cursor was present and rejected (too long or a control character). */
	cursorDropped: boolean;
};

export type ServerTable = {
	total: number;
	prevCursor: string | null;
	nextCursor: string | null;
};

function readServerCursor(raw: string | null): { cursor: string | null; dropped: boolean } {
	if (raw == null || raw === '') return { cursor: null, dropped: false };
	if (raw.length > SERVER_CURSOR_MAX || SERVER_CONTROL.test(raw)) return { cursor: null, dropped: true };
	return { cursor: raw, dropped: false };
}

/**
 * Namespaced server-table params: `<id>.q`, `<id>.sort`, `<id>.dir`, `<id>.host`, `<id>.cursor`.
 * An unknown sort falls back to the default and drops a paired direction.
 * A column's `firstDir` applies when that column is selected and `dir` is absent.
 * A non-empty host that is not a UUID sets `hostRejected` and is not a host id.
 * A bad cursor is dropped and `cursorDropped` is set.
 * `q` is judged on the raw trimmed value, before `readSearch` can blank NUL or a value over its own cap.
 */
export function readServerTableQuery<Row>(
	search: URLSearchParams,
	id: string,
	columns: readonly Column<Row>[],
	defaults: { sort: string; dir: SortDir }
): ServerTableQuery {
	const sortableKey = (key: string | null): key is string =>
		key != null && columns.some((column) => column.sortable === true && column.key === key);
	const fallback = sortableKey(defaults.sort) ? defaults.sort : (columns.find((column) => column.sortable)?.key ?? defaults.sort);
	const rawSort = search.get(tableParam(id, 'sort'));
	const rawDir = search.get(tableParam(id, 'dir'));
	const dirIsValid = rawDir === 'asc' || rawDir === 'desc';
	const sortMissing = rawSort == null || rawSort === '';
	let sort = fallback;
	let dir = defaults.dir;
	if (!sortMissing && sortableKey(rawSort)) {
		sort = rawSort;
		const column = columns.find((item) => item.key === sort);
		dir = dirIsValid ? rawDir : (column?.firstDir ?? defaults.dir);
	} else if (sortMissing && dirIsValid) {
		dir = rawDir;
	}
	const rawQ = search.get(tableParam(id, 'q'));
	const trimmedQ = rawQ == null ? '' : rawQ.trim();
	const qTooLong = trimmedQ.includes('\0') || trimmedQ.length > SERVER_SEARCH_MAX;
	const q = qTooLong ? '' : readSearch(rawQ);
	const hostRaw = search.get(tableParam(id, 'host'))?.trim() ?? '';
	const hostIsUuid = SERVER_UUID.test(hostRaw);
	const cursor = readServerCursor(search.get(tableParam(id, 'cursor')));
	return {
		q,
		sort,
		dir,
		host: hostIsUuid ? hostRaw : null,
		cursor: cursor.cursor,
		qTooLong,
		hostRejected: hostRaw !== '' && !hostIsUuid,
		cursorDropped: cursor.dropped
	};
}

/** Query string for the project services API. `q` over the cap is omitted. */
export function serverApiParams(query: ServerTableQuery, limit = DEFAULT_PAGE_SIZE): URLSearchParams {
	const params = new URLSearchParams();
	if (query.q && !query.qTooLong) params.set('q', query.q);
	if (query.host) params.set('host_id', query.host);
	params.set('sort', query.sort);
	params.set('dir', query.dir);
	params.set('limit', String(limit));
	if (query.cursor) params.set('cursor', query.cursor);
	return params;
}

/**
 * Same-page link for a server table.
 * A patch that sets search, sort, direction, or host drops the cursor (and any client page).
 * A cursor-only patch keeps the other params.
 */
export function serverTableHref(
	url: URL,
	id: string,
	patch: Partial<{ q: string | null; sort: string | null; dir: SortDir | null; host: string | null; cursor: string | null }>
): string {
	const params = new URLSearchParams(url.searchParams);
	const changesQuery = 'q' in patch || 'sort' in patch || 'dir' in patch || 'host' in patch;
	const write = (key: 'q' | 'sort' | 'dir' | 'host', value: string | null | undefined) => {
		const name = tableParam(id, key);
		if (value == null || value === '') params.delete(name);
		else params.set(name, value);
	};
	if ('q' in patch) write('q', patch.q);
	if ('sort' in patch) write('sort', patch.sort);
	if ('dir' in patch) write('dir', patch.dir);
	if ('host' in patch) write('host', patch.host);
	if (changesQuery) {
		params.delete(tableParam(id, 'cursor'));
		params.delete(tableParam(id, 'page'));
	} else if ('cursor' in patch) {
		const name = tableParam(id, 'cursor');
		if (patch.cursor == null || patch.cursor === '') params.delete(name);
		else params.set(name, patch.cursor);
	}
	const qs = params.toString();
	return qs ? `${url.pathname}?${qs}` : url.pathname;
}

/** First click uses `firstDir`. The active column toggles. The cursor is dropped. */
export function serverSortHref(
	url: URL,
	id: string,
	column: { key: string; firstDir?: SortDir },
	query: { sort: string | null; dir: SortDir }
): string {
	const opening: SortDir = column.firstDir === 'desc' ? 'desc' : 'asc';
	const dir: SortDir = query.sort === column.key ? (query.dir === 'asc' ? 'desc' : 'asc') : opening;
	return serverTableHref(url, id, { sort: column.key, dir });
}

/** Search keeps sort, direction, and host, and drops `q`, the cursor, and the client page. */
export function serverSearchHiddenFields(search: URLSearchParams, id: string): Array<{ name: string; value: string }> {
	const skip = new Set([tableParam(id, 'q'), tableParam(id, 'cursor'), tableParam(id, 'page')]);
	const fields: Array<{ name: string; value: string }> = [];
	for (const [name, value] of search) {
		if (!skip.has(name)) fields.push({ name, value });
	}
	return fields;
}

/** Host filter keeps the other params and drops the host, the cursor, and the client page. */
export function serverHostHiddenFields(search: URLSearchParams, id: string): Array<{ name: string; value: string }> {
	const skip = new Set([tableParam(id, 'host'), tableParam(id, 'cursor'), tableParam(id, 'page')]);
	const fields: Array<{ name: string; value: string }> = [];
	for (const [name, value] of search) {
		if (!skip.has(name)) fields.push({ name, value });
	}
	return fields;
}

/**
 * Item numbers for one server page.
 * The cursor is opaque, so the start index is known on the first page (no prev cursor)
 * and the last page (no next cursor). A middle page leaves `from` at 0.
 */
export function serverPageBounds(
	total: number,
	count: number,
	prevCursor: string | null,
	nextCursor: string | null
): { from: number; to: number; total: number } {
	const safeTotal = Number.isSafeInteger(total) && total > 0 ? total : 0;
	const safeCount = Number.isSafeInteger(count) && count > 0 ? Math.min(count, safeTotal) : 0;
	if (safeTotal === 0 || safeCount === 0) return { from: 0, to: 0, total: safeTotal };
	if (prevCursor == null) return { from: 1, to: safeCount, total: safeTotal };
	if (nextCursor == null) {
		const from = Math.max(1, safeTotal - safeCount + 1);
		return { from, to: safeTotal, total: safeTotal };
	}
	return { from: 0, to: safeCount, total: safeTotal };
}

/** `Showing a–b of total`. A middle page, whose offset is unknown, is `Showing n of total`. */
export function serverPagerText(from: number, to: number, total: number): string {
	if (from > 0) return `Showing ${from}\u2013${to} of ${total}`;
	if (to > 0) return `Showing ${to} of ${total}`;
	return `Showing 0\u2013${0} of ${total}`;
}

/** A search, another page, or more rows than this response needs the pager. */
export function serverPagerVisible(
	total: number,
	count: number,
	q: string,
	prevCursor: string | null,
	nextCursor: string | null
): boolean {
	if (total <= 0) return false;
	return q !== '' || prevCursor != null || nextCursor != null || total > count;
}
