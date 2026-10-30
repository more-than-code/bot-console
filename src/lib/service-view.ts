import type { HealthStatus } from './api-types';
import { isCatalogName } from './catalog';
import { formatWhen } from './format';
import { SERVICE_LOGS_PARAM } from './url';

export { SERVICE_LOGS_PARAM };

/** URL `show` values. The API names differ for the middle view. */
export const SERVICE_SHOWS = ['deploybot', 'discovered', 'all'] as const;

export type ServiceShow = (typeof SERVICE_SHOWS)[number];

export type ServiceApiView = 'deploybot' | 'deploybot_and_discovered' | 'all';

const SHOW_TO_VIEW = {
	deploybot: 'deploybot',
	discovered: 'deploybot_and_discovered',
	all: 'all'
} as const satisfies Record<ServiceShow, ServiceApiView>;

export const SERVICE_SHOW_LABEL: Record<ServiceShow, string> = {
	deploybot: 'Deploybot services',
	discovered: 'Also discovered',
	all: 'Everything, including gone'
};

/**
 * URL `show` and the `view` query it sends.
 * Missing or any other value is Deploybot services (`view=deploybot`).
 * The API spelling `deploybot_and_discovered` is not a `show` value.
 */
export function serviceShow(raw: string | null | undefined): { show: ServiceShow; view: ServiceApiView } {
	if (raw === 'deploybot' || raw === 'discovered' || raw === 'all') {
		return { show: raw, view: SHOW_TO_VIEW[raw] };
	}
	return { show: 'deploybot', view: 'deploybot' };
}

/**
 * Status word for one services row.
 * `gone_at` replaces health: owned and declared are stopped (Deploybot can start them),
 * discovered is gone. A present row keeps its health status.
 */
export function serviceRowStatus(row: {
	source: 'discovered' | 'declared' | 'owned';
	gone_at: string | null;
	health: { status: HealthStatus } | null;
}): HealthStatus | 'stopped' | 'gone' {
	if (row.gone_at != null) return row.source === 'discovered' ? 'gone' : 'stopped';
	return row.health?.status ?? 'unknown';
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
 * Status badge tooltip and description on a services row: live details, the health source,
 * then `Last seen <when>` in the viewer's zone (as `LocalTime` shows it). Empty parts are left out.
 */
export function statusTooltipText(detail: string, hint: string | null, lastSeen: string | null, timeZone?: string): string {
	const parts = [detail.trim()];
	if (hint) parts.push(`${hint}.`);
	const when = formatWhen(lastSeen, timeZone);
	if (when !== 'n/a') parts.push(`Last seen ${when}.`);
	return parts.filter((part) => part !== '').join(' ');
}

/**
 * Checks column leads with `docker healthcheck` when Docker reported the health.
 * The services tab does not load catalog specs, so a catalog healthcheck with no docker source is not visible here.
 */
export function showsDockerHealthcheck(row: { health: { source?: 'docker' | 'check' | null } | null }): boolean {
	return row.health?.source === 'docker';
}

/** Full image digest, or null when the row has none. */
export function imageDigestText(value: string | null | undefined): string | null {
	if (value == null) return null;
	const text = value.trim();
	return text === '' ? null : text;
}

/**
 * The Deploybot empty line and its link.
 * A search, or any load or action message, keeps the ordinary "No services reported."
 */
export function showDeploybotEmpty(input: {
	show: ServiceShow;
	search: string;
	message: string | null;
}): boolean {
	return input.show === 'deploybot' && input.search === '' && input.message == null;
}

/**
 * Default-view empty state: discovered listeners for this project.
 * Keeps the host filter. Drops search, sort, and the cursor, which is bound to the view.
 */
export function discoveredListenersHref(url: URL): string {
	const params = new URLSearchParams();
	params.set('tab', 'services');
	const host = url.searchParams.get('services.host');
	if (host) params.set('services.host', host);
	params.set('show', 'discovered');
	return `${url.pathname}?${params.toString()}`;
}

/** `services.logs`: a catalog entry name, or null when missing or not a valid name (ignored). */
export function serviceLogsEntry(raw: string | null | undefined): string | null {
	if (raw == null) return null;
	return isCatalogName(raw) ? raw : null;
}

/** The row `services.logs` points at: that entry on the filtered host, owned by this project. */
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

/** Shown when `services.logs` names an entry with no row on that host yet. */
export function serviceLogsMissingNote(entry: string): string {
	return `${entry} isn't listed on this host yet. Refresh in a moment.`;
}

/** The current URL without `services.logs`; every other param stays. */
export function withoutServiceLogs(url: URL): string {
	const params = new URLSearchParams(url.searchParams);
	params.delete(SERVICE_LOGS_PARAM);
	const qs = params.toString();
	return qs ? `${url.pathname}?${qs}` : url.pathname;
}

/**
 * What the Services tab does with a `services.logs` request on this render.
 * `none`: no request, no matching row, or already used. `wait`: the row's state is still being read
 * (its drawer is not mounted yet). `open-and-clear`: the row's controls are known, so its drawer has
 * mounted open (when the caller has `logs`); select and scroll to the row and drop the param.
 */
export function serviceLogsStep(input: { done: boolean; rowId: string | null; controls: 'checking' | object | null }):
	| 'none'
	| 'wait'
	| 'open-and-clear' {
	if (input.done || input.rowId == null) return 'none';
	if (input.controls === 'checking') return 'wait';
	return 'open-and-clear';
}

/**
 * Removes `services.logs` from the address when it still names `entry` on `pathname`.
 * Returns whether `replace` was called. A throwing `replace` is swallowed: the param then stays.
 */
export function dropServiceLogs(current: URL, pathname: string, entry: string, replace: (href: string) => void): boolean {
	if (current.pathname !== pathname || current.searchParams.get(SERVICE_LOGS_PARAM) !== entry) return false;
	try {
		replace(withoutServiceLogs(current));
		return true;
	} catch {
		return false;
	}
}

/** The params that choose which rows show. The row highlight lasts only while they stay the same. */
export function serviceFilterKey(search: URLSearchParams): string {
	return ['services.q', 'services.host', 'services.cursor', 'show'].map((name) => search.get(name) ?? '').join('\n');
}
