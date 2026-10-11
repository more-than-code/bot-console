import { isHostName } from './host.ts';
import { round } from './series.ts';
import type { HostSnapshot } from './types.ts';

export type RegistryInfo = {
	name: string;
	lanIp: string | null;
	tailscaleIp: string | null;
	role: string | null;
	runs: string | null;
};

/** One latest reading. Omitted fields are left untouched; null is a real empty value. */
export type FieldSample = {
	host: string;
	time: string | null;
	cpuPercent?: number | null;
	memoryPercent?: number | null;
	diskPercent?: number | null;
	tempC?: number | null;
	load1?: number | null;
	load5?: number | null;
	load15?: number | null;
	uptimeSeconds?: number | null;
};

type Draft = {
	snap: HostSnapshot;
	lastMs: number | null;
};

function blank(name: string): HostSnapshot {
	return {
		name,
		lanIp: null,
		tailscaleIp: null,
		role: null,
		runs: null,
		cpuPercent: null,
		memoryPercent: null,
		diskPercent: null,
		tempC: null,
		load1: null,
		load5: null,
		load15: null,
		uptimeSeconds: null,
		lastReported: null,
		online: false
	};
}

function ensure(map: Map<string, Draft>, name: string): Draft | null {
	if (!isHostName(name)) return null;
	let draft = map.get(name);
	if (!draft) {
		draft = { snap: blank(name), lastMs: null };
		map.set(name, draft);
	}
	return draft;
}

function applySample(snap: HostSnapshot, sample: FieldSample): void {
	if (sample.cpuPercent !== undefined) snap.cpuPercent = round(sample.cpuPercent, 1);
	if (sample.memoryPercent !== undefined) snap.memoryPercent = round(sample.memoryPercent, 1);
	if (sample.diskPercent !== undefined) snap.diskPercent = round(sample.diskPercent, 1);
	if (sample.tempC !== undefined) snap.tempC = round(sample.tempC, 1);
	if (sample.load1 !== undefined) snap.load1 = round(sample.load1, 2);
	if (sample.load5 !== undefined) snap.load5 = round(sample.load5, 2);
	if (sample.load15 !== undefined) snap.load15 = round(sample.load15, 2);
	if (sample.uptimeSeconds !== undefined) {
		const uptime = sample.uptimeSeconds;
		snap.uptimeSeconds = uptime == null || !Number.isFinite(uptime) ? null : Math.round(uptime);
	}
}

function timeMs(value: string | null): number | null {
	if (!value) return null;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? ms : null;
}

/**
 * Union of the registry, names seen in recent metric rows, and hosts that
 * actually returned a reading. Missing fields stay null. No timestamps means stale.
 */
export function assembleSnapshots(input: {
	registry: RegistryInfo[];
	discovered: string[];
	samples: FieldSample[];
	generatedAt: string;
	staleMs: number;
}): HostSnapshot[] {
	const map = new Map<string, Draft>();
	for (const row of input.registry) {
		const draft = ensure(map, row.name);
		if (!draft) continue;
		draft.snap.lanIp = row.lanIp;
		draft.snap.tailscaleIp = row.tailscaleIp;
		draft.snap.role = row.role;
		draft.snap.runs = row.runs;
	}
	for (const name of input.discovered) ensure(map, name);
	for (const sample of input.samples) {
		const draft = ensure(map, sample.host);
		if (!draft) continue;
		applySample(draft.snap, sample);
		const ms = timeMs(sample.time);
		if (ms != null && (draft.lastMs == null || ms > draft.lastMs)) draft.lastMs = ms;
	}

	const generatedMs = Date.parse(input.generatedAt);
	const origin = Number.isFinite(generatedMs) ? generatedMs : Number.POSITIVE_INFINITY;
	const hosts = [...map.values()].map((draft) => {
		if (draft.lastMs != null) {
			draft.snap.lastReported = new Date(draft.lastMs).toISOString();
			draft.snap.online = origin - draft.lastMs <= input.staleMs;
		}
		return draft.snap;
	});
	hosts.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	return hosts;
}
