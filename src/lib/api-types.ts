export type Role = 'owner' | 'admin' | 'viewer';

export type User = {
	id: string;
	email: string;
	name: string;
	avatar_url: string | null;
};

export type Project = {
	id: string;
	name: string;
	slug: string;
	role: Role;
	created_at: string;
};

export type Member = {
	user_id: string;
	email: string;
	name: string;
	role: Role;
	created_at: string;
};

/** Invite links are viewer or admin. Never owner. */
export type InviteRole = 'admin' | 'viewer';

/** `GET /v1/projects/{id}/invites`. No token and no url. */
export type Invite = {
	id: string;
	role: InviteRole;
	created_by: string;
	created_at: string;
	expires_at: string;
	max_uses: number;
	uses: number;
	revoked_at: string | null;
};

/** Create result shown once. The token is only inside `url`. */
export type CreatedInvite = {
	url: string;
	role: InviteRole;
};

/** `POST /v1/invites/lookup`. */
export type InviteLookup = {
	project_id: string;
	project_name: string;
	role: InviteRole;
	already_member: boolean;
};

export type JoinToken = {
	id: string;
	host_name_hint: string | null;
	created_by: string;
	created_at: string;
	expires_at: string | null;
	used_at: string | null;
	used_by_host_id: string | null;
	revoked_at: string | null;
};

export type HostStatus = 'online' | 'offline' | 'asleep' | 'revoked';

export type HostRelation = 'owner' | 'shared';

export type ShareLevel = 'metrics' | 'deploy';

export type Host = {
	id: string;
	project_id: string;
	name: string;
	node_type: string;
	os: string;
	arch: string;
	always_on: boolean;
	agent_version: string | null;
	status: HostStatus;
	last_seen_at: string | null;
	enrolled_at: string;
	revoked_at: string | null;
	/** Owner when the caller is in the owning project. Shared otherwise. */
	relation: HostRelation;
	/** Null when `relation` is owner. */
	share_level: ShareLevel | null;
	/** Null when the agent reports no program policy. */
	programs: HostPrograms | null;
};

/** What the caller may do with one catalog entry. `status` comes with any other action. */
export type CatalogAction = 'run' | 'stop' | 'restart' | 'logs' | 'status';

export type CatalogGrantAction = 'run' | 'stop' | 'restart' | 'logs';

export type CatalogRestart = 'on-failure' | 'no';

/** Program policy from the agent's hello. Paths and executables stay on the host. */
export type HostPrograms = {
	enabled: boolean;
	run_as: string[];
	allow_shell: boolean;
	policy_hash: string;
};

export type ProgramSpec = {
	dir: string;
	exec: string;
	args: string[];
	shell: boolean;
	run_as: string;
	env: Record<string, string>;
	port: number | null;
	restart: CatalogRestart;
};

export type CatalogEntry = {
	id: string;
	project_id: string;
	name: string;
	kind: 'program';
	spec: ProgramSpec;
	spec_hash: string;
	command_display: string;
	created_by: string;
	created_at: string;
	updated_at: string;
	my_actions: CatalogAction[];
};

/** `role:admin`, `role:viewer`, or `user:<uuid>`. The owner is never a subject. */
export type CatalogGrant = {
	subject: string;
	actions: CatalogGrantAction[];
};

export type CatalogPreview = {
	exec: string;
	args: string[];
	env: Record<string, string>;
	command_display: string;
};

export type ApprovalStatus = 'pending' | 'approved';

export type Approval = {
	entry_id: string;
	entry_name: string;
	project_id: string;
	project_name: string;
	host_id: string;
	spec_hash: string;
	command_display: string;
	exec: string;
	args: string[];
	env: Record<string, string>;
	dir: string;
	run_as: string;
	shell: boolean;
	status: ApprovalStatus;
	requested_by: string;
	requested_at: string;
	approved_by: string | null;
	approved_at: string | null;
};

