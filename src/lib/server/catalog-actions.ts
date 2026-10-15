import { error, fail, isHttpError, isRedirect, redirect, type RequestEvent } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import {
	GRANT_ACTIONS,
	IMAGE_GRANT_ACTIONS,
	byteLength,
	cleanCommand,
	cleanDir,
	cleanEnv,
	cleanPort,
	cleanRestart,
	cleanRunAs,
	isAllowedRunAs,
	isCatalogName,
	isIdempotencyKey,
	isSpecHash
} from '$lib/catalog';
import type { CatalogGrant, CatalogGrantAction, Host, Member } from '$lib/api-types';
import type { CatalogDraft, CatalogEditorState, CatalogPermissionsState, CatalogRunKind, CatalogRunState } from '$lib/project-action';
import { ApiError, actionFailure, apiFetch, apiList } from '$lib/server/api';
import { formText } from '$lib/server/form';
import { requireUser } from '$lib/server/guard';
import { present } from '$lib/server/redact';
import { saveImageEntry } from '$lib/server/image-actions';
import { parseCatalogPreview, parseHost, parseImageLogs, parseImageStatus, parseMember, parseProgramLogs, parseProgramStatus } from '$lib/server/shape';
import { isUuid } from '$lib/server/validate';
import { backTo } from '$lib/url';

const UNEXPECTED = 'The API returned an unexpected response.';

function projectIdOf(params: { id?: string }): string {
	if (!params.id || !isUuid(params.id)) error(404, 'Not found');
	return params.id;
}

function hostIdOf(params: { id?: string }): string {
	if (!params.id || !isUuid(params.id)) error(404, 'Not found');
	return params.id;
}

function apiStatus(err: unknown): number {
	return err instanceof ApiError && err.status >= 400 && err.status <= 599 ? err.status : 503;
}

function apiMessage(err: unknown): string {
	if (err instanceof ApiError) return err.msg;
	console.error('bot api request failed');
	return 'The API is unavailable.';
}

function editorMode(form: FormData): 'create' | 'edit' {
	return formText(form, 'editor_mode') === 'edit' ? 'edit' : 'create';
}

function entryName(form: FormData): string | null {
	const name = formText(form, 'entry_name');
	return isCatalogName(name) ? name : null;
}

function readEnv(form: FormData): { rows: CatalogDraft['env']; message: string | null } {
	const keys = form.getAll('env_key');
	const values = form.getAll('env_value');
	if (keys.length !== values.length) return { rows: [], message: 'An environment value needs a key.' };
	if (keys.length > 64) return { rows: [], message: 'At most 64 environment variables.' };
	const rows: CatalogDraft['env'] = [];
	for (let index = 0; index < keys.length; index += 1) {
		const key = keys[index];
		const value = values[index];
		if (typeof key !== 'string' || typeof value !== 'string') return { rows: [], message: 'An environment value needs a key.' };
		if (key.length > 64 || new TextEncoder().encode(value).byteLength > 4096) {
			return { rows: [], message: 'An environment value is too long.' };
		}
		rows.push({ key, value });
	}
	return { rows, message: null };
}

function draftFrom(form: FormData): { draft: CatalogDraft; message: string | null } {
	const env = readEnv(form);
	const restartRaw = formText(form, 'restart');
	const name = formText(form, 'name');
	const command = formText(form, 'command');
	const dir = formText(form, 'dir').trim();
	const runAs = formText(form, 'run_as');
	const port = formText(form, 'port').trim();
	const draft: CatalogDraft = {
		name,
		command,
		shell: formText(form, 'shell') === '1',
		dir,
		runAs,
		port,
		restart: restartRaw === 'no' ? 'no' : 'on-failure',
		env: env.rows
	};
	if (name.length > 48) {
		return { draft, message: 'Name must start with a letter or digit and use lowercase letters, digits, and hyphens.' };
	}
	if (command.length > 4096 || byteLength(command) > 4096) {
		return { draft, message: 'Enter one command line (1–4096 bytes, one line).' };
	}
	if (dir.length > 255 || byteLength(dir) > 255) {
		return { draft, message: 'Working directory must be an absolute path, at most 255 bytes, with no .. segment.' };
	}
	if (runAs.length > 32) {
		return { draft, message: 'Choose a run-as account that an eligible host allows.' };
	}
	if (port.length > 5) {
		return { draft, message: 'Expected port must be from 1 to 65535, or blank.' };
	}
	if (restartRaw !== '' && restartRaw !== 'on-failure' && restartRaw !== 'no') {
		return { draft, message: 'Choose a restart policy.' };
	}
	return { draft, message: env.message };
}

