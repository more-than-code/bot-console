import type { RangeKey } from './ranges';

export type HostSnapshot = {
	name: string;
	lanIp: string | null;
	tailscaleIp: string | null;
	role: string | null;
	/** metrics.hosts.hosts — what this host runs. */
	runs: string | null;
	cpuPercent: number | null;
	memoryPercent: number | null;
	diskPercent: number | null;
	tempC: number | null;
	load1: number | null;
	load5: number | null;
	load15: number | null;
	uptimeSeconds: number | null;
	/** ISO-8601 UTC. */
	lastReported: string | null;
	online: boolean;
};

export type Overview = {
	generatedAt: string;
	hosts: HostSnapshot[];
};

export type SeriesPoint = {
	t: string;
	cpu: number | null;
	memory: number | null;
	disk: number | null;
	temp: number | null;
	load1: number | null;
	netRx: number | null;
	netTx: number | null;
	diskRead: number | null;
	diskWrite: number | null;
};

export type HostDetail = {
	generatedAt: string;
	range: RangeKey;
	host: HostSnapshot;
	points: SeriesPoint[];
};

export function isOverview(value: unknown): value is Overview {
	if (!value || typeof value !== 'object') return false;
	const hosts = (value as Overview).hosts;
	return typeof (value as Overview).generatedAt === 'string' && Array.isArray(hosts);
}

export function isHostDetail(value: unknown): value is HostDetail {
	if (!value || typeof value !== 'object') return false;
	const detail = value as HostDetail;
	return (
		typeof detail.generatedAt === 'string' &&
		(detail.range === '1h' || detail.range === '1d' || detail.range === '1w') &&
		Array.isArray(detail.points) &&
		!!detail.host &&
		typeof detail.host.name === 'string'
	);
}
