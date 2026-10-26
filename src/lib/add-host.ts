import type { CreatedJoin, Host, HostStatus, JoinToken } from '$lib/api-types';

/** How long the created-token card polls for the new host before it gives up. */
export const ENROL_WAIT_MS = 15 * 60 * 1000;

/**
 * Instructions an admin pastes into their own AI agent. Never the join token: the user types it at the enrol prompt.
 * With `server` (already checked by `acceptedServerUrl`) the agent fills it into the enrol command; the URL sits on
 * its own line so it cannot run into the sentence. Without it the user fills in the server URL from the Deploybot console.
 * `slug` is interpolated as is: `parseProject` accepts only `^[a-z0-9-]+$`.
 */
export function agentPrompt(slug: string, server?: string | null): string {
	const enrol = server
		? `Stop before enrolment. Give me the enrol command from the "next:" line of the install output with <server URL> replaced by the URL on the next line. I will run it myself and type the join token.\n${server}`
		: 'Stop before enrolment. Give me the enrol command from the "next:" line of the install output, with <server URL> left as is. I will fill in the server URL from the Deploybot console and run it myself.';
	return [
		`Help me add a host to my Deploybot project "${slug}". Run the steps on <host> with the access I give you (my SSH, a shell on the host, my cloud console, or commands I paste).`,
		'Follow https://deploybot.dev/llms.txt and the section "Enrol with an AI agent" in the bot-agent install guide it links.',
		`Before you install, show me the install command and stop until I agree. If this host only runs catalog images, it uses the policy flags (--project ${slug}, the --image patterns, --enable).`,
		enrol,
		'Never ask for, read, or handle the join token.'
	].join('\n');
}

/** The agent accepts ws:// only for a loopback dev server, and only with --insecure-dev. */
export function loopbackWs(server: string | null): boolean {
	if (!server) return false;
	try {
		const url = new URL(server);
		return url.protocol === 'ws:' && !url.username && !url.password && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]');
	} catch {
		return false;
	}
}

export const PLACEHOLDER_SERVER = '<your server URL>';

/**
 * The enrol command shown with a created token. `server` was checked by `acceptedServerUrl`
 * (no quotes or shell characters), so it is safe inside the single quotes. Null shows a placeholder.
 */
export function enrolCommand(server: string | null): string {
	return `sudo ./install.sh enroll --server '${server ?? PLACEHOLDER_SERVER}' --runner${loopbackWs(server) ? ' --insecure-dev' : ''}`;
}

/**
 * Closing the join token dialog asks first while the token may still be needed: the host has not enrolled
 * and the token has not ended. Enrolled or ended closes at once.
 */
export function closeNeedsConfirm(status: EnrolStatus | null): boolean {
	return status?.kind === 'waiting' || status?.kind === 'timeout';
}

export type JoinDialogState = {
	open: boolean;
	/** The "Close anyway?" step is showing. */
	confirming: boolean;
	/** The created token shown in this dialog. Cleared on close, so it is never shown again. */
	shownId: string | null;
	/** The create form was submitted in this dialog, so a Hosts tab message belongs to it. */
	sent: boolean;
};

export type JoinDialogEvent =
	| { type: 'open-request' }
	| { type: 'submit' }
	| { type: 'failed' }
	| { type: 'created'; id: string }
	| { type: 'close-request'; status: EnrolStatus | null }
	| { type: 'keep-open' }
	| { type: 'close-anyway' }
	| { type: 'enrolment'; status: EnrolStatus | null }
	| { type: 'closed' };

/** Where focus goes after a view swap inside the dialog. */
export type JoinDialogFocus = 'copy-instructions' | 'keep-open' | 'close' | 'error' | null;

/**
 * The token id the enrol poller runs for: the shown token while the dialog is open, else null.
 * The poller is keyed on this string, so closing disposes it and a reload with the same id does not restart it.
 */
export function joinPollId(state: JoinDialogState, createdId: string | null): string | null {
	return state.open && state.shownId !== null && state.shownId === createdId ? state.shownId : null;
}

export const JOIN_DIALOG_CLOSED: JoinDialogState = { open: false, confirming: false, shownId: null, sent: false };

/**
 * The join token dialog. Closing drops the shown token and the sent flag at once, so reopening (even during the
 * close animation) shows an empty form. The confirm step stays up through the close animation and is reset on
 * `closed` or the next open.
 */
