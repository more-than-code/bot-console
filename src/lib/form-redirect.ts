import { goto } from '$app/navigation';

type ActionResult = { type: string; location?: string };
type Navigate = (url: string, opts: { invalidateAll: boolean; noScroll: boolean; keepFocus: boolean }) => Promise<void>;

/**
 * An enhanced form's `update()`, except that a redirect back to the page keeps the scroll position and focus.
 * SvelteKit's default follows the redirect like a fresh navigation and can scroll to the top.
 */
export function updateInPlace(result: ActionResult, update: () => Promise<void>, navigate: Navigate = goto): Promise<void> {
	if (result.type === 'redirect' && result.location) {
		return navigate(result.location, { invalidateAll: true, noScroll: true, keepFocus: true });
	}
	return update();
}
