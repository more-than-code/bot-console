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
