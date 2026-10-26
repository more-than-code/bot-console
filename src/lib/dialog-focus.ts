import { tick } from 'svelte';

/**
 * `onCloseAutoFocus` handler that moves focus to `id`. bits-ui would restore focus to the trigger,
 * which Safari and Firefox never focused on click.
 */
export function restoreFocusTo(id: string): (event: Event) => void {
	return (event) => {
		event.preventDefault();
		document.getElementById(id)?.focus();
	};
}

/** Focus `id` once the view it is in has rendered. */
export async function focusAfterTick(id: string): Promise<void> {
	await tick();
	document.getElementById(id)?.focus();
}
