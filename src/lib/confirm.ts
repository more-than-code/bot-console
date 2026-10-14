/** No-JS link that opens this confirm step. Other query params stay. */
export function confirmHref(url: URL, id: string): string {
	const params = new URLSearchParams(url.searchParams);
	params.set('confirm', id);
	const qs = params.toString();
	return qs ? `${url.pathname}?${qs}` : url.pathname;
}

/** Open when JavaScript asked, or when the URL names this id and it has not been dismissed. */
export function confirmIsOpen(opened: boolean, confirmParam: string | null, id: string, dismissed: boolean): boolean {
	return opened || (confirmParam === id && !dismissed);
}

/** Exact, case-sensitive match. The server check is still the authority. */
export function typeToConfirmMatches(typed: string, expected: string): boolean {
	return typed === expected;
}
