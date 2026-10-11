import type { SeriesPoint } from './types';

export type GaugePoint = { t: string; value: number | null };
export type NetPoint = { t: string; rx: number | null; tx: number | null };
export type DiskioPoint = { t: string; read: number | null; write: number | null };

export function round(value: number | null, digits: number): number | null {
	if (value == null || !Number.isFinite(value)) return null;
	const scale = 10 ** digits;
	return Math.round(value * scale) / scale;
}

function slot(map: Map<string, SeriesPoint>, t: string): SeriesPoint {
	let point = map.get(t);
	if (!point) {
		point = {
			t,
			cpu: null,
			memory: null,
			disk: null,
			temp: null,
			load1: null,
			netRx: null,
			netTx: null,
			diskRead: null,
			diskWrite: null
		};
		map.set(t, point);
	}
	return point;
}

export function mergeSeries(input: {
	cpu: GaugePoint[];
	memory: GaugePoint[];
	disk: GaugePoint[];
	temp: GaugePoint[];
	load1: GaugePoint[];
	net: NetPoint[];
	diskio: DiskioPoint[];
}): SeriesPoint[] {
	const map = new Map<string, SeriesPoint>();
	for (const row of input.cpu) slot(map, row.t).cpu = round(row.value, 1);
	for (const row of input.memory) slot(map, row.t).memory = round(row.value, 1);
	for (const row of input.disk) slot(map, row.t).disk = round(row.value, 1);
	for (const row of input.temp) slot(map, row.t).temp = round(row.value, 1);
	for (const row of input.load1) slot(map, row.t).load1 = round(row.value, 2);
	for (const row of input.net) {
		const point = slot(map, row.t);
		point.netRx = round(row.rx, 1);
		point.netTx = round(row.tx, 1);
	}
	for (const row of input.diskio) {
		const point = slot(map, row.t);
		point.diskRead = round(row.read, 1);
		point.diskWrite = round(row.write, 1);
	}
	return [...map.values()].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
}
