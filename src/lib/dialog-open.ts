export type DialogOutcome = 'idle' | 'failure' | 'success';

export type DialogState = {
	open: boolean;
	sawFailure: boolean;
};

export type DialogView = DialogState & {
	resetDraft: boolean;
};

/**
 * The trigger owns an idle dialog.
 * A new failure forces it open. Dismissing that same failure stays closed,
 * so a still-failed page does not reopen it on every update.
 * Success closes it and resets the draft.
 */
export function nextFormDialog(state: DialogState, outcome: DialogOutcome): DialogView {
	if (outcome === 'success') return { open: false, sawFailure: false, resetDraft: true };
	if (outcome === 'failure') {
		if (!state.sawFailure) return { open: true, sawFailure: true, resetDraft: false };
		return { open: state.open, sawFailure: true, resetDraft: false };
	}
	if (state.sawFailure) return { open: false, sawFailure: false, resetDraft: false };
	return { open: state.open, sawFailure: false, resetDraft: false };
}

/** A returned success, or a redirect such as `backTo`, is success. Anything else failed stays open. */
export function formDialogOutcome(resultType: string): DialogOutcome {
	if (resultType === 'success' || resultType === 'redirect') return 'success';
	if (resultType === 'failure' || resultType === 'error') return 'failure';
	return 'idle';
}

/** Image create and edit. A save redirect closes the dialog. A failure keeps it open. */
export function imageEditorDialog(state: DialogState, resultType: string): DialogView {
	return nextFormDialog(state, formDialogOutcome(resultType));
}

export type InviteSecretState = {
	open: boolean;
	sawFailure: boolean;
	shownUrl: string | null;
	seenUrl: string | null;
};

/**
 * A new invite url is shown once. Closing the dialog clears it, and opening
 * again with the same action result shows the empty form. A new url shows again.
 * With no url, the failure dialog rule applies.
 */
export function nextInviteSecret(
	state: InviteSecretState,
	input: { inviteUrl: string | null; failed: boolean; open: boolean }
): InviteSecretState {
	let open = input.open;
	let { sawFailure } = state;
	let shownUrl = state.shownUrl;
	let seenUrl = state.seenUrl;
	const url = input.inviteUrl;

	if (url && url !== seenUrl) {
		seenUrl = url;
		shownUrl = url;
		open = true;
		sawFailure = false;
	} else if (!url) {
		seenUrl = null;
		shownUrl = null;
		const dialog = nextFormDialog({ open, sawFailure }, input.failed ? 'failure' : 'idle');
		open = dialog.open;
		sawFailure = dialog.sawFailure;
	}

	if (!open) shownUrl = null;
	return { open, sawFailure, shownUrl, seenUrl };
}
