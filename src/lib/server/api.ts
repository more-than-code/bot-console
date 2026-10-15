import { isIP } from 'node:net';
import { env } from '$env/dynamic/private';
import { fail, isHttpError, isRedirect, redirect, type RequestEvent } from '@sveltejs/kit';
import type { User, Project } from '../api-types';
import { present } from './redact';
import { clearSession, SESSION_COOKIE, signinLocation } from './session';
import { isRecord, parseListPayload, parseMe } from './shape';
import { isSessionToken } from './validate';

export const API_TIMEOUT_MS = 35_000;
export const BODY_LIMIT = 2_000_000;
const LIST_PAGE_CAP = 20;
const LIST_ITEM_CAP = 4000;

/** Client-address headers a caller might copy from the browser request. The API trusts only the address this process sets. */
const CLIENT_ADDRESS_HEADERS = [
	'x-forwarded-for',
	'forwarded',
	'x-real-ip',
	'x-client-ip',
	'client-ip',
	'cf-connecting-ip',
	'true-client-ip',
	'fastly-client-ip',
	'x-cluster-client-ip',
	'forwarded-for',
	'x-originating-ip'
] as const;

const CODE_STATUS: Record<string, number> = {
	bad_request: 400,
	unauthorized: 401,
	forbidden: 403,
	not_found: 404,
	conflict: 409,
	unavailable: 503,
	timeout: 504,
	error: 500,
	authorization_pending: 400,
	slow_down: 400,
	expired_token: 400,
	access_denied: 400,
	not_implemented: 501
};

export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly msg: string;

	constructor(status: number, code: string, msg: string) {
		super(msg);
		this.name = 'ApiError';
		this.status = status;
		this.code = code;
		this.msg = msg;
	}
}

export type SessionResult =
	| { kind: 'anonymous' }
	| { kind: 'unauthorized' }
	| { kind: 'unavailable' }
	| { kind: 'ready'; user: User; projects: Project[] };

type CallOptions = {
	bearer: string | null;
	on401: 'redirect' | 'throw';
	clearOn401: boolean;
};

/** Kit env first, then process.env. An empty kit value falls through. */
export function readPrivate(name: string): string {
	const bag = env as Record<string, string | undefined>;
	const kit = bag[name];
	const fromKit = typeof kit === 'string' ? kit.trim() : '';
	if (fromKit) return fromKit;
	return process.env[name]?.trim() ?? '';
}

export const NOT_CONFIGURED_MESSAGE = 'Console is not configured (BOT_API_URL)';

export function configuredApiUrl(): string {
	return readPrivate('BOT_API_URL');
}

