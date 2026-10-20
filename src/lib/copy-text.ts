/** Note shown after a successful clipboard write. */
export const COPIED_NOTE = 'Copied';

/** Note shown when the clipboard write throws. */
export const COPY_FAILED_NOTE = 'Copy failed. Select the text and copy it manually.';

/** How long an icon-only copy failure keeps the digest on screen. */
export const COPY_FAILURE_MS = 8000;

/**
 * Write `value` with the caller's clipboard function.
 * Returns the note the copy control shows. A thrown write is the failure note.
 */
export async function copyText(value: string, write: (text: string) => Promise<void>): Promise<string> {
	try {
		await write(value);
		return COPIED_NOTE;
	} catch {
		return COPY_FAILED_NOTE;
	}
}

/** Digest still shown after an icon-only copy failure. Null once the note has expired. */
export function shownDigestFailure(value: string, failedAt: number | null, now: number): string | null {
	if (failedAt == null || value === '') return null;
	if (!Number.isFinite(failedAt) || !Number.isFinite(now)) return null;
	if (now - failedAt >= COPY_FAILURE_MS) return null;
	return value;
}
