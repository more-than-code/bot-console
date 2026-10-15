import { error, fail, isHttpError, isRedirect, redirect } from '@sveltejs/kit';
import type { CatalogEntry, Host, Invite, JoinToken, Member, ProjectService, ProjectServiceRow } from '$lib/api-types';
import { catalogForCaller, isCatalogName } from '$lib/catalog';
import { SERVICE_DEFAULT_DIR, SERVICE_DEFAULT_SORT, serviceColumns, serviceHostReachable } from '$lib/host-view';
import { serviceShow } from '$lib/service-view';
import type { CatalogPermissionsState, ProjectScope } from '$lib/project-action';
import { ApiError, actionFailure, apiFetch, apiList, loadFailure } from '$lib/server/api';
import {
	catalogCreate,
	catalogDelete,
	catalogLogs,
	catalogParse,
	catalogPermissions,
	catalogRestart,
	catalogRun,
	catalogStop,
	catalogUpdate
} from '$lib/server/catalog-actions';
import { formText } from '$lib/server/form';
import { requireUser } from '$lib/server/guard';
import { present } from '$lib/server/redact';
import { roleAtLeast, uiRole } from '$lib/server/roles';
import {
	parseCatalogGrants,
	parseCatalogList,
	parseCreatedInvite,
	parseCreatedJoin,
	parseHost,
	parseInvite,
	parseJoinToken,
	parseMember,
	parseProbe,
	parseProject,
	parseProjectService,
	parseServicePage
} from '$lib/server/shape';
import { withChecks } from '$lib/server/service-checks';
import { cleanDisplayName, cleanEmail, cleanExpiry, cleanHint, cleanName, cleanRole, isUuid } from '$lib/server/validate';
import { readServerTableQuery, serverApiParams } from '$lib/table';
import { backTo } from '$lib/url';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

function projectId(params: { id?: string }): string {
	if (!params.id || !isUuid(params.id)) error(404, 'Not found');
	return params.id;
}

function invalid(event: RequestEvent, scope: ProjectScope, message: string) {
	return fail(400, present(event, { scope, message }));
}

function tabOf(value: string | null, canAdmin: boolean, canOwner: boolean): ProjectScope {
	if (value === 'settings') return canOwner ? 'settings' : 'hosts';
	if (value === 'tokens') return canAdmin ? 'tokens' : 'hosts';
	if (value === 'members') return 'members';
	if (value === 'services') return 'services';
	if (value === 'catalog') return 'catalog';
	return 'hosts';
}

const SERVICES_LIMIT = 25;
const HOST_UNREACHABLE = 'That host is not available for this project.';
const CURSOR_DROPPED = 'That page link is not valid.';

type ServicesLoad = {
	services: ProjectServiceRow[];
	servicesTotal: number;
	servicesPrev: string | null;
	servicesNext: string | null;
	servicesOmitted: number;
	servicesMessage: string | null;
};

const noServices: ServicesLoad = {
	services: [],
	servicesTotal: 0,
	servicesPrev: null,
	servicesNext: null,
	servicesOmitted: 0,
	servicesMessage: null
};

async function loadProjectServices(
	event: RequestEvent,
	projectId: string,
	reachableHostIds: ReadonlySet<string>
): Promise<ServicesLoad> {
	const query = readServerTableQuery(event.url.searchParams, 'services', serviceColumns(false), {
		sort: SERVICE_DEFAULT_SORT,
		dir: SERVICE_DEFAULT_DIR
	});
	if (query.qTooLong) {
		return { ...noServices, servicesMessage: 'Search must be at most 100 characters.' };
	}
	const hostUnreachable = query.hostRejected || (query.host != null && !reachableHostIds.has(query.host));
	const apiQuery = hostUnreachable ? { ...query, host: null } : query;
	const notices: string[] = [];
	if (hostUnreachable) notices.push(HOST_UNREACHABLE);
	if (query.cursorDropped) notices.push(CURSOR_DROPPED);
	try {
		const params = serverApiParams(apiQuery, SERVICES_LIMIT);
		params.set('view', serviceShow(event.url.searchParams.get('show')).view);
		const payload = await apiFetch(event, `/v1/projects/${projectId}/services?${params.toString()}`);
		const page = parseServicePage(payload);
		if (!page) return { ...noServices, servicesMessage: 'The API returned an unexpected response.' };
		let omitted = 0;
		const summaries: ProjectService[] = [];
		for (const item of page.raw) {
			const row = parseProjectService(item);
			if (row) summaries.push(row);
			else omitted += 1;
		}
		const services = await withChecks(event, summaries);
		return {
			services,
			servicesTotal: page.total,
			servicesPrev: page.prevCursor,
			servicesNext: page.nextCursor,
			servicesOmitted: omitted,
			servicesMessage: notices.length > 0 ? notices.join(' ') : null
		};
	} catch (err) {
		return { ...noServices, servicesMessage: loadFailure(err).message };
	}
}

