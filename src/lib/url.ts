/**
 * One-shot Services param from the Catalog Deploy dialog's "View logs in Services" link.
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
