import { isCatalogName } from './catalog';
import { formatWhen } from './format';
import { CATALOG_LOGS_PARAM } from './url';

export { CATALOG_LOGS_PARAM };

/** Screen-reader lead-in of a copy row, read before its host link: which entry the line belongs to. */
export function copyOfText(entry: string): string {
	return `Copy of ${entry} on `;
}

/**
 * Tooltip for a live row. Gone rows have no health source.
 * `docker` is the engine; `check` is a Deploybot check.
 */
export function healthSourceLabel(row: {
	gone_at: string | null;
	health: { source?: 'docker' | 'check' | null } | null;
}): string | null {
	if (row.gone_at != null || row.health == null) return null;
	if (row.health.source === 'docker') return 'Docker health check';
	if (row.health.source === 'check') return 'Deploybot check';
	return null;
}

/**
 * Status badge tooltip and description on a copy row: live details, the health source,
 * then `Last seen <when>` in the viewer's zone (as `LocalTime` shows it). Empty parts are left out.
 */
export function statusTooltipText(detail: string, hint: string | null, lastSeen: string | null, timeZone?: string): string {
	const parts = [detail.trim()];
	if (hint) parts.push(`${hint}.`);
	const when = formatWhen(lastSeen, timeZone);
	if (when !== 'n/a') parts.push(`Last seen ${when}.`);
	return parts.filter((part) => part !== '').join(' ');
}

/** Full image digest, or null when the row has none. */
export function imageDigestText(value: string | null | undefined): string | null {
	if (value == null) return null;
	const text = value.trim();
	return text === '' ? null : text;
}

/** `catalog.logs`: a catalog entry name, or null when missing or not a valid name (ignored). */
export function serviceLogsEntry(raw: string | null | undefined): string | null {
	if (raw == null) return null;
	return isCatalogName(raw) ? raw : null;
}

/** The copy `catalog.logs` points at: that entry on the filtered host, owned by this project. */
export function serviceLogsRow<Row extends { catalog_entry: string | null; host_id: string; project_id: string | null }>(
	rows: readonly Row[],
	request: { entry: string; hostId: string },
	projectId: string
): Row | null {
	return (
		rows.find(
			(row) => row.catalog_entry === request.entry && row.host_id === request.hostId && row.project_id === projectId
		) ?? null
	);
}

/** Shown when `catalog.logs` names an entry with no copy on that host yet. */
export function serviceLogsMissingNote(entry: string): string {
	return `${entry} isn't listed on this host yet. Refresh in a moment.`;
}

/** The current URL without `catalog.logs`; every other param stays. */
export function withoutServiceLogs(url: URL): string {
	const params = new URLSearchParams(url.searchParams);
	params.delete(CATALOG_LOGS_PARAM);
	const qs = params.toString();
	return qs ? `${url.pathname}?${qs}` : url.pathname;
}

/**
 * What the Catalog & services tab does with a `catalog.logs` request on this render.
 * `none`: no request, no matching copy, or already used. `hidden`: the Kind filter or the search hides
 * the entry, so the not-listed note shows. `go-to-page`: the entry is on another table page; switch to it
 * (keeping the request). `wait`: the copy's state is still being read, or its row is not on the page yet.
 * `open-and-clear`: the row is rendered and its controls are known, so its drawer is open (when the caller
 * has `logs`); select and scroll to it and drop the param.
 */
export function serviceLogsStep(input: {
	done: boolean;
	rowId: string | null;
	controls: 'checking' | object | null;
	/** The table page that shows the copy's entry, or null when it is filtered out. */
	page: number | null;
	currentPage: number;
	/** The copy's row element is in the document. */
	rendered: boolean;
}): 'none' | 'hidden' | 'go-to-page' | 'wait' | 'open-and-clear' {
	if (input.done || input.rowId == null) return 'none';
	if (input.page == null) return 'hidden';
	if (input.page !== input.currentPage) return 'go-to-page';
	if (input.controls === 'checking' || !input.rendered) return 'wait';
	return 'open-and-clear';
}

/**
 * Removes `catalog.logs` from the address when it still names `entry` on `pathname`.
 * Returns whether `replace` was called. A throwing `replace` is swallowed: the param then stays.
 */
export function dropServiceLogs(current: URL, pathname: string, entry: string, replace: (href: string) => void): boolean {
	if (current.pathname !== pathname || current.searchParams.get(CATALOG_LOGS_PARAM) !== entry) return false;
	try {
		replace(withoutServiceLogs(current));
		return true;
	} catch {
		return false;
	}
}

/** The params that choose which rows show. The copy highlight lasts only while they stay the same. */
export function serviceFilterKey(search: URLSearchParams): string {
	return ['catalog.q', 'catalog.host', 'catalog.page', 'catalog.kind'].map((name) => search.get(name) ?? '').join('\n');
}
