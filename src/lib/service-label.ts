import { CATALOG_LOGS_PARAM } from './url';

const PORT_NAME = /^port-(\d+)$/;

/** A link's `catalog.q` is capped at 100 Unicode code points. */
const LINK_SEARCH_MAX = 100;

function capSearch(value: string): string {
	const points = [...value];
	if (points.length <= LINK_SEARCH_MAX) return value;
	return points.slice(0, LINK_SEARCH_MAX).join('');
}

/**
 * v1.2 label: `display_name`, otherwise a container's `container_name`,
 * otherwise the discovered `name`, unless that name is `port-<n>`,
 * in which case `port <n> · <owner_user>` (or `port <n>`).
 */
export function serviceLabel(service: {
	display_name?: string | null;
	name: string;
	owner_user?: string | null;
	kind?: string | null;
	container_name?: string | null;
}): string {
	const display = service.display_name?.trim() ?? '';
	if (display) return display;
	if (service.kind === 'container') {
		const container = service.container_name?.trim() ?? '';
		if (container) return container;
	}
	const port = PORT_NAME.exec(service.name);
	if (!port) return service.name;
	const owner = service.owner_user?.trim() ?? '';
	const number = port[1] ?? '';
	return owner ? `port ${number} \u00b7 ${owner}` : `port ${number}`;
}

/** The rename field starts from the display name, or a container's own name so it can be edited. */
export function renameStartValue(service: {
	display_name?: string | null;
	kind?: string | null;
	container_name?: string | null;
}): string {
	if (service.display_name != null) return service.display_name;
	if (service.kind === 'container') return service.container_name ?? '';
	return '';
}

/** The project's Catalog & services tab, narrowed to this host and searched for the catalog entry. */
export function processServiceHref(projectId: string, hostId: string, entry: string): string {
	const params = new URLSearchParams({
		tab: 'catalog',
		'catalog.host': hostId,
		'catalog.q': capSearch(entry)
	});
	return `/projects/${projectId}?${params.toString()}`;
}

/** The same link with `catalog.logs`, so that copy's Logs drawer opens once. */
export function serviceLogsHref(projectId: string, hostId: string, entry: string): string {
	return `${processServiceHref(projectId, hostId, entry)}&${new URLSearchParams({ [CATALOG_LOGS_PARAM]: entry }).toString()}`;
}

/**
 * Show rename when this project's admin+ can edit the row.
 * Owner admin+ of the host's owning project can edit every row.
 * A sharing project's admin+ can edit only that project's own services.
 * When the host is not in the loaded list, admin+ of this project still sees the control.
 */
export function canRenameService(input: {
	canAdmin: boolean;
	projectId: string;
	serviceProjectId: string | null;
	hostOwnerProjectId: string | null;
}): boolean {
	if (!input.canAdmin) return false;
	if (input.hostOwnerProjectId == null) return true;
	if (input.hostOwnerProjectId === input.projectId) return true;
	return input.serviceProjectId === input.projectId;
}
