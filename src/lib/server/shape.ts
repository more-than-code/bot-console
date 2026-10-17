import type {
	Approval,
	CatalogAction,
	CatalogEntry,
	CatalogGrant,
	CatalogGrantAction,
	CatalogPreview,
	CreatedInvite,
	DeviceView,
	EnvSet,
	EnvSetKey,
	Grant,
	Health,
	HealthCheck,
	Host,
	HostPrograms,
	HostStatus,
	ImageDeploy,
	ImageFileMount,
	ImageLogs,
	ImageOutcome,
	ImagePort,
	ImageRestart,
	ImageSpec,
	ImageState,
	ImageStatus,
	ImageVolume,
	ImageWorkload,
	ShareLevel,
	Invite,
	InviteLookup,
	JoinToken,
	Member,
	PendingConfirmation,
	ProbeView,
	ProcessItem,
	ProcessSample,
	ProgramLogs,
	ProgramSpec,
	ProgramStatus,
	Project,
	ProjectFile,
	ProjectFileContent,
	ProjectService,
	Registry,
	ServiceSummary,
	OauthRequest,
	SnapshotView,
	User
} from '../api-types';
import { CATALOG_NAME, ENV_KEY, GRANT_ACTIONS, RUN_AS, SPEC_HASH } from '../catalog';
import { cleanFileTarget, cleanImageUser, cleanVolumeTarget, fileTargetNests, isConfirmationId, isFileName, isRegistryHost, isSetName, redactAssignments } from '../image-spec';
import { isRole } from './roles';
import { acceptedInstallCommand, acceptedInviteUrl, consentRedirect, isJoinToken, isOauthRequestId, isUuid } from './validate';

const CONTROL = /[\u0000-\u001F\u007F]/;
/** Catalog command, dir, args, and env values forbid NUL and newline. A tab is kept. */
const LINE_BREAK = /[\u0000\n\r]/;
const PATH_MAX_BYTES = 512;
const utf8 = new TextEncoder();

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

/** Absent is null. A non-integer is malformed. An out-of-range integer is kept so the editor can show it. */
function optionalInt(value: unknown): number | null | undefined {
	if (value == null) return null;
	if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
	return value;
}

/** Health-check and probe paths are capped at 512 bytes (api-v1 v1.0.1 §7). */
function optionalPath(value: unknown): string | null | undefined {
	if (value == null) return null;
	if (typeof value !== 'string' || CONTROL.test(value) || utf8.encode(value).byteLength > PATH_MAX_BYTES) return undefined;
	return value;
}

/** Keep the text. Control characters become U+FFFD. Over the cap, end with an ellipsis inside the cap. */
function displayText(value: string, max: number): string {
	const cleaned = value.replace(CONTROL, '\uFFFD');
	if (cleaned.length <= max) return cleaned;
	if (max <= 1) return '\u2026'.slice(0, max);
	return `${cleaned.slice(0, max - 1)}\u2026`;
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
	const share = parseHostShare(value);
	if (!share) return null;
	const programs = parseProgramsField(value);
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
		revoked_at,
		relation: share.relation,
		share_level: share.share_level,
		programs
	};
}

/**
 * A missing key or null is "no policy". A present object that does not parse is also
 * "no policy": the host stays on the page, and the catalog treats programs as absent.
 */
function parseProgramsField(value: Record<string, unknown>): HostPrograms | null {
	if (!Object.hasOwn(value, 'programs') || value.programs == null) return null;
	return parseHostPrograms(value.programs);
}

/** Above this, the list is not a policy the console can offer. The host is kept with programs null. */
const RUN_AS_LIST_CAP = 256;
const POLICY_HASH_MAX = 4096;

export function parseHostPrograms(value: unknown): HostPrograms | null {
	if (!isRecord(value) || typeof value.enabled !== 'boolean' || typeof value.allow_shell !== 'boolean') return null;
	if (!Array.isArray(value.run_as) || value.run_as.length > RUN_AS_LIST_CAP) return null;
	const run_as: string[] = [];
	for (const item of value.run_as) {
		if (typeof item !== 'string' || item === 'root' || !RUN_AS.test(item)) return null;
		run_as.push(item);
	}
	if (typeof value.policy_hash !== 'string' || value.policy_hash.length === 0 || value.policy_hash.length > POLICY_HASH_MAX) return null;
	if (LINE_BREAK.test(value.policy_hash)) return null;
	const images = reportedBool(value, 'images');
	const docker = reportedBool(value, 'docker');
	const files = reportedBool(value, 'files');
	if (images === null || docker === null || files === null) return null;
	return { enabled: value.enabled, run_as, allow_shell: value.allow_shell, policy_hash: value.policy_hash, images, docker, files };
}

/** Missing or null is false. A present non-boolean is not a policy. */
function reportedBool(value: Record<string, unknown>, key: string): boolean | null {
	if (!Object.hasOwn(value, key) || value[key] == null) return false;
	return typeof value[key] === 'boolean' ? value[key] : null;
}

