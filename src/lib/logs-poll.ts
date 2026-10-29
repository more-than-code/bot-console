import type { VisibilityDoc } from '$lib/visibility';

/** Live waits this long after an answer before it asks again. */
export const LIVE_DELAY_MS = 3000;
/** Live turns itself off after this long. */
export const LIVE_MAX_MS = 15 * 60 * 1000;
/** Live turns itself off after this many failed fetches in a row. */
export const LIVE_MAX_FAILURES = 3;

export const LIVE_NOTE = `Live, every ${LIVE_DELAY_MS / 1000} s`;
export const LIVE_TIMEOUT_NOTE = `Live stopped after ${LIVE_MAX_MS / 60_000} minutes.`;

export type LiveEnd = 'timeout' | 'failures';

export type LogsPoller = {
	/** One fetch now, unless one is already running. `manual` is false only for Live's own polls. */
	refresh: (manual?: boolean) => Promise<void>;
	setLive: (on: boolean) => void;
	/** The drawer closed: no further fetches, and a late answer is ignored. */
	dispose: () => void;
};

/**
 * Fetches for one open logs drawer. One fetch at a time. While Live is on, the next fetch starts
 * `LIVE_DELAY_MS` after the previous answer, never on a fixed clock, and none starts while the tab is hidden.
 * Live on and a visible tab fetch at once only when that gap has already passed.
 * `load` resolves true when it got lines and must not reject.
 */
export function createLogsPoller({
	load,
	doc,
	onLiveEnd,
	now = () => Date.now()
}: {
	load: (manual: boolean) => Promise<boolean>;
	doc: VisibilityDoc;
	onLiveEnd: (reason: LiveEnd) => void;
	now?: () => number;
}): LogsPoller {
	let live = false;
	let liveSince = 0;
	let failures = 0;
	let inFlight = false;
	let disposed = false;
	let lastAnswerAt: number | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const clear = () => {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
	};

	const endLive = (reason: LiveEnd) => {
		live = false;
		clear();
		onLiveEnd(reason);
	};

	/** True when Live ran out and was turned off. */
	const expired = () => {
		if (!live || now() - liveSince < LIVE_MAX_MS) return false;
		endLive('timeout');
		return true;
	};

	/** The next Live fetch: at once when the gap since the last answer has passed, else for the rest of it. */
	const scheduleNext = () => {
		if (disposed || !live || inFlight || timer !== undefined || doc.visibilityState === 'hidden' || expired()) return;
		const wait = lastAnswerAt == null ? 0 : LIVE_DELAY_MS - (now() - lastAnswerAt);
		if (wait <= 0) {
			void refresh(false);
			return;
		}
		timer = setTimeout(() => {
			timer = undefined;
			if (!expired()) void refresh(false);
		}, wait);
	};

	async function refresh(manual = true) {
		if (disposed || inFlight) return;
		clear();
		inFlight = true;
		const ok = await load(manual);
		inFlight = false;
		if (disposed) return;
		lastAnswerAt = now();
		failures = ok ? 0 : failures + 1;
		if (!live) return;
		if (failures >= LIVE_MAX_FAILURES) {
			endLive('failures');
			return;
		}
		scheduleNext();
	}

	const onVisibility = () => {
		if (doc.visibilityState === 'hidden') clear();
		else scheduleNext();
	};

	doc.addEventListener('visibilitychange', onVisibility);

	return {
		refresh,
		setLive(on) {
			if (disposed || on === live) return;
			live = on;
			if (!on) {
				clear();
				return;
			}
			liveSince = now();
			failures = 0;
			scheduleNext();
		},
		dispose() {
			disposed = true;
			live = false;
			clear();
			doc.removeEventListener('visibilitychange', onVisibility);
		}
	};
}
