import { error, fail, isHttpError, isRedirect, redirect } from '@sveltejs/kit';
import type { CatalogEntry, EnvSet, Host, Invite, JoinToken, Member, ProjectFile, ProjectServiceRow, Registry, ServiceRuntime } from '$lib/api-types';
import { catalogForCaller, isCatalogName } from '$lib/catalog';
import { COPIES_CAPPED_NOTE, COPIES_MAX_PAGES, COPIES_PAGE_LIMIT, groupCopies, STATUS_READ_LIMIT } from '$lib/catalog-copies';
import {
	HEALTH_CHECK_LIMIT,
	HEALTH_NEEDS_CONFIRMATION,
	UNREAD_HEALTH_CHECKS,
	CHECKS_NEED_API,
	dockerCheckFromEntry,
	draftsFromForm,
	fieldForHealthMessage,
	healthCheckPayload,
	payloadHasConfirmation,
	probeRequestBody,
	validateHealthChecks
} from '$lib/health-checks';
import {
	entryHostIndex,
	entryRef,
	needsContainerStatus,
	notRunningPairs,
	ownerEntry,
	runtimeFromImageStatus,
	runtimeFromRow,
	statusReader,
	UNKNOWN_RUNTIME,
	type NotRunningPair,
	type ServiceEntryRef
} from '$lib/service-actions';
import type { ActionField, CatalogPermissionsState, ProjectScope } from '$lib/project-action';
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
import {
	catalogConfirm,
	catalogDeploy,
	catalogDeploys,
	catalogEnvSets,
	catalogFiles,
	catalogImageDigest,
	catalogImageTags,
	catalogRemove,
	catalogRollback,
	deleteEnvSet,
	deleteProjectFile,
	deleteRegistry,
	loadProjectSettings,
	putEnvKey,
	deleteEnvKey,
	makeEnvKeysSecret,
	mergeEnvSet,
	saveEnvSet,
	saveProjectFile,
	saveRegistry,
	viewProjectFile
} from '$lib/server/image-actions';
import { formText } from '$lib/server/form';
import { requireUser } from '$lib/server/guard';
import { present } from '$lib/server/redact';
import { roleAtLeast, uiRole } from '$lib/server/roles';
import {
	isRecord,
	parseCatalogGrants,
	parseCatalogList,
	parseCreatedInvite,
	parseCreatedJoin,
	parseHealthChecks,
	parseHost,
	parseImageStatus,
	parseInvite,
	parseJoinToken,
	parseMember,
	parseProbe,
	parseProject,
	parseProjectService,
	parseService,
	parseServicePage
} from '$lib/server/shape';
import { cleanDisplayName, cleanEmail, cleanExpiry, cleanHint, cleanName, cleanRole, isUuid } from '$lib/server/validate';
import { backTo, servicesTabTarget } from '$lib/url';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

function projectId(params: { id?: string }): string {
	if (!params.id || !isUuid(params.id)) error(404, 'Not found');
	return params.id;
}

function invalid(event: RequestEvent, scope: ProjectScope, message: string, field?: ActionField) {
	return fail(400, present(event, field ? { scope, message, field } : { scope, message }));
}

function tabOf(value: string | null, canAdmin: boolean): ProjectScope {
	if (value === 'settings') return canAdmin ? 'settings' : 'hosts';
	if (value === 'tokens') return canAdmin ? 'tokens' : 'hosts';
	if (value === 'members') return 'members';
	// `services` is the old Services tab, now part of Catalog & services.
	if (value === 'catalog' || value === 'services') return 'catalog';
	return 'hosts';
}

type CopiesLoad = {
	/** Running copies by catalog entry name, in host-name order (see `groupCopies`). */
	copies: Record<string, ProjectServiceRow[]>;
	/**
	 * True only when every services page was read and every row parsed. "Not deployed yet." needs it,
	 * so a failed, capped or partly unreadable list never claims an entry has no copy.
	 */
	copiesComplete: boolean;
	copiesOmitted: number;
	copiesMessage: string | null;
	/** More container copies than `STATUS_READ_LIMIT`: the rest show an unknown state. */
	statusCapped: boolean;
	/** Programs that never ran on a host that can run them. */
	notRunning: NotRunningPair[];
	/** False when the services index needed for `notRunning` could not be read whole. */
	notRunningKnown: boolean;
	/**
	 * Service id to container state, read with catalog status after the page renders (streamed).
	 * Copies waiting for it show "checking…". Never rejects.
	 */
	serviceStates: Promise<Record<string, ServiceRuntime>>;
};