/** Owner carries a null level. A share must name metrics or deploy. */
function parseHostShare(value: Record<string, unknown>): { relation: 'owner' | 'shared'; share_level: ShareLevel | null } | null {
	if (value.relation === 'owner') {
		if (value.share_level != null) return null;
		return { relation: 'owner', share_level: null };
	}
	if (value.relation !== 'shared') return null;
	if (value.share_level !== 'metrics' && value.share_level !== 'deploy') return null;
	return { relation: 'shared', share_level: value.share_level };
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

function inviteRole(value: unknown): Invite['role'] | null {
	if (value === 'admin' || value === 'viewer') return value;
	return null;
}

function boundedInt(value: unknown, min: number, max: number): number | null {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return null;
	return value;
}

/** List row. Extra fields, including token and url, are dropped. A bad field fails the row. */
export function parseInvite(value: unknown): Invite | null {
	if (!isRecord(value)) return null;
	const id = text(value.id, 36);
	const created_by = text(value.created_by, 36);
	const created_at = timestamp(value.created_at);
	const expires_at = timestamp(value.expires_at);
	const role = inviteRole(value.role);
	const max_uses = boundedInt(value.max_uses, 1, 50);
	const uses = boundedInt(value.uses, 0, 50);
	const revoked_at = optionalText(value.revoked_at, 64);
	if (!id || !isUuid(id) || !created_by || !isUuid(created_by) || !created_at || !expires_at || !role) return null;
	if (max_uses == null || uses == null || uses > max_uses || revoked_at === undefined) return null;
	return { id, role, created_by, created_at, expires_at, max_uses, uses, revoked_at };
}

/** Create body. The plaintext token is checked, then only the url and role are kept. */
export function parseCreatedInvite(value: unknown, origin: string): CreatedInvite | null {
	const invite = parseInvite(value);
	if (!invite || !isRecord(value)) return null;
	const token = text(value.token, 43);
	if (!token) return null;
	const url = acceptedInviteUrl(token, value.url, origin);
	if (!url) return null;
	return { url, role: invite.role };
}

export function parseInviteLookup(value: unknown): InviteLookup | null {
	if (!isRecord(value)) return null;
	const project_id = text(value.project_id, 36);
	const project_name = text(value.project_name, 80);
	const role = inviteRole(value.role);
	if (!project_id || !isUuid(project_id) || !project_name || !role) return null;
	if (typeof value.already_member !== 'boolean') return null;
	return { project_id, project_name, role, already_member: value.already_member };
}

/** Accept can return the caller's current role, including owner. The redirect uses only the id. */
export function parseInviteAccept(value: unknown): { project_id: string } | null {
	if (!isRecord(value)) return null;
	const project_id = text(value.project_id, 36);
	if (!project_id || !isUuid(project_id) || !isRole(value.role)) return null;
	return { project_id };
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

/** Keep a person-set or agent string. Control characters become U+FFFD. Blank becomes null. */
function flexibleName(value: unknown, max: number): string | null | undefined {
	if (value == null) return null;
	if (typeof value !== 'string') return undefined;
	const cleaned = displayText(value, max).trim();
	return cleaned === '' ? null : cleaned;
}

function optionalUuid(value: unknown): string | null | undefined {
	if (value == null) return null;
	const id = text(value, 36);
	if (id === null || !isUuid(id)) return undefined;
	return id;
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
	const last_seen_at = optionalText(value.last_seen_at, 64);
	const gone_at = optionalText(value.gone_at, 64);
	const display_name = flexibleName(value.display_name, 64);
	const owner_user = flexibleName(value.owner_user, 80);
	const project_id = optionalUuid(value.project_id);
	const host_id = optionalUuid(value.host_id);
	if (last_seen_at === undefined || gone_at === undefined || display_name === undefined || owner_user === undefined) return null;
	if (project_id === undefined || host_id === undefined) return null;
	const catalog_entry = parseCatalogEntryName(value);
	if (catalog_entry === undefined) return null;
	const container_name = containerNameOf(value.container_name);
	const image_digest = imageDigestOf(value.image_digest);
	if (container_name === undefined || image_digest === undefined) return null;
	return {
		id,
		name,
		source: value.source,
		kind: value.kind,
		ports,
		health,
		last_seen_at,
		gone_at,
		display_name,
		owner_user,
		project_id,
		host_id,
		catalog_entry,
		container_name,
		image_digest
	};
}

/** Missing or null is no container name. A bad string drops the row. */
function containerNameOf(value: unknown): string | null | undefined {
	if (value == null) return null;
	const parsed = text(value, 200);
	if (parsed === null) return undefined;
	const trimmed = parsed.trim();
	return trimmed === '' ? null : trimmed;
}

/** Missing or null is no digest. Anything that is not `sha256:` plus 64 hex digits drops the row. */
function imageDigestOf(value: unknown): string | null | undefined {
	if (value == null) return null;
	if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) return undefined;
	return value;
}

/** Missing or null is not a catalog service. A present value must be an entry name. */
function parseCatalogEntryName(value: Record<string, unknown>): string | null | undefined {
	if (!Object.hasOwn(value, 'catalog_entry') || value.catalog_entry == null) return null;
	const name = text(value.catalog_entry, 48);
	if (!name || !CATALOG_NAME.test(name)) return undefined;
	return name;
}

const PAGE_CURSOR_MAX = 512;

/** Opaque cursor. Empty is null. Too long or containing a control character is malformed. */
function pageCursor(value: unknown): string | null | undefined {
	if (value == null || value === '') return null;
	if (typeof value !== 'string' || value.length > PAGE_CURSOR_MAX || CONTROL.test(value)) return undefined;
	return value;
}

export type ServicePage = {
	raw: unknown[];
	total: number;
	nextCursor: string | null;
	prevCursor: string | null;
};

/** Project services envelope. A missing total, a bad cursor, or a non-array `items` fails closed. */
export function parseServicePage(payload: unknown): ServicePage | null {
	if (!isRecord(payload) || !Array.isArray(payload.items) || payload.items.length > 200) return null;
	if (!Object.hasOwn(payload, 'total') || !Object.hasOwn(payload, 'next_cursor') || !Object.hasOwn(payload, 'prev_cursor')) {
		return null;
	}
	const total = payload.total;
	if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) return null;
	const nextCursor = pageCursor(payload.next_cursor);
	const prevCursor = pageCursor(payload.prev_cursor);
	if (nextCursor === undefined || prevCursor === undefined) return null;
	return { raw: payload.items, total, nextCursor, prevCursor };
}

export function parseProjectService(value: unknown): ProjectService | null {
	const service = parseService(value);
	if (!service?.host_id || !isRecord(value)) return null;
	const host_name = text(value.host_name, 80);
	const project_name = text(value.project_name, 80);
	if (!host_name || !project_name) return null;
	if (typeof value.host_status !== 'string' || !HOST_STATUS.has(value.host_status as HostStatus)) return null;
	return {
		...service,
		host_id: service.host_id,
		host_name,
		host_status: value.host_status as HostStatus,
		project_name
	};
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
		const path = optionalPath(item.path);
		if (path === undefined) return null;
		if (item.protocol === 'http' && (!path || !path.startsWith('/'))) return null;
		if (item.protocol === 'tcp' && path !== null) return null;
		const interval_sec = optionalInt(item.interval_sec);
		const expect_status_min = optionalInt(item.expect_status_min);
		const expect_status_max = optionalInt(item.expect_status_max);
		if (interval_sec === undefined || expect_status_min === undefined || expect_status_max === undefined) return null;
		checks.push({
			id,
			protocol: item.protocol,
			port: item.port,
			path,
			enabled: item.enabled,
			interval_sec: interval_sec ?? 60,
			expect_status_min: expect_status_min ?? 200,
			expect_status_max: expect_status_max ?? 399
		});
	}
	return checks;
}