const empty = {
	project: null,
	message: null as string | null,
	tab: 'hosts' as ProjectScope,
	canAdmin: false,
	canOwner: false,
	hosts: [],
	hostsOmitted: 0,
	hostsTruncated: false,
	hostsMessage: null as string | null,
	members: [],
	membersOmitted: 0,
	membersTruncated: false,
	membersMessage: null as string | null,
	tokens: [],
	tokensOmitted: 0,
	tokensTruncated: false,
	tokensMessage: null as string | null,
	invites: [] as Invite[],
	invitesOmitted: 0,
	invitesTruncated: false,
	invitesMessage: null as string | null,
	catalog: [] as CatalogEntry[],
	catalogOmitted: 0,
	catalogTruncated: false,
	catalogMessage: null as string | null,
	permissions: null as CatalogPermissionsState | null,
	...noServices
};

export const load: PageServerLoad = async (event) => {
	requireUser(event);
	const id = projectId(event.params);
	let project;
	try {
		project = parseProject(await apiFetch(event, `/v1/projects/${id}`));
	} catch (err) {
		return present(event, { ...empty, userId: event.locals.user?.id ?? null, message: loadFailure(err).message });
	}
	const userId = event.locals.user?.id ?? null;
	if (!project) return present(event, { ...empty, userId, message: 'The API returned an unexpected response.' });

	const localsRole = event.locals.projects.find((item) => item.id === project.id)?.role ?? null;
	const role = uiRole(localsRole, project.role);
	const canAdmin = roleAtLeast(role, 'admin');
	const canOwner = roleAtLeast(role, 'owner');
	const tab = tabOf(event.url.searchParams.get('tab'), canAdmin, canOwner);

	let hosts: Host[] = [];
	let hostsOmitted = 0;
	let hostsTruncated = false;
	let hostsMessage: string | null = null;
	try {
		const list = await apiList(event, `/v1/projects/${id}/hosts`, parseHost);
		hosts = list.items;
		hostsOmitted = list.omitted;
		hostsTruncated = list.truncated;
	} catch (err) {
		hostsMessage = loadFailure(err).message;
	}

	let members: Member[] = [];
	let membersOmitted = 0;
	let membersTruncated = false;
	let membersMessage: string | null = null;
	try {
		const list = await apiList(event, `/v1/projects/${id}/members`, parseMember);
		members = list.items;
		membersOmitted = list.omitted;
		membersTruncated = list.truncated;
	} catch (err) {
		membersMessage = loadFailure(err).message;
	}

	let tokens: JoinToken[] = [];
	let tokensOmitted = 0;
	let tokensTruncated = false;
	let tokensMessage: string | null = null;
	if (canAdmin) {
		try {
			const list = await apiList(event, `/v1/projects/${id}/join-tokens`, parseJoinToken);
			tokens = list.items;
			tokensOmitted = list.omitted;
			tokensTruncated = list.truncated;
		} catch (err) {
			tokensMessage = loadFailure(err).message;
		}
	}

	let invites: Invite[] = [];
	let invitesOmitted = 0;
	let invitesTruncated = false;
	let invitesMessage: string | null = null;
	if (canAdmin) {
		try {
			const list = await apiList(event, `/v1/projects/${id}/invites`, parseInvite);
			invites = list.items;
			invitesOmitted = list.omitted;
			invitesTruncated = list.truncated;
		} catch (err) {
			invitesMessage = loadFailure(err).message;
		}
	}

	const reachableHostIds = new Set(hosts.filter(serviceHostReachable).map((host) => host.id));
	const services = tab === 'services' ? await loadProjectServices(event, id, reachableHostIds) : noServices;

	let catalog: CatalogEntry[] = [];
	let catalogOmitted = 0;
	let catalogTruncated = false;
	let catalogMessage: string | null = null;
	let permissions: CatalogPermissionsState | null = null;
	if (tab === 'catalog') {
		try {
			const parsed = parseCatalogList(await apiFetch(event, `/v1/projects/${id}/catalog`));
			if (!parsed) catalogMessage = 'The API returned an unexpected response.';
			else {
				catalog = catalogForCaller(parsed.items, canOwner);
				catalogOmitted = parsed.omitted;
				catalogTruncated = parsed.truncated;
			}
		} catch (err) {
			catalogMessage = loadFailure(err).message;
		}
		const requested = event.url.searchParams.get('permissions');
		if (canOwner && requested && isCatalogName(requested)) {
			permissions = await loadPermissions(event, id, requested);
		}
	}

	return present(event, {
		project,
		userId,
		message: null,
		tab,
		canAdmin,
		canOwner,
		hosts,
		hostsOmitted,
		hostsTruncated,
		hostsMessage,
		members,
		membersOmitted,
		membersTruncated,
		membersMessage,
		tokens,
		tokensOmitted,
		tokensTruncated,
		tokensMessage,
		invites,
		invitesOmitted,
		invitesTruncated,
		invitesMessage,
		catalog,
		catalogOmitted,
		catalogTruncated,
		catalogMessage,
		permissions,
		...services
	});
};

