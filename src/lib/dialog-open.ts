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

/** File delete closes on a failure so the row notice is not covered by the dialog. Other confirms use the shared rule. */
export function nextConfirmDialog(state: DialogState, outcome: DialogOutcome, closeOnFailure = false): DialogView {
	if (closeOnFailure && outcome === 'failure') return { open: false, sawFailure: false, resetDraft: false };
	return nextFormDialog(state, outcome);
}

/** Map an action result (`failure`, `redirect`, …) through the confirm rule. */
export function confirmAfterAction(state: DialogState, resultType: string, closeOnFailure = false): DialogView {
	return nextConfirmDialog(state, formDialogOutcome(resultType), closeOnFailure);
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

export type ImageSaveView = DialogView & {
	savedName: string | null;
};

/** A successful image save closes the dialog and names the success notice. A failure stays open and clears that notice. */
export function imageSaveView(state: DialogState, resultType: string, name: string): ImageSaveView {
	const dialog = imageEditorDialog(state, resultType);
	if (formDialogOutcome(resultType) !== 'success') return { ...dialog, savedName: null };
	const savedName = name.trim();
	return { ...dialog, savedName: savedName === '' ? null : savedName };
}

export type ImageRevealState = {
	open: boolean;
	sawReveal: boolean;
};

/**
 * Force the image dialog open only the first time a failure is revealed.
 * A later run while that failure is still revealed keeps the current `open`,
 * so a settle that already closed it is not undone before the redirect lands.
 */
export function imageDialogReveal(state: ImageRevealState, revealed: boolean): ImageRevealState {
	const open = revealed && !state.sawReveal ? true : state.open;
	return { open, sawReveal: revealed };
}

/** Env-set and file loads apply their lists and leave the image dialog open. */
export function imageAuxFormSettle(open: boolean, resultType: string): { open: boolean; take: boolean } {
	return { open, take: resultType === 'success' || resultType === 'failure' };
}

export type ImageNoticeSeen = {
	projectId: string;
	tab: string;
	permissions: boolean;
};

/**
 * Drop a saved-image notice when the project changes, the tab leaves Catalog,
 * or Permissions opens. The name does not come back on its own.
 */
export function imageNoticeOnView(
	name: string | null,
	seen: ImageNoticeSeen | null,
	next: ImageNoticeSeen
): { name: string | null; seen: ImageNoticeSeen } {
	if (seen == null) return { name: next.tab === 'catalog' && !next.permissions ? name : null, seen: next };
	if (seen.projectId !== next.projectId) return { name: null, seen: next };
	if (seen.tab === 'catalog' && next.tab !== 'catalog') return { name: null, seen: next };
	if (!seen.permissions && next.permissions) return { name: null, seen: next };
	return { name, seen: next };
}

/**
 * Catalog actions a person starts. Hidden env-set and file loads, and the image save
 * itself, are omitted: a cancelled save still submits `catalogCreate` or
 * `catalogUpdate`, and that must not clear the line.
 */
const IMAGE_NOTICE_CLEAR_ACTIONS: ReadonlySet<string> = new Set([
	'catalogDelete',
	'catalogRun',
	'catalogStop',
	'catalogRestart',
	'catalogDeploy',
	'catalogRollback'
]);

/** Those actions clear the notice. Anything else, including a cancelled save, leaves it. */
export function imageNoticeOnSubmit(name: string | null, action: string | null): string | null {
	if (action != null && IMAGE_NOTICE_CLEAR_ACTIONS.has(action)) return null;
	return name;
}

/** Opening a create or edit dialog clears the notice. Closing it, or leaving it open, does not. */
export function imageNoticeOnDialog(name: string | null, wasOpen: boolean, open: boolean): string | null {
	if (!wasOpen && open) return null;
	return name;
}

/**
 * The success name is announced only once the dialog has finished closing.
 * While it is still open the name stays pending, so the notice is not read
 * from inside the dialog.
 */
export function imageNoticeOnCloseComplete(
	pending: string | null,
	open: boolean
): { pending: string | null; announce: string | null } {
	if (open || pending == null) return { pending, announce: null };
	return { pending: null, announce: pending };
}

/** A fresh image save shows the notice again. A failure clears it. */
export function imageNoticeOnSave(name: string | null): string | null {
	if (name == null) return null;
	const trimmed = name.trim();
	return trimmed === '' ? null : trimmed;
}

/**
 * Body of the image form's `use:enhance` callback.
 * `onSettled` runs first so a redirect that never returns has already closed the dialog.
 */
export async function settleImageForm(
	result: { type: string },
	mode: 'create' | 'edit',
	entry: { name: string } | null,
	draft: { name: string },
	onSettled: ((outcome: DialogOutcome, name: string) => void | Promise<void>) | undefined,
	update: (opts?: { reset?: boolean }) => Promise<void> | void
): Promise<void> {
	const name = mode === 'edit' && entry ? entry.name : draft.name;
	await onSettled?.(formDialogOutcome(result.type), name);
	await update({ reset: false });
}

/** Apply an env-set or file load. Success and failure are taken. `open` is returned unchanged. */
export function settleImageAuxLoad(
	result: { type: string; data?: unknown },
	open: boolean,
	take: (data: Record<string, unknown>) => void
): boolean {
	const next = imageAuxFormSettle(open, result.type);
	if (!next.take || (result.type !== 'success' && result.type !== 'failure')) return next.open;
	const data = result.data;
	take(data != null && typeof data === 'object' ? (data as Record<string, unknown>) : {});
	return next.open;
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
