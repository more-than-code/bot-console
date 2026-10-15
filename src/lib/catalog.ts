import type { CatalogEntry, CatalogPreview, Host } from '$lib/api-types';

export const APPROVAL_WAIT = "waiting for the host owner's approval";

export const GRANT_ACTIONS = ['run', 'stop', 'restart', 'logs'] as const;

/** Image entries add deploy. Program grants stay on GRANT_ACTIONS. */
export const IMAGE_GRANT_ACTIONS = [...GRANT_ACTIONS, 'deploy'] as const;

export const CATALOG_NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;

export const RUN_AS = /^[a-z_][a-z0-9_-]{0,31}$/;

export const ENV_KEY = /^[A-Z_][A-Z0-9_]{0,63}$/;

export const SPEC_HASH = /^[0-9a-f]{64}$/;

export const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,128}$/;

/** NUL or a newline. A tab is allowed in a command, directory, argument, and environment value. */
const LINE_BREAK = /[\u0000\n\r]/;;

const utf8 = new TextEncoder();

export function byteLength(value: string): number {
	return utf8.encode(value).byteLength;
}

export function isCatalogName(value: string): boolean {
	return CATALOG_NAME.test(value);
}

export function isIdempotencyKey(value: string): boolean {
	return IDEMPOTENCY_KEY.test(value);
}

export function isSpecHash(value: string): boolean {
	return SPEC_HASH.test(value);
}

/** Owner, or a host shared into this project at deploy. Metrics shares are not catalog hosts. */
export function isCatalogHost(host: Pick<Host, 'relation' | 'share_level'>): boolean {
	if (host.relation === 'owner') return true;
	return host.relation === 'shared' && host.share_level === 'deploy';
}

/** Why this host cannot run the entry. Null means the host can be chosen. */
export function hostBlockReason(host: Pick<Host, 'programs'>, runAs: string, shell: boolean): string | null {
	if (host.programs == null) return 'This host does not allow programs.';
	if (!host.programs.enabled) return 'Programs are disabled on this host.';
	if (runAs !== '' && !host.programs.run_as.includes(runAs)) return `This host does not allow run as ${runAs}.`;
	if (shell && !host.programs.allow_shell) return 'This host does not allow a shell.';
	return null;
}

/** Why this host cannot run a container. Null means the host can be chosen. */
export function imageHostBlockReason(host: Pick<Host, 'programs'>): string | null {
	if (host.programs == null || !host.programs.images || !host.programs.docker) return 'This host does not run containers.';
	return null;
}

/** Union of run-as accounts on eligible hosts. Shell entries only use hosts that allow a shell. */
export function runAsChoices(hosts: readonly Pick<Host, 'relation' | 'share_level' | 'programs'>[], shell: boolean): string[] {
	const names = new Set<string>();
	for (const host of hosts) {
		if (!isCatalogHost(host) || host.programs == null || !host.programs.enabled) continue;
		if (shell && !host.programs.allow_shell) continue;
		for (const name of host.programs.run_as) names.add(name);
	}
	return [...names].sort();
}

export function isAllowedRunAs(
	hosts: readonly Pick<Host, 'relation' | 'share_level' | 'programs'>[],
	runAs: string,
	shell: boolean
): boolean {
	return runAsChoices(hosts, shell).includes(runAs);
}

/** The spec sentence, once an account is chosen. Empty until then. */
export function shellRisk(runAs: string): string | null {
	if (runAs === '') return null;
	return `anything in this line runs as ${runAs}`;
}

/** Absolute path, at most 255 bytes, no `..` segment, no NUL and no newline. */
export function cleanDir(value: string): string | null {
	const dir = value.trim();
	if (!dir.startsWith('/') || byteLength(dir) > 255 || LINE_BREAK.test(dir)) return null;
	if (dir.split('/').includes('..')) return null;
	return dir;
}

/** One command line. The text is kept as typed, including surrounding spaces. */
export function cleanCommand(value: string): string | null {
	if (value.length === 0 || byteLength(value) > 4096 || LINE_BREAK.test(value)) return null;
	return value;
}

export function cleanRunAs(value: string): string | null {
	if (value === 'root' || !RUN_AS.test(value)) return null;
	return value;
}

