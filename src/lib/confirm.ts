/** Exact, case-sensitive match. The server check is still the authority. */
export function typeToConfirmMatches(typed: string, expected: string): boolean {
	return typed === expected;
}

/** Confirm stays disabled until the typed text matches. No expected text means the button is enabled. */
export function confirmSubmitDisabled(typed: string, expected: string | null): boolean {
	if (expected == null) return false;
	return !typeToConfirmMatches(typed, expected);
}

/** Delete, Remove and Revoke confirm in the destructive style; anything else (Make secret) in the default one. */
export function confirmIsDestructive(label: string): boolean {
	return /delete|remove|revoke/i.test(label);
}