function editorResult(
	event: RequestEvent,
	status: number,
	mode: 'create' | 'edit',
	name: string | null,
	draft: CatalogDraft,
	preview: CatalogEditorState['preview'],
	previewMessage: string | null,
	message: string | null
) {
	const catalogEditor: CatalogEditorState = { mode, name, draft, preview, previewMessage, message };
	return fail(status, present(event, { scope: 'catalog' as const, catalogEditor }));
}

async function loadHosts(event: RequestEvent, id: string): Promise<Host[] | null> {
	try {
		const list = await apiList(event, `/v1/projects/${id}/hosts`, parseHost);
		if (list.truncated) return null;
		return list.items;
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		return null;
	}
}

async function loadMembers(event: RequestEvent, id: string): Promise<Member[] | null> {
	try {
		const list = await apiList(event, `/v1/projects/${id}/members`, parseMember);
		if (list.truncated) return null;
		return list.items;
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		return null;
	}
}

type ProgramBody = { ok: true; body: Record<string, unknown> } | { ok: false; message: string };

function programBody(draft: CatalogDraft, hosts: Host[], includeName: boolean): ProgramBody {
	const command = cleanCommand(draft.command);
	if (!command) return { ok: false, message: 'Enter one command line (1–4096 bytes, one line).' };
	const dir = cleanDir(draft.dir);
	if (!dir) return { ok: false, message: 'Working directory must be an absolute path, at most 255 bytes, with no .. segment.' };
	const runAs = cleanRunAs(draft.runAs);
	if (!runAs || !isAllowedRunAs(hosts, runAs, draft.shell)) {
		return { ok: false, message: 'Choose a run-as account that an eligible host allows.' };
	}
	const port = cleanPort(draft.port);
	if (port === undefined) return { ok: false, message: 'Expected port must be from 1 to 65535, or blank.' };
	const restart = cleanRestart(draft.restart);
	if (!restart) return { ok: false, message: 'Choose a restart policy.' };
	const env = cleanEnv(draft.env);
	if (!env.ok) return { ok: false, message: env.message };
	const body: Record<string, unknown> = { kind: 'program', command, shell: draft.shell, dir, run_as: runAs, restart };
	if (includeName) {
		if (!isCatalogName(draft.name)) {
			return { ok: false, message: 'Name must start with a letter or digit and use lowercase letters, digits, and hyphens.' };
		}
		body.name = draft.name;
	}
	if (Object.keys(env.env).length > 0) body.env = env.env;
	if (port != null) body.port = port;
	return { ok: true, body };
}

function permissionsState(name: string, grants: CatalogGrant[], message: string | null, loaded: boolean): CatalogPermissionsState {
	return { name, grants, message, loaded };
}

function grantActionsOf(form: FormData): readonly CatalogGrantAction[] {
	return formText(form, 'entry_kind') === 'image' ? IMAGE_GRANT_ACTIONS : GRANT_ACTIONS;
}

function roleGrant(form: FormData, role: 'admin' | 'viewer', allowed: readonly CatalogGrantAction[]): CatalogGrant | null {
	const actions = allowed.filter((action) => formText(form, `${role}_${action}`) === '1');
	if (actions.length === 0) return null;
	return { subject: `role:${role}`, actions: [...actions] };
}

function memberIndexes(form: FormData): number[] | null {
	const found = new Set<number>();
	for (const key of form.keys()) {
		const match = /^member_(\d+)_user$/.exec(key);
		if (!match) continue;
		const index = Number(match[1]);
		if (!Number.isInteger(index) || index < 0 || index >= 100) return null;
		found.add(index);
	}
	if (found.size > 100) return null;
	return [...found].sort((left, right) => left - right);
}

function readGrants(form: FormData, members: Member[]): { grants: CatalogGrant[]; message: string | null } {
	const allowed = grantActionsOf(form);
	const grants: CatalogGrant[] = [];
	const admin = roleGrant(form, 'admin', allowed);
	const viewer = roleGrant(form, 'viewer', allowed);
	if (admin) grants.push(admin);
	if (viewer) grants.push(viewer);
	const indexes = memberIndexes(form);
	if (indexes == null) return { grants, message: 'At most 100 grants.' };
	const seen = new Set<string>();
	let message: string | null = null;
	for (const index of indexes) {
		const user = formText(form, `member_${index}_user`);
		const actions = allowed.filter((action) => formText(form, `member_${index}_${action}`) === '1');
		if (user === '' && actions.length === 0) continue;
		if (!isUuid(user)) {
			message ??= user === '' ? 'Choose a member.' : 'That member is not valid.';
			continue;
		}
		const member = members.find((item) => item.user_id === user);
		if (!member) message ??= 'Choose a current member.';
		else if (member.role === 'owner') message ??= 'The owner already has every action.';
		if (seen.has(user)) message ??= 'Each member can appear once.';
		seen.add(user);
		if (actions.length === 0) message ??= 'Choose at least one action for that member.';
		else grants.push({ subject: `user:${user}`, actions: [...actions] });
	}
	if (grants.length > 100) return { grants: grants.slice(0, 100), message: 'At most 100 grants.' };
	return { grants, message };
}

