import type { CatalogAction, CatalogEntry, Host, HostStatus, ImageState, ImageStatus, ServiceRuntime } from '$lib/api-types';
import { hostBlockReason, isCatalogHost } from '$lib/catalog';
import { shortDigest } from '$lib/image-spec';

/** What the Services tab needs from a catalog entry to act on one of its running copies. */
export type ServiceEntryRef = {
	name: string;
	kind: 'program' | 'image';
	my_actions: CatalogAction[];
	/** Program only; empty for an image. */
	runAs: string;
	/** Program only; false for an image. */
	shell: boolean;
};

/** A running container at or above this restart count says how many restarts it has had. */
export const MANY_RESTARTS = 5;

export const STATE_UNKNOWN_NOTE = 'State unknown.';
export const NO_CONTAINER_NOTE = 'No container on this host. Deploy it from the Catalog tab.';
/** Shown in place of the buttons while the row's container status is still being read. */
export const CHECKING_NOTE = 'checking…';

function restartsText(restarts: number): string {
	return `${restarts} ${restarts === 1 ? 'restart' : 'restarts'}`;
}

/** Tooltip line for a container Docker keeps restarting. */
export function restartingNote(restarts: number): string {
	return `restarting, ${restartsText(restarts)}`;
}

/** Tooltip line for a running container that has restarted many times. */
export function manyRestartsNote(restarts: number): string {
	return `${restartsText(restarts)} so far`;
}

export function hostDownNote(status: HostStatus): string {
	return `Host ${status}.`;
}

export function entryRef(entry: CatalogEntry): ServiceEntryRef {
	if (entry.kind === 'image') return { name: entry.name, kind: 'image', my_actions: [...entry.my_actions], runAs: '', shell: false };
	return { name: entry.name, kind: 'program', my_actions: [...entry.my_actions], runAs: entry.spec.run_as, shell: entry.spec.shell };
}

export function runtimeFromImageState(state: ImageState, restartCount: number): ServiceRuntime {
	switch (state) {
		case 'running':
		case 'restarting':
		case 'paused':
			return { state, restarts: restartCount };
		case 'exited':
		case 'created':
		case 'dead':
			return { state: 'stopped', restarts: restartCount };
		case 'missing':
			return { state: 'missing', restarts: null };
		default:
			return { state: 'unknown', restarts: null };
	}
}

export const UNKNOWN_RUNTIME: ServiceRuntime = { state: 'unknown', restarts: null };

/** A container's state plus the details the status badge tooltip shows. */
export function runtimeFromImageStatus(status: ImageStatus): ServiceRuntime {
	return {
		...runtimeFromImageState(status.state, status.restart_count),
		container: { state: status.state, exitCode: status.exit_code, digest: status.digest, ports: [...status.ports] }
	};
}

/**
 * Status badge tooltip. A container: Docker state, exit code when stopped, restarts, short digest, ports.
 * A program: its state only. Null when there is nothing to add.
 */
export function runtimeDetail(runtime: ServiceRuntime, hostStatus: HostStatus): string | null {
	if (hostStatus !== 'online') return hostDownNote(hostStatus);
	const container = runtime.container;
	if (container == null) {
		if (runtime.state === 'unknown') return STATE_UNKNOWN_NOTE;
		if (runtime.state === 'missing') return NO_CONTAINER_NOTE;
		return `Program ${runtime.state}.`;
	}
	if (container.state === 'missing') return NO_CONTAINER_NOTE;
	const parts = [`Docker ${container.state}`];
	if (runtime.state === 'stopped' && container.exitCode != null) parts.push(`exit ${container.exitCode}`);
	if (runtime.restarts != null) parts.push(restartsText(runtime.restarts));
	const digest = shortDigest(container.digest);
	if (digest) parts.push(digest);
	parts.push(container.ports.length > 0 ? `ports ${container.ports.join(', ')}` : 'no ports');
	return `${parts.join(', ')}.`;
}

type OwnedRow = {
	source: string;
	kind: string;
	gone_at: string | null;
	catalog_entry: string | null;
	project_id: string | null;
	host_id: string | null;
};

/** The entry that owns this row in this project, or null (discovered, declared, another project, or no grant). */
export function ownerEntry(row: OwnedRow, projectId: string, entries: readonly ServiceEntryRef[]): ServiceEntryRef | null {
	if (row.source !== 'owned' || row.catalog_entry == null || row.project_id !== projectId) return null;
	const entry = entries.find((item) => item.name === row.catalog_entry) ?? null;
	if (entry == null || entry.my_actions.length === 0) return null;
	return entry;
}

/**
 * An owned container on an online host: only catalog status tells running, exited and missing apart.
 * A gone row is read too, since a container the report left out can still exist (stopped).
 */
export function needsContainerStatus(row: OwnedRow & { host_status: HostStatus }, entry: ServiceEntryRef): boolean {
	return entry.kind === 'image' && row.kind === 'container' && row.host_status === 'online';
}

/** State known from the row alone. A container is unknown unless status answered. */
export function runtimeFromRow(row: OwnedRow): ServiceRuntime {
	if (row.kind === 'container') return UNKNOWN_RUNTIME;
	return { state: row.gone_at != null ? 'stopped' : 'running', restarts: null };
}

