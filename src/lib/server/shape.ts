import type {
	DeviceView,
	Health,
	HealthCheck,
	Host,
	HostStatus,
	JoinToken,
	Member,
	ProbeView,
	Project,
	ServiceSummary,
	SnapshotView,
	User
} from '../api-types';
import { isRole } from './roles';
import { acceptedInstallCommand, isJoinToken, isUuid } from './validate';

const CONTROL = /[\u0000-\u001F\u007F]/;

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string | null {
	if (typeof value !== 'string' || value.length > max || CONTROL.test(value)) return null;
	return value;
}

function optionalText(value: unknown, max: number): string | null | undefined {
	if (value == null) return null;
	const parsed = text(value, max);
	return parsed === null ? undefined : parsed;
}

function optionalNumber(value: unknown): number | null | undefined {
	if (value == null) return null;
	if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
	return value;
}

function timestamp(value: unknown): string | null {
	return text(value, 64);
}

export function parseUser(value: unknown): User | null {
	if (!isRecord(value)) return null;
	const id = text(value.id, 36);
	const name = text(value.name, 200);
	if (!id || !isUuid(id) || name === null) return null;
	const email = text(value.email, 254) ?? '';
	const avatar = optionalText(value.avatar_url, 2000);
	if (avatar === undefined) return null;
	return { id, email, name, avatar_url: avatar };
}

export function parseProject(value: unknown): Project | null {
	if (!isRecord(value)) return null;
	const id = text(value.id, 36);
	const name = text(value.name, 80);
	const slug = text(value.slug, 120);
	const created_at = timestamp(value.created_at);
	if (!id || !isUuid(id) || !name || !slug || !created_at || !isRole(value.role)) return null;
	if (!/^[a-z0-9-]+$/.test(slug)) return null;
	return { id, name, slug, role: value.role, created_at };
}

export function parseMe(payload: unknown): { user: User; projects: Project[] } | null {
	if (!isRecord(payload)) return null;
	const user = parseUser(payload.user);
	if (!user || !Array.isArray(payload.projects)) return null;
	const projects: Project[] = [];
	for (const item of payload.projects) {
		const project = parseProject(item);
		if (!project) return null;
		projects.push(project);
	}
	return { user, projects };
}

export function parseMember(value: unknown): Member | null {
	if (!isRecord(value)) return null;
	const user_id = text(value.user_id, 36);
	const email = text(value.email, 254);
	const name = text(value.name, 200);
	const created_at = timestamp(value.created_at);
	if (!user_id || !isUuid(user_id) || !email || name === null || !created_at || !isRole(value.role)) return null;
	return { user_id, email, name, role: value.role, created_at };
}

const HOST_STATUS = new Set<HostStatus>(['online', 'offline', 'asleep', 'revoked']);

export function parseHost(value: unknown): Host | null {
	if (!isRecord(value)) return null;
	const id = text(value.id, 36);
	const project_id = text(value.project_id, 36);
	const name = text(value.name, 80);
	const node_type = text(value.node_type, 80);
	const os = text(value.os, 80);
	const arch = text(value.arch, 80);
	const enrolled_at = timestamp(value.enrolled_at);
	const agent_version = optionalText(value.agent_version, 80);
	const last_seen_at = optionalText(value.last_seen_at, 64);
	const revoked_at = optionalText(value.revoked_at, 64);
	if (!id || !isUuid(id) || !project_id || !isUuid(project_id) || !name || !enrolled_at) return null;
	if (node_type === null || os === null || arch === null) return null;
	if (typeof value.always_on !== 'boolean') return null;
	if (typeof value.status !== 'string' || !HOST_STATUS.has(value.status as HostStatus)) return null;
	if (agent_version === undefined || last_seen_at === undefined || revoked_at === undefined) return null;
	return {
		id,
		project_id,
		name,
		node_type,
		os,
		arch,
		always_on: value.always_on,
		agent_version,
		status: value.status as HostStatus,
		last_seen_at,
		enrolled_at,
		revoked_at
	};
}

export function parseJoinToken(value: unknown): JoinToken | null {
	if (!isRecord(value)) return null;
	const id = text(value.id, 36);
	const created_by = text(value.created_by, 36);
	const created_at = timestamp(value.created_at);
	const host_name_hint = optionalText(value.host_name_hint, 80);
	const expires_at = optionalText(value.expires_at, 64);
	const used_at = optionalText(value.used_at, 64);
	const revoked_at = optionalText(value.revoked_at, 64);
	const used_by_host_id = optionalText(value.used_by_host_id, 36);
	if (!id || !isUuid(id) || !created_by || !isUuid(created_by) || !created_at) return null;
	if (host_name_hint === undefined || expires_at === undefined || used_at === undefined || revoked_at === undefined) {
		return null;
	}
	if (used_by_host_id === undefined) return null;
	if (used_by_host_id !== null && !isUuid(used_by_host_id)) return null;
	return { id, host_name_hint, created_by, created_at, expires_at, used_at, used_by_host_id, revoked_at };
}

function parseHealth(value: unknown): Health | null | undefined {
	if (value == null) return null;
	if (!isRecord(value)) return undefined;
	if (value.status !== 'up' && value.status !== 'down' && value.status !== 'unknown') return undefined;
	const last_checked_at = optionalText(value.last_checked_at, 64);
	const latency_ms = optionalNumber(value.latency_ms);
	if (last_checked_at === undefined || latency_ms === undefined) return undefined;
	return { status: value.status, last_checked_at, latency_ms };
}

function parsePorts(value: unknown): number[] | null {
	if (!Array.isArray(value) || value.length > 50) return null;
	const ports: number[] = [];
	for (const item of value) {
		if (typeof item !== 'number' || !Number.isInteger(item) || item < 0 || item > 65535) return null;
		ports.push(item);
	}
	return ports;
}

