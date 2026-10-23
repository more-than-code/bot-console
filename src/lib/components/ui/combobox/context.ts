import { getContext, setContext } from "svelte";

/**
 * Shared by the combobox parts. `navigated` is true once the user moves through the options with
 * the arrow, Page or Home/End keys. Until then the input is free text: an option bits-ui highlights
 * on its own is not shown as active, and Enter is left to the form.
 */
export type ComboboxNav = {
	readonly listId: string;
	readonly open: boolean;
	navigated: boolean;
	show(): void;
	close(): void;
};

const KEY = Symbol("combobox-nav");

export function setComboboxNav(nav: ComboboxNav): ComboboxNav {
	return setContext(KEY, nav);
}

export function comboboxNav(): ComboboxNav {
	const nav = getContext<ComboboxNav | undefined>(KEY);
	if (!nav) throw new Error("Combobox parts must be inside Combobox.Root");
	return nav;
}
