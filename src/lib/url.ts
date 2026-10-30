/**
 * SvelteKit named action on the current path. The action is the search key
 * `&/<name>` (the same shape as `?/<name>`), so the rest of the query is still
 * there when the action renders the page. Undefined values are dropped.
 */
export function actionUrl(name: string, query: Record<string, string | undefined>): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value !== undefined) params.set(key, value);
	}
	const qs = params.toString();
	return qs ? `?${qs}&/${name}` : `?/${name}`;
}

/**
 * Named action on the current page. Keeps the query (tab, range, table state)
 * except `confirm`, SvelteKit `/name` keys, and any `drop` keys, then appends `&/name`.
 */
export function actionUrlFrom(url: URL, name: string, drop: readonly string[] = []): string {
	const params = new URLSearchParams(url.searchParams);
	const remove = new Set<string>(['confirm', ...drop]);
	for (const key of params.keys()) {
		if (key.startsWith('/')) remove.add(key);
	}
	for (const key of remove) params.delete(key);
	const qs = params.toString();
	return qs ? `?${qs}&/${name}` : `?/${name}`;
}

/** Same path and query after a successful action. Drops `confirm` and the `/name` action key. */
export function backTo(url: URL): string {
	const params = new URLSearchParams(url.searchParams);
	const remove = new Set<string>(['confirm']);
	for (const key of params.keys()) {
		if (key.startsWith('/')) remove.add(key);
	}
	for (const key of remove) params.delete(key);
	const qs = params.toString();
	return qs ? `${url.pathname}?${qs}` : url.pathname;
}