const CLIENT_NAME_MAX = 64;
const REDIRECT_HOST_MAX = 300;
const RESOURCE_MAX = 2048;
const GRANT_CAP = 500;

export function parseOauthRequest(value: unknown): OauthRequest | null {
	if (!isRecord(value) || !isRecord(value.client)) return null;
	const id = text(value.id, 256);
	const clientId = text(value.client.id, 128);
	const name = text(value.client.name, CLIENT_NAME_MAX);
	const redirect_host = text(value.redirect_host, REDIRECT_HOST_MAX);
	const resource = text(value.resource, RESOURCE_MAX);
	const expires_at = timestamp(value.expires_at);
	if (!id || !isOauthRequestId(id) || !clientId || !name || !redirect_host || !resource || !expires_at) return null;
	if (redirect_host.trim() === '' || resource.trim() === '') return null;
	const projects_count = value.projects_count;
	if (typeof value.client.verified !== 'boolean' || typeof value.remembered !== 'boolean') return null;
	if (typeof projects_count !== 'number' || !Number.isInteger(projects_count) || projects_count < 0 || projects_count > 1_000_000) {
		return null;
	}
	return {
		id,
		client: { id: clientId, name, verified: value.client.verified },
		redirect_host,
		resource,
		remembered: value.remembered,
		projects_count,
		expires_at
	};
}

/** Approve and deny. A string `redirect_to` that fails the scheme check is `refused`. */
export function parseOauthRedirect(payload: unknown): { ok: true; redirect_to: string } | { ok: false; reason: 'malformed' | 'refused' } {
	if (!isRecord(payload) || typeof payload.redirect_to !== 'string') return { ok: false, reason: 'malformed' };
	const redirect_to = consentRedirect(payload.redirect_to);
	if (!redirect_to) return { ok: false, reason: 'refused' };
	return { ok: true, redirect_to };
}

function parseGrant(value: unknown): Grant | null {
	if (!isRecord(value)) return null;
	const id = text(value.id, 36);
	const client_name = text(value.client_name, CLIENT_NAME_MAX);
	const redirect_host = text(value.redirect_host, REDIRECT_HOST_MAX);
	const created_at = timestamp(value.created_at);
	if (!id || !isUuid(id) || !client_name || !redirect_host || redirect_host.trim() === '' || !created_at) return null;
	if (!Object.hasOwn(value, 'last_used_at')) return null;
	let last_used_at: string | null = null;
	if (value.last_used_at != null) {
		const parsed = timestamp(value.last_used_at);
		if (!parsed) return null;
		last_used_at = parsed;
	}
	if (value.kind !== 'oauth' && value.kind !== 'device') return null;
	return { id, client_name, redirect_host, created_at, last_used_at, kind: value.kind };
}

/** The whole list fails closed. One bad row is not dropped. */
export function parseGrants(payload: unknown): Grant[] | null {
	if (!isRecord(payload) || !Array.isArray(payload.items) || payload.items.length > GRANT_CAP) return null;
	const items: Grant[] = [];
	const seen = new Set<string>();
	for (const item of payload.items) {
		const grant = parseGrant(item);
		if (!grant || seen.has(grant.id)) return null;
		seen.add(grant.id);
		items.push(grant);
	}
	return items;
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

export type ParsedMetric = {
	step: number | null;
	series: Array<{ name: string; points: Array<{ t: string; value: number | null }> }>;
};

function parseStep(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 10 || value > 3600) return null;
	return value;
}

function parsePoint(value: unknown): { t: string; value: number | null } | null {
	if (!Array.isArray(value) || value.length !== 2) return null;
	const t = text(value[0], 64);
	if (!t || !Number.isFinite(Date.parse(t))) return null;
	if (value[1] == null) return { t, value: null };
	if (typeof value[1] !== 'number' || !Number.isFinite(value[1])) return null;
	return { t, value: value[1] };
}

/**
 * Metric payload for one `m`. Series not in `names` are dropped.
 * A malformed point or series fails the whole payload so the chart shows an error.
 */
export function parseMetricPayload(value: unknown, m: string, names: readonly string[]): ParsedMetric | null {
	if (!isRecord(value) || value.m !== m) return null;
	if (!Array.isArray(value.series) || value.series.length > 20) return null;
	const parsed: Array<{ name: string; points: Array<{ t: string; value: number | null }> }> = [];
	for (const item of value.series) {
		if (!isRecord(item)) return null;
		const name = text(item.name, 64);
		if (!name) return null;
		if (!Array.isArray(item.points) || item.points.length > 2000) return null;
		const points: Array<{ t: string; value: number | null }> = [];
		for (const raw of item.points.slice(0, 500)) {
			const point = parsePoint(raw);
			if (!point) return null;
			points.push(point);
		}
		parsed.push({ name, points });
	}
	const series = names
		.map((name) => parsed.find((item) => item.name === name))
		.filter((item): item is { name: string; points: Array<{ t: string; value: number | null }> } => item != null);
	return { step: parseStep(value.step), series };
}

function parseProcessItem(value: unknown): ProcessItem | null {
	if (!isRecord(value)) return null;
	const pid = value.pid;
	if (typeof pid !== 'number' || !Number.isInteger(pid) || pid < 0 || pid > 2_147_483_647) return null;
	if (typeof value.process_name !== 'string' || typeof value.user !== 'string') return null;
	if (value.cmdline != null && typeof value.cmdline !== 'string') return null;
	const process_name = displayText(value.process_name, 200);
	const user = displayText(value.user, 80);
	const cmdline = value.cmdline == null ? null : displayText(value.cmdline, 8192);
	const started_at = optionalText(value.started_at, 64);
	const serviceRaw = optionalText(value.service_id, 36);
	if (started_at === undefined || serviceRaw === undefined) return null;
	if (serviceRaw !== null && !isUuid(serviceRaw)) return null;
	const cpu_usage = optionalNumber(value.cpu_usage);
	const memory_rss = optionalNumber(value.memory_rss);
	const memory_usage = optionalNumber(value.memory_usage);
	const threads = optionalNumber(value.num_threads);
	if (cpu_usage === undefined || memory_rss === undefined || memory_usage === undefined || threads === undefined) return null;
	if (threads != null && (!Number.isInteger(threads) || threads < 0)) return null;
	return {
		pid,
		process_name,
		user,
		cmdline,
		service_id: serviceRaw,
		cpu_usage,
		memory_rss,
		memory_usage,
		num_threads: threads,
		started_at
	};
}

