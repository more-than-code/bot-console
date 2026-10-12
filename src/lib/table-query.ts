/** Shared paging, sort direction, and search limits for console tables. */

export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 100;
export const PAGE_MAX = 10_000;
export const SEARCH_MAX = 200;
export const SEARCH_DEBOUNCE_MS = 300;

export const SERVICE_SORTS = [
	'name',
	'status',
	'host',
	'port',
	'unit',
	'http',
	'lastCheck',
	'latency',
	'cpu',
	'memory'
] as const;

export type ServiceSort = (typeof SERVICE_SORTS)[number];

export const PROCESS_SORTS = [
	'host',
	'process',
	'pid',
	'user',
	'threads',
	'cpu',
	'memory',
	'uptime',
	'sampledAt'
] as const;

export type ProcessSort = (typeof PROCESS_SORTS)[number];

export type SortDir = 'asc' | 'desc';

const POSITIVE = /^[1-9][0-9]*$/;

export type ParseFail = { ok: false; message: string };

function fail(message: string): ParseFail {
	return { ok: false, message };
}

/** Blank is "no search". Length is checked after trim. NUL is rejected. */
export function parseSearch(raw: string | null): { ok: true; q: string | null } | ParseFail {
	if (raw == null) return { ok: true, q: null };
	const trimmed = raw.trim();
	if (trimmed === '') return { ok: true, q: null };
	if (trimmed.includes('\0')) return fail('Invalid search');
	if (trimmed.length > SEARCH_MAX) return fail('Search is too long');
	return { ok: true, q: trimmed };
}

/**
 * LIKE/ILIKE pattern for a literal substring. `%`, `_`, and `\` in the
 * caller's text are escaped so they are not wildcards. Callers bind the
 * result as a parameter and set `ESCAPE '\'`.
 */
export function likePattern(q: string): string {
	return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

export function parseDir(raw: string | null, fallback: SortDir): { ok: true; dir: SortDir } | ParseFail {
	if (raw == null || raw === '') return { ok: true, dir: fallback };
	if (raw === 'asc' || raw === 'desc') return { ok: true, dir: raw };
	return fail('Direction must be asc or desc');
}

export function parseBounded(
	raw: string | null,
	max: number,
	label: string
): { ok: true; value: number | null } | ParseFail {
	if (raw == null || raw === '') return { ok: true, value: null };
	if (!POSITIVE.test(raw)) return fail(`Invalid ${label}`);
	const value = Number(raw);
	if (value > max) return fail(`Invalid ${label}`);
	return { ok: true, value };
}

/** Missing page and pageSize stay null (unpaged). Either one fills the other. */
export function parseOptionalPage(
	params: URLSearchParams
): { ok: true; page: number | null; pageSize: number | null } | ParseFail {
	const page = parseBounded(params.get('page'), PAGE_MAX, 'page');
	if (!page.ok) return page;
	const pageSize = parseBounded(params.get('pageSize'), PAGE_SIZE_MAX, 'page size');
	if (!pageSize.ok) return pageSize;
	if (page.value == null && pageSize.value == null) return { ok: true, page: null, pageSize: null };
	return {
		ok: true,
		page: page.value ?? 1,
		pageSize: pageSize.value ?? PAGE_SIZE_DEFAULT
	};
}

/** Processes always return one page. Omitted params are the defaults. */
export function parseRequiredPage(
	params: URLSearchParams
): { ok: true; page: number; pageSize: number } | ParseFail {
	const parsed = parseOptionalPage(params);
	if (!parsed.ok) return parsed;
	return {
		ok: true,
		page: parsed.page ?? 1,
		pageSize: parsed.pageSize ?? PAGE_SIZE_DEFAULT
	};
}

export function member<T extends string>(
	raw: string | null,
	allowed: readonly T[],
	fallback: T,
	label: string
): { ok: true; value: T } | ParseFail {
	if (raw == null || raw === '') return { ok: true, value: fallback };
	if ((allowed as readonly string[]).includes(raw)) return { ok: true, value: raw as T };
	return fail(`${label} must be one of ${allowed.join(', ')}`);
}

/** Nulls sort last in both directions. Numbers stay numeric; everything else is case-insensitive text. */
export function compareValues(
	left: string | number | null,
	right: string | number | null,
	dir: SortDir
): number {
	if (left == null && right == null) return 0;
	if (left == null) return 1;
	if (right == null) return -1;
	let order = 0;
	if (typeof left === 'number' && typeof right === 'number') order = left - right;
	else {
		const a = String(left).toLowerCase();
		const b = String(right).toLowerCase();
		order = a < b ? -1 : a > b ? 1 : 0;
	}
	return dir === 'asc' ? order : -order;
}

export function slicePage<T>(rows: T[], page: number | null, pageSize: number | null): T[] {
	if (page == null || pageSize == null) return rows;
	const start = (page - 1) * pageSize;
	if (start >= rows.length) return [];
	return rows.slice(start, start + pageSize);
}
