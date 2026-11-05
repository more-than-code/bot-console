import type { CatalogEntry, Host, ProjectServiceRow } from './api-types';
import { formatUptime } from './format';
import { serviceHostReachable } from './host-view';
import type { NotRunningPair } from './service-actions';
import { serviceLabel } from './service-label';

/**
 * One row of the Catalog & services tab: a catalog entry, its running copies (one per host, in host-name
 * order), and the hosts a program never ran on (Start only).
 */
export type CatalogRow = {
	entry: CatalogEntry;
	copies: ProjectServiceRow[];
	idle: Host[];
};

/** The API caps one services page at this many rows. */
export const COPIES_PAGE_LIMIT = 200;
/** At most this many services pages are read for one tab load. */
export const COPIES_MAX_PAGES = 5;
export const COPIES_CAPPED_NOTE = 'Some running copies could not be listed.';
/**
 * At most this many container copies get a status read per page load (spec §10): the first ones in entry
 * order, then host order. Every load reads them, so this bounds the fan-out to the hosts.
 */
export const STATUS_READ_LIMIT = 100;
export const STATUS_CAPPED_NOTE = `Live state is shown for the first ${STATUS_READ_LIMIT} copies.`;

function raw(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** Host names compare without case first (pi1 next to Pi2), then exactly, so the order is stable. */
export function byHostName(a: string, b: string): number {
	return raw(a.toLowerCase(), b.toLowerCase()) || raw(a, b);
}

/**
 * The copies of each listed entry: owned rows of this project whose `catalog_entry` names that entry, in
 * host-name order. Discovered rows, another project's rows, and rows of entries not listed are left out.
 */
export function groupCopies(
	rows: readonly ProjectServiceRow[],
	projectId: string,
	entries: readonly { name: string }[]
): Record<string, ProjectServiceRow[]> {
	const names = new Set(entries.map((entry) => entry.name));
	const groups: Record<string, ProjectServiceRow[]> = {};
	for (const row of rows) {
		if (row.source !== 'owned' || row.project_id !== projectId || row.catalog_entry == null) continue;
		if (!names.has(row.catalog_entry)) continue;
		(groups[row.catalog_entry] ??= []).push(row);
	}
	for (const copies of Object.values(groups)) {
		copies.sort((a, b) => byHostName(a.host_name, b.host_name) || raw(a.id, b.id));
	}
	return groups;
}

/** Each entry with its copies and the hosts it never ran on, in the entries' order. */
export function catalogRows(
	entries: readonly CatalogEntry[],
	copies: Readonly<Record<string, readonly ProjectServiceRow[]>>,
	notRunning: readonly NotRunningPair[]
): CatalogRow[] {
	return entries.map((entry) => ({
		entry,
		copies: [...(Object.hasOwn(copies, entry.name) ? copies[entry.name] : [])],
		idle: notRunning
			.filter((pair) => pair.entry.name === entry.name)
			.map((pair) => pair.host)
			.sort((a, b) => byHostName(a.name, b.name) || raw(a.id, b.id))
	}));
}

/**
 * With a host chosen, each row keeps only its copy (or never-ran host) there, and rows with nothing there
 * are left out. A null host keeps every row as it is.
 */
export function rowsOnHost(rows: readonly CatalogRow[], hostId: string | null): CatalogRow[] {
	if (hostId == null) return [...rows];
	const out: CatalogRow[] = [];
	for (const row of rows) {
		const copies = row.copies.filter((copy) => copy.host_id === hostId);
		const idle = row.idle.filter((host) => host.id === hostId);
		if (copies.length > 0 || idle.length > 0) out.push({ ...row, copies, idle });
	}
	return out;
}

/** What a search matches on the copies: each copy's host name and label, one per line. */
export function copySearchText(row: CatalogRow): string {
	return row.copies.map((copy) => `${copy.host_name}\n${serviceLabel(copy)}`).join('\n');
}

/**
 * Cell classes of the Catalog & services table, shared by entry rows and their copy rows so a copy's
 * host, status, label and icons sit under the entry's own columns (spec §10). Below `sm` only Name and
 * Actions show; the Name cell then carries the kind and command (entries) or status and label (copies).
 */
export const CATALOG_CELL = {
	/** The arrow that shows and hides the entry's services. */
	toggle: 'w-px p-2 align-middle',
	/** Below `sm` the name cell takes the free width but no more, so its lines truncate instead of widening the table. */
	name: 'p-2 align-middle max-sm:w-full max-sm:max-w-0',
	kind: 'p-2 align-middle max-sm:hidden',
	command: 'p-2 align-middle max-sm:hidden',
	services: 'p-2 align-middle max-sm:hidden',
	lastDeployed: 'p-2 align-middle whitespace-nowrap max-sm:hidden',
	actions: 'p-2 align-middle whitespace-normal',
	/**
	 * The action icons in fixed slots (four columns of icon width at every width from `sm`), the same on
	 * entry and copy rows, so icons line up down the column. Below `sm` only the 44 px ⋯ menu shows.
	 */
	actionsGroup: 'm-0 ml-auto grid w-max min-w-0 grid-cols-[repeat(4,1.75rem)] items-center gap-1 border-0 p-0 max-sm:grid-cols-[2.75rem]'
} as const;

/**
 * Cell classes of an entry's nested services table (Host | Status | Port | Digest | Uptime | actions).
 * Below `sm` only Host (with status, then port, digest and uptime on a second line) and the ⋯ menu show.
 */
export const SERVICES_CELL = {
	host: 'px-2 py-1.5 align-middle whitespace-normal max-sm:w-full max-sm:max-w-0',
	status: 'px-2 py-1.5 align-middle max-sm:hidden',
	port: 'px-2 py-1.5 align-middle font-mono text-xs max-sm:hidden',
	digest: 'px-2 py-1.5 align-middle max-sm:hidden',
	uptime: 'px-2 py-1.5 align-middle whitespace-nowrap max-sm:hidden',
	actions: 'px-2 py-1.5 align-middle text-right'
} as const;

export const HOST_UNREACHABLE = 'That host is not available for this project.';
export const NOTHING_ON_HOST = 'Nothing in the catalog runs on this host.';
export const NO_ENTRIES = 'No catalog entries.';

/** The hosts the host filter offers: owned hosts and deploy shares. */
export function hostChoices<H extends Pick<Host, 'relation' | 'share_level'>>(hosts: readonly H[]): H[] {
	return hosts.filter((host) => serviceHostReachable(host));
}

/**
 * The `catalog.host` in effect: a host among the choices, or null. Any other non-empty value is ignored
 * and gives the notice.
 */
export function chosenHost(raw: string | null, choices: readonly { id: string }[]): { hostId: string | null; notice: string | null } {
	if (raw == null || raw === '') return { hostId: null, notice: null };
	if (choices.some((host) => host.id === raw)) return { hostId: raw, notice: null };
	return { hostId: null, notice: HOST_UNREACHABLE };
}

/** The empty-table line: the host text only for a host filter alone, with no search and no Kind filter. */
export function catalogEmptyText(input: { hostChosen: boolean; searching: boolean; kindFiltered: boolean; entries: number }): string {
	if (input.hostChosen && !input.searching && !input.kindFiltered && input.entries > 0) return NOTHING_ON_HOST;
	return NO_ENTRIES;
}

/** What a copy's badge says. `loading` is a spinner while its state is still being read. */
export type CopyState = 'running' | 'unhealthy' | 'stopped' | 'noStatus' | 'loading';

export const COPY_STATE_TEXT: Record<Exclude<CopyState, 'loading'>, string> = {
	running: 'Running',
	unhealthy: 'Unhealthy',
	stopped: 'Stopped',
	noStatus: 'No status'
};
export const NO_STATUS_TIP = "Couldn't read the state from the host";
export const NOT_STARTED = 'Not started';
export const NOT_DEPLOYED = 'Not deployed';

/**
 * One copy's state word: the service Status badge and the summary counts (spec §10, status badge rule),
 * in this order. `runtime` null: a read is pending (`loading`, a spinner). `undefined`: no read (no grant).
 * 1. A gone row, or a container that is stopped (exited, created, dead) or missing: `stopped`.
 * 2. A container that is restarting: `unhealthy`.
 * 3. A running or paused container: health `down` is `unhealthy`, otherwise `running` (health unknown does
 *    not make it unhealthy; see `healthNote`).
 * 4. A container whose live state was not read (the read failed or timed out, the host is not online, it is
 *    past the 100-copy cap, or the caller has no grant): health `up` is `running`, `down` is `unhealthy`,
 *    unknown is `noStatus`.
 * 5. A program (no live read): health `down` is `unhealthy`, otherwise `running` while reported (and
 *    `stopped` when gone, rule 1).
 */
export function copyState(
	copy: Pick<ProjectServiceRow, 'kind' | 'gone_at' | 'health'>,
	runtime: { state: string } | null | undefined
): CopyState {
	if (runtime === null) return 'loading';
	const health = copy.health?.status ?? 'unknown';
	if (copy.gone_at != null) return 'stopped';
	if (copy.kind !== 'container') return health === 'down' ? 'unhealthy' : 'running';
	switch (runtime?.state) {
		case 'stopped':
		case 'missing':
			return 'stopped';
		case 'restarting':
			return 'unhealthy';
		case 'running':
		case 'paused':
			return health === 'down' ? 'unhealthy' : 'running';
		default:
			// Not read: fall back to the health the host reports.
			if (health === 'up') return 'running';
			if (health === 'down') return 'unhealthy';
			return 'noStatus';
	}
}

/**
 * The tooltip line of a Running container whose health is not `up` (rule 3): "No health check" when the row
 * has no health source, "Health not checked recently" when it has one but the result is unknown or stale.
 */
export function healthNote(
	copy: Pick<ProjectServiceRow, 'kind' | 'health'>,
	state: CopyState
): string | null {
	if (state !== 'running' || copy.kind !== 'container' || copy.health?.status === 'up') return null;
	return copy.health?.source ? 'Health not checked recently' : 'No health check';
}

export type CopySummary = {
	/** Copies plus hosts it never ran on. */
	total: number;
	hosts: string[];
	running: number;
	unhealthy: number;
	stopped: number;
	notStarted: number;
	noStatus: number;
	/** Some copy's state is still being read. */
	loading: boolean;
};

/** The Services column of one entry: counts of its (host-filtered) copies by state, and its hosts. */
export function copySummary(row: Pick<CatalogRow, 'copies' | 'idle'>, stateOf: (copy: ProjectServiceRow) => CopyState): CopySummary {
	const summary: CopySummary = {
		total: row.copies.length + row.idle.length,
		hosts: [...row.copies.map((copy) => copy.host_name), ...row.idle.map((host) => host.name)],
		running: 0,
		unhealthy: 0,
		stopped: 0,
		notStarted: row.idle.length,
		noStatus: 0,
		loading: false
	};
	for (const copy of row.copies) {
		const state = stateOf(copy);
		if (state === 'loading') summary.loading = true;
		else summary[state] += 1;
	}
	return summary;
}

/** "pi1, pi2, pi3 +2": at most `max` host names, then how many more. */
export function hostsText(hosts: readonly string[], max = 3): string {
	if (hosts.length <= max) return hosts.join(', ');
	return `${hosts.slice(0, max).join(', ')} +${hosts.length - max}`;
}

/** The copy line's mono detail: "port 8080 · sha256:abcdef123456" (parts left out when missing). */
export function copyDetailText(ports: readonly number[], shortDigest: string | null): string {
	const parts: string[] = [];
	if (ports.length === 1) parts.push(`port ${ports[0]}`);
	else if (ports.length > 1) parts.push(`ports ${ports.join(', ')}`);
	if (shortDigest) parts.push(shortDigest);
	return parts.join(' · ');
}

/** A start time up to this far in the future (clock skew between host and console) still counts. */
export const UPTIME_SKEW_MS = 30_000;

/**
 * The Uptime cell: time since a running container started (from its live status); "<1m" under a minute;
 * a dash for programs, stopped copies, unknown states, or a start time too far ahead.
 */
export function copyUptime(
	state: CopyState,
	runtime: { container?: { startedAt?: string | null } } | null | undefined,
	now: number
): string {
	const started = runtime?.container?.startedAt;
	if (state !== 'running' && state !== 'unhealthy') return '—';
	if (!started) return '—';
	const time = Date.parse(started);
	if (!Number.isFinite(time) || time > now + UPTIME_SKEW_MS) return '—';
	const seconds = Math.max(0, (now - time) / 1000);
	return seconds < 60 ? '<1m' : formatUptime(seconds);
}

/** The ports text: "8080" or "80, 443"; blank when there are none. */
export function portsText(ports: readonly number[]): string {
	return ports.join(', ');
}

/**
 * The one badge the phone line shows for a collapsed entry: the worst state present (unhealthy, then no
 * status, stopped, not started, running), with its count. Null when nothing has been read yet.
 */
export function worstState(summary: CopySummary): { tone: string; text: string } | null {
	if (summary.unhealthy > 0) return { tone: 'down', text: `${summary.unhealthy} unhealthy` };
	if (summary.noStatus > 0) return { tone: 'unknown', text: `${summary.noStatus} no status` };
	if (summary.stopped > 0) return { tone: 'stopped', text: `${summary.stopped} stopped` };
	if (summary.notStarted > 0) return { tone: 'unknown', text: `${summary.notStarted} not started` };
	if (summary.running > 0) return { tone: 'up', text: `${summary.running} running` };
	return null;
}
