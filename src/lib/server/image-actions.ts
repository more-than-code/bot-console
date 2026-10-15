import { error, fail, isHttpError, isRedirect, redirect, type RequestEvent } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { ENV_KEY, isCatalogName, isIdempotencyKey } from '$lib/catalog';
import {
	STILL_RUNNING,
	deployTimeoutMs,
	draftForBrowser,
	imageDraftFromForm,
	imageRequestBody,
	imageSpecFromDraft,
	isConfirmationId,
	isFullDigest,
	isRegistryHost,
	isSetName,
	redactSubmitted,
	submittedSecrets,
	type ImageDraft,
	type KnownSet
} from '$lib/image-spec';
import type { EnvSet, Registry } from '$lib/api-types';
import type { ImageDeployState, ImageEditorState } from '$lib/project-action';
import { ApiError, apiFetch } from '$lib/server/api';
import { formText } from '$lib/server/form';
import { requireUser } from '$lib/server/guard';
import { present } from '$lib/server/redact';
import {
	parseDeployPayload,
	parseEnvSetList,
	parseImageDeployList,
	parseRegistry,
	parseRegistryList,
	parseRemovePayload
} from '$lib/server/shape';
import { isUuid } from '$lib/server/validate';
import { backTo } from '$lib/url';

const UNEXPECTED = 'The API returned an unexpected response.';
const DOTENV_MAX = 256 * 1024;

