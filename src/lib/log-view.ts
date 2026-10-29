import type { ActionResult } from '@sveltejs/kit';
import type { ImageLogs, ProgramLogs } from '$lib/api-types';
import { LIVE_NOTE } from '$lib/logs-poll';
import type { CatalogRunState } from '$lib/project-action';

export const LOGS_FAILED = 'Logs could not be loaded.';
export const LOGS_LOADING = 'Loading logs…';

/** How close to the end (in px) still counts as scrolled to the bottom. */
const BOTTOM_SLACK_PX = 8;

type ScrollBox = { scrollTop: number; clientHeight: number; scrollHeight: number };

export function atBottom(box: ScrollBox): boolean {
	return box.scrollHeight - box.scrollTop - box.clientHeight <= BOTTOM_SLACK_PX;
}

/**
 * What the log view does after new lines arrive: stay at the end when it was there,
 * else keep the position and offer "New lines below" when the text changed.
 */
export function scrollAfterUpdate(wasAtBottom: boolean, changed: boolean): 'follow' | 'keep' | 'notify' {
	if (wasAtBottom) return 'follow';
	return changed ? 'notify' : 'keep';
}

export type LogsOutcome =
	| { kind: 'logs'; logs: ProgramLogs | ImageLogs }
	| { kind: 'error'; message: string }
	| { kind: 'redirect'; location: string };

/** The `catalogLogs` action answer, read from a fetch rather than `page.form`. */
export function logsOutcome(result: ActionResult): LogsOutcome {
	if (result.type === 'redirect') return { kind: 'redirect', location: result.location };
	if (result.type === 'error') return { kind: 'error', message: LOGS_FAILED };
	const state = (result.data as { catalogAction?: CatalogRunState } | undefined)?.catalogAction;
	if (result.type === 'success' && state?.logs) return { kind: 'logs', logs: state.logs };
	return { kind: 'error', message: state?.message || LOGS_FAILED };
}

/**
 * A redirect the drawer may follow: a path on this site (one leading `/`, not `//`),
 * or a URL on `origin`. Returns the path to go to, or null.
 */
export function sameOriginPath(location: string, origin: string): string | null {
	if (location.startsWith('/') && !location.startsWith('//') && !location.startsWith('/\\')) return location;
	try {
		const url = new URL(location);
		return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : null;
	} catch {
		return null;
	}
}

/** The live region's text: the error, the note that Live stopped, or the first-load message. Empty otherwise. */
export function logsAnnouncement(state: { error: string | null; endNote: string | null; firstLoad: boolean }): string {
	if (state.error) return state.error;
	if (state.endNote) return state.endNote;
	return state.firstLoad ? LOGS_LOADING : '';
}

/** The quiet info line under the toolbar: the Live note and the update time. Not announced. */
export function logsInfoLine(state: { live: boolean; updated: string | null }): string {
	const updated = state.updated ? `Updated ${state.updated}.` : '';
	return state.live ? `${LIVE_NOTE}. ${updated}`.trim() : updated;
}
