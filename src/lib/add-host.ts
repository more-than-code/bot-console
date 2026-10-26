import type { CreatedJoin, Host, HostStatus, JoinToken } from '$lib/api-types';

/** How long the created-token card polls for the new host before it gives up. */
export const ENROL_WAIT_MS = 15 * 60 * 1000;

/**
 * Instructions an admin pastes into their own AI agent.
 * No join token and no server URL: the user creates the token and runs the enrol command themselves.
 */
export function agentPrompt(slug: string): string {
	return [
		`Help me add a host to my Deploybot project "${slug}". Run the steps on <host> with the access I give you (my SSH, a shell on the host, my cloud console, or commands I paste).`,
		'Follow https://deploybot.dev/llms.txt and the section "Enrol with an AI agent" in the bot-agent install guide it links.',
		`Before you install, show me the install command and stop until I agree. If this host only runs catalog images, it uses the policy flags (--project ${slug}, the --image patterns, --enable).`,
		'Stop before enrolment. Give me the enrol command from the "next:" line of the install output, with <server URL> left as is. I will fill in the server URL from the Deploybot console and run it myself.',
		'Never ask for, read, or handle the join token.'
	].join('\n');
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