const noCopies: CopiesLoad = {
	copies: {},
	copiesComplete: true,
	copiesOmitted: 0,
	copiesMessage: null,
	statusCapped: false,
	notRunning: [],
	notRunningKnown: true,
	serviceStates: Promise.resolve({})
};

/** A status read that takes longer leaves the copy's state unknown. */
const STATUS_TIMEOUT_MS = 8_000;
/** At most this many status reads at once per page load. */
const STATUS_CONCURRENCY = 4;


type CopyRowsRead = {
	/** Every parsed row of this project, before grouping. */
	rows: ProjectServiceRow[];
	omitted: number;
	/** Every page was read and every row parsed. */
	complete: boolean;
	/** More pages than `COPIES_MAX_PAGES`. */
	capped: boolean;
	message: string | null;
};

/**
 * This project's Deploybot services with their health checks (api-v1 v1.18), following `next_cursor` for
 * at most `COPIES_MAX_PAGES` pages of `COPIES_PAGE_LIMIT`.
 */
async function readCopyRows(event: RequestEvent, projectId: string): Promise<CopyRowsRead> {
	const rows: ProjectServiceRow[] = [];
	// Cursor pages can repeat a row (offset paging while services change): keep the first.
	const seen = new Set<string>();
	let omitted = 0;
	let cursor: string | null = null;
	try {
		for (let pageNo = 0; pageNo < COPIES_MAX_PAGES; pageNo += 1) {
			const params = new URLSearchParams({ view: 'deploybot', include: 'health_checks', limit: String(COPIES_PAGE_LIMIT) });
			if (cursor != null) params.set('cursor', cursor);
			const page = parseServicePage(await apiFetch(event, `/v1/projects/${projectId}/services?${params.toString()}`));
			if (!page) return { rows, omitted, complete: false, capped: false, message: 'The API returned an unexpected response.' };
			for (const item of page.raw) {
				// Another project's service on this project's hosts is never a copy here, so it cannot
				// count as left out (and so cannot hide the "not running yet" rows), even when malformed.
				if (isRecord(item) && typeof item.project_id === 'string' && item.project_id !== projectId) continue;
				const row = parseProjectService(item);
				if (!row) {
					omitted += 1;
					continue;
				}
				if (row.project_id !== projectId || seen.has(row.id)) continue;
				seen.add(row.id);
				// api-v1 v1.18: checks come with the list row; an older API omits the key.
				if (!isRecord(item) || !Object.hasOwn(item, 'health_checks')) {
					rows.push({ ...row, checks: [], checksMessage: CHECKS_NEED_API });
					continue;
				}
				const checks = parseHealthChecks(item.health_checks);
				rows.push({ ...row, checks: checks ?? [], checksMessage: checks ? null : UNREAD_HEALTH_CHECKS });
			}
			cursor = page.nextCursor;
			if (cursor == null) return { rows, omitted, complete: omitted === 0, capped: false, message: null };
		}
		return { rows, omitted, complete: false, capped: true, message: COPIES_CAPPED_NOTE };
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		return { rows: [], omitted: 0, complete: false, capped: false, message: loadFailure(err).message };
	}
}

/**
 * The running copies of the listed entries, grouped by entry, plus the programs that never ran on a host
 * and the streamed container states. Needs the host list and the catalog, so it waits for both.
 */
async function loadCopies(
	event: RequestEvent,
	projectId: string,
	hosts: Host[],
	catalog: CatalogEntry[],
	read: CopyRowsRead,
	canAdmin: boolean
): Promise<CopiesLoad> {
	const failed = read.message != null && !read.capped;
	if (failed) return { ...noCopies, copiesComplete: false, notRunningKnown: false, copiesMessage: read.message };
	const entries = catalog.map(entryRef).filter((entry) => entry.my_actions.length > 0);
	const listed = groupCopies(read.rows, projectId, catalog);
	// Entry order, then host order: the status read cap keeps the first ones.
	const flat = catalog.flatMap((entry) => listed[entry.name] ?? []);
	const checked = canAdmin ? withDockerChecks(flat, catalog) : flat;
	const withState = withRuntime(event, projectId, checked, entries);
	const byId = new Map(withState.rows.map((row) => [row.id, row]));
	const copies: Record<string, ProjectServiceRow[]> = {};
	for (const [name, rows] of Object.entries(listed)) copies[name] = rows.map((row) => byId.get(row.id) ?? row);
	return {
		copies,
		copiesComplete: read.complete,
		copiesOmitted: read.omitted,
		copiesMessage: read.message,
		statusCapped: withState.capped,
		notRunning: read.complete ? notRunningPairs(entries, hosts, entryHostIndex(read.rows)) : [],
		notRunningKnown: read.complete || !entries.some((entry) => entry.kind === 'program' && entry.my_actions.includes('run')),
		serviceStates: withState.states
	};
}

