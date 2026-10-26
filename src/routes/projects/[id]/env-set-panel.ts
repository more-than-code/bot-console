import type { EnvSetKey } from '$lib/api-types';

/** Open state for one env set. Collapse only flips `open`, so an edit in progress stays. */

export type EnvSetPanel = {
	open: boolean;
};

export function initialEnvSetPanel(): EnvSetPanel {
	return { open: true };
}

export function envSetKeyCount(count: number): string {
	return count === 1 ? '1 key' : `${count} keys`;
}

export function toggleEnvSet(panel: EnvSetPanel): EnvSetPanel {
	return { ...panel, open: !panel.open };
}

/** DOM ids inside one set panel. `status` is the panel's one `role="status"` line. */
export function envDomId(set: string, part: string, key = ''): string {
	return key === '' ? `env-${part}-${set}` : `env-${part}-${set}-${key}`;
}

/**
 * A key split after each underscore. The table puts a `<wbr>` between the parts, so a long key
 * wraps only at `_` and never between letters (`DB_` / `URL`, not `DB` / `_U` / `RL`).
 */
export function keyWrapParts(key: string): string[] {
	// No regex lookbehind: Safari before 16.4 throws on it.
	return key.match(/[^_]*_|[^_]+/g) ?? [];
}

export const RETYPE_VALUE = 'Paste the value again.';

/**
 * The one row in edit state (Edit on another row replaces it), its error, and whether the
 * error must ask for a secret value again.
 */
export type RowEdit = { key: string; error: string; retype: boolean } | null;

/** A failed save keeps the row in edit state with the message. A stale result for another row is ignored. */
export function rowEditFailed(edit: RowEdit, key: string, message: string, retype: boolean): RowEdit {
	if (edit?.key !== key) return edit;
	return { key, error: message, retype };
}

export function rowEditErrorText(edit: RowEdit): string {
	if (!edit || edit.error === '') return '';
	return edit.retype ? `${edit.error} ${RETYPE_VALUE}` : edit.error;
}

/** The inline input's start. A plain key starts with its value; a secret starts empty with the preview as placeholder. */
export function editValueField(item: EnvSetKey): { value: string; placeholder: string } {
	if (item.is_secret) return { value: '', placeholder: item.preview ?? '' };
	return { value: item.value ?? '', placeholder: '' };
}

export const EMPTY_SECRET_MESSAGE = 'Enter a new value, or Cancel to keep the current one.';

/** An inline save of a secret with an empty input is refused locally; a plain key may be saved empty. */
export function secretEditRefusal(item: EnvSetKey, value: string): string | null {
	return item.is_secret && value === '' ? EMPTY_SECRET_MESSAGE : null;
}

/** Escape anywhere in the editing row cancels the edit. */
export function isCancelKey(event: { key: string }): boolean {
	return event.key === 'Escape';
}

/** After a save and reload, the row's Edit button, or the status line when the row is gone. */
export function focusAfterEditSave(set: string, keys: readonly string[], key: string): string {
	return keys.includes(key) ? envDomId(set, 'edit', key) : envDomId(set, 'status');
}

/**
 * After a save's reload, move focus only if it is not elsewhere on purpose: nothing is focused
 * (`body`, or the removed Save button) or it is still inside the saved row.
 */
export function focusIsFree(
	active: object | null,
	body: object | null,
	row: { contains: (node: never) => boolean } | null
): boolean {
	if (active == null || active === body) return true;
	return row != null && row.contains(active as never);
}

/** The message of a failed action result, or a fixed fallback. The server never echoes the value. */
export function failureMessage(result: { type: string; data?: unknown }): string {
	const data = result.data;
	if (data != null && typeof data === 'object' && typeof (data as { message?: unknown }).message === 'string') {
		const message = (data as { message: string }).message;
		if (message !== '') return message;
	}
	return 'The value could not be saved.';
}

export const MAKE_SECRET_MESSAGE =
	"This value will be encrypted and hidden. This can't be undone; to make a key plain again, delete it and add it again.";

export function madeSecretNote(key: string): string {
	return `Made ${key} secret.`;
}

/** The Env sets card's status line, outside the dialog and any one set panel. */
export const ENV_SET_STATUS_ID = 'env-set-status';

export function savedEnvSetNote(name: string): string {
	return `Saved env set ${name}.`;
}

export type EnvSetSaveEffects = {
	/** Blank the dotenv paste. Runs first on every result, so a secret never outlives the request. */
	clearPaste: () => void;
	/** Set the card's status line ("Saved env set {name}.") and reset the name and New keys are secret. */
	saved: () => void;
	/** Close the dialog (a no-op when it is already closed). */
	close: () => void;
	update: () => Promise<void>;
	tick: () => Promise<void>;
	focusStatus: () => void;
	/** Focus the dialog's error notice after the failure is on the page. */
	focusError: () => void;
};

/**
 * The Add env set form's `use:enhance` result, in order, like `settleAdd`. A success closes the dialog,
 * waits for the reload (SvelteKit's navigation resets focus), then focuses the status line, but only
 * when the dialog was still open when the result arrived. A failure reloads the form result, so the
 * dialog stays open with the message (and "Paste the value again." from the server), then focuses it.
 */
export async function settleEnvSetSave(
	open: boolean,
	resultType: string,
	fx: EnvSetSaveEffects
): Promise<'saved' | 'failed' | 'other'> {
	fx.clearPaste();
	if (resultType === 'redirect') {
		fx.saved();
		fx.close();
		await fx.update();
		if (!open) return 'saved';
		await fx.tick();
		fx.focusStatus();
		return 'saved';
	}
	await fx.update();
	if (resultType === 'failure') {
		fx.focusError();
		return 'failed';
	}
	return 'other';
}
