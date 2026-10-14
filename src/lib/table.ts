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

export function tableParam(id: string, key: 'q' | 'sort' | 'dir' | 'page'): string {
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