/**
 * Admin only (the dialog's edit gate), for copies that report Docker health. The catalog is the tab's
 * one read (first page only, on purpose: an entry beyond it is not listed). A failed read lists no copies.
 */
function withDockerChecks(copies: ProjectServiceRow[], catalog: CatalogEntry[]): ProjectServiceRow[] {
	if (!copies.some((row) => row.health?.source === 'docker')) return copies;
	const entries = new Map(catalog.map((entry) => [entry.name, entry]));
	return copies.map((row) =>
		row.health?.source === 'docker' ? { ...row, dockerCheck: dockerCheckFromEntry(entries.get(row.catalog_entry ?? '')) } : row
	);
}

/**
 * Each copy of an entry the caller has a grant on gets its state. Programs are known from the row. The
 * services list does not say whether a container is running, so each owned container on an online host is
 * read with catalog status (not audited): once per (entry, host), at most four at a time, and streamed so
 * the page does not wait for slow hosts. Past `STATUS_READ_LIMIT` copies a container is not read and its
 * state is unknown.
 */
function withRuntime(
	event: RequestEvent,
	projectId: string,
	services: ProjectServiceRow[],
	entries: ServiceEntryRef[]
): { rows: ProjectServiceRow[]; states: Promise<Record<string, ServiceRuntime>>; capped: boolean } {
	const read = statusReader((entry, hostId) => containerRuntime(event, projectId, entry, hostId), STATUS_CONCURRENCY);
	const pending: Array<Promise<[string, ServiceRuntime]>> = [];
	let reads = 0;
	let capped = false;
	const rows = services.map((row) => {
		const entry = ownerEntry(row, projectId, entries);
		if (entry == null) return row;
		if (!needsContainerStatus(row, entry)) return { ...row, runtime: runtimeFromRow(row) };
		if (reads >= STATUS_READ_LIMIT) {
			capped = true;
			return { ...row, runtime: UNKNOWN_RUNTIME };
		}
		reads += 1;
		pending.push(read(entry.name, row.host_id).then((runtime) => [row.id, runtime]));
		return row;
	});
	return { rows, states: Promise.all(pending).then((pairs) => present(event, Object.fromEntries(pairs))), capped };
}