function projectIdOf(params: { id?: string }): string {
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

function stillRunning(err: unknown): boolean {
	return err instanceof ApiError && (err.status === 504 || err.code === 'timeout');
}

function editorFailure(event: RequestEvent, status: number, mode: 'create' | 'edit', name: string | null, draft: ImageDraft, field: string | null, message: string) {
	const imageEditor: ImageEditorState = { mode, name, draft: draftForBrowser(draft), message, field };
	return fail(status, present(event, { scope: 'catalog' as const, imageEditor }));
}

function deployState(input: Omit<ImageDeployState, 'resultId'>): ImageDeployState {
	return { ...input, resultId: randomUUID() };
}

function deployFailure(event: RequestEvent, status: number, state: Omit<ImageDeployState, 'resultId'>) {
	return fail(status, present(event, { scope: 'catalog' as const, imageDeploy: deployState(state) }));
}

function emptyDeploy(name: string, hostId: string, workload: ImageDeployState['workload'], waitSec: number, message: string | null): Omit<ImageDeployState, 'resultId'> {
	return {
		name,
		hostId,
		workload,
		waitSec,
		outcome: null,
		status: null,
		lines: [],
		history: null,
		confirmation: null,
		confirmKind: null,
		message
	};
}

function waitOf(workload: ImageDeployState['workload'], raw: string): number {
	const parsed = /^[0-9]+$/.test(raw) ? Number(raw) : NaN;
	if (workload === 'job') return parsed >= 10 && parsed <= 3600 ? parsed : 600;
	return parsed >= 5 && parsed <= 600 ? parsed : 30;
}

function named(form: FormData): string {
	const name = formText(form, 'name');
	return isCatalogName(name) ? name : '';
}

async function historyFor(event: RequestEvent, id: string, name: string, hostId: string): Promise<ImageDeployState['history']> {
	try {
		const payload = await apiFetch(event, `/v1/projects/${id}/catalog/${name}/deploys?host_id=${hostId}`);
		return parseImageDeployList(payload)?.items ?? null;
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		return null;
	}
}

export async function saveImageEntry(event: RequestEvent, mode: 'create' | 'edit', form: FormData, id: string) {
	const built = imageDraftFromForm(form);
	const name = mode === 'edit' ? (isCatalogName(formText(form, 'entry_name')) ? formText(form, 'entry_name') : null) : null;
	if (mode === 'edit' && !name) return editorFailure(event, 400, mode, null, built.draft, null, 'That catalog entry is not valid.');
	if (built.message) return editorFailure(event, 400, mode, name, built.draft, built.field, built.message);
	const check = imageSpecFromDraft(built.draft, undefined, mode === 'create');
	if (!check.ok) return editorFailure(event, 400, mode, name, built.draft, check.field, check.message);
	const body = imageRequestBody(check.spec, check.name);
	const path = mode === 'create' ? `/v1/projects/${id}/catalog` : `/v1/projects/${id}/catalog/${name}`;
	try {
		await apiFetch(event, path, { method: mode === 'create' ? 'POST' : 'PUT', body: JSON.stringify(body) });
		redirect(303, backTo(event.url));
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		const message = redactSubmitted(apiMessage(err), submittedSecrets(built.draft));
		return editorFailure(event, apiStatus(err), mode, name, built.draft, null, message);
	}
}

function deployContext(form: FormData): { name: string; hostId: string; workload: 'service' | 'job'; waitSec: number; key: string } | { message: string } {
	const name = named(form);
	if (!name) return { message: 'That catalog entry is not valid.' };
	const hostId = formText(form, 'host_id');
	if (!isUuid(hostId)) return { message: 'Choose a host.' };
	const workload = formText(form, 'workload') === 'job' ? 'job' : 'service';
	const waitSec = waitOf(workload, formText(form, 'wait_sec'));
	const key = formText(form, 'idempotency_key');
	if (!isIdempotencyKey(key)) return { message: 'The idempotency key is not valid.' };
	return { name, hostId, workload, waitSec, key };
}

export async function catalogDeploy(event: RequestEvent) {
	requireUser(event);
	const id = projectIdOf(event.params);
	const form = await event.request.formData();
	const ctx = deployContext(form);
	if ('message' in ctx) return fail(400, present(event, { scope: 'catalog' as const, message: ctx.message }));
	const base = emptyDeploy(ctx.name, ctx.hostId, ctx.workload, ctx.waitSec, null);
	const timeoutMs = deployTimeoutMs(ctx.workload, ctx.waitSec);
	try {
		const payload = await apiFetch(
			event,
			`/v1/projects/${id}/catalog/${ctx.name}/deploy`,
			{
				method: 'POST',
				body: JSON.stringify({ host_id: ctx.hostId, force: formText(form, 'force') === '1', idempotency_key: ctx.key })
			},
			timeoutMs
		);
		const parsed = parseDeployPayload(payload);
		if (!parsed) return deployFailure(event, 502, { ...base, message: UNEXPECTED });
		const history = await historyFor(event, id, ctx.name, ctx.hostId);
		if (parsed.kind === 'confirmation') {
			return present(event, {
				scope: 'catalog' as const,
				imageDeploy: deployState({ ...base, history, confirmation: parsed.confirmation, confirmKind: 'deploy' })
			});
		}
		return present(event, {
			scope: 'catalog' as const,
			imageDeploy: deployState({ ...base, history, outcome: parsed.deploy, status: parsed.status, lines: parsed.lines })
		});
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		const message = stillRunning(err) ? STILL_RUNNING : apiMessage(err);
		const history = stillRunning(err) ? null : await historyFor(event, id, ctx.name, ctx.hostId);
		return deployFailure(event, apiStatus(err), { ...base, history, message });
	}
}

export async function catalogRollback(event: RequestEvent) {
	requireUser(event);
	const id = projectIdOf(event.params);
	const form = await event.request.formData();
	const ctx = deployContext(form);
	if ('message' in ctx) return fail(400, present(event, { scope: 'catalog' as const, message: ctx.message }));
	const digest = formText(form, 'digest');
	const base = emptyDeploy(ctx.name, ctx.hostId, ctx.workload, ctx.waitSec, null);
	if (!isFullDigest(digest)) return deployFailure(event, 400, { ...base, message: 'That digest is not valid.' });
	const timeoutMs = deployTimeoutMs(ctx.workload, ctx.waitSec);
	try {
		const payload = await apiFetch(
			event,
			`/v1/projects/${id}/catalog/${ctx.name}/rollback`,
			{ method: 'POST', body: JSON.stringify({ host_id: ctx.hostId, digest, idempotency_key: ctx.key }) },
			timeoutMs
		);
		const parsed = parseDeployPayload(payload);
		if (!parsed) return deployFailure(event, 502, { ...base, message: UNEXPECTED });
		const history = await historyFor(event, id, ctx.name, ctx.hostId);
		if (parsed.kind === 'confirmation') {
			return present(event, {
				scope: 'catalog' as const,
				imageDeploy: deployState({ ...base, history, confirmation: parsed.confirmation, confirmKind: 'rollback' })
			});
		}
		return present(event, {
			scope: 'catalog' as const,
			imageDeploy: deployState({ ...base, history, outcome: parsed.deploy, status: parsed.status, lines: parsed.lines })
		});
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		const message = stillRunning(err) ? STILL_RUNNING : apiMessage(err);
		return deployFailure(event, apiStatus(err), { ...base, message });
	}
}

export async function catalogRemove(event: RequestEvent) {
	requireUser(event);
	const id = projectIdOf(event.params);
	const form = await event.request.formData();
	const ctx = deployContext(form);
	if ('message' in ctx) return fail(400, present(event, { scope: 'catalog' as const, message: ctx.message }));
	const base = emptyDeploy(ctx.name, ctx.hostId, ctx.workload, ctx.waitSec, null);
	try {
		const payload = await apiFetch(event, `/v1/projects/${id}/catalog/${ctx.name}/remove`, {
			method: 'POST',
			body: JSON.stringify({ host_id: ctx.hostId, idempotency_key: ctx.key })
		});
		const parsed = parseRemovePayload(payload);
		if (!parsed) return deployFailure(event, 502, { ...base, message: UNEXPECTED });
		const history = await historyFor(event, id, ctx.name, ctx.hostId);
		if (parsed.kind === 'confirmation') {
			return present(event, {
				scope: 'catalog' as const,
				imageDeploy: deployState({ ...base, history, confirmation: parsed.confirmation, confirmKind: 'remove' })
			});
		}
		return present(event, { scope: 'catalog' as const, imageDeploy: deployState({ ...base, history, status: parsed.status }) });
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		return deployFailure(event, apiStatus(err), { ...base, message: apiMessage(err) });
	}
}

export async function catalogConfirm(event: RequestEvent) {
	requireUser(event);
	const id = projectIdOf(event.params);
	const form = await event.request.formData();
	const ctx = deployContext(form);
	if ('message' in ctx) return fail(400, present(event, { scope: 'catalog' as const, message: ctx.message }));
	const confirmationId = formText(form, 'confirmation_id');
	const kind = formText(form, 'confirm_kind');
	const base = emptyDeploy(ctx.name, ctx.hostId, ctx.workload, ctx.waitSec, null);
	if (!isConfirmationId(confirmationId)) return deployFailure(event, 400, { ...base, message: 'That confirmation is not valid.' });
	if (kind !== 'deploy' && kind !== 'rollback' && kind !== 'remove') {
		return deployFailure(event, 400, { ...base, message: 'That confirmation is not valid.' });
	}
	const timeoutMs = kind === 'remove' ? undefined : deployTimeoutMs(ctx.workload, ctx.waitSec);
	try {
		const payload = await apiFetch(
			event,
			`/v1/confirmations/${confirmationId}`,
			{ method: 'POST', body: JSON.stringify({ idempotency_key: ctx.key }) },
			timeoutMs
		);
		const history = await historyFor(event, id, ctx.name, ctx.hostId);
		if (kind === 'remove') {
			const parsed = parseRemovePayload(payload);
			if (!parsed) return deployFailure(event, 502, { ...base, message: UNEXPECTED });
			if (parsed.kind === 'confirmation') {
				return present(event, {
					scope: 'catalog' as const,
					imageDeploy: deployState({ ...base, history, confirmation: parsed.confirmation, confirmKind: 'remove' })
				});
			}
			return present(event, { scope: 'catalog' as const, imageDeploy: deployState({ ...base, history, status: parsed.status }) });
		}
		const parsed = parseDeployPayload(payload);
		if (!parsed) return deployFailure(event, 502, { ...base, message: UNEXPECTED });
		if (parsed.kind === 'confirmation') {
			return present(event, {
				scope: 'catalog' as const,
				imageDeploy: deployState({ ...base, history, confirmation: parsed.confirmation, confirmKind: kind })
			});
		}
		return present(event, {
			scope: 'catalog' as const,
			imageDeploy: deployState({ ...base, history, outcome: parsed.deploy, status: parsed.status, lines: parsed.lines })
		});
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		const message = kind !== 'remove' && stillRunning(err) ? STILL_RUNNING : apiMessage(err);
		return deployFailure(event, apiStatus(err), { ...base, message });
	}
}

export async function catalogDeploys(event: RequestEvent) {
	requireUser(event);
	const id = projectIdOf(event.params);
	const form = await event.request.formData();
	const name = named(form);
	const hostId = formText(form, 'host_id');
	const workload = formText(form, 'workload') === 'job' ? 'job' : 'service';
	const waitSec = waitOf(workload, formText(form, 'wait_sec'));
	if (!name) return fail(400, present(event, { scope: 'catalog' as const, message: 'That catalog entry is not valid.' }));
	if (!isUuid(hostId)) return fail(400, present(event, { scope: 'catalog' as const, message: 'Choose a host.' }));
	const base = emptyDeploy(name, hostId, workload, waitSec, null);
	try {
		const payload = await apiFetch(event, `/v1/projects/${id}/catalog/${name}/deploys?host_id=${hostId}`);
		const list = parseImageDeployList(payload);
		if (!list) return deployFailure(event, 502, { ...base, message: UNEXPECTED });
		return present(event, { scope: 'catalog' as const, imageDeploy: deployState({ ...base, history: list.items }) });
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		return deployFailure(event, apiStatus(err), { ...base, message: apiMessage(err) });
	}
}

export async function catalogEnvSets(event: RequestEvent) {
	requireUser(event);
	const id = projectIdOf(event.params);
	try {
		const payload = await apiFetch(event, `/v1/projects/${id}/env-sets`);
		const list = parseEnvSetList(payload);
		if (!list) return fail(502, present(event, { scope: 'catalog' as const, catalogSets: [], catalogSetsMessage: UNEXPECTED }));
		const catalogSets: KnownSet[] = list.items.map((set) => ({ name: set.name, keys: set.keys.map((item) => item.key) }));
		return present(event, { scope: 'catalog' as const, catalogSets, catalogSetsMessage: null });
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		return fail(apiStatus(err), present(event, { scope: 'catalog' as const, catalogSets: [], catalogSetsMessage: apiMessage(err) }));
	}
}

const PASTE_AGAIN = 'Paste the value again.';

function dotenvSecrets(dotenv: string): string[] {
	const secrets = dotenv === '' ? [] : [dotenv];
	for (const line of dotenv.split('\n')) {
		const eq = line.indexOf('=');
		if (eq === -1) continue;
		const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
		if (value !== '') secrets.push(value);
	}
	return secrets;
}

function settingsFailure(event: RequestEvent, status: number, message: string, settingsField: 'dotenv' | 'token' | null = null) {
	const text = settingsField ? `${message} ${PASTE_AGAIN}` : message;
	return fail(status, present(event, { scope: 'settings' as const, message: text, settingsField }));
}

export async function saveEnvSet(event: RequestEvent) {
	requireUser(event);
	const id = projectIdOf(event.params);
	const form = await event.request.formData();
	const name = formText(form, 'set');
	const dotenv = formText(form, 'dotenv');
	if (!isSetName(name)) return settingsFailure(event, 400, 'Env set names use lowercase letters, digits, and hyphens.', 'dotenv');
	if (dotenv.length === 0 || new TextEncoder().encode(dotenv).byteLength > DOTENV_MAX) {
		return settingsFailure(event, 400, 'Paste a dotenv file of at most 256 KiB.', 'dotenv');
	}
	try {
		await apiFetch(event, `/v1/projects/${id}/env-sets/${name}`, { method: 'PUT', body: JSON.stringify({ dotenv }) });
		redirect(303, backTo(event.url));
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		return settingsFailure(event, apiStatus(err), redactSubmitted(apiMessage(err), dotenvSecrets(dotenv)), 'dotenv');
	}
}

export async function patchEnvKey(event: RequestEvent) {
	requireUser(event);
	const id = projectIdOf(event.params);
	const form = await event.request.formData();
	const name = formText(form, 'set');
	const key = formText(form, 'key');
	if (!isSetName(name) || !ENV_KEY.test(key)) return settingsFailure(event, 400, 'That env set key is not valid.');
	try {
		await apiFetch(event, `/v1/projects/${id}/env-sets/${name}/keys/${key}`, {
			method: 'PATCH',
			body: JSON.stringify({ is_secret: formText(form, 'is_secret') === '1' })
		});
		redirect(303, backTo(event.url));
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		return settingsFailure(event, apiStatus(err), apiMessage(err));
	}
}

export async function deleteEnvSet(event: RequestEvent) {
	requireUser(event);
	const id = projectIdOf(event.params);
	const name = formText(await event.request.formData(), 'set');
	if (!isSetName(name)) return settingsFailure(event, 400, 'That env set is not valid.');
	try {
		await apiFetch(event, `/v1/projects/${id}/env-sets/${name}`, { method: 'DELETE' });
		redirect(303, backTo(event.url));
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		return settingsFailure(event, apiStatus(err), apiMessage(err));
	}
}

function registryPath(id: string, host: string): string | null {
	if (!isRegistryHost(host)) return null;
	if (/[%/?#\s]/.test(host)) return null;
	return `/v1/projects/${id}/registries/${host}`;
}

export async function saveRegistry(event: RequestEvent) {
	requireUser(event);
	const id = projectIdOf(event.params);
	const form = await event.request.formData();
	const host = formText(form, 'host').trim();
	const username = formText(form, 'username');
	const token = formText(form, 'token');
	const path = registryPath(id, host);
	if (!path) return settingsFailure(event, 400, 'Enter a registry host, such as ghcr.io.', 'token');
	if (username.length === 0 || username.length > 255 || /[\u0000\n\r]/.test(username)) {
		return settingsFailure(event, 400, 'Enter a username.', 'token');
	}
	if (token.length === 0 || new TextEncoder().encode(token).byteLength > 4096 || /[\u0000\n\r]/.test(token)) {
		return settingsFailure(event, 400, 'Enter a token.', 'token');
	}
	try {
		const payload = await apiFetch(event, path, { method: 'PUT', body: JSON.stringify({ username, token }) });
		if (!parseRegistry(payload)) return settingsFailure(event, 502, UNEXPECTED, 'token');
		redirect(303, backTo(event.url));
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		return settingsFailure(event, apiStatus(err), redactSubmitted(apiMessage(err), token === '' ? [] : [token]), 'token');
	}
}

export async function deleteRegistry(event: RequestEvent) {
	requireUser(event);
	const id = projectIdOf(event.params);
	const host = formText(await event.request.formData(), 'host').trim();
	const path = registryPath(id, host);
	if (!path) return settingsFailure(event, 400, 'That registry is not valid.');
	try {
		await apiFetch(event, path, { method: 'DELETE' });
		redirect(303, backTo(event.url));
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		return settingsFailure(event, apiStatus(err), apiMessage(err));
	}
}

export async function loadProjectSettings(event: RequestEvent, id: string): Promise<{
	envSets: EnvSet[];
	envSetsMessage: string | null;
	registries: Registry[];
	registriesMessage: string | null;
}> {
	const env = await readEnvSets(event, id);
	const registries = await readRegistries(event, id);
	return {
		envSets: env.items,
		envSetsMessage: env.message,
		registries: registries.items,
		registriesMessage: registries.message
	};
}

async function readEnvSets(event: RequestEvent, id: string) {
	try {
		const list = parseEnvSetList(await apiFetch(event, `/v1/projects/${id}/env-sets`));
		if (!list) return { items: [], message: UNEXPECTED };
		return { items: list.items, message: null };
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		return { items: [], message: apiMessage(err) };
	}
}

async function readRegistries(event: RequestEvent, id: string) {
	try {
		const list = parseRegistryList(await apiFetch(event, `/v1/projects/${id}/registries`));
		if (!list) return { items: [], message: UNEXPECTED };
		return { items: list.items, message: null };
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		return { items: [], message: apiMessage(err) };
	}
}
