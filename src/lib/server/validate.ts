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
const INSTALL_COMMAND = /^printf '%s' '([A-Za-z0-9_-]+)' \| sudo -u bot-agent bot-agent init --server '([^'\s]+)' --join-token-stdin$/;

export function isJoinToken(value: string): boolean {
	return JOIN_TOKEN.test(value);
}

/** The init command is shown only when it matches the fixed form and embeds this token. */
export function acceptedInstallCommand(command: string, token: string): string | null {
	// The server capture would otherwise allow `$(...)` inside the quotes.
	if (command.includes('$(')) return null;
	const match = INSTALL_COMMAND.exec(command);
	if (!match || match[1] !== token) return null;
	return command;
}
