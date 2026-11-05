/**
 * One-shot param from the Catalog Deploy drawer's "View logs" link: open that copy's Logs drawer.
 * Action URLs and the redirect after an action drop it, so it never comes back after use.
 */
export const CATALOG_LOGS_PARAM = 'catalog.logs';

/** Old Services tab params that still mean something on the Catalog & services tab. */
const SERVICES_PARAM_MAP: Readonly<Record<string, string>> = {
	'services.q': 'catalog.q',
	'services.host': 'catalog.host',
	'services.logs': CATALOG_LOGS_PARAM
};

/** Old Services tab params with no meaning on the Catalog & services tab. */
const SERVICES_PARAMS_DROPPED = new Set(['services.sort', 'services.dir', 'services.cursor', 'services.page', 'show']);

/**
 * Where an old `?tab=services` link goes: the same page with `tab=catalog`, `services.q`, `services.host` and
 * `services.logs` renamed to their `catalog.*` names, and the old sort, cursor, page and `show` params dropped.
 * `services.logs` needs `services.host` (it named a copy on that host), so without one it is dropped too.
 * A `catalog.*` param already in the URL wins. Null when the URL is not on the Services tab.
 */
export function servicesTabTarget(url: URL): string | null {
	if (url.searchParams.get('tab') !== 'services') return null;
	const params = new URLSearchParams();
	for (const [key, value] of url.searchParams) {
		if (SERVICES_PARAMS_DROPPED.has(key) || Object.hasOwn(SERVICES_PARAM_MAP, key)) continue;
		params.append(key, key === 'tab' ? 'catalog' : value);
	}
	for (const [from, to] of Object.entries(SERVICES_PARAM_MAP)) {
		if (from === 'services.logs' && !url.searchParams.has('services.host')) continue;
		const value = url.searchParams.get(from);
		if (value != null && !params.has(to)) params.set(to, value);
	}
	return `${url.pathname}?${params.toString()}`;
}

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
 * except `confirm`, `catalog.logs`, SvelteKit `/name` keys, and any `drop` keys, then appends `&/name`.
 */
export function actionUrlFrom(url: URL, name: string, drop: readonly string[] = []): string {
	const params = new URLSearchParams(url.searchParams);
	const remove = new Set<string>(['confirm', CATALOG_LOGS_PARAM, ...drop]);
	for (const key of params.keys()) {
		if (key.startsWith('/')) remove.add(key);
	}
	for (const key of remove) params.delete(key);
	const qs = params.toString();
	return qs ? `?${qs}&/${name}` : `?/${name}`;
}

/** Same path and query after a successful action. Drops `confirm`, `catalog.logs`, and the `/name` action key. */
export function backTo(url: URL): string {
	const params = new URLSearchParams(url.searchParams);
	const remove = new Set<string>(['confirm', CATALOG_LOGS_PARAM]);
	for (const key of params.keys()) {
		if (key.startsWith('/')) remove.add(key);
	}
	for (const key of remove) params.delete(key);
	const qs = params.toString();
	return qs ? `${url.pathname}?${qs}` : url.pathname;
}

/** The page's query without `permissions`, `catalog.logs` or a `/name` action key: the table state the Permissions drawer opens over. */
function withoutPermissions(url: URL): URLSearchParams {
	const params = new URLSearchParams(url.searchParams);
	params.delete('permissions');
	params.delete(CATALOG_LOGS_PARAM);
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
 * Hidden fields of a row's Permissions GET form: the current query (search, sort, filters) on the Catalog & services tab,
 * plus `permissions`, so closing the drawer returns to the same table state.
 */
export function permissionsOpenFields(url: URL, name: string): Array<{ name: string; value: string }> {
	const params = withoutPermissions(url);
	params.set('tab', 'catalog');
	params.set('permissions', name);
	return [...params].map(([key, value]) => ({ name: key, value }));
}

/** The same page with the Permissions drawer open for `name`: where the entry's ⋯ menu item navigates. */
export function permissionsOpenHref(url: URL, name: string): string {
	const params = new URLSearchParams(permissionsOpenFields(url, name).map((field) => [field.name, field.value]));
	return `${url.pathname}?${params.toString()}`;
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