/** `sampled_at` may be null. A row with a missing pid or a wrong field type is counted in `skipped`. */
export function parseProcessSample(value: unknown): ProcessSample | null {
	if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > 200) return null;
	const sampled_at = optionalText(value.sampled_at, 64);
	if (sampled_at === undefined) return null;
	const items: ProcessItem[] = [];
	let skipped = 0;
	for (const raw of value.items) {
		const item = parseProcessItem(raw);
		if (!item) {
			skipped += 1;
			continue;
		}
		items.push(item);
	}
	return { sampled_at, items, skipped };
}

export function parseProbe(value: unknown): ProbeView | null {
	if (!isRecord(value)) return null;
	const protocol = text(value.protocol, 32);
	const result = text(value.result, 32);
	return {
		service: text(value.service, 200),
		protocol: protocol && /^[a-z0-9_-]+$/i.test(protocol) ? protocol : null,
		port: nullableNumber(value.port),
		path: optionalPath(value.path) ?? null,
		result: result && /^[a-z0-9_-]+$/i.test(result) ? result : null,
		http_status: nullableNumber(value.http_status),
		latency_ms: nullableNumber(value.latency_ms),
		checked_at: optionalText(value.checked_at, 64) ?? null
	};
}

const CATALOG_ACTIONS = new Set<CatalogAction>(['run', 'stop', 'restart', 'logs', 'status', 'deploy']);
const GRANT_ACTION_SET = new Set<CatalogGrantAction>([...GRANT_ACTIONS, 'deploy']);
const ENTRY_CAP = 200;
const GRANT_LIST_CAP = 100;
const LOG_LINE_CAP = 1000;
const LOG_LINE_MAX = 8192;

/** command_display is kept whole. Only an empty value, or one with NUL or a newline, is dropped. */
function commandDisplay(value: unknown): string | null {
	if (typeof value !== 'string' || value.length === 0 || LINE_BREAK.test(value)) return null;
	if (value.trim() === '') return null;
	return value;
}

function requireKey(value: Record<string, unknown>, key: string): boolean {
	return Object.hasOwn(value, key);
}

function parseDir(value: unknown): string | null {
	if (typeof value !== 'string' || LINE_BREAK.test(value) || utf8.encode(value).byteLength > 255) return null;
	if (!value.startsWith('/') || value.split('/').includes('..')) return null;
	return value;
}

function parseArgs(value: unknown): string[] | null {
	if (!Array.isArray(value) || value.length > 32) return null;
	const args: string[] = [];
	for (const item of value) {
		if (typeof item !== 'string' || utf8.encode(item).byteLength > 4096 || LINE_BREAK.test(item)) return null;
		args.push(item);
	}
	return args;
}

/** Stored env is kept as the API sent it, including keys the write path will later refuse. */
function parseEnv(value: unknown): Record<string, string> | null {
	if (!isRecord(value)) return null;
	const keys = Object.keys(value);
	if (keys.length > 64) return null;
	const env: Record<string, string> = {};
	for (const key of keys) {
		if (!ENV_KEY.test(key)) return null;
		const raw = value[key];
		if (typeof raw !== 'string' || utf8.encode(raw).byteLength > 4096 || LINE_BREAK.test(raw)) return null;
		env[key] = raw;
	}
	return env;
}

function parseProgramPort(value: unknown): number | null | undefined {
	if (value === null) return null;
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) return undefined;
	return value;
}

export function parseProgramSpec(value: unknown): ProgramSpec | null {
	if (!isRecord(value) || typeof value.shell !== 'boolean') return null;
	if (!requireKey(value, 'port') || !requireKey(value, 'env') || !requireKey(value, 'args')) return null;
	const dir = parseDir(value.dir);
	const exec = text(value.exec, 256);
	const args = parseArgs(value.args);
	const run_as = text(value.run_as, 32);
	const env = parseEnv(value.env);
	const port = parseProgramPort(value.port);
	if (!dir || !exec || !args || !run_as || run_as === 'root' || !RUN_AS.test(run_as) || !env || port === undefined) return null;
	if (value.restart !== 'on-failure' && value.restart !== 'no') return null;
	return { dir, exec, args, shell: value.shell, run_as, env, port, restart: value.restart };
}

function parseMyActions(value: unknown): CatalogAction[] | null {
	if (!Array.isArray(value) || value.length > CATALOG_ACTIONS.size) return null;
	const actions: CatalogAction[] = [];
	for (const item of value) {
		if (typeof item !== 'string' || !CATALOG_ACTIONS.has(item as CatalogAction) || actions.includes(item as CatalogAction)) {
			return null;
		}
		actions.push(item as CatalogAction);
	}
	return actions;
}

function parseEntryBase(value: Record<string, unknown>): Omit<CatalogEntry, 'kind' | 'spec'> | null {
	const id = text(value.id, 36);
	const project_id = text(value.project_id, 36);
	const name = text(value.name, 48);
	const spec_hash = text(value.spec_hash, 64);
	const command_display = commandDisplay(value.command_display);
	const created_by = text(value.created_by, 36);
	const created_at = timestamp(value.created_at);
	const updated_at = timestamp(value.updated_at);
	const my_actions = parseMyActions(value.my_actions);
	if (!id || !isUuid(id) || !project_id || !isUuid(project_id) || !name || !CATALOG_NAME.test(name)) return null;
	if (!spec_hash || !SPEC_HASH.test(spec_hash) || !command_display) return null;
	if (!created_by || !isUuid(created_by) || !created_at || !updated_at || !my_actions) return null;
	return { id, project_id, name, spec_hash, command_display, created_by, created_at, updated_at, my_actions };
}

