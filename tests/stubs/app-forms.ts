/** Server render does not run actions. The export keeps `use:enhance` resolvable. */
export function enhance(): Record<string, never> {
	return {};
}
