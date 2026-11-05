import { render } from 'svelte/server';
import type { CatalogAction, CatalogEntry, Host, ProjectServiceRow } from '../src/lib/api-types.ts';
import { groupCopies } from '../src/lib/catalog-copies.ts';
import type { NotRunningPair } from '../src/lib/service-actions.ts';
import CatalogSection from '../src/routes/projects/[id]/CatalogSection.svelte';
import { PROJECT } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

/** Fixtures and a render helper for the Catalog & services tab's copy rows. */

export const COPY_HOST_ID = '00000000-0000-4000-8000-0000000000aa';
export const COPY_ID = '00000000-0000-4000-8000-0000000000bb';
const HASH = 'a'.repeat(64);

export function copyHost(overrides: Partial<Host> = {}): Host {
	return {
		id: COPY_HOST_ID,
		project_id: PROJECT.id,
		name: 'pi1',
		node_type: 'pi',
		os: 'linux',
		arch: 'arm64',
		always_on: true,
		agent_version: '1.2.0',
		status: 'online',
		last_seen_at: '2026-10-14T00:00:00Z',
		enrolled_at: '2026-10-13T00:00:00Z',
		revoked_at: null,
		relation: 'owner',
		share_level: null,
		programs: null,
		...overrides
	};
}

/** An owned container copy of catalog entry `web` on pi1, in this project. */
export function copyRow(overrides: Partial<ProjectServiceRow> = {}): ProjectServiceRow {
	return {
		id: COPY_ID,
		name: 'web',
		source: 'owned',
		kind: 'container',
		ports: [80, 443],
		health: null,
		last_seen_at: '2026-10-14T12:00:00Z',
		gone_at: null,
		display_name: 'Web',
		owner_user: 'root',
		project_id: PROJECT.id,
		host_id: COPY_HOST_ID,
		host_name: 'pi1',
		host_status: 'online',
		project_name: 'Lab',
		catalog_entry: 'web',
		container_name: 'web-1',
		image_digest: null,
		checks: [],
		checksMessage: null,
		...overrides
	};
}

export function imageCatalogEntry(name = 'web', my_actions: CatalogAction[] = [], id = `entry-${name}`): CatalogEntry {
	return {
		id,
		project_id: PROJECT.id,
		name,
		kind: 'image',
		spec: {
			kind: 'service',
			image: `ghcr.io/acme/${name}:1`,
			command: null,
			entrypoint: null,
			ports: [],
			env: {},
			env_sets: [],
			secret_env: {},
			volumes: [],
			files: [],
			restart: 'unless-stopped',
			user: '',
			healthy_after_sec: 30,
			memory_mb: null,
			timeout_sec: 600,
			healthcheck: null,
			logging: null,
			health_policy: null
		},
		spec_hash: HASH,
		command_display: `ghcr.io/acme/${name}:1`,
		created_by: '00000000-0000-4000-8000-000000000001',
		created_at: '2026-10-14T00:00:00Z',
		updated_at: '2026-10-14T00:00:00Z',
		my_actions
	} as CatalogEntry;
}

export function programCatalogEntry(name = 'web', my_actions: CatalogAction[] = [], id = `entry-${name}`): CatalogEntry {
	return {
		id,
		project_id: PROJECT.id,
		name,
		kind: 'program',
		spec: {
			dir: '/srv/app',
			exec: 'npm',
			args: ['run', 'dev'],
			shell: false,
			run_as: 'joe',
			env: {},
			port: 3031,
			restart: 'on-failure'
		},
		spec_hash: HASH,
		command_display: 'npm run dev',
		created_by: '00000000-0000-4000-8000-000000000001',
		created_at: '2026-10-14T00:00:00Z',
		updated_at: '2026-10-14T00:00:00Z',
		my_actions
	} as CatalogEntry;
}

export type CopiesProps = {
	rows: ProjectServiceRow[];
	/** Default: one image entry per distinct `catalog_entry` among the rows, with `actions`. */
	entries?: CatalogEntry[];
	actions?: CatalogAction[];
	hosts?: Host[];
	canAdmin?: boolean;
	canOwner?: boolean;
	url?: string;
	notRunning?: NotRunningPair[];
	/** Render every entry collapsed (the page default). By default entries with services start open. */
	collapsed?: boolean;
	[key: string]: unknown;
};

/** Server-renders the Catalog & services tab with these rows grouped as the load groups them. */
export function renderCopies(props: CopiesProps): string {
	const { rows, entries, actions = [], hosts, canAdmin = false, canOwner = false, url, notRunning = [], collapsed = false, ...rest } = props;
	const names = [...new Set(rows.map((row) => row.catalog_entry).filter((name): name is string => name != null))];
	const listed = entries ?? names.map((name) => imageCatalogEntry(name, actions));
	setPageUrl(url ?? `http://console.example/projects/${PROJECT.id}?tab=catalog`);
	return render(CatalogSection, {
		props: {
			canOwner,
			canAdmin,
			entries: listed,
			omitted: 0,
			truncated: false,
			message: null,
			hosts: hosts ?? [copyHost()],
			members: [],
			projectId: PROJECT.id,
			copies: groupCopies(rows, PROJECT.id, listed),
			notRunning,
			serviceStates: {},
			initialOpen: collapsed ? [] : listed.map((entry) => entry.name),
			...rest
		}
	}).body;
}
