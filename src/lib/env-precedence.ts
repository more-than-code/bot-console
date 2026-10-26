/**
 * Which env source wins for a catalog image entry (api-v1 rule 12):
 * `env_sets` in order < `secret_env` < `env`. Keys are compared trimmed and case-sensitive.
 * Only key names are used; values never enter these notes.
 */

export type SelectedSet = { name: string; keys: readonly string[] };

/** A secret env row: its env key and the `<set>.<name>` it reads. */
export type SecretRef = { key: string; set: string; name: string };

type Winner = { kind: 'set'; name: string } | { kind: 'secret' } | { kind: 'env' };

export type EnvOverrides = {
	/** Inline env key → what it overrides (selected sets in order, and whether a secret has it too). */
	env: Map<string, { sets: string[]; secret: boolean }>;
	/** Secret env key → the selected sets it overrides, and whether an inline row overrides it. */
	secrets: Map<string, { sets: string[]; byEnv: boolean }>;
	/** Keys in two or more selected sets, with those sets in order and the source that is used. */
	conflicts: Array<{ key: string; sets: string[]; used: Winner }>;
};

function cleanKeys(keys: readonly string[]): Set<string> {
	return new Set(keys.map((key) => key.trim()).filter((key) => key !== ''));
}

export function envOverrides(envKeys: readonly string[], secretRows: readonly SecretRef[], selected: readonly SelectedSet[]): EnvOverrides {
	const env = cleanKeys(envKeys);
	const secrets = cleanKeys(secretRows.map((row) => row.key));
	const setsByKey = new Map<string, string[]>();
	for (const set of selected) {
		for (const key of cleanKeys(set.keys)) {
			const names = setsByKey.get(key) ?? [];
			if (!names.includes(set.name)) names.push(set.name);
			setsByKey.set(key, names);
		}
	}

	const result: EnvOverrides = { env: new Map(), secrets: new Map(), conflicts: [] };
	for (const key of env) {
		const sets = setsByKey.get(key) ?? [];
		const secret = secrets.has(key);
		if (sets.length > 0 || secret) result.env.set(key, { sets, secret });
	}
	for (const row of secretRows) {
		const key = row.key.trim();
		if (key === '') continue;
		// A secret that reads the same key from a selected set is that set's value, not an override of it.
		const same = row.name.trim() === key ? row.set.trim() : null;
		const sets = (setsByKey.get(key) ?? []).filter((name) => name !== same);
		const byEnv = env.has(key);
		if (sets.length > 0 || byEnv) result.secrets.set(key, { sets, byEnv });
		else result.secrets.delete(key);
	}
	for (const [key, sets] of setsByKey) {
		if (sets.length < 2) continue;
		const used: Winner = env.has(key) ? { kind: 'env' } : secrets.has(key) ? { kind: 'secret' } : { kind: 'set', name: sets[sets.length - 1] };
		result.conflicts.push({ key, sets, used });
	}
	return result;
}

function joinNames(names: readonly string[]): string {
	if (names.length <= 1) return names.join('');
	return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "env set a", "env sets a and b", "env sets a, b and the secret env", "the secret env". */
function sourceList(sets: readonly string[], secret: boolean): string {
	const items = [...sets, ...(secret ? ['the secret env'] : [])];
	const prefix = sets.length === 0 ? '' : sets.length === 1 ? 'env set ' : 'env sets ';
	return prefix + joinNames(items);
}

function winnerText(used: Winner): string {
	if (used.kind === 'env') return 'the inline env value is used';
	if (used.kind === 'secret') return 'the secret env value is used';
	return `${used.name} is used because it comes later in that order`;
}

/** The note under an inline env row, or null when the key overrides nothing. */
export function envOverrideNote(overrides: EnvOverrides, key: string): string | null {
	const hit = overrides.env.get(key.trim());
	if (!hit) return null;
	return `Overrides the value from ${sourceList(hit.sets, hit.secret)}. This value is used.`;
}

/** The note under a secret env row, or null when the key overrides nothing and is not overridden. */
export function secretOverrideNote(overrides: EnvOverrides, key: string): string | null {
	const hit = overrides.secrets.get(key.trim());
	if (!hit) return null;
	if (hit.sets.length === 0) return 'The inline env value with this key overrides this secret.';
	return `Overrides the value from ${sourceList(hit.sets, false)}. ${hit.byEnv ? 'The inline env value with this key is used.' : 'This value is used.'}`;
}

/** The line under the Env sets list once two or more are selected, in the order the API resolves them. */
export function setOrderLine(selected: readonly string[]): string | null {
	if (selected.length < 2) return null;
	return `Order used: ${selected.join(', ')}. A later set wins for keys in ${selected.length === 2 ? 'both' : 'more than one'}.`;
}

/** One note per key that two or more selected sets share. */
export function setConflictNotes(overrides: EnvOverrides): Array<{ key: string; sets: string[]; text: string }> {
	return overrides.conflicts.map(({ key, sets, used }) => ({ key, sets, text: `${key} is in ${joinNames(sets)}; ${winnerText(used)}.` }));
}
