import { timingSafeEqual } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u001F\u007F]/;
const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';

export function isUuid(value: string): boolean {
	return UUID.test(value);
}

export function isSessionToken(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length >= 16 &&
		value.length <= 3500 &&
		/^[\x21-\x7E]+$/.test(value) &&
		!value.includes(';') &&
		!value.includes('\\')
	);
}

export function secretEqual(left: string, right: string): boolean {
	const a = Buffer.from(left);
	const b = Buffer.from(right);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

export function normalizeUserCode(value: string | null | undefined): string | null {
	if (!value) return null;
	const compact = value.trim().toUpperCase().replaceAll('-', '');
	if (compact.length !== 8) return null;
	for (const char of compact) {
		if (!USER_CODE_ALPHABET.includes(char)) return null;
	}
	return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

export function cleanName(value: string): string | null {
	const name = value.trim();
	if (name.length < 1 || name.length > 80 || CONTROL.test(name)) return null;
	return name;
}

/** Person-set service name. 1–64 printable characters after trim. */
export function cleanDisplayName(value: string): string | null {
	const name = value.trim();
	if (name.length < 1 || name.length > 64 || CONTROL.test(name)) return null;
	return name;
}

export function cleanEmail(value: string): string | null {
	const email = value.trim();
	if (email.length < 3 || email.length > 254 || CONTROL.test(email)) return null;
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
	return email;
}

export function cleanRole(value: string): 'admin' | 'viewer' | null {
	if (value === 'admin' || value === 'viewer') return value;
	return null;
}

export function cleanHint(value: string): string | null {
	const hint = value.trim();
	if (!hint) return null;
	if (hint.length > 80 || CONTROL.test(hint)) return null;
	return hint;
}

/** Empty input means the server default. A non-empty invalid value is rejected. */
export function cleanExpiry(value: string): { ok: true; seconds: number | null } | { ok: false } {
	const trimmed = value.trim();
	if (!trimmed) return { ok: true, seconds: null };
	if (!/^\d+$/.test(trimmed)) return { ok: false };
	const seconds = Number(trimmed);
	if (!Number.isInteger(seconds) || seconds < 300 || seconds > 604800) return { ok: false };
	return { ok: true, seconds };
}

export function isHttpsUrl(value: unknown): value is string {
	if (typeof value !== 'string' || value.length < 8 || value.length > 4096 || CONTROL.test(value)) return false;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && !url.username && !url.password;
	} catch {
		return false;
	}
}

export function isJoinSecret(value: unknown): value is string {
	return typeof value === 'string' && value.length >= 1 && value.length <= 4096 && !CONTROL.test(value);
}

const JOIN_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
/** 256-bit unpadded base64url. One path segment, nothing else. */
const INVITE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function isInviteToken(value: unknown): value is string {
	return typeof value === 'string' && INVITE_TOKEN.test(value);
}

/**
 * Shareable invite link from the API. The origin must be this console's origin
 * and the path must be exactly `/invite/<token>`. A foreign host, an http/https
 * mismatch, javascript:, userinfo, and a mismatched path are refused.
 */
export function acceptedInviteUrl(token: string, raw: unknown, origin: string): string | null {
	if (!isInviteToken(token)) return null;
	if (typeof origin !== 'string' || origin.length === 0 || origin.length > 2048 || CONTROL.test(origin)) return null;
	if (typeof raw !== 'string' || raw.length < 8 || raw.length > 2048 || CONTROL.test(raw)) return null;
	if (raw !== raw.trim()) return null;
	let url: URL;
	let expected: URL;
	try {
		url = new URL(raw);
		expected = new URL(origin);
	} catch {
		return null;
	}
	if (expected.origin !== origin || expected.pathname !== '/' || expected.search !== '' || expected.hash !== '') return null;
	if (url.username || url.password || url.hostname.length === 0) return null;
	if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
	if (url.origin !== expected.origin) return null;
	if (url.search !== '' || url.hash !== '') return null;
	if (url.pathname !== `/invite/${token}`) return null;
	return url.href;
}
const INSTALL_COMMAND = /^printf '%s' '([A-Za-z0-9_-]+)' \| sudo -u bot-agent bot-agent init --server '([^'\s]+)' --join-token-stdin$/;

export function isJoinToken(value: string): boolean {
	return JOIN_TOKEN.test(value);
}

/** Opaque consent id. At least 128 bits, and safe to place in one path segment. */
const OAUTH_REQUEST_ID = /^[A-Za-z0-9_-]{16,256}$/;

export function isOauthRequestId(value: unknown): value is string {
	return typeof value === 'string' && OAUTH_REQUEST_ID.test(value);
}

function isLoopbackHost(hostname: string): boolean {
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

/**
 * OAuth `redirect_to` from the API. https, or http only for a loopback host
 * (RFC 8252). Returns the parsed URL, or null for javascript:, data:, a
 * non-loopback http URL, userinfo, or a value that does not parse.
 */
export function consentRedirect(value: unknown): string | null {
	if (typeof value !== 'string' || value.length < 8 || value.length > 4096 || CONTROL.test(value)) return null;
	if (value !== value.trim()) return null;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (url.username || url.password || url.hostname.length === 0) return null;
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHost(url.hostname))) return null;
	return url.href;
}

/** Characters a server URL may use. No quotes, `$`, backticks, spaces, `?`, `#`, `%` or non-ASCII (bidi, zero-width). */
const SERVER_CHARS = /^[A-Za-z0-9._~:/\-[\]]+$/;
const SERVER_HOSTNAME = /^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])$/;

/**
 * An agent server URL that is safe to put inside single quotes in a shell command and into an AI agent prompt:
 * wss://, or ws:// only for a loopback host; no userinfo, query or fragment; plain ASCII only.
 * Returns the string as given, or null.
 */
export function acceptedServerUrl(server: string): string | null {
	if (server.length === 0 || server.length > 2048 || !SERVER_CHARS.test(server)) return null;
	let url: URL;
	try {
		url = new URL(server);
	} catch {
		return null;
	}
	if (url.username || url.password || url.search || url.hash) return null;
	if (!SERVER_HOSTNAME.test(url.hostname)) return null;
	if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && isLoopbackHost(url.hostname))) return null;
	return server;
}

/**
 * Server URL from the API install command. Null when the command is not the
 * fixed form, embeds a different token, the server itself contains the token,
 * or the server fails `acceptedServerUrl`. The console never shows that command.
 */
export function acceptedInstallServer(command: string, token: string): string | null {
	const match = INSTALL_COMMAND.exec(command);
	if (!match || match[1] !== token) return null;
	const server = match[2];
	if (!server || server.includes(token)) return null;
	return acceptedServerUrl(server);
}
