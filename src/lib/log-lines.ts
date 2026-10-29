// How many log lines the drawer asks for. The API allows 1–1000 for programs and 1–2000 for images.

export type LogEntryKind = 'program' | 'image';

/** The choice on every open, and the API default when `lines` is left out. */
export const DEFAULT_LOG_LINES = 200;
/** The most Live offers. Every poll replaces the view, so Live only ever shows the newest N lines. */
export const LIVE_LOG_LINES_MAX = 500;

const PROGRAM_CHOICES: readonly number[] = [200, 500, 1000];
const IMAGE_CHOICES: readonly number[] = [200, 500, 1000, 2000];
const LIVE_CHOICES: readonly number[] = [200, 500];

/** agent-protocol v1.3/v1.4 cap each answer at 64 KiB of text, keeping the newest lines. */
export const TRUNCATED_NOTE = 'Only the newest lines that fit in 64 KB are shown.';

/** Every value the kind allows; the server action checks against this. */
export function logLineChoices(kind: LogEntryKind): readonly number[] {
	return kind === 'image' ? IMAGE_CHOICES : PROGRAM_CHOICES;
}

/** What the picker offers now: only 200 and 500 while Live is on. */
export function pickerChoices(kind: LogEntryKind, live: boolean): readonly number[] {
	return live ? LIVE_CHOICES : logLineChoices(kind);
}

/** A form value in the kind's set ("200", not "0200" or " 200"), as a number; else null. */
export function logLinesChoice(kind: LogEntryKind, raw: string): number | null {
	const found = logLineChoices(kind).find((choice) => String(choice) === raw);
	return found ?? null;
}

/** The picker's value, and the choice Live replaced (null when Live changed nothing). */
export type LinesState = { choice: number; beforeLive: number | null };

/** Live on: a choice above 500 becomes 500, and the earlier one is remembered. */
export function linesOnLiveOn(choice: number): LinesState {
	return choice > LIVE_LOG_LINES_MAX ? { choice: LIVE_LOG_LINES_MAX, beforeLive: choice } : { choice, beforeLive: null };
}

/** Live off by the switch: the remembered choice comes back and is fetched once. Nothing remembered, nothing changes. */
export function linesOnLiveOff(state: LinesState): { state: LinesState; fetch: boolean } {
	if (state.beforeLive == null) return { state, fetch: false };
	return { state: { choice: state.beforeLive, beforeLive: null }, fetch: true };
}

/** Live ended by itself (time or failures), or the user picked a value: the picker keeps what it shows. */
export function linesKept(state: LinesState): LinesState {
	return { choice: state.choice, beforeLive: null };
}