function isLoopbackHost(hostname: string): boolean {
	// Node's URL.hostname keeps the brackets on an IPv6 literal (`[::1]`).
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

export function apiBaseUrl(): URL | null {
	const raw = configuredApiUrl();
	if (!raw) return null;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (url.username || url.password || url.search || url.hash) return null;
	if (url.pathname !== '/' && url.pathname !== '') return null;
	if (url.protocol === 'https:') return new URL(`${url.origin}/`);
	if (url.protocol !== 'http:') return null;
	if (!isLoopbackHost(url.hostname) && readPrivate('BOT_API_ALLOW_INSECURE_HTTP') !== '1') return null;
	return new URL(`${url.origin}/`);
}

export function apiFetch(event: RequestEvent, path: string, init?: RequestInit): Promise<unknown> {
	const raw = event.cookies.get(SESSION_COOKIE);
	const bearer = isSessionToken(raw) ? raw : null;
	return callApi(event, path, init, { bearer, on401: 'redirect', clearOn401: true });
}

/** OAuth start and callback are public. A 401 there must not clear a console session. */
export function apiFetchPublic(event: RequestEvent, path: string, init?: RequestInit): Promise<unknown> {
	return callApi(event, path, init, { bearer: null, on401: 'throw', clearOn401: false });
}

export async function loadSession(event: RequestEvent): Promise<SessionResult> {
	const raw = event.cookies.get(SESSION_COOKIE);
	if (!raw) return { kind: 'anonymous' };
	if (!isSessionToken(raw)) {
		clearSession(event);
		return { kind: 'unauthorized' };
	}
	if (!apiBaseUrl()) return { kind: 'unavailable' };
	try {
		const payload = await callApi(event, '/v1/me', undefined, { bearer: raw, on401: 'throw', clearOn401: true });
		const session = parseMe(payload);
		if (!session) return { kind: 'unavailable' };
		return { kind: 'ready', user: session.user, projects: session.projects };
	} catch (err) {
		if (isRedirect(err)) throw err;
		if (err instanceof ApiError && err.status === 401) return { kind: 'unauthorized' };
		return { kind: 'unavailable' };
	}
}

export async function apiList<T>(
	event: RequestEvent,
	path: string,
	parseItem: (value: unknown) => T | null
): Promise<{ items: T[]; omitted: number; truncated: boolean }> {
	const items: T[] = [];
	let omitted = 0;
	let truncated = false;
	let cursor: string | null = null;
	const seen = new Set<string>();
	for (let page = 0; page < LIST_PAGE_CAP && items.length < LIST_ITEM_CAP; page += 1) {
		if (cursor) {
			if (seen.has(cursor)) {
				truncated = true;
				break;
			}
			seen.add(cursor);
		}
		const params = new URLSearchParams({ limit: '200' });
		if (cursor) params.set('cursor', cursor);
		const payload = await apiFetch(event, `${path}?${params.toString()}`);
		const parsed = parseListPayload(payload);
		if (!parsed) throw new ApiError(502, 'error', 'The API returned an unexpected response.');
		const rawItems = parsed.raw.length > 500 ? parsed.raw.slice(0, 500) : parsed.raw;
		omitted += Math.max(0, parsed.raw.length - rawItems.length);
		for (const raw of rawItems) {
			if (items.length >= LIST_ITEM_CAP) {
				truncated = true;
				omitted += 1;
				continue;
			}
			const item = parseItem(raw);
			if (item) items.push(item);
			else omitted += 1;
		}
		if (!parsed.next) {
			cursor = null;
			break;
		}
		cursor = parsed.next;
	}
	if (cursor) truncated = true;
	return { items, omitted, truncated };
}

export function actionFailure(event: RequestEvent, err: unknown, scope?: string) {
	if (isRedirect(err) || isHttpError(err)) throw err;
	const data = scope ? { scope, message: messageOf(err) } : { message: messageOf(err) };
	const status = err instanceof ApiError && err.status >= 400 && err.status <= 599 ? err.status : 503;
	return fail(status, present(event, data));
}

export function loadFailure(err: unknown): { message: string } {
	if (isRedirect(err) || isHttpError(err)) throw err;
	return { message: messageOf(err) };
}

/** One IP from adapter-node, or nothing. Prerender and some tests throw; a chain or hostname is not forwarded. */
function clientAddress(event: RequestEvent): string | null {
	try {
		const value = event.getClientAddress();
		if (typeof value !== 'string' || isIP(value) === 0) return null;
		return value;
	} catch {
		return null;
	}
}

function messageOf(err: unknown): string {
	if (err instanceof ApiError) return err.msg;
	console.error('bot api request failed');
	return 'The API is unavailable.';
}

async function callApi(event: RequestEvent, path: string, init: RequestInit | undefined, options: CallOptions): Promise<unknown> {
	const target = endpointUrl(path);
	const method = init?.method ?? 'GET';
	const headers = new Headers(init?.headers);
	headers.delete('authorization');
	headers.delete('cookie');
	for (const name of CLIENT_ADDRESS_HEADERS) headers.delete(name);
	if (options.bearer) headers.set('authorization', `Bearer ${options.bearer}`);
	headers.set('accept', 'application/json');
	if (init?.body != null && !headers.has('content-type')) headers.set('content-type', 'application/json');
	const client = clientAddress(event);
	if (client) headers.set('x-forwarded-for', client);

	const timeout = AbortSignal.timeout(API_TIMEOUT_MS);
	const signal = init?.signal ? AbortSignal.any([timeout, init.signal]) : timeout;
	let response: Response;
	try {
		response = await fetch(target, {
			method,
			headers,
			body: init?.body,
			redirect: 'error',
			cache: 'no-store',
			signal
		});
	} catch (err) {
		if (isRedirect(err) || err instanceof ApiError) throw err;
		const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
		console.error(`bot api ${method} ${target.pathname} ${timedOut ? 'timeout' : 'unavailable'}`);
		if (timedOut) throw new ApiError(504, 'timeout', 'The API did not respond in time.');
		throw new ApiError(503, 'unavailable', 'The API is unavailable.');
	}

	const text = await readLimitedBody(response);
	if (response.status === 401) {
		rejectUnauthorized(event, options, method, target.pathname, text);
	}
	const envelope = readEnvelope(text, response.status);
	if (envelope.code === 'unauthorized') {
		rejectUnauthorized(event, options, method, target.pathname, text);
	}
	if (response.status >= 200 && response.status < 300 && envelope.code === 'ok') return envelope.payload;
	const status = response.status >= 400 ? response.status : (CODE_STATUS[envelope.code] ?? 500);
	console.error(`bot api ${method} ${target.pathname} ${status} ${envelope.code}`);
	throw new ApiError(status, envelope.code, envelope.msg || 'The request failed.');
}

function rejectUnauthorized(
	event: RequestEvent,
	options: CallOptions,
	method: string,
	pathname: string,
	text: string
): never {
	if (options.clearOn401) clearSession(event);
	console.error(`bot api ${method} ${pathname} 401 unauthorized`);
	if (options.on401 === 'redirect') redirect(303, signinLocation(event.url));
	throw new ApiError(401, 'unauthorized', envelopeMessage(text) ?? 'Sign in required.');
}

function envelopeMessage(text: string): string | null {
	try {
		const body: unknown = JSON.parse(text);
		if (isRecord(body) && typeof body.msg === 'string' && body.msg.length > 0 && body.msg.length <= 500) return body.msg;
	} catch {
		return null;
	}
	return null;
}

function endpointUrl(path: string): URL {
	if (!path.startsWith('/v1/') || path.includes('://') || path.includes('..') || path.includes('\\') || path.includes('#') || path.includes('\0')) {
		throw new ApiError(400, 'bad_request', 'The API request was rejected.');
	}
	const base = apiBaseUrl();
	if (!base) throw new ApiError(503, 'unavailable', 'The API is not configured.');
	const split = path.indexOf('?');
	const pathname = split === -1 ? path : path.slice(0, split);
	const search = split === -1 ? '' : path.slice(split);
	const target = new URL(base.origin);
	target.pathname = pathname;
	target.search = search;
	return target;
}

function declaredLength(response: Response): number | 'bad' | null {
	const raw = response.headers.get('content-length');
	if (raw == null) return null;
	if (!/^\d+$/.test(raw)) return 'bad';
	const value = Number(raw);
	if (!Number.isSafeInteger(value)) return 'bad';
	return value;
}

async function readLimitedBody(response: Response): Promise<string> {
	const declared = declaredLength(response);
	if (declared === 'bad' || (typeof declared === 'number' && declared > BODY_LIMIT)) {
		await response.body?.cancel().catch(() => undefined);
		throw new ApiError(502, 'error', 'The API returned an unexpected response.');
	}
	const body = response.body;
	if (!body) return '';
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value || value.byteLength === 0) continue;
			total += value.byteLength;
			if (total > BODY_LIMIT) {
				await reader.cancel().catch(() => undefined);
				throw new ApiError(502, 'error', 'The API returned an unexpected response.');
			}
			chunks.push(value);
		}
	} catch (err) {
		if (err instanceof ApiError) throw err;
		await reader.cancel().catch(() => undefined);
		if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
			throw new ApiError(504, 'timeout', 'The API did not respond in time.');
		}
		throw new ApiError(502, 'error', 'The API returned an unexpected response.');
	}
	const merged = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(merged);
}

function readEnvelope(text: string, status: number): { code: string; msg: string; payload: unknown } {
	let body: unknown;
	try {
		body = text.length === 0 ? null : JSON.parse(text);
	} catch {
		throw new ApiError(status >= 400 ? status : 502, 'error', 'The API returned an unexpected response.');
	}
	if (!isRecord(body) || typeof body.code !== 'string' || typeof body.msg !== 'string' || !('payload' in body)) {
		throw new ApiError(status >= 400 ? status : 502, 'error', 'The API returned an unexpected response.');
	}
	const msg = body.msg.length > 500 ? body.msg.slice(0, 500) : body.msg;
	return { code: body.code, msg, payload: body.payload };
}