export function parseService(value: unknown): ServiceSummary | null {
	if (!isRecord(value)) return null;
	const id = text(value.id, 36);
	const name = text(value.name, 200);
	const health = parseHealth(value.health);
	const ports = parsePorts(value.ports);
	if (!id || !isUuid(id) || !name || health === undefined || !ports) return null;
	if (value.source !== 'discovered' && value.source !== 'declared' && value.source !== 'owned') return null;
	if (value.kind !== 'container' && value.kind !== 'systemd' && value.kind !== 'process') return null;
	return { id, name, source: value.source, kind: value.kind, ports, health };
}

export function parseHealthChecks(value: unknown): HealthCheck[] | null {
	if (!Array.isArray(value) || value.length > 10) return null;
	const checks: HealthCheck[] = [];
	for (const item of value) {
		if (!isRecord(item)) return null;
		const id = text(item.id, 36);
		if (!id || !isUuid(id)) return null;
		if (item.protocol !== 'http' && item.protocol !== 'tcp') return null;
		if (typeof item.port !== 'number' || !Number.isInteger(item.port) || item.port < 1 || item.port > 65535) return null;
		if (typeof item.enabled !== 'boolean') return null;
		const path = optionalText(item.path, 200);
		if (path === undefined) return null;
		if (item.protocol === 'http' && (!path || !path.startsWith('/'))) return null;
		if (item.protocol === 'tcp' && path !== null) return null;
		checks.push({ id, protocol: item.protocol, port: item.port, path, enabled: item.enabled });
	}
	return checks;
}

export function parseDevice(value: unknown): DeviceView | null {
	if (!isRecord(value)) return null;
	const user_code = text(value.user_code, 9);
	const client_name = text(value.client_name, 100);
	const expires_at = timestamp(value.expires_at);
	if (!user_code || client_name === null || !expires_at) return null;
	if (value.status !== 'pending' && value.status !== 'approved' && value.status !== 'denied' && value.status !== 'expired') {
		return null;
	}
	return { user_code, client_name, expires_at, status: value.status };
}

export function parseCreatedJoin(value: unknown): { token: string; install_command: string | null } | null {
	if (!isRecord(value)) return null;
	const token = text(value.token, 128);
	if (!token || !isJoinToken(token)) return null;
	const command = text(value.install_command, 4096);
	return { token, install_command: command ? acceptedInstallCommand(command, token) : null };
}

export type ListPage = { raw: unknown[]; next: string | null };

export function parseListPayload(payload: unknown): ListPage | null {
	if (Array.isArray(payload)) return { raw: payload, next: null };
	if (!isRecord(payload) || !Array.isArray(payload.items)) return null;
	const next = payload.next_cursor;
	if (next == null || next === '') return { raw: payload.items, next: null };
	if (typeof next !== 'string' || next.length > 2000 || CONTROL.test(next)) return null;
	return { raw: payload.items, next };
}

function nullableNumber(value: unknown): number | null {
	const parsed = optionalNumber(value);
	return parsed == null ? null : parsed;
}

export function parseSnapshot(value: unknown): SnapshotView | null {
	if (!isRecord(value)) return null;
	const mem = isRecord(value.mem)
		? {
				total: nullableNumber(value.mem.total),
				used: nullableNumber(value.mem.used),
				available: nullableNumber(value.mem.available),
				used_percent: nullableNumber(value.mem.used_percent)
			}
		: null;
	const disks: SnapshotView['disks'] = [];
	if (Array.isArray(value.disks)) {
		for (const disk of value.disks.slice(0, 32)) {
			if (!isRecord(disk)) continue;
			const path = text(disk.path, 200);
			if (!path) continue;
			disks.push({
				path,
				total: nullableNumber(disk.total),
				used: nullableNumber(disk.used),
				used_percent: nullableNumber(disk.used_percent)
			});
		}
	}
	let load: SnapshotView['load'] = null;
	if (Array.isArray(value.load) && value.load.length >= 3) {
		load = [nullableNumber(value.load[0]), nullableNumber(value.load[1]), nullableNumber(value.load[2])];
	}
	const top: SnapshotView['top'] = [];
	if (Array.isArray(value.top)) {
		for (const row of value.top.slice(0, 20)) {
			if (!isRecord(row) || typeof row.pid !== 'number' || !Number.isInteger(row.pid)) continue;
			top.push({
				pid: row.pid,
				process_name: text(row.process_name, 200) ?? '',
				user: text(row.user, 80) ?? '',
				cpu_usage: nullableNumber(row.cpu_usage),
				memory_rss: nullableNumber(row.memory_rss),
				cmdline: text(row.cmdline, 1024)
			});
		}
	}
	return {
		sampled_at: optionalText(value.sampled_at, 64) ?? null,
		cpu_percent: nullableNumber(value.cpu_percent),
		mem,
		disks,
		load,
		temp_celsius: nullableNumber(value.temp_celsius),
		uptime_sec: nullableNumber(value.uptime_sec),
		top
	};
}

export function parseProbe(value: unknown): ProbeView | null {
	if (!isRecord(value)) return null;
	const protocol = text(value.protocol, 32);
	const result = text(value.result, 32);
	return {
		service: text(value.service, 200),
		protocol: protocol && /^[a-z0-9_-]+$/i.test(protocol) ? protocol : null,
		port: nullableNumber(value.port),
		path: optionalText(value.path, 200) ?? null,
		result: result && /^[a-z0-9_-]+$/i.test(result) ? result : null,
		http_status: nullableNumber(value.http_status),
		latency_ms: nullableNumber(value.latency_ms),
		checked_at: optionalText(value.checked_at, 64) ?? null
	};
}
