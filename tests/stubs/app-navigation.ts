/** Server render does not navigate. SearchField still imports these. */
export function goto(): Promise<void> {
	return Promise.resolve();
}

export function invalidate(): Promise<void> {
	return Promise.resolve();
}

export function invalidateAll(): Promise<void> {
	return Promise.resolve();
}

/** Every `replaceState(url)` call, in order. Tests read and clear it. */
export const replaceStateCalls: string[] = [];

export function replaceState(url: string | URL): void {
	replaceStateCalls.push(String(url));
}

/** Server render does not navigate, so no callback runs. */
export function afterNavigate(): void {}
