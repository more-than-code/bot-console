import { error, fail, isHttpError, isRedirect, redirect } from '@sveltejs/kit';
import type { Host, ProcessSample } from '$lib/api-types';
import type { HostPage, MetricChart, ProcessSort, ServiceLink } from '$lib/host-view';
import { hostQuery, METRIC_SPECS } from '$lib/host-view';
import { rangeWindow, type RangeKey } from '$lib/ranges';
import { processServiceHref, serviceLabel } from '$lib/service-label';
import { actionFailure, apiFetch, loadFailure } from '$lib/server/api';
import { requireUser } from '$lib/server/guard';
import { present } from '$lib/server/redact';
import {
	parseHost,
	parseListPayload,
	parseMetricPayload,
	parseProcessSample,
	parseProject,
	parseService,
	parseSnapshot
} from '$lib/server/shape';
import { isUuid } from '$lib/server/validate';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

type LoadEvent = Parameters<PageServerLoad>[0];

function hostId(params: { id?: string }): string {
	if (!params.id || !isUuid(params.id)) error(404, 'Not found');
	return params.id;
}

function blank(tab: HostPage['tab'], range: RangeKey, processSort: ProcessSort, message: string): HostPage {
	return {
		host: null,
		projectName: null,
		tab,
		range,
		processSort,
		message,
		serviceLinks: {},
		metrics: [],
		processes: null,
		processesMessage: null
	};
}

async function loadProjectName(event: RequestEvent, projectId: string): Promise<string | null> {
	try {
		const project = parseProject(await apiFetch(event, `/v1/projects/${projectId}`));
		return project?.name ?? null;
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		return null;
	}
}

async function loadMetric(event: RequestEvent, id: string, spec: (typeof METRIC_SPECS)[number], window: { from: string; to: string }): Promise<MetricChart> {
	const params = new URLSearchParams({ m: spec.m, from: window.from, to: window.to });
	try {
		const payload = await apiFetch(event, `/v1/hosts/${id}/metrics?${params.toString()}`);
		const parsed = parseMetricPayload(payload, spec.m, spec.series.map((series) => series.name));
		if (!parsed) return { m: spec.m, message: 'The API returned an unexpected response.', step: null, series: [] };
		return { m: spec.m, message: null, step: parsed.step, series: parsed.series };
	} catch (err) {
		return { m: spec.m, message: loadFailure(err).message, step: null, series: [] };
	}
}

async function loadOverview(event: LoadEvent, host: Host, range: RangeKey, processSort: ProcessSort): Promise<HostPage> {
	event.depends('host:metrics');
	const window = rangeWindow(range, Date.now());
	const [projectName, metrics] = await Promise.all([
		loadProjectName(event, host.project_id),
		Promise.all(METRIC_SPECS.map((spec) => loadMetric(event, host.id, spec, window)))
	]);
	return {
		host,
		projectName,
		tab: 'overview',
		range,
		processSort,
		message: null,
		serviceLinks: {},
		metrics,
		processes: null,
		processesMessage: null
	};
}

/** One host-list page per project. Further pages are not followed. */
const SHARE_SCAN_PROJECTS = 20;

/**
 * Owning project when the caller is a member of `host.project_id`.
 * Otherwise the first of at most 20 session projects whose first host page lists the host.
 */
async function projectForServices(event: LoadEvent, host: Host): Promise<string | null> {
	const projects = event.locals.projects;
	if (projects.some((project) => project.id === host.project_id)) return host.project_id;
	for (const project of projects.slice(0, SHARE_SCAN_PROJECTS)) {
		try {
			const payload = await apiFetch(event, `/v1/projects/${project.id}/hosts?limit=200`);
			const parsed = parseListPayload(payload);
			if (!parsed) continue;
			for (const raw of parsed.raw) {
				const item = parseHost(raw);
				if (item?.id === host.id) return project.id;
			}
		} catch (err) {
			if (isRedirect(err) || isHttpError(err)) throw err;
		}
	}
	return null;
}

async function readServiceLinks(event: RequestEvent, hostId: string): Promise<Record<string, ServiceLink>> {
	try {
		const parsed = parseListPayload(await apiFetch(event, `/v1/hosts/${hostId}/services`));
		if (!parsed) return {};
		const members = new Set(event.locals.projects.map((project) => project.id));
		const links: Record<string, ServiceLink> = {};
		for (const item of parsed.raw.slice(0, 500)) {
			const service = parseService(item);
			if (!service) continue;
			const href =
				service.project_id && members.has(service.project_id)
					? processServiceHref(service.project_id, hostId, service.name)
					: null;
			links[service.id] = { label: serviceLabel(service), href };
		}
		return links;
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		return {};
	}
}

async function readProcesses(event: RequestEvent, id: string, sort: ProcessSort): Promise<{ sample: ProcessSample | null; message: string | null }> {
	try {
		const payload = await apiFetch(event, `/v1/hosts/${id}/processes?sort=${sort}&limit=200`);
		const sample = parseProcessSample(payload);
		if (!sample) return { sample: null, message: 'The API returned an unexpected response.' };
		return { sample, message: null };
	} catch (err) {
		return { sample: null, message: loadFailure(err).message };
	}
}

async function loadProcesses(event: RequestEvent, host: Host, range: RangeKey, processSort: ProcessSort): Promise<HostPage> {
	const [projectName, processes, serviceLinks] = await Promise.all([
		loadProjectName(event, host.project_id),
		readProcesses(event, host.id, processSort),
		readServiceLinks(event, host.id)
	]);
	return {
		host,
		projectName,
		tab: 'processes',
		range,
		processSort,
		message: null,
		serviceLinks,
		metrics: [],
		processes: processes.sample,
		processesMessage: processes.message
	};
}

export const load: PageServerLoad = async (event) => {
	requireUser(event);
	const id = hostId(event.params);
	const query = hostQuery(event.url);
	try {
		const host = parseHost(await apiFetch(event, `/v1/hosts/${id}`));
		if (!host) return present(event, blank(query.tab, query.range, query.processSort, 'The API returned an unexpected response.'));
		if (event.url.searchParams.get('tab') === 'services') {
			const project = await projectForServices(event, host);
			if (project) redirect(303, `/projects/${project}?tab=services&services.host=${host.id}`);
		}
		if (query.tab === 'processes') return present(event, await loadProcesses(event, host, query.range, query.processSort));
		return present(event, await loadOverview(event, host, query.range, query.processSort));
	} catch (err) {
		const failure = loadFailure(err);
		return present(event, blank(query.tab, query.range, query.processSort, failure.message));
	}
};

export const actions: Actions = {
	snapshot: async (event) => {
		requireUser(event);
		const id = hostId(event.params);
		try {
			const snapshot = parseSnapshot(await apiFetch(event, `/v1/hosts/${id}/snapshot`, { method: 'POST' }));
			if (!snapshot) return fail(502, present(event, { message: 'The API returned an unexpected response.' }));
			return present(event, { snapshot });
		} catch (err) {
			return actionFailure(event, err);
		}
	}
};
