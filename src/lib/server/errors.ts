import { error, isHttpError } from '@sveltejs/kit';

export function logQueryFailure(err: unknown): void {
	const raw = err instanceof Error ? err.message.split('\n')[0] : 'unknown error';
	const safe = raw.replace(/password\s*=\s*\S+/gi, 'password=[redacted]').slice(0, 300);
	console.error(`metrics query failed: ${safe}`);
}

export async function withMetrics<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		if (isHttpError(err)) throw err;
		logQueryFailure(err);
		error(503, 'Metrics are temporarily unavailable');
	}
}
