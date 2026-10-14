import { SERVER_SEARCH_MAX } from './table';

const PORT_NAME = /^port-(\d+)$/;

/** `services.q` is capped at the API maximum, counted in Unicode code points. */
function capServiceQuery(value: string): string {
	const points = [...value];
	if (points.length <= SERVER_SEARCH_MAX) return value;
	return points.slice(0, SERVER_SEARCH_MAX).join('');
}

/**
 * v1.2 label: `display_name`, otherwise the discovered `name`,
 * unless that name is `port-<n>`, in which case `port <n> · <owner_user>` (or `port <n>`).
 */
export function serviceLabel(service: {
	display_name?: string | null;
	name: string;
	owner_user?: string | null;
}): string {
	const display = service.display_name?.trim() ?? '';
	if (display) return display;
	const port = PORT_NAME.exec(service.name);
	if (!port) return service.name;
	const owner = service.owner_user?.trim() ?? '';
	const number = port[1] ?? '';
	return owner ? `port ${number} \u00b7 ${owner}` : `port ${number}`;
}

/** Project Services tab for this host, filtered to the discovered service name. */
export function processServiceHref(projectId: string, hostId: string, serviceName: string): string {
	const params = new URLSearchParams({
		tab: 'services',
		'services.host': hostId,
		'services.q': capServiceQuery(serviceName)
	});
	return `/projects/${projectId}?${params.toString()}`;
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
