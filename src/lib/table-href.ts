/** Stable query-string builder for shareable table links. Null and '' are omitted. */

const KEY_ORDER = ['host', 'service', 'q', 'sort', 'order', 'dir', 'page', 'pageSize'];

export type QueryValues = Record<string, string | null>;

export function withQuery(path: string, state: QueryValues, overrides: Partial<QueryValues> = {}): string {
	const next: QueryValues = { ...state };
	for (const [key, value] of Object.entries(overrides)) next[key] = value ?? null;
	const params = new URLSearchParams();
	const extras = Object.keys(next).filter((key) => !KEY_ORDER.includes(key));
	for (const key of [...KEY_ORDER, ...extras]) {
		const value = next[key];
		if (value != null && value !== '') params.set(key, value);
	}
	const qs = params.toString();
	return qs ? `${path}?${qs}` : path;
}