export type ProgramStatus = {
	unit: string;
	active_state: string;
	sub_state: string;
	main_pid: number | null;
	started_at: string | null;
	ports: number[];
};

export type ProgramLogs = {
	unit: string;
	lines: string[];
	truncated: boolean;
};

export type HealthStatus = 'up' | 'down' | 'unknown';

export type Health = {
	status: HealthStatus;
	last_checked_at: string | null;
	latency_ms: number | null;
};

export type HealthCheck = {
	id: string;
	protocol: 'http' | 'tcp';
	port: number;
	path: string | null;
	enabled: boolean;
};

export type ServiceSummary = {
	id: string;
	name: string;
	source: 'discovered' | 'declared' | 'owned';
	kind: 'container' | 'systemd' | 'process';
	ports: number[];
	health: Health | null;
	/** From the service payload already returned by the list. Missing becomes null. */
	last_seen_at: string | null;
	/** Person-set name. Missing or blank becomes null. */
	display_name: string | null;
	/** Account that owns the listening socket. Missing becomes null. */
	owner_user: string | null;
	/** Service's project. Missing becomes null; a bad id fails the row. */
	project_id: string | null;
	/** Host that runs the service. Missing becomes null; a bad id fails the row. */
	host_id: string | null;
	/** Catalog entry name when this service was started from the catalog. Otherwise null. */
	catalog_entry: string | null;
};

export type ServiceRow = ServiceSummary & {
	checks: HealthCheck[];
	checksMessage: string | null;
};

/** One row of `GET /v1/projects/{id}/services`, plus the checks the console loaded. */
export type ProjectService = ServiceSummary & {
	host_id: string;
	host_name: string;
	host_status: HostStatus;
	project_name: string;
};

export type ProjectServiceRow = ProjectService & {
	checks: HealthCheck[];
	checksMessage: string | null;
};

export type SnapshotView = {
	sampled_at: string | null;
	cpu_percent: number | null;
	mem: {
		total: number | null;
		used: number | null;
		available: number | null;
		used_percent: number | null;
	} | null;
	disks: Array<{ path: string; total: number | null; used: number | null; used_percent: number | null }>;
	load: [number | null, number | null, number | null] | null;
	temp_celsius: number | null;
	uptime_sec: number | null;
	top: Array<{
		pid: number;
		process_name: string;
		user: string;
		cpu_usage: number | null;
		memory_rss: number | null;
		cmdline: string | null;
	}>;
};

export type ProbeView = {
	service: string | null;
	protocol: string | null;
	port: number | null;
	path: string | null;
	result: string | null;
	http_status: number | null;
	latency_ms: number | null;
	checked_at: string | null;
};

export type DeviceView = {
	user_code: string;
	client_name: string;
	expires_at: string;
	status: 'pending' | 'approved' | 'denied' | 'expired';
};

export type CreatedJoin = {
	token: string;
	install_command: string | null;
};

/** One row of `GET /v1/hosts/{id}/processes`. */
export type ProcessItem = {
	pid: number;
	process_name: string;
	user: string;
	cmdline: string | null;
	service_id: string | null;
	cpu_usage: number | null;
	memory_rss: number | null;
	memory_usage: number | null;
	num_threads: number | null;
	started_at: string | null;
};

export type ProcessSample = {
	sampled_at: string | null;
	items: ProcessItem[];
	/** Rows dropped because pid was missing or a field had the wrong type. */
	skipped: number;
};

/** `GET /v1/oauth/requests/{id}` (oauth-v1 §3.1). */
export type OauthRequest = {
	id: string;
	client: {
		id: string;
		name: string;
		verified: boolean;
	};
	redirect_host: string;
	resource: string;
	remembered: boolean;
	projects_count: number;
	expires_at: string;
};

/** One active row of `GET /v1/me/grants` (oauth-v1 §11). */
export type Grant = {
	id: string;
	client_name: string;
	redirect_host: string;
	created_at: string;
	last_used_at: string | null;
	kind: 'oauth' | 'device';
};
