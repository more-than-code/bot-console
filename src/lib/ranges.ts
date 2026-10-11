export const RANGES = {
	'1h': { label: '1 hour', window: '1 hour', bucket: '30 seconds', bucketMs: 30_000 },
	'1d': { label: '1 day', window: '1 day', bucket: '5 minutes', bucketMs: 5 * 60_000 },
	'1w': { label: '1 week', window: '7 days', bucket: '30 minutes', bucketMs: 30 * 60_000 }
} as const;

export type RangeKey = keyof typeof RANGES;

export function parseRange(value: string | null): RangeKey | null {
	if (value === '1h' || value === '1d' || value === '1w') return value;
	return null;
}