/** Buttons for one copy. The live details are the status badge's tooltip (`runtimeDetail`). */
export type ServiceControls = {
	entry: string;
	entryKind: 'program' | 'image';
	/** The enabled state button: Start (`run`) or Stop. */
	stateAction: 'run' | 'stop' | null;
	/** Start is shown but blocked, with this reason (offline host, unknown state, no container). Needs `run`. */
	blockedReason: string | null;
	restart: boolean;
	logs: boolean;
	/** Restart count line: on Stop's tooltip when Stop is shown, else on Logs. */
	crashNote: string | null;
};

/** Buttons for one owned copy on its host, by state and the caller's grants on the entry. */
export function serviceControls(entry: ServiceEntryRef, hostStatus: HostStatus, runtime: ServiceRuntime): ServiceControls {
	const can = (action: CatalogAction) => entry.my_actions.includes(action);
	const base: ServiceControls = {
		entry: entry.name,
		entryKind: entry.kind,
		stateAction: null,
		blockedReason: null,
		restart: false,
		logs: can('logs'),
		crashNote: null
	};
	const blocked = (reason: string): ServiceControls => ({ ...base, blockedReason: can('run') ? reason : null });
	if (hostStatus !== 'online') return blocked(hostDownNote(hostStatus));
	const restarts = runtime.restarts ?? 0;
	const stop = can('stop') ? ('stop' as const) : null;
	switch (runtime.state) {
		case 'running':
			return {
				...base,
				stateAction: stop,
				restart: can('restart'),
				crashNote: restarts >= MANY_RESTARTS ? manyRestartsNote(restarts) : null
			};
		case 'restarting':
			return { ...base, stateAction: stop, crashNote: restartingNote(restarts) };
		case 'paused':
			return { ...base, stateAction: stop };
		case 'stopped':
			return { ...base, stateAction: can('run') ? 'run' : null };
		case 'missing':
			return blocked(NO_CONTAINER_NOTE);
		default:
			return blocked(STATE_UNKNOWN_NOTE);
	}
}

/**
 * Reads each (entry, host) once and at most `max` at a time. Rows of the same copy share one promise.
 * `read` must not reject.
 */
export function statusReader(
	read: (entry: string, hostId: string) => Promise<ServiceRuntime>,
	max = 4
): (entry: string, hostId: string) => Promise<ServiceRuntime> {
	const seen = new Map<string, Promise<ServiceRuntime>>();
	const waiting: Array<() => void> = [];
	let running = 0;

	async function slot<T>(task: () => Promise<T>): Promise<T> {
		if (running >= max) await new Promise<void>((resolve) => waiting.push(resolve));
		running += 1;
		try {
			return await task();
		} finally {
			running -= 1;
			waiting.shift()?.();
		}
	}

	return (entry, hostId) => {
		const key = `${entry}\n${hostId}`;
		let found = seen.get(key);
		if (found == null) {
			found = slot(() => read(entry, hostId));
			seen.set(key, found);
		}
		return found;
	};
}

/** A changed kind (Start and Stop share one form when the state flips) gets its own key. */
export function keyForKind(current: string, previousKind: string | null, kind: string, fresh: () => string): string {
	if (current === '' || previousKind !== kind) return fresh();
	return current;
}

/**
 * Idempotency key for the next run, stop or restart. Any answer from the server (success or failure)
 * starts a new key; only a submit that got no response (a network error has no status) keeps it.
 */
export function keyAfterResult(current: string, result: { type: string; status?: number }, fresh: () => string): string {
	if (result.type === 'error' && result.status == null) return current;
	return fresh();
}

/** Entry name to host ids that have any owned row for it, gone or not. */
export function entryHostIndex(rows: readonly OwnedRow[]): Record<string, string[]> {
	const found = new Map<string, Set<string>>();
	for (const row of rows) {
		if (row.source !== 'owned' || row.catalog_entry == null || row.host_id == null) continue;
		const hosts = found.get(row.catalog_entry) ?? new Set<string>();
		hosts.add(row.host_id);
		found.set(row.catalog_entry, hosts);
	}
	const out: Record<string, string[]> = {};
	for (const [name, hosts] of found) out[name] = [...hosts].sort();
	return out;
}

export type NotRunningPair = { entry: ServiceEntryRef; host: Host };

/**
 * A program that never ran on a host has no Services row. Each (program, host that can run it) with no
 * row gets one here, so Start stays reachable. Images are left out: Deploy creates their first row.
 */
export function notRunningPairs(
	entries: readonly ServiceEntryRef[],
	hosts: readonly Host[],
	index: Readonly<Record<string, readonly string[]>>
): NotRunningPair[] {
	const pairs: NotRunningPair[] = [];
	for (const entry of entries) {
		if (entry.kind !== 'program' || !entry.my_actions.includes('run')) continue;
		const present = index[entry.name] ?? [];
		for (const host of hosts) {
			if (!isCatalogHost(host) || hostBlockReason(host, entry.runAs, entry.shell) != null) continue;
			if (present.includes(host.id)) continue;
			pairs.push({ entry, host });
		}
	}
	return pairs;
}
