import type {
	CatalogGrant,
	CatalogPreview,
	CatalogRestart,
	CreatedJoin,
	InviteRole,
	ProbeView,
	ProgramLogs,
	ProgramStatus
} from '$lib/api-types';
import { nextFormDialog, type DialogState } from '$lib/dialog-open';

export type ProjectScope = 'hosts' | 'services' | 'catalog' | 'members' | 'tokens' | 'settings';

export type CatalogRunKind = 'run' | 'stop' | 'restart' | 'logs';

export type CatalogDraft = {
	name: string;
	command: string;
	shell: boolean;
	dir: string;
	runAs: string;
	port: string;
	restart: CatalogRestart;
	env: Array<{ key: string; value: string }>;
};

/** Create or edit dialog after a preview or a failed save. */
export type CatalogEditorState = {
	mode: 'create' | 'edit';
	name: string | null;
	draft: CatalogDraft;
	preview: CatalogPreview | null;
	previewMessage: string | null;
	message: string | null;
};

/** Run, stop, restart, or logs dialog. A new `resultId` opens it again. */
export type CatalogRunState = {
	name: string;
	kind: CatalogRunKind;
	resultId: string;
	status: ProgramStatus | null;
	logs: ProgramLogs | null;
	message: string | null;
};

/** Permissions dialog. `loaded` is false when the grant list could not be read. */
export type CatalogPermissionsState = {
	name: string;
	grants: CatalogGrant[];
	message: string | null;
	loaded: boolean;
};

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
	catalogEditor?: CatalogEditorState;
	catalogAction?: CatalogRunState;
	permissions?: CatalogPermissionsState;
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
