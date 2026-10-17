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
export type CatalogAction = 'run' | 'stop' | 'restart' | 'logs' | 'status' | 'deploy';

export type CatalogGrantAction = 'run' | 'stop' | 'restart' | 'logs' | 'deploy';

export type CatalogRestart = 'on-failure' | 'no';

export type ImageWorkload = 'service' | 'job';

export type ImageRestart = 'no' | 'on-failure' | 'unless-stopped';

/** Deploy and rollback outcomes. They arrive in the 200 body, not as HTTP errors. */
export type ImageOutcome =
	| 'succeeded'
	| 'unchanged'
	| 'failed'
	| 'timeout'
	| 'rolled_back'
	| 'rollback_failed'
	| 'image_unavailable'
	| 'forbidden_spec'
	| 'conflict';

/** Program policy from the agent's hello. Paths and executables stay on the host. */
export type HostPrograms = {
	enabled: boolean;
	run_as: string[];
	allow_shell: boolean;
	policy_hash: string;
	/** True when the agent reported a usable image policy. Missing on older hellos is false. */
	images: boolean;
	/** True when the helper answered container_list at start-up. Missing on older hellos is false. */
	docker: boolean;
	/** True when the agent reported managed files. Missing on older hellos is false. */
	files: boolean;
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

export type ImagePort = {
	host: number;
	container: number;
	public: boolean;
};

export type ImageVolume = {
	name: string;
	target: string;
	read_only: boolean;
};

/** A project file mounted read-only at `target`. Content stays on the API. */
export type ImageFileMount = {
	file: string;
	target: string;
};

export type ImageSpec = {
	kind: ImageWorkload;
	image: string;
	command: string[] | null;
	entrypoint: string[] | null;
	ports: ImagePort[];
	env: Record<string, string>;
	env_sets: string[];
	secret_env: Record<string, string>;
	volumes: ImageVolume[];
	files: ImageFileMount[];
	restart: ImageRestart;
	user: string;
	healthy_after_sec: number;
	memory_mb: number | null;
	timeout_sec: number;
};

type CatalogEntryBase = {
	id: string;
	project_id: string;
	name: string;
	spec_hash: string;
	command_display: string;
	created_by: string;
	created_at: string;
	updated_at: string;
	my_actions: CatalogAction[];
};

export type ProgramEntry = CatalogEntryBase & {
	kind: 'program';
	spec: ProgramSpec;
};

export type ImageEntry = CatalogEntryBase & {
	kind: 'image';
	spec: ImageSpec;
};

export type CatalogEntry = ProgramEntry | ImageEntry;

export type ImageDeploy = {
	id: string;
	entry_id: string;
	host_id: string;
	digest: string | null;
	spec_hash: string;
	outcome: ImageOutcome;
	exit_code: number | null;
	started_at: string;
	finished_at: string | null;
	by: string;
	via: 'console' | 'mcp';
};

export type ImageState = 'running' | 'exited' | 'created' | 'paused' | 'restarting' | 'dead' | 'missing' | 'unknown';

export type ImageStatus = {
	container: string | null;
	/** `unknown` when a deploy or rollback timed out and the API has no container state. */
	state: ImageState;
	exit_code: number | null;
	restart_count: number;
	started_at: string | null;
	finished_at: string | null;
	digest: string | null;
	ports: number[];
};

export type ImageLogs = {
	container: string | null;
	lines: string[];
	truncated: boolean;
};

/** `value` is null for a secret. The console also drops secret values before they reach the browser. */
export type EnvSetKey = {
	key: string;
	is_secret: boolean;
	value: string | null;
};

export type EnvSet = {
	name: string;
	keys: EnvSetKey[];
	updated_at: string;
	updated_by: string;
};

/** A registry row. The token is never part of this object. */
export type Registry = {
	host: string;
	username: string;
	updated_at: string;
	updated_by: string;
};

/**
 * A project file, without its content.
 * `sha256` is the hex digest of a plain file, and null for a secret file.
 */
export type ProjectFile = {
	name: string;
	is_secret: boolean;
	size: number;
	sha256: string | null;
	updated_at: string;
	updated_by: string;
};

/** A plain file, including content. Secret files are never this object. */
export type ProjectFileContent = {
	name: string;
	content: string;
	size: number;
	sha256: string;
	updated_at: string;
	updated_by: string;
};

/** D25 plan returned instead of a result when the API asks the caller to confirm. */
export type PendingConfirmation = {
	confirmation_id: string;
	plan: string;
	expires_at: string;
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
	/** Present when the detail payload sent them. Absent on older rows; the editor defaults them. */
	interval_sec?: number;
	expect_status_min?: number;
	expect_status_max?: number;
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
	/** Set when the host's latest services report omitted this row. Null when the row was in that report. */
	gone_at: string | null;
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
	/** Docker container name. Null when the host did not report one. */
	container_name: string | null;
	/** Image digest for an owned container. Null for other rows. */
	image_digest: string | null;
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