export function parseCatalogEntry(value: unknown): CatalogEntry | null {
	if (!isRecord(value)) return null;
	const base = parseEntryBase(value);
	if (!base) return null;
	if (value.kind === 'program') {
		const spec = parseProgramSpec(value.spec);
		if (!spec) return null;
		return { ...base, kind: 'program', spec };
	}
	if (value.kind === 'image') {
		const spec = parseImageSpec(value.spec);
		if (!spec) return null;
		return { ...base, kind: 'image', spec };
	}
	return null;
}

function parseGrantActions(value: unknown): CatalogGrantAction[] | null {
	if (!Array.isArray(value) || value.length === 0 || value.length > GRANT_ACTION_SET.size) return null;
	const actions: CatalogGrantAction[] = [];
	for (const item of value) {
		if (typeof item !== 'string' || !GRANT_ACTION_SET.has(item as CatalogGrantAction) || actions.includes(item as CatalogGrantAction)) {
			return null;
		}
		actions.push(item as CatalogGrantAction);
	}
	return actions;
}

function parseGrantSubject(value: unknown): string | null {
	const subject = text(value, 48);
	if (!subject) return null;
	if (subject === 'role:viewer' || subject === 'role:admin') return subject;
	if (!subject.startsWith('user:')) return null;
	const id = subject.slice('user:'.length);
	if (!isUuid(id)) return null;
	return subject;
}

export function parseCatalogGrant(value: unknown): CatalogGrant | null {
	if (!isRecord(value)) return null;
	const subject = parseGrantSubject(value.subject);
	const actions = parseGrantActions(value.actions);
	if (!subject || !actions) return null;
	return { subject, actions };
}

/** Duplicate subjects, an empty action list, or more than 100 grants fail the whole payload. */
export function parseCatalogGrants(payload: unknown): CatalogGrant[] | null {
	if (!isRecord(payload) || !Array.isArray(payload.grants) || payload.grants.length > GRANT_LIST_CAP) return null;
	const grants: CatalogGrant[] = [];
	const seen = new Set<string>();
	for (const item of payload.grants) {
		const grant = parseCatalogGrant(item);
		if (!grant || seen.has(grant.subject)) return null;
		seen.add(grant.subject);
		grants.push(grant);
	}
	return grants;
}

export function parseCatalogPreview(value: unknown): CatalogPreview | null {
	if (!isRecord(value) || !requireKey(value, 'env') || !requireKey(value, 'args')) return null;
	const exec = text(value.exec, 256);
	const args = parseArgs(value.args);
	const env = parseEnv(value.env);
	const command_display = commandDisplay(value.command_display);
	if (!exec || !args || !env || !command_display) return null;
	return { exec, args, env, command_display };
}

export function parseApproval(value: unknown): Approval | null {
	if (!isRecord(value) || typeof value.shell !== 'boolean') return null;
	if (!requireKey(value, 'approved_by') || !requireKey(value, 'approved_at')) return null;
	if (!requireKey(value, 'exec') || !requireKey(value, 'args') || !requireKey(value, 'env')) return null;
	const entry_id = text(value.entry_id, 36);
	const entry_name = text(value.entry_name, 48);
	const project_id = text(value.project_id, 36);
	const project_name = text(value.project_name, 80);
	const host_id = text(value.host_id, 36);
	const spec_hash = text(value.spec_hash, 64);
	const command_display = commandDisplay(value.command_display);
	const exec = text(value.exec, 256);
	const args = parseArgs(value.args);
	const env = parseEnv(value.env);
	const dir = parseDir(value.dir);
	const run_as = text(value.run_as, 32);
	const requested_by = text(value.requested_by, 36);
	const requested_at = timestamp(value.requested_at);
	const approved_by = optionalUuid(value.approved_by);
	const approved_at = optionalText(value.approved_at, 64);
	if (!entry_id || !isUuid(entry_id) || !entry_name || !CATALOG_NAME.test(entry_name)) return null;
	if (!project_id || !isUuid(project_id) || !project_name || !host_id || !isUuid(host_id)) return null;
	if (!spec_hash || !SPEC_HASH.test(spec_hash) || !command_display || !exec || !args || !env || !dir) return null;
	if (!run_as || run_as === 'root' || !RUN_AS.test(run_as) || !requested_by || !isUuid(requested_by) || !requested_at) return null;
	if (approved_by === undefined || approved_at === undefined) return null;
	if (value.status !== 'pending' && value.status !== 'approved') return null;
	return {
		entry_id,
		entry_name,
		project_id,
		project_name,
		host_id,
		spec_hash,
		command_display,
		exec,
		args,
		env,
		dir,
		run_as,
		shell: value.shell,
		status: value.status,
		requested_by,
		requested_at,
		approved_by,
		approved_at
	};
}

export function parseProgramStatus(value: unknown): ProgramStatus | null {
	if (!isRecord(value)) return null;
	if (!requireKey(value, 'main_pid') || !requireKey(value, 'started_at') || !requireKey(value, 'ports')) return null;
	const unit = text(value.unit, 200);
	const active_state = text(value.active_state, 64);
	const sub_state = text(value.sub_state, 64);
	const started_at = optionalText(value.started_at, 64);
	const ports = parsePorts(value.ports);
	if (!unit || !active_state || !sub_state || started_at === undefined || !ports) return null;
	let main_pid: number | null;
	if (value.main_pid == null) main_pid = null;
	else if (typeof value.main_pid !== 'number' || !Number.isSafeInteger(value.main_pid) || value.main_pid < 0) return null;
	else main_pid = value.main_pid;
	return { unit, active_state, sub_state, main_pid, started_at, ports };
}

export function parseProgramLogs(value: unknown): ProgramLogs | null {
	if (!isRecord(value) || typeof value.truncated !== 'boolean' || !Array.isArray(value.lines)) return null;
	const unit = text(value.unit, 200);
	if (!unit) return null;
	const capped = value.lines.slice(0, LOG_LINE_CAP);
	const lines: string[] = [];
	for (const item of capped) {
		if (typeof item !== 'string') return null;
		lines.push(displayText(item, LOG_LINE_MAX));
	}
	return { unit, lines, truncated: value.truncated || value.lines.length > LOG_LINE_CAP };
}

const IMAGE_OUTCOMES = new Set<ImageOutcome>([
	'succeeded',
	'unchanged',
	'failed',
	'timeout',
	'rolled_back',
	'rollback_failed',
	'image_unavailable',
	'forbidden_spec',
	'conflict'
]);

