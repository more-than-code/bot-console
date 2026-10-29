/** Server render does not run actions. The export keeps `use:enhance` resolvable. */
export function enhance(): Record<string, never> {
	return {};
}

/** Same wire shape as SvelteKit's, minus devalue: tests pass plain JSON. */
export function deserialize(text: string): unknown {
	return JSON.parse(text);
}
