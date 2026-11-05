import type { CatalogRow } from './catalog-copies';
import { serviceLabel } from './service-label';

/**
 * Which Catalog & services entries are expanded. Collapsed by default; the set is remembered for the visit
 * in sessionStorage, per project, and ignored when storage is unavailable (spec §10, collapsible entries).
 */

type SessionLike = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * The browser's per-tab storage, or null on the server or when it is blocked. It holds only entry names
 * (never a token or other secret); the auth-session test allows this one file to use it.
 */
export function visitStorage(): Storage | null {
	try {
		return typeof sessionStorage === 'undefined' ? null : sessionStorage;
	} catch {
		return null;
	}
}

export function openStorageKey(projectId: string): string {
	return `deploybot:catalog-open:${projectId}`;
}

/** At most this many names are read back, and longer names are ignored (catalog names are at most 48). */
export const OPEN_NAMES_MAX = 500;
export const OPEN_NAME_LENGTH_MAX = 100;

const KEY_PREFIX = 'deploybot:catalog-open:';

/** The stored open entry names. Missing, unreadable or malformed storage is an empty set. */
export function readOpen(storage: SessionLike | null | undefined, projectId: string): Set<string> {
	try {
		const raw = storage?.getItem(openStorageKey(projectId));
		if (!raw) return new Set();
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return new Set();
		return new Set(
			parsed
				.slice(0, OPEN_NAMES_MAX)
				.filter((name): name is string => typeof name === 'string' && name !== '' && name.length <= OPEN_NAME_LENGTH_MAX)
		);
	} catch {
		return new Set();
	}
}

/**
 * Stores the user's open names, keeping only names of entries the page lists (`known`). Returns false when
 * storage is unavailable or refuses the write.
 */
export function writeOpen(
	storage: SessionLike | null | undefined,
	projectId: string,
	open: ReadonlySet<string>,
	known: ReadonlySet<string>
): boolean {
	try {
		if (!storage) return false;
		const names = [...open].filter((name) => known.has(name) && name.length <= OPEN_NAME_LENGTH_MAX).sort().slice(0, OPEN_NAMES_MAX);
		storage.setItem(openStorageKey(projectId), JSON.stringify(names));
		return true;
	} catch {
		return false;
	}
}

/** Removes every project's open names (on sign-out). Returns how many keys it removed. */
export function clearOpenStorage(storage: (Pick<Storage, 'removeItem' | 'key'> & { length: number }) | null | undefined): number {
	try {
		if (!storage) return 0;
		const keys: string[] = [];
		for (let index = 0; index < storage.length; index += 1) {
			const key = storage.key(index);
			if (key?.startsWith(KEY_PREFIX)) keys.push(key);
		}
		for (const key of keys) storage.removeItem(key);
		return keys.length;
	} catch {
		return 0;
	}
}

/**
 * The user's own choices: entries they opened (stored for the visit) and entries they closed while a
 * filter had opened them (not stored; dropped when the filters change).
 */
export type OpenState = { open: ReadonlySet<string>; closed: ReadonlySet<string> };

export type OpenAction =
	/** Storage was read after the page mounted. */
	| { type: 'restore'; stored: ReadonlySet<string> }
	/** The arrow or a row click; `forced` is whether a filter or link currently opens it. */
	| { type: 'toggle'; name: string; forced: boolean }
	/** Expand all or Collapse all, for the entries on view. */
	| { type: 'expand'; names: readonly string[] }
	| { type: 'collapse'; names: readonly string[] }
	/** A new search, host or Kind filter: forget which filter-opened entries the user closed. */
	| { type: 'filters-changed' };

export const NO_CHOICES: OpenState = { open: new Set(), closed: new Set() };

export function openReducer(state: OpenState, action: OpenAction): OpenState {
	switch (action.type) {
		case 'restore':
			return { open: new Set([...action.stored, ...state.open]), closed: state.closed };
		case 'toggle': {
			const open = new Set(state.open);
			const closed = new Set(state.closed);
			if (isEntryOpen(state, action.name, action.forced ? new Set([action.name]) : new Set())) {
				open.delete(action.name);
				closed.add(action.name);
			} else {
				open.add(action.name);
				closed.delete(action.name);
			}
			return { open, closed };
		}
		case 'expand': {
			const open = new Set(state.open);
			const closed = new Set(state.closed);
			for (const name of action.names) {
				open.add(name);
				closed.delete(name);
			}
			return { open, closed };
		}
		case 'collapse': {
			const open = new Set(state.open);
			const closed = new Set(state.closed);
			for (const name of action.names) {
				open.delete(name);
				closed.add(name);
			}
			return { open, closed };
		}
		case 'filters-changed':
			return state.closed.size === 0 ? state : { open: state.open, closed: new Set() };
	}
}

/** Open when the user opened it, or a filter or link opens it and the user has not closed it. */
export function isEntryOpen(state: OpenState, name: string, forced: ReadonlySet<string>): boolean {
	if (state.closed.has(name)) return false;
	return state.open.has(name) || forced.has(name);
}

/** Only an entry with copy rows (copies or hosts it never ran on) can open; the others have no arrow. */
export function canOpen(row: Pick<CatalogRow, 'copies' | 'idle'>): boolean {
	return row.copies.length > 0 || row.idle.length > 0;
}

/**
 * Entries a filter opens: with a host chosen, every listed entry with a copy row there; with a search,
 * every entry with a copy whose host or label matches it. Health never opens an entry.
 */
export function forcedOpen(rows: readonly CatalogRow[], q: string, hostChosen: boolean): string[] {
	const needle = q.trim().toLowerCase();
	const names: string[] = [];
	for (const row of rows) {
		if (!canOpen(row)) continue;
		if (hostChosen) {
			names.push(row.entry.name);
			continue;
		}
		if (needle === '') continue;
		const hit = row.copies.some(
			(copy) => copy.host_name.toLowerCase().includes(needle) || serviceLabel(copy).toLowerCase().includes(needle)
		);
		if (hit) names.push(row.entry.name);
	}
	return names;
}

/**
 * Entries opened by the page rather than the user (never stored): the filter matches (`forcedOpen`) and
 * the entry of the `catalog.logs` link, which opens before its service is selected.
 */
export function forcedNames(rows: readonly CatalogRow[], q: string, hostChosen: boolean, logsEntry: string | null): Set<string> {
	const names = new Set(forcedOpen(rows, q, hostChosen));
	if (logsEntry != null) names.add(logsEntry);
	return names;
}

/** The names Expand all and Collapse all act on: the entries on view that can open. */
export function openableNames(rows: readonly CatalogRow[]): string[] {
	return rows.filter(canOpen).map((row) => row.entry.name);
}

/** Controls inside a row act on their own; a click on them does not toggle the entry. */
export const ROW_CLICK_IGNORE = 'button, a, input, select, textarea, label, form, [role="menuitem"], [role="menu"], [data-no-row-toggle]';

/**
 * True when the click landed on the row itself, not on a control inside it, and did not end a text
 * selection (so selecting a word in the row, or double-clicking it, does not toggle).
 */
export function rowClickToggles(
	target: { closest(selector: string): unknown } | null,
	selection: { isCollapsed: boolean } | null = null
): boolean {
	if (target == null) return false;
	if (selection != null && !selection.isCollapsed) return false;
	return target.closest(ROW_CLICK_IGNORE) == null;
}