const IMAGE_STATES = new Set<ImageState>(['running', 'exited', 'created', 'paused', 'restarting', 'dead', 'missing', 'unknown']);

/** Missing or null uses the fallback. An out-of-range value drops the spec. */
function optionalBounded(record: Record<string, unknown>, key: string, min: number, max: number, fallback: number): number | null {
	if (!Object.hasOwn(record, key) || record[key] == null) return fallback;
	return boundedInt(record[key], min, max);
}

/** The timer the kind does not use. The API stores 0. Omit and null are 0. A negative or non-integer drops the spec. */
function unusedTimer(record: Record<string, unknown>, key: string): number | null {
	if (!Object.hasOwn(record, key) || record[key] == null) return 0;
	const value = record[key];
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
	return value;
}

function parseImageRef(value: unknown): string | null {
	if (typeof value !== 'string' || value.length === 0 || utf8.encode(value).byteLength > 255) return null;
	if (LINE_BREAK.test(value) || /\s/.test(value)) return null;
	return value;
}

function parseArgvField(value: unknown): string[] | null | undefined {
	if (value === null) return null;
	const args = parseArgs(value);
	return args === null ? undefined : args;
}

function parseImagePorts(value: unknown): ImagePort[] | null {
	if (!Array.isArray(value) || value.length > 16) return null;
	const ports: ImagePort[] = [];
	const hosts = new Set<number>();
	for (const item of value) {
		if (!isRecord(item) || typeof item.public !== 'boolean') return null;
		const host = boundedInt(item.host, 1, 65535);
		const container = boundedInt(item.container, 1, 65535);
		if (host == null || container == null || hosts.has(host)) return null;
		hosts.add(host);
		ports.push({ host, container, public: item.public });
	}
	return ports;
}

function parseNameList(value: unknown): string[] | null {
	if (!Array.isArray(value) || value.length > 8) return null;
	const names: string[] = [];
	for (const item of value) {
		if (typeof item !== 'string' || !isSetName(item) || names.includes(item)) return null;
		names.push(item);
	}
	return names;
}

function parseSecretEnv(value: unknown): Record<string, string> | null {
	if (!isRecord(value)) return null;
	const keys = Object.keys(value);
	if (keys.length > 64) return null;
	const secret: Record<string, string> = {};
	for (const key of keys) {
		if (!ENV_KEY.test(key)) return null;
		const raw = value[key];
		if (typeof raw !== 'string') return null;
		const dot = raw.indexOf('.');
		if (dot <= 0) return null;
		const set = raw.slice(0, dot);
		const name = raw.slice(dot + 1);
		if (!isSetName(set) || !ENV_KEY.test(name)) return null;
		secret[key] = raw;
	}
	return secret;
}

/** Absent `files` is `[]`. A present value that is not a rule-13 list fails the spec. */
function parseImageFiles(value: unknown, volumeTargets: readonly string[]): ImageFileMount[] | null {
	if (!Array.isArray(value) || value.length > 16) return null;
	const files: ImageFileMount[] = [];
	const names = new Set<string>();
	const targets = new Set<string>(volumeTargets);
	for (const item of value) {
		if (!isRecord(item) || typeof item.file !== 'string' || !isFileName(item.file) || names.has(item.file)) return null;
		const target = cleanFileTarget(typeof item.target === 'string' ? item.target : '');
		if (!target || targets.has(target)) return null;
		if (volumeTargets.some((other) => fileTargetNests(target, other))) return null;
		names.add(item.file);
		targets.add(target);
		files.push({ file: item.file, target });
	}
	return files;
}

function parseImageVolumes(value: unknown): ImageVolume[] | null {
	if (!Array.isArray(value) || value.length > 8) return null;
	const volumes: ImageVolume[] = [];
	const targets = new Set<string>();
	for (const item of value) {
		if (!isRecord(item) || typeof item.read_only !== 'boolean' || typeof item.name !== 'string' || !isSetName(item.name)) return null;
		const target = cleanVolumeTarget(typeof item.target === 'string' ? item.target : '');
		if (!target || targets.has(target)) return null;
		targets.add(target);
		volumes.push({ name: item.name, target, read_only: item.read_only });
	}
	return volumes;
}

export function parseImageSpec(value: unknown): ImageSpec | null {
	if (!isRecord(value)) return null;
	if (value.kind !== 'service' && value.kind !== 'job') return null;
	const workload: ImageWorkload = value.kind;
	const image = parseImageRef(value.image);
	const command = parseArgvField(value.command);
	const entrypoint = parseArgvField(value.entrypoint);
	const ports = parseImagePorts(value.ports);
	const env = parseEnv(value.env);
	const env_sets = parseNameList(value.env_sets);
	const secret_env = parseSecretEnv(value.secret_env);
	const volumes = parseImageVolumes(value.volumes);
	if (!image || command === undefined || entrypoint === undefined || !ports || !env || !env_sets || !secret_env || !volumes) return null;
	let files: ImageFileMount[];
	if (!Object.hasOwn(value, 'files')) files = [];
	else {
		const parsed = parseImageFiles(value.files, volumes.map((volume) => volume.target));
		if (!parsed) return null;
		files = parsed;
	}
	if (value.restart !== 'no' && value.restart !== 'on-failure' && value.restart !== 'unless-stopped') return null;
	const restart: ImageRestart = value.restart;
	if (workload === 'job' && restart !== 'no') return null;
	if (typeof value.user !== 'string' || cleanImageUser(value.user) === null) return null;
	let memory_mb: number | null;
	if (!Object.hasOwn(value, 'memory_mb') || value.memory_mb == null) memory_mb = null;
	else {
		const memory = boundedInt(value.memory_mb, 16, 65536);
		if (memory == null) return null;
		memory_mb = memory;
	}
	const healthy = workload === 'service' ? optionalBounded(value, 'healthy_after_sec', 5, 600, 30) : unusedTimer(value, 'healthy_after_sec');
	const timeout = workload === 'job' ? optionalBounded(value, 'timeout_sec', 10, 3600, 600) : unusedTimer(value, 'timeout_sec');
	if (healthy === null || timeout === null) return null;
	return {
		kind: workload,
		image,
		command,
		entrypoint,
		ports,
		env,
		env_sets,
		secret_env,
		volumes,
		files,
		restart,
		user: value.user,
		healthy_after_sec: healthy,
		memory_mb,
		timeout_sec: timeout
	};
}

