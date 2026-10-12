/** Postgres undefined_table / undefined_column. Other failures must still surface. */
const MISSING_METRIC_SHAPE = new Set(['42P01', '42703']);

/** How long a missing relation stays cached. A missing column is never cached. */
export const MISSING_RELATION_TTL_MS = 60_000;

export function pgErrorCode(err: unknown): string | null {
	if (!err || typeof err !== 'object') return null;
	const code = (err as { code?: unknown }).code;
	return typeof code === 'string' ? code : null;
}

export function isMissingMetricShape(err: unknown): boolean {
	const code = pgErrorCode(err);
	return code != null && MISSING_METRIC_SHAPE.has(code);
}

/** Remember 42P01 only. 42703 is a column mismatch and must be retried next poll. */
export function rememberMissingRelation(cache: Map<string, number>, key: string, code: string, now: number): void {
	if (code !== '42P01') return;
	cache.set(key, now + MISSING_RELATION_TTL_MS);
}

export function missingRelationRemembered(cache: Map<string, number>, key: string, now: number): boolean {
	const until = cache.get(key);
	if (until == null) return false;
	if (now >= until) {
		cache.delete(key);
		return false;
	}
	return true;
}
