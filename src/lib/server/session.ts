const CONTROL = /[\u0000-\u001F\u007F\\]/;
const DANGEROUS_ENCODING = /%2f|%5c|%00|%09|%0a|%0d/i;

export const SESSION_COOKIE = 'bot_session';
export const OAUTH_COOKIE = 'bot_oauth';
export const SESSION_MAX_AGE = 604800;
export const OAUTH_MAX_AGE = 600;

export type SessionCookieOptions = {
	httpOnly: true;
	sameSite: 'lax';
	path: '/';
	maxAge: number;
	secure: boolean;
};

export function sessionCookieOptions(url: URL): SessionCookieOptions {
	return {
		httpOnly: true,
		sameSite: 'lax',
		path: '/',
		maxAge: SESSION_MAX_AGE,
		secure: url.protocol === 'https:'
	};
}

export function oauthCookieOptions(url: URL): SessionCookieOptions {
	// Lax so the browser still sends this cookie on the top-level GET back from Google.
	return { ...sessionCookieOptions(url), maxAge: OAUTH_MAX_AGE };
}

export function clearSessionCookieHeader(url: URL): string {
	const secure = url.protocol === 'https:' ? '; Secure' : '';
	return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}

export function logicalPath(pathname: string): string {
	let path = pathname;
	if (path.endsWith('/__data.json')) path = path.slice(0, -'/__data.json'.length);
	else if (path.endsWith('.html__data.json')) path = path.slice(0, -'.html__data.json'.length) + '.html';
	else if (path.endsWith('/__route.js')) path = path.slice(0, -'/__route.js'.length);
	return path === '' ? '/' : path;
}

export function isApiPath(pathname: string): boolean {
	const path = logicalPath(pathname);
	return path === '/api' || path.startsWith('/api/');
}

/** Built assets and root files. App routes, including sign-in, are not static. */
export function isStaticAsset(pathname: string): boolean {
	const path = logicalPath(pathname);
	if (path.startsWith('/_app/') || path.startsWith('/.well-known/')) return true;
	return /^\/[^/]+\.(svg|png|ico|webp|txt|webmanifest|gif|jpe?g)$/i.test(path);
}

export function isPublicPath(pathname: string): boolean {
	const path = logicalPath(pathname);
	if (path === '/signin' || path.startsWith('/signin/')) return true;
	if (path === '/theme' || path.startsWith('/theme/')) return true;
	if (path === '/auth/google/callback') return true;
	return isStaticAsset(path);
}

export function needsNoStore(pathname: string): boolean {
	return !isStaticAsset(pathname);
}

/**
 * Same-origin relative path only. Rejects protocol-relative URLs, backslash
 * host tricks, and encoded slashes that browsers may treat as `//`.
 */
export function safeNext(value: string | null | undefined, fallback = '/projects'): string {
	if (typeof value !== 'string') return fallback;
	const trimmed = value.trim();
	if (!trimmed || trimmed.length > 2048) return fallback;
	if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return fallback;
	if (CONTROL.test(trimmed)) return fallback;

	const decoded = decodeNext(trimmed);
	if (!decoded) return fallback;

	let url: URL;
	let raw: URL;
	try {
		url = new URL(decoded, 'http://localhost');
		raw = new URL(trimmed, 'http://localhost');
	} catch {
		return fallback;
	}
	if (url.origin !== 'http://localhost' || raw.origin !== 'http://localhost') return fallback;
	if (url.username || url.password || raw.username || raw.password) return fallback;
	if (!url.pathname.startsWith('/') || url.pathname.startsWith('//') || url.pathname.includes('\\')) return fallback;
	if (isBlockedNext(url.pathname)) return fallback;
	return url.pathname + url.search;
}

function decodeNext(value: string): string | null {
	let decoded: string;
	try {
		decoded = decodeURIComponent(value);
	} catch {
		return null;
	}
	if (DANGEROUS_ENCODING.test(decoded)) {
		try {
			decoded = decodeURIComponent(decoded);
		} catch {
			return null;
		}
	}
	if (!decoded.startsWith('/') || decoded.startsWith('//') || CONTROL.test(decoded)) return null;
	return decoded;
}

function isBlockedNext(pathname: string): boolean {
	return (
		pathname === '/signin' ||
		pathname.startsWith('/signin/') ||
		pathname === '/signout' ||
		pathname.startsWith('/signout/') ||
		pathname.startsWith('/auth/')
	);
}

export function signinLocation(url: URL): string {
	const next = safeNext(`${logicalPath(url.pathname)}${url.search}`);
	return `/signin?next=${encodeURIComponent(next)}`;
}

export function parseOauthCookie(raw: string | undefined): { state: string; next: string } | null {
	if (!raw || raw.length > 3000) return null;
	let body: unknown;
	try {
		body = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
	const record = body as Record<string, unknown>;
	if (typeof record.state !== 'string' || typeof record.next !== 'string') return null;
	if (record.state.length < 1 || record.state.length > 512 || !/^[\x21-\x7E]+$/.test(record.state)) return null;
	return { state: record.state, next: safeNext(record.next) };
}

export function clearSession(event: {
	url: URL;
	cookies: { delete: (name: string, options: SessionCookieOptions) => void };
}): void {
	event.cookies.delete(SESSION_COOKIE, sessionCookieOptions(event.url));
}