async function loadPermissions(event: RequestEvent, id: string, name: string): Promise<CatalogPermissionsState> {
	try {
		const grants = parseCatalogGrants(await apiFetch(event, `/v1/projects/${id}/catalog/${name}/permissions`));
		if (!grants) return { name, grants: [], message: 'The API returned an unexpected response.', loaded: false };
		return { name, grants, message: null, loaded: true };
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		return { name, grants: [], message: loadFailure(err).message, loaded: false };
	}
}

const INVITE_EXPIRY_SEC: Record<string, number> = {
	'86400': 86400,
	'604800': 604800,
	'2592000': 2592000
};

const INVITE_USES: Record<string, number> = {
	'1': 1,
	'5': 5,
	'25': 25
};

function inviteInvalid(event: RequestEvent, message: string) {
	return fail(400, present(event, { scope: 'members' as const, inviteMessage: message }));
}

function inviteFailure(event: RequestEvent, err: unknown) {
	if (isRedirect(err) || isHttpError(err)) throw err;
	if (!(err instanceof ApiError)) console.error('bot api request failed');
	const status = err instanceof ApiError && err.status >= 400 && err.status <= 599 ? err.status : 503;
	const message = err instanceof ApiError ? err.msg : 'The API is unavailable.';
	return fail(status, present(event, { scope: 'members' as const, inviteMessage: message }));
}

function keptName(event: RequestEvent, serviceId: string, typed: string, status: number, message: string) {
	return fail(status, present(event, { scope: 'services', message, renameServiceId: serviceId, displayName: typed }));
}

async function renameService(event: RequestEvent, serviceId: string, form: FormData) {
	if (!isUuid(serviceId)) return invalid(event, 'services', 'That service is not valid.');
	const typed = formText(form, 'display_name');
	const clearing = formText(form, 'clear') === '1';
	let body: { display_name: string | null };
	if (clearing) {
		body = { display_name: null };
	} else {
		const name = cleanDisplayName(typed);
		if (!name) return keptName(event, serviceId, typed, 400, 'Enter a display name (1–64 characters).');
		body = { display_name: name };
	}
	try {
		await apiFetch(event, `/v1/services/${serviceId}`, { method: 'PATCH', body: JSON.stringify(body) });
		const dest = new URL(backTo(event.url), event.url.origin);
		const qs = dest.searchParams.toString();
		redirect(303, qs ? `${dest.pathname}?${qs}` : dest.pathname);
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		if (err instanceof ApiError && (err.code === 'conflict' || err.code === 'bad_request' || err.code === 'forbidden')) {
			return keptName(event, serviceId, typed, err.status, err.msg);
		}
		return actionFailure(event, err, 'services');
	}
}