function parseLogLines(value: unknown): { lines: string[]; truncated: boolean } | null {
	if (!Array.isArray(value)) return null;
	const capped = value.slice(0, LOG_LINE_CAP);
	const lines: string[] = [];
	for (const item of capped) {
		if (typeof item !== 'string') return null;
		lines.push(displayText(item, LOG_LINE_MAX));
	}
	return { lines, truncated: value.length > LOG_LINE_CAP };
}

export function parseImageStatus(value: unknown): ImageStatus | null {
	if (!isRecord(value) || typeof value.restart_count !== 'number' || !Number.isSafeInteger(value.restart_count) || value.restart_count < 0) {
		return null;
	}
	if (typeof value.state !== 'string' || !IMAGE_STATES.has(value.state as ImageState)) return null;
	const container = value.container == null ? null : text(value.container, 200);
	if (value.container != null && !container) return null;
	const digest = imageDigestOf(value.digest);
	if (digest === undefined) return null;
	const started_at = optionalText(value.started_at, 64);
	const finished_at = optionalText(value.finished_at, 64);
	const ports = parsePorts(value.ports);
	if (started_at === undefined || finished_at === undefined || !ports) return null;
	let exit_code: number | null;
	if (value.exit_code == null) exit_code = null;
	else if (typeof value.exit_code !== 'number' || !Number.isInteger(value.exit_code) || value.exit_code < 0 || value.exit_code > 255) return null;
	else exit_code = value.exit_code;
	return {
		container,
		state: value.state as ImageState,
		exit_code,
		restart_count: value.restart_count,
		started_at,
		finished_at,
		digest,
		ports
	};
}

export function parseImageLogs(value: unknown): ImageLogs | null {
	if (!isRecord(value) || typeof value.truncated !== 'boolean') return null;
	const container = value.container == null ? null : text(value.container, 200);
	if (value.container != null && !container) return null;
	const lines = parseLogLines(value.lines);
	if (!lines) return null;
	return { container, lines: lines.lines, truncated: value.truncated || lines.truncated };
}

function parseExitCode(value: unknown): number | null | undefined {
	if (value == null) return null;
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255) return undefined;
	return value;
}

export function parseImageDeploy(value: unknown): ImageDeploy | null {
	if (!isRecord(value)) return null;
	const id = text(value.id, 36);
	const entry_id = text(value.entry_id, 36);
	const host_id = text(value.host_id, 36);
	const spec_hash = text(value.spec_hash, 64);
	const by = text(value.by, 36);
	const started_at = timestamp(value.started_at);
	const finished_at = optionalText(value.finished_at, 64);
	const digest = imageDigestOf(value.digest);
	const exit_code = parseExitCode(value.exit_code);
	if (!id || !isUuid(id) || !entry_id || !isUuid(entry_id) || !host_id || !isUuid(host_id)) return null;
	if (!spec_hash || !SPEC_HASH.test(spec_hash) || !by || !isUuid(by) || !started_at || finished_at === undefined) return null;
	if (digest === undefined || exit_code === undefined) return null;
	if (typeof value.outcome !== 'string' || !IMAGE_OUTCOMES.has(value.outcome as ImageOutcome)) return null;
	if (value.via !== 'console' && value.via !== 'mcp') return null;
	return {
		id,
		entry_id,
		host_id,
		digest,
		spec_hash,
		outcome: value.outcome as ImageOutcome,
		exit_code,
		started_at,
		finished_at,
		by,
		via: value.via
	};
}

export function parseConfirmation(value: unknown): PendingConfirmation | null {
	if (!isRecord(value)) return null;
	const confirmation_id = text(value.confirmation_id, 43);
	if (!confirmation_id || !isConfirmationId(confirmation_id)) return null;
	if (typeof value.plan !== 'string' || value.plan.length === 0 || value.plan.length > 2000) return null;
	const expires_at = timestamp(value.expires_at);
	if (!expires_at) return null;
	return { confirmation_id, plan: redactAssignments(displayText(value.plan, 2000)), expires_at };
}

export type DeployPayload =
	| { kind: 'confirmation'; confirmation: PendingConfirmation }
	| { kind: 'deploy'; deploy: ImageDeploy; status: ImageStatus; lines: string[] };

export function parseDeployPayload(value: unknown): DeployPayload | null {
	if (!isRecord(value)) return null;
	if (Object.hasOwn(value, 'confirmation_id') && !Object.hasOwn(value, 'deploy')) {
		const confirmation = parseConfirmation(value);
		return confirmation ? { kind: 'confirmation', confirmation } : null;
	}
	const deploy = parseImageDeploy(value.deploy);
	const status = parseImageStatus(value.status);
	const lines = parseLogLines(value.lines);
	if (!deploy || !status || !lines) return null;
	return { kind: 'deploy', deploy, status, lines: lines.lines };
}

export type RemovePayload = { kind: 'confirmation'; confirmation: PendingConfirmation } | { kind: 'status'; status: ImageStatus };

export function parseRemovePayload(value: unknown): RemovePayload | null {
	if (!isRecord(value)) return null;
	if (Object.hasOwn(value, 'confirmation_id') && !Object.hasOwn(value, 'status')) {
		const confirmation = parseConfirmation(value);
		return confirmation ? { kind: 'confirmation', confirmation } : null;
	}
	const status = parseImageStatus(value.status);
	return status ? { kind: 'status', status } : null;
}

export function parseImageDeployList(payload: unknown): { items: ImageDeploy[]; omitted: number } | null {
	const page = parseListPayload(payload);
	if (!page) return null;
	const capped = page.raw.slice(0, 50);
	let omitted = page.raw.length - capped.length;
	const items: ImageDeploy[] = [];
	for (const item of capped) {
		const row = parseImageDeploy(item);
		if (row) items.push(row);
		else omitted += 1;
	}
	return { items, omitted };
}

