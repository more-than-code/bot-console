/**
 * One-shot Services param from the Catalog Deploy drawer's "View logs in Services" link.
 * Action URLs and the redirect after an action drop it, so it never comes back after use.
 */
export const SERVICE_LOGS_PARAM = 'services.logs';

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
 * except `confirm`, `services.logs`, SvelteKit `/name` keys, and any `drop` keys, then appends `&/name`.
 */
export function actionUrlFrom(url: URL, name: string, drop: readonly string[] = []): string {
	const params = new URLSearchParams(url.searchParams);
	const remove = new Set<string>(['confirm', SERVICE_LOGS_PARAM, ...drop]);
	for (const key of params.keys()) {
		if (key.startsWith('/')) remove.add(key);
	}
	for (const key of remove) params.delete(key);
	const qs = params.toString();
	return qs ? `?${qs}&/${name}` : `?/${name}`;
}

/** Same path and query after a successful action. Drops `confirm`, `services.logs`, and the `/name` action key. */
export function backTo(url: URL): string {
	const params = new URLSearchParams(url.searchParams);
	const remove = new Set<string>(['confirm', SERVICE_LOGS_PARAM]);
	for (const key of params.keys()) {
		if (key.startsWith('/')) remove.add(key);
	}
	for (const key of remove) params.delete(key);
	const qs = params.toString();
	return qs ? `${url.pathname}?${qs}` : url.pathname;
}

/** The page's query without `permissions` or a `/name` action key: the table state the Permissions drawer opens over. */
function withoutPermissions(url: URL): URLSearchParams {
	const params = new URLSearchParams(url.searchParams);
	params.delete('permissions');
	for (const key of [...params.keys()]) {
		if (key.startsWith('/')) params.delete(key);
	}
	return params;
}

/** Where the Catalog Permissions drawer closes to: the same page without `permissions` or a `/name` action key. */
export function permissionsCloseHrefFor(url: URL): string {
	const qs = withoutPermissions(url).toString();
	return qs ? `${url.pathname}?${qs}` : url.pathname;
}

/**
 * Hidden fields of a row's Permissions GET form: the current query (search, sort, filters) on the Catalog tab,
 * plus `permissions`, so closing the drawer returns to the same table state.
 */
export function permissionsOpenFields(url: URL, name: string): Array<{ name: string; value: string }> {
	const params = withoutPermissions(url);
	params.set('tab', 'catalog');
	params.set('permissions', name);
	return [...params].map(([key, value]) => ({ name: key, value }));
}

/**
 * Where a user close of the Permissions drawer navigates: `closeHref`, unless a navigation to a different
 * `permissions` URL is already on its way (a click on another row's Permissions during the close), which wins.
 */
export function permissionsCloseTarget(closeHref: string, current: URL, pending: URL | null): string | null {
	if (pending != null && permissionsRequested(pending) && pending.href !== current.href) return null;
	return closeHref;
}

/** The URL asks for a Permissions drawer. A navigation that lands on one opens it, even if the last one was closing. */
export function permissionsRequested(url: URL): boolean {
	return (url.searchParams.get('permissions') ?? '') !== '';
}

/** A click the router turns into an in-page navigation: primary button, no modifier, not already handled. */
export function isPlainClick(event: ClickInfo): boolean {
	return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.defaultPrevented;
}

type ClickInfo = Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'defaultPrevented'>;

/** Click handler for a link that navigates in the page: runs `onPlain` (such as closing a dialog) on a plain click only. */
export function onPlainClick(onPlain: (() => void) | undefined): (event: ClickInfo) => void {
	return (event) => {
		if (isPlainClick(event)) onPlain?.();
	};
}
