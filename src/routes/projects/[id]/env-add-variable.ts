import { ENV_KEY } from '$lib/catalog';
import { RETYPE_VALUE } from './env-set-panel';

/** Draft of the Add variable dialog. Secret is on by default. */
export type AddDraft = {
	key: string;
	value: string;
	secret: boolean;
	error: string;
	/** `key`: the Key field is wrong. `form`: anything else (API messages). */
	errorField: 'key' | 'form' | null;
	/** A secret value was cleared after a failure and must be pasted again. */
	retype: boolean;
};

export function initialAddDraft(): AddDraft {
	return { key: '', value: '', secret: true, error: '', errorField: null, retype: false };
}

/** Flip Secret. The typed value stays; the paste-again hint no longer applies. */
export function setAddSecret(draft: AddDraft, secret: boolean): AddDraft {
	return { ...draft, secret, retype: false };
}

/** Typing a value ends the paste-again hint. */
export function addValueTyped(draft: AddDraft): AddDraft {
	return draft.retype ? { ...draft, retype: false } : draft;
}

export const ADD_KEY_MESSAGE = 'Keys use A-Z, digits, and underscore, and start with a letter or underscore.';

/** Checked before sending. The API stays authoritative. */
export function addKeyError(key: string): string | null {
	return ENV_KEY.test(key) ? null : ADD_KEY_MESSAGE;
}

/** A Key refused before sending: nothing was sent, so the typed value stays. */
export function addKeyRefused(draft: AddDraft, message: string): AddDraft {
	return { ...draft, error: message, errorField: 'key', retype: false };
}

/** A failed add keeps the key and the message. A secret value is cleared and asked for again. */
export function addFailed(draft: AddDraft, message: string, errorField: 'key' | 'form' = 'form'): AddDraft {
	if (!draft.secret) return { ...draft, error: message, errorField, retype: false };
	return { ...draft, value: '', error: message, errorField, retype: draft.value !== '' };
}

export function addErrorText(draft: AddDraft): string {
	if (draft.error === '') return '';
	return draft.retype ? `${draft.error} ${RETYPE_VALUE}` : draft.error;
}

export type AddSettleEffects = {
	/** Set the panel status line ("Added {KEY}."). */
	added: () => void;
	/** Close the dialog (a no-op when it is already closed). */
	close: () => void;
	failed: () => void | Promise<void>;
	update: () => Promise<void>;
	tick: () => Promise<void>;
	focusStatus: () => void;
};

/**
 * The Add variable form's `use:enhance` result, in order. A success closes the dialog, then waits for
 * the reload (SvelteKit's navigation resets focus), then focuses the status line, but only when the
 * dialog was still open when the result arrived. A failure that arrives after a dismiss is ignored.
 */
export async function settleAdd(open: boolean, resultType: string, fx: AddSettleEffects): Promise<'added' | 'failed' | 'ignored' | 'other'> {
	if (resultType === 'failure') {
		if (!open) return 'ignored';
		await fx.failed();
		return 'failed';
	}
	if (resultType === 'redirect') {
		fx.added();
		fx.close();
		await fx.update();
		// Dismissed before the result arrived: focus is where the user left it.
		if (!open) return 'added';
		await fx.tick();
		fx.focusStatus();
		return 'added';
	}
	await fx.update();
	return 'other';
}
