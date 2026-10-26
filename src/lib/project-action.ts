import type {
	CatalogGrant,
	CatalogPreview,
	CatalogRestart,
	CreatedJoin,
	ImageDeploy,
	ImageLogs,
	ImageStatus,
	ImageWorkload,
	InviteRole,
	PendingConfirmation,
	ProbeView,
	ProgramLogs,
	ProgramStatus
} from '$lib/api-types';
import { nextFormDialog, type DialogState } from '$lib/dialog-open';
import type { ImageDraft, KnownSet } from '$lib/image-spec';
import type { ImageDigestResult, ImageTagsResult } from '$lib/image-tags';

export type ProjectScope = 'hosts' | 'services' | 'catalog' | 'members' | 'tokens' | 'settings';

/** The dialog form an action result belongs to. Its message shows in that dialog, not on the page. */
export type ActionField = 'createToken' | 'addMember';

/** Catalog actions on a Services row. A container's status is the row's badge tooltip, not an action. */
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

/** Start, stop, restart, logs, or status dialog on a Services row. A new `resultId` opens it again. */
export type CatalogRunState = {
	name: string;
	/** The row's host. Empty when the posted host id was not valid. */
	hostId: string;
	/** The Services row that posted it, or null for a not-running item (no row yet). */
	serviceId: string | null;
	kind: CatalogRunKind;
	resultId: string;
	status: ProgramStatus | ImageStatus | null;
	logs: ProgramLogs | ImageLogs | null;
	message: string | null;
};

/** Create or edit dialog for a container entry, after a failed save. */
export type ImageEditorState = {
	mode: 'create' | 'edit';
	name: string | null;
	draft: ImageDraft;
	message: string | null;
	field: string | null;
};

/** Deploy dialog. A new `resultId` opens it again. History is the last deploys, newest first. */
export type ImageDeployState = {
	name: string;
	resultId: string;
	hostId: string;
	workload: ImageWorkload;
	waitSec: number;
	outcome: ImageDeploy | null;
	status: ImageStatus | null;
	lines: string[];
	/** Null means the action did not load history, so the dialog keeps the list it has. */
	history: ImageDeploy[] | null;
	confirmation: PendingConfirmation | null;
	/** Which call the confirmation continues. Remove stays on the short timeout. */
	confirmKind: 'deploy' | 'rollback' | 'remove' | null;
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
	/** Set by createToken and addMember. */
	field?: ActionField;
	message?: string;
	confirmHostId?: string;
	created?: CreatedJoin;
	probe?: ProbeView;
	probeServiceId?: string;
	/** Set when the probe was the editor's unsaved row, not a saved check id. */
	editorProbe?: boolean;
	/** Draft row the editor probe ran against. Null when the form did not send one. */
	probeIndex?: number | null;
	/** Editor probe error shown on that row. Field errors use `healthMessage` instead. */
	probeMessage?: string | null;
	renameServiceId?: string;
	displayName?: string;
	/** Health-check dialog stays open for this service. */
	healthServiceId?: string;
	healthField?: string | null;
	healthIndex?: number | null;
	healthMessage?: string | null;
	/** Set only on the create-invite action result. A reload drops it. */
	inviteUrl?: string;
	inviteRole?: InviteRole;
	inviteMessage?: string;
	catalogEditor?: CatalogEditorState;
	catalogAction?: CatalogRunState;
	permissions?: CatalogPermissionsState;
	imageEditor?: ImageEditorState;
	imageDeploy?: ImageDeployState;
	/** Names and key names only. Values are never included. */
	catalogSets?: KnownSet[];
	catalogSetsMessage?: string | null;
	/** File names only. Content is never included. */
	catalogFiles?: Array<{ name: string }>;
	catalogFilesMessage?: string | null;
	/** Registry tags for the Image field: tag names and a message key only. */
	catalogImageTags?: ImageTagsResult;
	/** Digest of a picked tag, or a message key. */
	catalogImageDigest?: ImageDigestResult;
	/** Plain file content from View. Secret files never set this. */
	viewedFile?: { name: string; content: string } | null;
	/** Which settings form failed. The secret field is cleared either way. */
	settingsField?: 'dotenv' | 'token' | 'file' | null;
	/** File a delete failure belongs to. The notice sits on that row, not under the dialog. */
	settingsName?: string | null;
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
