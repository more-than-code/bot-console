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
