import type { CreatedJoin, InviteRole, ProbeView } from '$lib/api-types';
import { nextFormDialog, type DialogState } from '$lib/dialog-open';

export type ProjectScope = 'hosts' | 'services' | 'members' | 'tokens' | 'settings';

export type ProjectActionData = {
	scope: ProjectScope;
	message?: string;
	confirmHostId?: string;
	created?: CreatedJoin;
	probe?: ProbeView;
	probeServiceId?: string;
	renameServiceId?: string;
	displayName?: string;
	/** Set only on the create-invite action result. A reload drops it. */
	inviteUrl?: string;
	inviteRole?: InviteRole;
	inviteMessage?: string;
};

export type RenameOpenState = DialogState;

/**
 * Polled `failed` flag. Success is not this flag: a redirect looks idle,
 * and the form callback passes `success` to `nextFormDialog` directly.
 */
export function nextRenameOpen(state: RenameOpenState, failed: boolean): RenameOpenState {
	const next = nextFormDialog(state, failed ? 'failure' : 'idle');
	return { open: next.open, sawFailure: next.sawFailure };
}

/** Page mapping from an action result. Success (no form, or no rename id) leaves the dialog closed. */
export function servicesRenameView(action: ProjectActionData | null): {
	renameServiceId: string | null;
	typedName: string | null;
	open: boolean;
} {
	if (action?.scope !== 'services' || action.renameServiceId == null) {
		return { renameServiceId: null, typedName: null, open: false };
	}
	return {
		renameServiceId: action.renameServiceId,
		typedName: action.displayName != null ? action.displayName : null,
		open: true
	};
}
