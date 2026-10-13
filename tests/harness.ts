import type { Project, User } from '$lib/api-types';
import { env } from '$env/dynamic/private';
import type { RequestEvent } from '@sveltejs/kit';

export const TOKEN = 'session-token-0123456789abcdef';
export const JOIN = 'join-plain-0123456789abcdef';

export const USER: User = {
	id: '00000000-0000-4000-8000-000000000001',
	email: 'ada@example.com',
	name: 'Ada',
	avatar_url: null
};

export const PROJECT: Project = {
	id: '00000000-0000-4000-8000-000000000010',
	name: 'Lab',
	slug: 'lab',
	role: 'owner',
	created_at: '2026-10-13T00:00:00Z'
};

const savedApiUrl = process.env.BOT_API_URL;

function clearOptIns(): void {
	delete env.BOT_API_ALLOW_INSECURE_HTTP;
	delete process.env.BOT_API_ALLOW_INSECURE_HTTP;
	delete env.BOT_API_OAUTH_AUTHORIZE_HOSTS;
	delete process.env.BOT_API_OAUTH_AUTHORIZE_HOSTS;
}

export function useApi(url: string | null): void {
	clearOptIns();
	if (url) {
		env.BOT_API_URL = url;
		process.env.BOT_API_URL = url;
		return;
	}
	delete env.BOT_API_URL;
	delete process.env.BOT_API_URL;
}

export function restoreEnv(): void {
	clearOptIns();
	delete env.BOT_API_URL;
	if (savedApiUrl === undefined) delete process.env.BOT_API_URL;
	else process.env.BOT_API_URL = savedApiUrl;
}

export type CookieOp = {
	op: 'set' | 'delete';
	name: string;
	value?: string;
	options: {
		httpOnly?: boolean;
		sameSite?: string | boolean;
		path?: string;
		maxAge?: number;
		secure?: boolean;
	};
};

export type FetchCall = {
	url: URL;
	method: string;
	authorization: string | null;
	body: string | null;
	signal: AbortSignal | null;
	redirect: RequestInit['redirect'];
};

export function installFetch(handler: (call: FetchCall) => Response | Promise<Response>): FetchCall[] {
	const calls: FetchCall[] = [];
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		const headers = new Headers(init?.headers);
		const call: FetchCall = {
			url: new URL(raw),
			method: init?.method ?? 'GET',
			authorization: headers.get('authorization'),
			body: typeof init?.body === 'string' ? init.body : null,
			signal: init?.signal ?? null,
			redirect: init?.redirect
		};
		calls.push(call);
		return handler(call);
	}) as typeof fetch;
	return calls;
}

export function envelope(payload: unknown, status = 200, code = 'ok', msg = ''): Response {
	return new Response(JSON.stringify({ code, msg, payload }), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

export function fakeEvent(input: {
	url: string;
	method?: string;
	session?: string;
	oauth?: string;
	form?: Record<string, string>;
	params?: Record<string, string>;
	user?: User | null;
	projects?: Project[];
}): { event: RequestEvent; jar: Map<string, string>; sets: CookieOp[] } {
	const jar = new Map<string, string>();
	if (input.session) jar.set('bot_session', input.session);
	if (input.oauth) jar.set('bot_oauth', input.oauth);
	const sets: CookieOp[] = [];
	const method = input.method ?? (input.form ? 'POST' : 'GET');
	const headers = new Headers();
	if (input.form) {
		headers.set('content-type', 'application/x-www-form-urlencoded');
		headers.set('origin', new URL(input.url).origin);
	}
	const request = new Request(input.url, {
		method,
		headers,
		body: input.form ? new URLSearchParams(input.form) : undefined
	});
	const event = {
		url: new URL(input.url),
		request,
		params: input.params ?? {},
		locals: {
			authEnabled: true,
			user: input.user ?? null,
			projects: input.projects ?? [],
			sessionUnavailable: false
		},
		cookies: {
			get(name: string) {
				return jar.get(name);
			},
			set(name: string, value: string, options: CookieOp['options']) {
				jar.set(name, value);
				sets.push({ op: 'set', name, value, options });
			},
			delete(name: string, options: CookieOp['options']) {
				jar.delete(name);
				sets.push({ op: 'delete', name, options });
			},
			getAll() {
				return [];
			},
			serialize() {
				return '';
			}
		},
		fetch: globalThis.fetch,
		getClientAddress: () => '127.0.0.1',
		setHeaders() {},
		isDataRequest: false,
		isSubRequest: false,
		route: { id: null },
		platform: undefined,
		isRemoteRequest: false
	};
	return { event: event as unknown as RequestEvent, jar, sets };
}

export function containsToken(value: unknown, token = TOKEN): boolean {
	return JSON.stringify(value).includes(token);
}
