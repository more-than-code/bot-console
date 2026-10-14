/** Windows for `GET /v1/hosts/{id}/metrics`. `step` stays the server default. */

export const RANGES = {
	'1h': { label: '1 hour', ms: 60 * 60 * 1000 },
	'6h': { label: '6 hours', ms: 6 * 60 * 60 * 1000 },
	'24h': { label: '24 hours', ms: 24 * 60 * 60 * 1000 },
	'7d': { label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 }
} as const;

export type RangeKey = keyof typeof RANGES;

const RANGE_KEYS = new Set<string>(Object.keys(RANGES));

/** Missing or unknown values use the API's own default, the last hour. */
export function parseRange(value: string | null): RangeKey {
	if (value != null && RANGE_KEYS.has(value)) return value as RangeKey;
	return '1h';
}

/** `from` and `to` are RFC3339 UTC. The span is exact for the chosen range. */
export function rangeWindow(range: RangeKey, now: number): { from: string; to: string } {
	return {
		from: new Date(now - RANGES[range].ms).toISOString(),
		to: new Date(now).toISOString()
	};
}
