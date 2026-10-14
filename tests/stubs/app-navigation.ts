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