/** Never rejects: it runs after the page is sent, where a redirect can no longer happen. */
async function containerRuntime(event: RequestEvent, projectId: string, entry: string, hostId: string): Promise<ServiceRuntime> {
	// A read still queued when the browser has gone away is not sent.
	if (event.request.signal?.aborted) return UNKNOWN_RUNTIME;
	try {
		const payload = await apiFetch(
			event,
			`/v1/projects/${projectId}/catalog/${entry}/status`,
			{ method: 'POST', body: JSON.stringify({ host_id: hostId }) },
			STATUS_TIMEOUT_MS
		);
		const status = parseImageStatus(payload);
		return status ? runtimeFromImageStatus(status) : UNKNOWN_RUNTIME;
	} catch {
		return UNKNOWN_RUNTIME;
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
	envSets: [] as EnvSet[],
	envSetsMessage: null as string | null,
	files: [] as ProjectFile[],
	filesMessage: null as string | null,
	registries: [] as Registry[],
	registriesMessage: null as string | null,
	...noCopies
};

export const load: PageServerLoad = async (event) => {
	requireUser(event);
	// Old Services tab links (bookmarks, other pages) land on Catalog & services with their params mapped.
	const legacy = servicesTabTarget(event.url);
	if (legacy && event.request.method === 'GET') redirect(303, legacy);
	// The Hosts tab's created-token card polls this key while it waits for the new host.
	if (tabOf(event.url.searchParams.get('tab'), true) === 'hosts') event.depends('project:enrol');
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
	const tab = tabOf(event.url.searchParams.get('tab'), canAdmin);

	// Each tab loads only what it shows, and independent calls run together.
	// The copies on the Catalog & services tab wait for the host list and the catalog, because grouping and
	// the row actions need both.
	const hostsLoad =
		tab === 'hosts' || tab === 'catalog'
			? loadList(event, `/v1/projects/${id}/hosts`, parseHost)
			: Promise.resolve(emptyList<Host>());
	const catalogRead = tab === 'catalog' ? loadCatalog(event, id, canOwner) : Promise.resolve(null);
	const copiesLoad =
		tab === 'catalog'
			? Promise.all([hostsLoad, catalogRead, readCopyRows(event, id)]).then(([list, listed, read]) =>
					listed && listed.catalogMessage == null
						? loadCopies(event, id, list.items, listed.catalog, read, canAdmin)
						: noCopies
				)
			: Promise.resolve(noCopies);
	const [hostList, memberList, tokenList, inviteList, copiesData, catalogLoad, settings] = await Promise.all([
		hostsLoad,
		tab === 'members' || tab === 'catalog' ? loadList(event, `/v1/projects/${id}/members`, parseMember) : emptyList<Member>(),
		// The Hosts tab reads them only to see whether a newly created token was used.
		(tab === 'tokens' || tab === 'hosts') && canAdmin ? loadList(event, `/v1/projects/${id}/join-tokens`, parseJoinToken) : emptyList<JoinToken>(),
		tab === 'members' && canAdmin ? loadList(event, `/v1/projects/${id}/invites`, parseInvite) : emptyList<Invite>(),
		copiesLoad,
		catalogRead,
		tab === 'settings' && canAdmin ? loadProjectSettings(event, id) : null
	]);

	const hosts = hostList.items;
	const hostsOmitted = hostList.omitted;
	const hostsTruncated = hostList.truncated;
	const hostsMessage = hostList.message;
	const members = memberList.items;
	const membersOmitted = memberList.omitted;
	const membersTruncated = memberList.truncated;
	const membersMessage = memberList.message;
	const tokens = tokenList.items;
	const tokensOmitted = tokenList.omitted;
	const tokensTruncated = tokenList.truncated;
	const tokensMessage = tokenList.message;
	const invites = inviteList.items;
	const invitesOmitted = inviteList.omitted;
	const invitesTruncated = inviteList.truncated;
	const invitesMessage = inviteList.message;
	const catalog = catalogLoad?.catalog ?? [];
	const catalogOmitted = catalogLoad?.catalogOmitted ?? 0;
	const catalogTruncated = catalogLoad?.catalogTruncated ?? false;
	const catalogMessage = catalogLoad?.catalogMessage ?? null;
	const permissions = catalogLoad?.permissions ?? null;
	const envSets = settings?.envSets ?? [];
	const envSetsMessage = settings?.envSetsMessage ?? null;
	const files = settings?.files ?? [];
	const filesMessage = settings?.filesMessage ?? null;
	const registries = settings?.registries ?? [];
	const registriesMessage = settings?.registriesMessage ?? null;

	// The streamed states stay a promise: present() would turn it into a plain object.
	const { serviceStates, ...copyData } = copiesData;
	return {
		...present(event, {
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
			envSets,
			envSetsMessage,
			files,
			filesMessage,
			registries,
			registriesMessage,
			...copyData
		}),
		serviceStates
	};
};

type ListLoad<T> = { items: T[]; omitted: number; truncated: boolean; message: string | null };

function emptyList<T>(): ListLoad<T> {
	return { items: [], omitted: 0, truncated: false, message: null };
}

/** One section's list. A failure becomes the section's message; a redirect or HTTP error still throws. */
async function loadList<T>(event: RequestEvent, path: string, parse: (value: unknown) => T | null): Promise<ListLoad<T>> {
	try {
		return { ...(await apiList(event, path, parse)), message: null };
	} catch (err) {
		return { ...emptyList<T>(), message: loadFailure(err).message };
	}
}

/** The catalog list and, when an owner asked for it, one entry's permissions, fetched together. */
async function loadCatalog(event: RequestEvent, id: string, canOwner: boolean) {
	const requested = event.url.searchParams.get('permissions');
	const [listed, permissions] = await Promise.all([
		apiFetch(event, `/v1/projects/${id}/catalog`).then(
			(payload) => ({ parsed: parseCatalogList(payload), message: null }),
			(err) => ({ parsed: null, message: loadFailure(err).message })
		),
		canOwner && requested && isCatalogName(requested) ? loadPermissions(event, id, requested) : null
	]);
	const failed = listed.message ?? (listed.parsed ? null : 'The API returned an unexpected response.');
	if (failed || !listed.parsed) {
		return { catalog: [], catalogOmitted: 0, catalogTruncated: false, catalogMessage: failed, permissions };
	}
	return {
		catalog: catalogForCaller(listed.parsed.items, canOwner),
		catalogOmitted: listed.parsed.omitted,
		catalogTruncated: listed.parsed.truncated,
		catalogMessage: null,
		permissions
	};
}

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
	return fail(status, present(event, { scope: 'catalog', message, renameServiceId: serviceId, displayName: typed }));
}