export function nextJoinDialog(state: JoinDialogState, event: JoinDialogEvent): { state: JoinDialogState; focus: JoinDialogFocus } {
	switch (event.type) {
		case 'open-request':
			return { state: { ...JOIN_DIALOG_CLOSED, open: true }, focus: null };
		case 'submit':
			return { state: { ...state, sent: true }, focus: null };
		case 'failed':
			// A create failure reopens the form with its message, even if Escape closed it while the request ran.
			return { state: { open: true, confirming: false, shownId: null, sent: true }, focus: 'error' };
		case 'created':
			return { state: { open: true, confirming: false, shownId: event.id, sent: false }, focus: 'copy-instructions' };
		case 'close-request':
			if (state.confirming) return { state: { ...state, confirming: false }, focus: 'close' };
			if (state.shownId && closeNeedsConfirm(event.status)) return { state: { ...state, confirming: true }, focus: 'keep-open' };
			return { state: { ...state, open: false, confirming: false, shownId: null, sent: false }, focus: null };
		case 'keep-open':
			return { state: { ...state, confirming: false }, focus: 'close' };
		case 'close-anyway':
			return { state: { ...state, open: false, shownId: null, sent: false }, focus: null };
		case 'enrolment':
			if (state.open && state.confirming && state.shownId && !closeNeedsConfirm(event.status)) {
				return { state: { ...state, confirming: false }, focus: 'close' };
			}
			return { state, focus: null };
		case 'closed':
			// The close animation ended. Ignore it if the dialog was opened again meanwhile.
			if (state.open) return { state, focus: null };
			return { state: { ...JOIN_DIALOG_CLOSED }, focus: null };
	}
}

export type EnrolStatus =
	| { kind: 'waiting' }
	| { kind: 'enrolled'; name: string; status: HostStatus }
	| { kind: 'ended'; reason: 'revoked' | 'expired' }
	| { kind: 'timeout'; expiresAt: string | null };

/**
 * Enrolled once the created token is used and its host is in the hosts list.
 * Ended when the token is revoked or expired, timed out after ENROL_WAIT_MS, else waiting.
 * `now` is the time of the last refresh, so a timeout is never read from data older than that refresh.
 */
export function enrolStatus(created: CreatedJoin, tokens: JoinToken[], hosts: Host[], now: number, startedAt: number): EnrolStatus {
	const token = tokens.find((item) => item.id === created.id);
	const host = token?.used_at && token.used_by_host_id ? hosts.find((item) => item.id === token.used_by_host_id) : undefined;
	if (host) return { kind: 'enrolled', name: host.name, status: host.status };
	if (token?.revoked_at) return { kind: 'ended', reason: 'revoked' };
	const expires = token?.expires_at ? Date.parse(token.expires_at) : NaN;
	if (expires <= now) return { kind: 'ended', reason: 'expired' };
	if (now - startedAt >= ENROL_WAIT_MS) return { kind: 'timeout', expiresAt: token?.expires_at ?? null };
	return { kind: 'waiting' };
}

/** The parts of `document` the poller uses. */
export type VisibilityDoc = {
	readonly visibilityState: DocumentVisibilityState;
	addEventListener(type: 'visibilitychange', listener: () => void): void;
	removeEventListener(type: 'visibilitychange', listener: () => void): void;
};

/**
 * Calls `refresh` every `intervalMs` while `isWaiting()` and the document is visible.
 * Hidden stops the timer; visible refreshes at once and restarts it. One refresh at a time; a failed one is ignored.
 */
export function createEnrolPoller({
	isWaiting,
	refresh,
	doc,
	intervalMs
}: {
	isWaiting: () => boolean;
	refresh: () => Promise<unknown>;
	doc: VisibilityDoc;
	intervalMs: number;
}): { start: () => void; dispose: () => void } {
	let timer: ReturnType<typeof setInterval> | undefined;
	let inFlight = false;
	let disposed = false;
	const stop = () => {
		if (timer !== undefined) clearInterval(timer);
		timer = undefined;
	};
	const tick = () => {
		if (disposed) return;
		if (!isWaiting()) {
			stop();
			return;
		}
		if (inFlight) return;
		inFlight = true;
		refresh()
			.catch(() => {})
			.finally(() => {
				inFlight = false;
			});
	};
	const schedule = () => {
		stop();
		if (disposed || !isWaiting()) return;
		timer = setInterval(tick, intervalMs);
	};
	const onVisibility = () => {
		if (doc.visibilityState === 'hidden') {
			stop();
			return;
		}
		tick();
		schedule();
	};
	return {
		start() {
			if (disposed) return;
			doc.addEventListener('visibilitychange', onVisibility);
			if (doc.visibilityState !== 'hidden') schedule();
		},
		dispose() {
			disposed = true;
			stop();
			doc.removeEventListener('visibilitychange', onVisibility);
		}
	};
}
