/** Postgres undefined_table / undefined_column. Other failures must still surface. */
const MISSING_METRIC_SHAPE = new Set(['42P01', '42703']);

export function isMissingMetricShape(err: unknown): boolean {
	if (!err || typeof err !== 'object') return false;
	const code = (err as { code?: unknown }).code;
	return typeof code === 'string' && MISSING_METRIC_SHAPE.has(code);
}