function runResult(name: string, kind: CatalogRunKind, status: CatalogRunState['status'], logs: CatalogRunState['logs'], message: string | null): CatalogRunState {
	return { name, kind, resultId: randomUUID(), status, logs, message };
}

function runFailure(event: RequestEvent, status: number, name: string, kind: CatalogRunKind, message: string) {
	return fail(status, present(event, { scope: 'catalog' as const, catalogAction: runResult(name, kind, null, null, message) }));
}

async function saveEntry(event: RequestEvent, mode: 'create' | 'edit') {
	requireUser(event);
	const id = projectIdOf(event.params);
	const form = await event.request.formData();
	if (formText(form, 'entry_kind') === 'image') return saveImageEntry(event, mode, form, id);
	const built = draftFrom(form);
	const name = mode === 'edit' ? entryName(form) : null;
	if (mode === 'edit' && !name) {
		return editorResult(event, 400, mode, null, built.draft, null, null, 'That catalog entry is not valid.');
	}
	if (built.message) return editorResult(event, 400, mode, name, built.draft, null, null, built.message);
	const hosts = await loadHosts(event, id);
	if (!hosts) return editorResult(event, 503, mode, name, built.draft, null, null, 'Hosts could not be loaded, so the run-as account was not checked.');
	const body = programBody(built.draft, hosts, mode === 'create');
	if (!body.ok) return editorResult(event, 400, mode, name, built.draft, null, null, body.message);
	const path = mode === 'create' ? `/v1/projects/${id}/catalog` : `/v1/projects/${id}/catalog/${name}`;
	try {
		await apiFetch(event, path, { method: mode === 'create' ? 'POST' : 'PUT', body: JSON.stringify(body.body) });
		redirect(303, backTo(event.url));
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		return editorResult(event, apiStatus(err), mode, name, built.draft, null, null, apiMessage(err));
	}
}

async function catalogAct(event: RequestEvent, kind: CatalogRunKind) {
	requireUser(event);
	const id = projectIdOf(event.params);
	const form = await event.request.formData();
	const name = formText(form, 'name');
	const hostId = formText(form, 'host_id');
	const shown = isCatalogName(name) ? name : '';
	if (!isCatalogName(name)) return runFailure(event, 400, shown, kind, 'That catalog entry is not valid.');
	if (!isUuid(hostId)) return runFailure(event, 400, shown, kind, 'Choose a host.');
	const image = formText(form, 'entry_kind') === 'image';
	const body: { host_id: string; idempotency_key?: string } = { host_id: hostId };
	if (kind !== 'logs' && kind !== 'status') {
		const key = formText(form, 'idempotency_key');
		if (!isIdempotencyKey(key)) return runFailure(event, 400, shown, kind, 'The idempotency key is not valid.');
		body.idempotency_key = key;
	}
	try {
		const payload = await apiFetch(event, `/v1/projects/${id}/catalog/${name}/${kind}`, {
			method: 'POST',
			body: JSON.stringify(body)
		});
		if (kind === 'logs') {
			const logs = image ? parseImageLogs(payload) : parseProgramLogs(payload);
			if (!logs) return runFailure(event, 502, shown, kind, UNEXPECTED);
			return present(event, { scope: 'catalog' as const, catalogAction: runResult(shown, kind, null, logs, null) });
		}
		const status = image ? parseImageStatus(payload) : parseProgramStatus(payload);
		if (!status) return runFailure(event, 502, shown, kind, UNEXPECTED);
		return present(event, { scope: 'catalog' as const, catalogAction: runResult(shown, kind, status, null, null) });
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		return runFailure(event, apiStatus(err), shown, kind, apiMessage(err));
	}
}

export async function catalogCreate(event: RequestEvent) {
	return saveEntry(event, 'create');
}

export async function catalogUpdate(event: RequestEvent) {
	return saveEntry(event, 'edit');
}