function healthFieldFailure(
	event: RequestEvent,
	serviceId: string,
	status: number,
	field: string,
	index: number | null,
	message: string
) {
	// Field text stays in the dialog. `message` would also become the section banner.
	return fail(status, present(event, {
		scope: 'catalog' as const,
		healthServiceId: serviceId,
		healthField: field,
		healthIndex: index,
		healthMessage: message
	}));
}

/** Editor probe failures stay on the row. `field` null is the row notice; a field is the control error. */
function editorProbeFailure(
	event: RequestEvent,
	serviceId: string,
	status: number,
	index: number | null,
	message: string,
	field: string | null
) {
	return fail(status, present(event, {
		scope: 'catalog' as const,
		editorProbe: true,
		probeServiceId: serviceId,
		probeIndex: index,
		probeMessage: field == null ? message : null,
		healthServiceId: serviceId,
		healthField: field,
		healthIndex: field == null ? null : index,
		healthMessage: field == null ? null : message
	}));
}

function probeRowIndex(raw: string): number | null {
	if (!/^(0|[1-9]\d{0,5})$/.test(raw)) return null;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < 0 || value > HEALTH_CHECK_LIMIT) return null;
	return value;
}

/** Lets the shape check accept this port before the service is read. An unusable port matches nothing. */
function shapePorts(port: string): number[] {
	if (!/^(0|[1-9]\d{0,5})$/.test(port)) return [];
	const value = Number(port);
	if (!Number.isSafeInteger(value) || value < 1 || value > 65535) return [];
	return [value];
}

async function replaceHealthChecks(event: RequestEvent, serviceId: string, form: FormData) {
	if (!isUuid(serviceId)) return invalid(event, 'catalog', 'That service is not valid.');
	const read = draftsFromForm(form);
	if (!read.ok) return healthFieldFailure(event, serviceId, 400, read.field, read.index, read.message);
	try {
		const detail = parseService(await apiFetch(event, `/v1/services/${serviceId}`));
		if (!detail) {
			return healthFieldFailure(event, serviceId, 502, 'form', null, 'The API returned an unexpected response.');
		}
		const issue = validateHealthChecks(read.drafts, detail.ports)[0];
		if (issue) return healthFieldFailure(event, serviceId, 400, issue.field, issue.index, issue.message);
		const saved = await apiFetch(event, `/v1/services/${serviceId}/health-checks`, {
			method: 'PUT',
			body: JSON.stringify({ checks: healthCheckPayload(read.drafts) })
		});
		if (payloadHasConfirmation(saved)) {
			return healthFieldFailure(event, serviceId, 409, 'form', null, HEALTH_NEEDS_CONFIRMATION);
		}
		const dest = new URL(backTo(event.url), event.url.origin);
		const qs = dest.searchParams.toString();
		redirect(303, qs ? `${dest.pathname}?${qs}` : dest.pathname);
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		if (err instanceof ApiError && err.code === 'bad_request') {
			return healthFieldFailure(event, serviceId, err.status, fieldForHealthMessage(err.msg), null, err.msg);
		}
		if (err instanceof ApiError) {
			return healthFieldFailure(event, serviceId, err.status, 'form', null, err.msg);
		}
		return actionFailure(event, err, 'catalog');
	}
}

