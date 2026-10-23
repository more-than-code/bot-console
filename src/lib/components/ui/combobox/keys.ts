/**
 * What the free-text combobox input does with a key, before bits-ui sees it.
 * - `caret`: Home/End stay with the text field (bits-ui is not called; `navigated` is unchanged).
 * - `submit`: Enter with the list open and nothing the user moved to: close the list and let the form submit the typed text.
 * - `reveal`: the first ArrowDown shows the option bits-ui already highlighted (the first) instead of skipping it.
 * - `end`: the first ArrowUp highlights the last option (an End key is sent to bits-ui).
 * - `navigate`: an arrow or Page key the user moves with; marks the list as navigated and passes on.
 * - `pass`: everything else goes to bits-ui as is (Enter after navigating picks; Escape closes the list).
 */
export type ComboboxKeyAction = "caret" | "submit" | "reveal" | "end" | "navigate" | "pass";

const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "PageDown", "PageUp"]);

export function comboboxKeyAction(key: string, state: { open: boolean; navigated: boolean; hasHighlight: boolean }): ComboboxKeyAction {
	if (key === "Home" || key === "End") return "caret";
	if (key === "Enter" && state.open && !state.navigated) return "submit";
	if (state.open && !state.navigated && state.hasHighlight) {
		if (key === "ArrowDown") return "reveal";
		if (key === "ArrowUp") return "end";
	}
	if (NAV_KEYS.has(key)) return "navigate";
	return "pass";
}