function parseEnvSetKey(value: unknown): EnvSetKey | null {
	if (!isRecord(value) || typeof value.is_secret !== 'boolean') return null;
	const key = text(value.key, 64);
	if (!key || !ENV_KEY.test(key)) return null;
	if (value.is_secret) return { key, is_secret: true, value: null };
	if (value.value == null) return { key, is_secret: false, value: null };
	if (typeof value.value !== 'string' || utf8.encode(value.value).byteLength > 4096 || LINE_BREAK.test(value.value)) return null;
	return { key, is_secret: false, value: value.value };
}

export function parseEnvSet(value: unknown): EnvSet | null {
	if (!isRecord(value) || !Array.isArray(value.keys) || value.keys.length > 256) return null;
	const name = text(value.name, 48);
	const updated_at = timestamp(value.updated_at);
	const updated_by = text(value.updated_by, 36);
	if (!name || !isSetName(name) || !updated_at || !updated_by || !isUuid(updated_by)) return null;
	const keys: EnvSetKey[] = [];
	const seen = new Set<string>();
	for (const item of value.keys) {
		const parsed = parseEnvSetKey(item);
		if (!parsed || seen.has(parsed.key)) return null;
		seen.add(parsed.key);
		keys.push(parsed);
	}
	return { name, keys, updated_at, updated_by };
}

export function parseEnvSetList(payload: unknown): { items: EnvSet[]; omitted: number } | null {
	const page = parseListPayload(payload);
	if (!page) return null;
	const capped = page.raw.slice(0, 200);
	let omitted = page.raw.length - capped.length;
	const items: EnvSet[] = [];
	const seen = new Set<string>();
	for (const item of capped) {
		const row = parseEnvSet(item);
		if (!row || seen.has(row.name)) omitted += 1;
		else {
			seen.add(row.name);
			items.push(row);
		}
	}
	return { items, omitted };
}

/** A project file row. Secret `sha256` is null. A plain file's digest is 64 hex digits. Content is dropped. */
export function parseProjectFile(value: unknown): ProjectFile | null {
	if (!isRecord(value) || typeof value.is_secret !== 'boolean' || !Object.hasOwn(value, 'sha256')) return null;
	const name = text(value.name, 64);
	const updated_at = timestamp(value.updated_at);
	const updated_by = text(value.updated_by, 36);
	const size = boundedInt(value.size, 1, 65536);
	if (!name || !isFileName(name) || !updated_at || !updated_by || !isUuid(updated_by) || size == null) return null;
	let sha256: string | null;
	if (value.is_secret) {
		if (value.sha256 !== null) return null;
		sha256 = null;
	} else if (typeof value.sha256 !== 'string' || !SPEC_HASH.test(value.sha256)) return null;
	else sha256 = value.sha256;
	return { name, is_secret: value.is_secret, size, sha256, updated_at, updated_by };
}

/** A plain file with content. The byte length must match `size`. A NUL or a secret digest fails. */
export function parseProjectFileContent(value: unknown): ProjectFileContent | null {
	if (!isRecord(value) || typeof value.content !== 'string') return null;
	if (value.content.length === 0 || value.content.includes('\0')) return null;
	const sizeBytes = utf8.encode(value.content).byteLength;
	const size = boundedInt(value.size, 1, 65536);
	if (size == null || size !== sizeBytes || sizeBytes > 65536) return null;
	if (typeof value.sha256 !== 'string' || !SPEC_HASH.test(value.sha256)) return null;
	const name = text(value.name, 64);
	const updated_at = timestamp(value.updated_at);
	const updated_by = text(value.updated_by, 36);
	if (!name || !isFileName(name) || !updated_at || !updated_by || !isUuid(updated_by)) return null;
	return { name, content: value.content, size, sha256: value.sha256, updated_at, updated_by };
}

/** The whole list fails closed. A bad row is not dropped. */
export function parseProjectFileList(payload: unknown): { items: ProjectFile[] } | null {
	const page = parseListPayload(payload);
	if (!page || page.raw.length > 64) return null;
	const items: ProjectFile[] = [];
	const seen = new Set<string>();
	for (const item of page.raw) {
		const row = parseProjectFile(item);
		if (!row || seen.has(row.name)) return null;
		seen.add(row.name);
		items.push(row);
	}
	return { items };
}

export function parseRegistry(value: unknown): Registry | null {
	if (!isRecord(value)) return null;
	const host = text(value.host, 255);
	const username = text(value.username, 255);
	const updated_at = timestamp(value.updated_at);
	const updated_by = text(value.updated_by, 36);
	if (!host || !isRegistryHost(host) || username === null || !updated_at || !updated_by || !isUuid(updated_by)) return null;
	return { host, username, updated_at, updated_by };
}

export function parseRegistryList(payload: unknown): { items: Registry[]; omitted: number } | null {
	const page = parseListPayload(payload);
	if (!page) return null;
	const capped = page.raw.slice(0, 100);
	let omitted = page.raw.length - capped.length;
	const items: Registry[] = [];
	const seen = new Set<string>();
	for (const item of capped) {
		const row = parseRegistry(item);
		if (!row || seen.has(row.host)) omitted += 1;
		else {
			seen.add(row.host);
			items.push(row);
		}
	}
	return { items, omitted };
}

export type CatalogList = { items: CatalogEntry[]; omitted: number; truncated: boolean };

/** One catalog page. A bad row is left out. A `next_cursor` marks the list truncated. */
export function parseCatalogList(payload: unknown): CatalogList | null {
	const page = parseListPayload(payload);
	if (!page) return null;
	return collectRows(page.raw, page.next != null, parseCatalogEntry);
}

export type ApprovalList = { items: Approval[]; omitted: number; truncated: boolean };

export function parseApprovalList(payload: unknown): ApprovalList | null {
	const page = parseListPayload(payload);
	if (!page) return null;
	return collectRows(page.raw, page.next != null, parseApproval);
}

function collectRows<T>(raw: unknown[], truncated: boolean, parse: (value: unknown) => T | null): { items: T[]; omitted: number; truncated: boolean } {
	const capped = raw.slice(0, ENTRY_CAP);
	let omitted = raw.length - capped.length;
	const items: T[] = [];
	for (const item of capped) {
		const parsed = parse(item);
		if (parsed) items.push(parsed);
		else omitted += 1;
	}
	return { items, omitted, truncated: truncated || raw.length > ENTRY_CAP };
}