async function renameService(event: RequestEvent, serviceId: string, form: FormData) {
	if (!isUuid(serviceId)) return invalid(event, 'catalog', 'That service is not valid.');
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
		return actionFailure(event, err, 'catalog');
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
	catalogDeploy,
	catalogRollback,
	catalogRemove,
	catalogConfirm,
	catalogDeploys,
	catalogEnvSets,
	catalogFiles,
	catalogImageTags,
	catalogImageDigest,
	saveEnvSet,
	mergeEnvSet,
	putEnvKey,
	deleteEnvKey,
	makeEnvKeysSecret,
	deleteEnvSet,
	saveProjectFile,
	viewProjectFile,
	deleteProjectFile,
	saveRegistry,
	deleteRegistry,
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
		if (!email) return invalid(event, 'members', 'Enter an email address.', 'addMember');
		if (!role) return invalid(event, 'members', 'Choose admin or viewer.', 'addMember');
		try {
			await apiFetch(event, `/v1/projects/${id}/members`, {
				method: 'POST',
				body: JSON.stringify({ email, role })
			});
			redirect(303, backTo(event.url));
		} catch (err) {
			return actionFailure(event, err, 'members', 'addMember');
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
		if (hintText.trim() && !hint) return invalid(event, 'hosts', 'Host name hint must be 1–80 characters.', 'createToken');
		const expiry = cleanExpiry(formText(form, 'expires_in_sec'));
		if (!expiry.ok) return invalid(event, 'hosts', 'Expiry must be between 300 and 604800 seconds, or blank.', 'createToken');
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
			if (!created) return fail(502, present(event, { scope: 'hosts', field: 'createToken' as const, message: 'The API returned an unexpected response.' }));
			// Stay on this response so the plaintext token is shown once. A reload is a GET and drops it.
			return present(event, {
				scope: 'hosts' as const,
				field: 'createToken' as const,
				created,
				message: created.server ? null : 'Server URL not shown: unexpected format'
			});
		} catch (err) {
			return actionFailure(event, err, 'hosts', 'createToken');
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
		if (!isUuid(serviceId)) {
			return fail(400, present(event, { scope: 'catalog', message: 'That health check is not valid.' }));
		}
		// Saved rows still post only check_id. The editor posts protocol, port, and path.
		if (checkId !== '') {
			if (!isUuid(checkId)) {
				return fail(400, present(event, { scope: 'catalog', message: 'That health check is not valid.' }));
			}
			try {
				const probe = parseProbe(
					await apiFetch(event, `/v1/services/${serviceId}/probe`, {
						method: 'POST',
						body: JSON.stringify({ check_id: checkId })
					})
				);
				if (!probe) return fail(502, present(event, { scope: 'catalog', message: 'The API returned an unexpected response.' }));
				return present(event, { scope: 'catalog' as const, probe, probeServiceId: serviceId });
			} catch (err) {
				return actionFailure(event, err, 'catalog');
			}
		}
		if (formText(form, 'protocol') === '') {
			return fail(400, present(event, { scope: 'catalog', message: 'That health check is not valid.' }));
		}
		const protocol = formText(form, 'protocol');
		const port = formText(form, 'port');
		const path = formText(form, 'path');
		const index = probeRowIndex(formText(form, 'probe_index'));
		// Path and port shape need no fetch. Membership uses the service read below, not this list.
		const shape = probeRequestBody({ protocol, port, path, ports: shapePorts(port) });
		if (!shape.ok) return editorProbeFailure(event, serviceId, 400, index, shape.message, shape.field);
		try {
			const detail = parseService(await apiFetch(event, `/v1/services/${serviceId}`));
			if (!detail) {
				return editorProbeFailure(event, serviceId, 502, index, 'The API returned an unexpected response.', null);
			}
			const built = probeRequestBody({ protocol, port, path, ports: detail.ports });
			if (!built.ok) return editorProbeFailure(event, serviceId, 400, index, built.message, built.field);
			const probe = parseProbe(
				await apiFetch(event, `/v1/services/${serviceId}/probe`, {
					method: 'POST',
					body: JSON.stringify(built.body)
				})
			);
			if (!probe) return editorProbeFailure(event, serviceId, 502, index, 'The API returned an unexpected response.', null);
			return present(event, {
				scope: 'catalog' as const,
				probe,
				probeServiceId: serviceId,
				editorProbe: true,
				probeIndex: index
			});
		} catch (err) {
			if (isRedirect(err) || isHttpError(err)) throw err;
			if (!(err instanceof ApiError)) console.error('bot api request failed');
			const status = err instanceof ApiError && err.status >= 400 && err.status <= 599 ? err.status : 503;
			const message = err instanceof ApiError ? err.msg : 'The API is unavailable.';
			return editorProbeFailure(event, serviceId, status, index, message, null);
		}
	},

	saveHealthChecks: async (event) => {
		requireUser(event);
		projectId(event.params);
		const form = await event.request.formData();
		return replaceHealthChecks(event, formText(form, 'service_id'), form);
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
