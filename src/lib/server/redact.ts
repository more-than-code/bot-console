import { SESSION_COOKIE } from './session';
import { isSessionToken } from './validate';

/** Remove the session token from any string we are about to send to the browser. */
export function redactSecrets<T>(value: T, secret: string | null): T {
	if (!secret || secret.length < 16) return value;
	const hidden: string = secret;
	return walk(value) as T;

	function walk(current: unknown): unknown {
		if (typeof current === 'string') return current.split(hidden).join('[redacted]');
		if (Array.isArray(current)) return current.map((item) => walk(item));
		if (current && typeof current === 'object') {
			const copy: Record<string, unknown> = {};
			for (const [key, item] of Object.entries(current)) copy[key] = walk(item);
			return copy;
		}
		return current;
	}
}

export function sessionTokenFrom(event: { cookies: { get: (name: string) => string | undefined } }): string | null {
	const raw = event.cookies.get(SESSION_COOKIE);
	return isSessionToken(raw) ? raw : null;
}

export function present<T>(event: { cookies: { get: (name: string) => string | undefined } }, value: T): T {
	return redactSecrets(value, sessionTokenFrom(event));
}