export const actions: Actions = {
	catalogCreate,
	catalogUpdate,
	catalogDelete,
	catalogParse,
	catalogRun,
	catalogStop,
	catalogRestart,
	catalogLogs,
	catalogPermissions,
	askRevoke: async (event) => {
		requireUser(event);
		projectId(event.params);
		const hostId = formText(await event.request.formData(), 'host_id');
		if (!isUuid(hostId)) return invalid(event, 'hosts', 'That host is not valid.');
		return present(event, { scope: 'hosts', confirmHostId: hostId });
	},

	revokeCredential: async (event) => {
		requireUser(event);
		const id = projectId(event.params);
		const hostId = formText(await event.request.formData(), 'host_id');
		if (!isUuid(hostId)) return invalid(event, 'hosts', 'That host is not valid.');
		try {
			await apiFetch(event, `/v1/hosts/${hostId}/credential`, { method: 'DELETE' });
			redirect(303, backTo(event.url));
		} catch (err) {
			return actionFailure(event, err, 'hosts');
		}
	},

	addMember: async (event) => {
		requireUser(event);
		const id = projectId(event.params);
		const form = await event.request.formData();
		const email = cleanEmail(formText(form, 'email'));
		const role = cleanRole(formText(form, 'role'));
		if (!email) return invalid(event, 'members', 'Enter an email address.');
		if (!role) return invalid(event, 'members', 'Choose admin or viewer.');
		try {
			await apiFetch(event, `/v1/projects/${id}/members`, {
				method: 'POST',
				body: JSON.stringify({ email, role })
			});
			redirect(303, backTo(event.url));
		} catch (err) {
			return actionFailure(event, err, 'members');
		}
	},

	changeRole: async (event) => {
		requireUser(event);
		const id = projectId(event.params);
		const form = await event.request.formData();
		const userId = formText(form, 'user_id');
		const role = cleanRole(formText(form, 'role'));
		if (!isUuid(userId)) return invalid(event, 'members', 'That member is not valid.');
		if (!role) return invalid(event, 'members', 'Choose admin or viewer.');
		try {
			await apiFetch(event, `/v1/projects/${id}/members/${userId}`, {
				method: 'PATCH',
				body: JSON.stringify({ role })
			});
			redirect(303, backTo(event.url));
		} catch (err) {
			return actionFailure(event, err, 'members');
		}
	},

	removeMember: async (event) => {
		requireUser(event);
		const id = projectId(event.params);
		const userId = formText(await event.request.formData(), 'user_id');
		if (!isUuid(userId)) return invalid(event, 'members', 'That member is not valid.');
		try {
			await apiFetch(event, `/v1/projects/${id}/members/${userId}`, { method: 'DELETE' });
			redirect(303, backTo(event.url));
		} catch (err) {
			return actionFailure(event, err, 'members');
		}
	},

	createInvite: async (event) => {
		requireUser(event);
		const id = projectId(event.params);
		const form = await event.request.formData();
		const role = cleanRole(formText(form, 'role'));
		const expires = INVITE_EXPIRY_SEC[formText(form, 'expires_in_sec')];
		const maxUses = INVITE_USES[formText(form, 'max_uses')];
		if (!role) return inviteInvalid(event, 'Choose admin or viewer.');
		if (!expires) return inviteInvalid(event, 'Choose an expiry of 1, 7, or 30 days.');
		if (!maxUses) return inviteInvalid(event, 'Choose 1, 5, or 25 uses.');
		try {
			const created = parseCreatedInvite(
				await apiFetch(event, `/v1/projects/${id}/invites`, {
					method: 'POST',
					body: JSON.stringify({ role, expires_in_sec: expires, max_uses: maxUses })
				}),
				event.url.origin
			);
			if (!created) {
				return fail(502, present(event, { scope: 'members' as const, inviteMessage: 'The API returned an unexpected response.' }));
			}
			// Stay on this response so the url is shown once. A reload is a GET and drops it.
			return present(event, { scope: 'members' as const, inviteUrl: created.url, inviteRole: created.role });
		} catch (err) {
			return inviteFailure(event, err);
		}
	},

	revokeInvite: async (event) => {
		requireUser(event);
		const id = projectId(event.params);
		const inviteId = formText(await event.request.formData(), 'invite_id');
		if (!isUuid(inviteId)) return invalid(event, 'members', 'That invite is not valid.');
		try {
			await apiFetch(event, `/v1/projects/${id}/invites/${inviteId}`, { method: 'DELETE' });
			redirect(303, backTo(event.url));
		} catch (err) {
			return actionFailure(event, err, 'members');
		}
	},

	transfer: async (event) => {
		requireUser(event);
		const id = projectId(event.params);
		const userId = formText(await event.request.formData(), 'user_id');
		if (!isUuid(userId)) return invalid(event, 'members', 'Choose a member.');
		try {
			await apiFetch(event, `/v1/projects/${id}/transfer-ownership`, {
				method: 'POST',
				body: JSON.stringify({ user_id: userId })
			});
			redirect(303, backTo(event.url));
		} catch (err) {
			return actionFailure(event, err, 'members');
		}
	},

	createToken: async (event) => {
		requireUser(event);
		const id = projectId(event.params);
		const form = await event.request.formData();
		const hintText = formText(form, 'host_name_hint');
		const hint = hintText.trim() ? cleanHint(hintText) : null;
		if (hintText.trim() && !hint) return invalid(event, 'tokens', 'Host name hint must be 1–80 characters.');
		const expiry = cleanExpiry(formText(form, 'expires_in_sec'));
		if (!expiry.ok) return invalid(event, 'tokens', 'Expiry must be between 300 and 604800 seconds, or blank.');
		const body: { host_name_hint?: string; expires_in_sec?: number } = {};
		if (hint) body.host_name_hint = hint;
		if (expiry.seconds != null) body.expires_in_sec = expiry.seconds;
		try {
			const created = parseCreatedJoin(
				await apiFetch(event, `/v1/projects/${id}/join-tokens`, {
					method: 'POST',
					body: JSON.stringify(body)
				})
			);
			if (!created) return fail(502, present(event, { scope: 'tokens', message: 'The API returned an unexpected response.' }));
			// Stay on this response so the plaintext token is shown once. A reload is a GET and drops it.
			return present(event, {
				scope: 'tokens' as const,
				created,
				message: created.install_command ? null : 'Install command not shown: unexpected format'
			});
		} catch (err) {
			return actionFailure(event, err, 'tokens');
		}
	},

	revokeToken: async (event) => {
		requireUser(event);
		const id = projectId(event.params);
		const tokenId = formText(await event.request.formData(), 'token_id');
		if (!isUuid(tokenId)) return invalid(event, 'tokens', 'That join token is not valid.');
		try {
			await apiFetch(event, `/v1/projects/${id}/join-tokens/${tokenId}`, { method: 'DELETE' });
			redirect(303, backTo(event.url));
		} catch (err) {
			return actionFailure(event, err, 'tokens');
		}
	},

	rename: async (event) => {
		requireUser(event);
		const id = projectId(event.params);
		const form = await event.request.formData();
		const serviceId = formText(form, 'service_id');
		if (serviceId !== '') return renameService(event, serviceId, form);
		const name = cleanName(formText(form, 'name'));
		if (!name) return invalid(event, 'settings', 'Enter a project name (1–80 characters).');
		try {
			await apiFetch(event, `/v1/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
			redirect(303, backTo(event.url));
		} catch (err) {
			return actionFailure(event, err, 'settings');
		}
	},

	probe: async (event) => {
		requireUser(event);
		projectId(event.params);
		const form = await event.request.formData();
		const serviceId = formText(form, 'service_id');
		const checkId = formText(form, 'check_id');
		if (!isUuid(serviceId) || !isUuid(checkId)) {
			return fail(400, present(event, { scope: 'services', message: 'That health check is not valid.' }));
		}
		try {
			const probe = parseProbe(
				await apiFetch(event, `/v1/services/${serviceId}/probe`, {
					method: 'POST',
					body: JSON.stringify({ check_id: checkId })
				})
			);
			if (!probe) return fail(502, present(event, { scope: 'services', message: 'The API returned an unexpected response.' }));
			return present(event, { scope: 'services' as const, probe, probeServiceId: serviceId });
		} catch (err) {
			return actionFailure(event, err, 'services');
		}
	},

	deleteProject: async (event) => {
		requireUser(event);
		const id = projectId(event.params);
		const typed = formText(await event.request.formData(), 'confirm');
		try {
			const current = parseProject(await apiFetch(event, `/v1/projects/${id}`));
			if (!current || typed !== current.name) {
				return invalid(event, 'settings', 'Type the project name exactly to delete it.');
			}
			await apiFetch(event, `/v1/projects/${id}`, { method: 'DELETE' });
			redirect(303, '/projects');
		} catch (err) {
			return actionFailure(event, err, 'settings');
		}
	}
};