export async function catalogDelete(event: RequestEvent) {
	requireUser(event);
	const id = projectIdOf(event.params);
	const name = formText(await event.request.formData(), 'name');
	if (!isCatalogName(name)) return fail(400, present(event, { scope: 'catalog' as const, message: 'That catalog entry is not valid.' }));
	try {
		await apiFetch(event, `/v1/projects/${id}/catalog/${name}`, { method: 'DELETE' });
		redirect(303, backTo(event.url));
	} catch (err) {
		return actionFailure(event, err, 'catalog');
	}
}

export async function catalogParse(event: RequestEvent) {
	requireUser(event);
	const id = projectIdOf(event.params);
	const form = await event.request.formData();
	const built = draftFrom(form);
	const mode = editorMode(form);
	const name = mode === 'edit' ? entryName(form) : null;
	if (built.message) return editorResult(event, 400, mode, name, built.draft, null, built.message, null);
	const command = cleanCommand(built.draft.command);
	if (!command) {
		return editorResult(event, 400, mode, name, built.draft, null, 'Enter one command line (1–4096 bytes, one line).', null);
	}
	try {
		const payload = await apiFetch(event, `/v1/projects/${id}/catalog/parse`, {
			method: 'POST',
			body: JSON.stringify({ command, shell: built.draft.shell })
		});
		const preview = parseCatalogPreview(payload);
		if (!preview) return editorResult(event, 502, mode, name, built.draft, null, UNEXPECTED, null);
		return present(event, {
			scope: 'catalog' as const,
			catalogEditor: { mode, name, draft: built.draft, preview, previewMessage: null, message: null }
		});
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		return editorResult(event, apiStatus(err), mode, name, built.draft, null, apiMessage(err), null);
	}
}

export async function catalogRun(event: RequestEvent) {
	return catalogAct(event, 'run');
}

export async function catalogStop(event: RequestEvent) {
	return catalogAct(event, 'stop');
}

export async function catalogRestart(event: RequestEvent) {
	return catalogAct(event, 'restart');
}

export async function catalogLogs(event: RequestEvent) {
	return catalogAct(event, 'logs');
}

export async function catalogStatus(event: RequestEvent) {
	return catalogAct(event, 'status');
}

export async function catalogPermissions(event: RequestEvent) {
	requireUser(event);
	const id = projectIdOf(event.params);
	const form = await event.request.formData();
	const name = formText(form, 'name');
	if (!isCatalogName(name)) return fail(400, present(event, { scope: 'catalog' as const, message: 'That catalog entry is not valid.' }));
	const members = await loadMembers(event, id);
	if (!members) {
		return fail(503, present(event, { scope: 'catalog' as const, permissions: permissionsState(name, [], 'Members could not be loaded.', false) }));
	}
	const read = readGrants(form, members);
	if (read.message) {
		return fail(400, present(event, { scope: 'catalog' as const, permissions: permissionsState(name, read.grants, read.message, true) }));
	}
	try {
		await apiFetch(event, `/v1/projects/${id}/catalog/${name}/permissions`, {
			method: 'PUT',
			body: JSON.stringify({ grants: read.grants })
		});
		const dest = new URL(backTo(event.url), event.url.origin);
		dest.searchParams.delete('permissions');
		const qs = dest.searchParams.toString();
		redirect(303, qs ? `${dest.pathname}?${qs}` : dest.pathname);
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		return fail(apiStatus(err), present(event, { scope: 'catalog' as const, permissions: permissionsState(name, read.grants, apiMessage(err), true) }));
	}
}

export async function approveCatalog(event: RequestEvent) {
	requireUser(event);
	const id = hostIdOf(event.params);
	const form = await event.request.formData();
	const entry_id = formText(form, 'entry_id');
	const spec_hash = formText(form, 'spec_hash');
	if (!isUuid(entry_id)) return fail(400, present(event, { message: 'That catalog entry is not valid.' }));
	if (!isSpecHash(spec_hash)) return fail(400, present(event, { message: 'That spec hash is not valid.' }));
	try {
		await apiFetch(event, `/v1/hosts/${id}/catalog-approvals`, {
			method: 'POST',
			body: JSON.stringify({ entry_id, spec_hash })
		});
		redirect(303, backTo(event.url));
	} catch (err) {
		return actionFailure(event, err);
	}
}

export async function revokeCatalog(event: RequestEvent) {
	requireUser(event);
	const id = hostIdOf(event.params);
	const entryId = formText(await event.request.formData(), 'entry_id');
	if (!isUuid(entryId)) return fail(400, present(event, { message: 'That catalog entry is not valid.' }));
	try {
		await apiFetch(event, `/v1/hosts/${id}/catalog-approvals/${entryId}`, { method: 'DELETE' });
		redirect(303, backTo(event.url));
	} catch (err) {
		return actionFailure(event, err);
	}
}
