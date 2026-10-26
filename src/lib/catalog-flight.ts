import type { ImageHealthcheck } from '$lib/api-types';

export const FLIGHT_ACTIONS = ['deploy', 'run', 'stop', 'restart', 'rollback'] as const;

export type FlightAction = (typeof FLIGHT_ACTIONS)[number];

const FLIGHT_LABEL: Record<FlightAction, string> = {
	deploy: 'Deploying…',
	run: 'Starting…',
	stop: 'Stopping…',
	restart: 'Restarting…',
	rollback: 'Rolling back…'
};

export function flightLabel(action: FlightAction): string {
	return FLIGHT_LABEL[action];
}

/** Run, Stop, and Restart take the long request. Logs and Status do not. */
export function flightOfRunKind(kind: string): FlightAction | null {
	if (kind === 'run' || kind === 'stop' || kind === 'restart') return kind;
	return null;
}

/** `m:ss`, minutes unbounded, no leading zero on the minutes. */
export function formatElapsed(totalSeconds: number): string {
	const seconds = Math.max(0, Math.floor(totalSeconds));
	const minutes = Math.floor(seconds / 60);
	const rest = seconds % 60;
	return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

/** Whole seconds since `startedAt`. A skipped timer tick still reports the real gap. */
export function elapsedSeconds(startedAt: number, now: number): number {
	if (!Number.isFinite(startedAt) || !Number.isFinite(now)) return 0;
	return Math.max(0, Math.floor((now - startedAt) / 1000));
}

/** True when a click or submit must be ignored because a flight is already running. */
export function blockInFlightSubmit(inFlight: boolean): boolean {
	return inFlight;
}

/** Where focus goes once a flight ends. A result notice wins; otherwise the submit button. */
export function flightFocusTarget(hasNotice: boolean): 'notice' | 'submit' {
	return hasNotice ? 'notice' : 'submit';
}

type FlightFocusRoot = {
	focus(): void;
	querySelector(selector: string): { focus(): void } | null;
};

/** Park focus on the in-flight submit, or on the dialog when that button is gone. */
export function flightFocusReturn(container: FlightFocusRoot): 'submit' | 'dialog' {
	const busy = container.querySelector('button[aria-busy="true"]');
	if (busy) {
		busy.focus();
		return 'submit';
	}
	container.focus();
	return 'dialog';
}

/** Health-wait budget in seconds. Null when the entry has no healthcheck. Pull time is not included. */
export function healthWaitSeconds(healthcheck: ImageHealthcheck | null | undefined): number | null {
	if (healthcheck == null) return null;
	const probes = healthcheck.start_period_sec + healthcheck.interval_sec * (healthcheck.retries + 1);
	return Math.max(0, healthcheck.timeout_sec, probes);
}

/** That budget rounded up to whole minutes. Null when there is no healthcheck. */
export function healthWaitMinutes(healthcheck: ImageHealthcheck | null | undefined): number | null {
	const seconds = healthWaitSeconds(healthcheck);
	if (seconds == null) return null;
	return Math.ceil(seconds / 60);
}

/** Sentence under the Deploy button while the request runs. */
export function deployProgressNote(healthcheck: ImageHealthcheck | null | undefined): string {
	const minutes = healthWaitMinutes(healthcheck);
	if (minutes == null) return 'Pulls the image, starts the container.';
	return `Pulls the image, starts the container, then waits until it is healthy (up to ${minutes} min).`;
}
