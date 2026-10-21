import { getContext, setContext } from 'svelte';

export const TIME_ZONE_COOKIE = 'bot_tz';
export const TIME_ZONE_MAX_AGE = 31536000;

const KEY = Symbol('viewer-time-zone');

export type TimeZoneSource = { readonly current: string };

/** One to three IANA segments. Slashes, letters, digits, and `_`, `+`, `-` only. */
const ZONE_NAME = /^[A-Za-z0-9_+-]{1,32}(?:\/[A-Za-z0-9_+-]{1,32}){0,2}$/;

/** Allowlisted IANA name. Anything else, including a missing cookie, is rejected. */
export function parseTimeZone(value: string | null | undefined): string | null {
	if (!value || value.length > 64 || !ZONE_NAME.test(value)) return null;
	try {
		Intl.DateTimeFormat('en-NZ', { timeZone: value });
		return value;
	} catch {
		return null;
	}
}

export function systemTimeZone(): string {
	const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	return parseTimeZone(zone) ?? 'UTC';
}

export function browserTimeZone(): string | null {
	if (typeof Intl === 'undefined') return null;
	return parseTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
}

/** Not HttpOnly: the browser writes the zone it is actually in. */
export function timeZoneCookie(zone: string, secure: boolean): string {
	const securePart = secure ? '; Secure' : '';
	return `${TIME_ZONE_COOKIE}=${encodeURIComponent(zone)}; Path=/; Max-Age=${TIME_ZONE_MAX_AGE}; SameSite=Lax${securePart}`;
}

export function rememberTimeZone(zone: string): void {
	if (typeof document === 'undefined') return;
	const secure = typeof location !== 'undefined' && location.protocol === 'https:';
	document.cookie = timeZoneCookie(zone, secure);
}

export function provideTimeZone(source: TimeZoneSource): void {
	setContext(KEY, source);
}

export function timeZoneSource(): TimeZoneSource | null {
	return getContext<TimeZoneSource>(KEY) ?? null;
}
