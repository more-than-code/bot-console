import type { HealthStatus } from './api-types';

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
