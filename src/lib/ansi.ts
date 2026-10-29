/**
 * Terminal escape sequences in agent text: OSC (`ESC ] … BEL` or `ESC ] … ESC \`, such as a window
 * title or an OSC 8 link), CSI (`ESC [ … letter`, such as colour codes, also when cut off at the end),
 * and two-byte escapes (`ESC ( B`, `ESC 7`, `ESC =`, `ESC c`).
 */
const ESCAPES = /\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\|$)|\u001B\[[0-?]*[ -/]*(?:[@-~]|$)|\u001B[ -/]*[0-~]/g;
/** 8-bit C1 controls (U+0080–U+009F). */
const C1 = /[\u0080-\u009F]/g;

/** Text without escape sequences and C1 controls. Other control characters are left for the caller. */
export function stripAnsi(value: string): string {
	return value.replace(ESCAPES, '').replace(C1, '');
}