/** Blank becomes null. Anything else that is not a port is undefined. */
export function cleanPort(value: string): number | null | undefined {
	const trimmed = value.trim();
	if (trimmed === '') return null;
	if (!/^[0-9]+$/.test(trimmed)) return undefined;
	const port = Number(trimmed);
	if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
	return port;
}

export function cleanRestart(value: string): 'on-failure' | 'no' | null {
	if (value === '' || value === 'on-failure') return 'on-failure';
	if (value === 'no') return 'no';
	return null;
}

export type EnvClean = { ok: true; env: Record<string, string> } | { ok: false; message: string };

/**
 * Skip blank pairs. Shape only: charset, duplicates, the 64-key cap, and no NUL or newline.
 * Reserved keys and the v1.6.1 denylist are the API's decision. The form shows `err.msg`.
 */
export function cleanEnv(rows: readonly { key: string; value: string }[]): EnvClean {
	const env: Record<string, string> = {};
	for (const row of rows) {
		const key = row.key.trim();
		if (key === '' && row.value === '') continue;
		if (key === '') return { ok: false, message: 'An environment value needs a key.' };
		if (!ENV_KEY.test(key)) return { ok: false, message: 'Environment keys use A-Z, digits, and underscore.' };
		if (LINE_BREAK.test(row.value) || byteLength(row.value) > 4096) {
			return { ok: false, message: 'An environment value is too long or contains a newline.' };
		}
		if (Object.hasOwn(env, key)) return { ok: false, message: 'Each environment key can appear once.' };
		if (Object.keys(env).length >= 64) return { ok: false, message: 'At most 64 environment variables.' };
		env[key] = row.value;
	}
	return { ok: true, env };
}

export type EnvRow = { key: string; value: string };

type PreviewSubmitter = {
	addEventListener(type: 'submit', listener: () => void, options: { once: true }): void;
	removeEventListener(type: 'submit', listener: () => void): void;
	requestSubmit(submitter: unknown): void;
};

/**
 * Submit with the Preview button. The callback runs only when the submit event fires.
 * Browser constraint validation does not fire it, so a blocked preview is not remembered.
 */
export function submitCatalogPreview(form: PreviewSubmitter, submitter: unknown, remember: () => void): void {
	form.addEventListener('submit', remember, { once: true });
	try {
		form.requestSubmit(submitter);
	} finally {
		form.removeEventListener('submit', remember);
	}
}

/** A preview result applies only when it is still the latest preview. A save always applies. */
export function shouldApplyPreviewUpdate(previewing: boolean, requestId: number, latestPreviewId: number): boolean {
	if (!previewing) return true;
	return requestId === latestPreviewId;
}

/** Keep the idempotency key until the post succeeds, so a retry replays instead of dispatching again. */
export function reuseIdempotencyKey(resultType: string): boolean {
	return resultType !== 'success';
}

/** Owners edit the spec. Everyone else gets the catalog row without the values that will run. */
export function catalogForCaller(entries: readonly CatalogEntry[], owner: boolean): CatalogEntry[] {
	if (owner) return [...entries];
	return entries.map((item) => {
		if (item.kind === 'image') return { ...item, spec: { ...item.spec, env: {} } };
		return { ...item, spec: { ...item.spec, exec: '', args: [], env: {} } };
	});
}

/** Identifies a parsed line, so the form does not ask the server to parse the same line twice. */
export function previewToken(shell: boolean, line: string): string {
	return `${shell ? '1' : '0'}\n${line}`;
}

/**
 * Apply a parse preview to the form. Hoisted `KEY=value` words leave the command (`command_display`
 * is the argv without them) and become env rows; a typed value replaces a row with the same key.
 * Leaving them in both places would send each key twice. Returns null when there is nothing to do:
 * shell mode (nothing is split), nothing hoisted, or the field no longer holds the previewed line.
 */
export function hoistPreviewEnv(
	command: string,
	shell: boolean,
	rows: readonly EnvRow[],
	previewedLine: string,
	preview: CatalogPreview
): { command: string; env: EnvRow[] } | null {
	const hoisted = Object.entries(preview.env);
	if (shell || hoisted.length === 0 || command !== previewedLine) return null;
	const env = rows.map((row) => ({
		key: row.key,
		value: Object.hasOwn(preview.env, row.key) ? preview.env[row.key] : row.value
	}));
	for (const [key, value] of hoisted) {
		if (!env.some((row) => row.key === key)) env.push({ key, value });
	}
	return { command: preview.command_display, env };
}
