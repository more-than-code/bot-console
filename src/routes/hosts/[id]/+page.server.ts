import { error, fail, isHttpError, isRedirect } from '@sveltejs/kit';
import type { Host, ProcessSample, ServiceRow, ServiceSummary } from '$lib/api-types';
import type { HostPage, MetricChart, ProcessSort } from '$lib/host-view';
import { hostQuery, METRIC_SPECS } from '$lib/host-view';
import { rangeWindow, type RangeKey } from '$lib/ranges';
import { ApiError, actionFailure, apiFetch, loadFailure } from '$lib/server/api';
import { formText } from '$lib/server/form';
import { requireUser } from '$lib/server/guard';
import { present } from '$lib/server/redact';
import {
	isRecord,
	parseHealthChecks,
	parseHost,
	parseListPayload,
	parseMetricPayload,
	parseProbe,
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

const CHECK_LIMIT = 50;
const CHECK_CONCURRENCY = 6;
const CHECK_DEADLINE_MS = 10_000;

async function loadChecks(event: RequestEvent, service: ServiceSummary, signal: AbortSignal): Promise<ServiceRow> {
	try {
		const payload = await apiFetch(event, `/v1/services/${service.id}`, { signal });
		const checks = isRecord(payload) ? parseHealthChecks(payload.health_checks) : null;
		if (!checks) return { ...service, checks: [], checksMessage: 'Health checks could not be read.' };
		return { ...service, checks, checksMessage: null };
	} catch (err) {
		return { ...service, checks: [], checksMessage: loadFailure(err).message };
	}
}

/** The service list has no health_checks. Detail reads stay inside one shared deadline. */
async function withChecks(event: RequestEvent, services: ServiceSummary[]): Promise<ServiceRow[]> {
	const pending = services.slice(0, CHECK_LIMIT);
	const skipped: ServiceRow[] = services.slice(CHECK_LIMIT).map((service) => ({
		...service,
		checks: [],
		checksMessage: 'checks not loaded'
	}));
	const rows: ServiceRow[] = new Array(pending.length);
	const deadline = AbortSignal.timeout(CHECK_DEADLINE_MS);
	let cursor = 0;
	async function worker() {
		for (;;) {
			const index = cursor;
			cursor += 1;
			if (index >= pending.length) return;
			const service = pending[index];
			if (!service) continue;
			rows[index] = await loadChecks(event, service, deadline);
		}
	}
	await Promise.all(Array.from({ length: Math.min(CHECK_CONCURRENCY, pending.length) }, () => worker()));
	return [...rows, ...skipped];
}

function blank(tab: HostPage['tab'], range: RangeKey, processSort: ProcessSort, message: string): HostPage {
	return {
		host: null,
		projectName: null,
		tab,
		range,
		processSort,
		message,
		services: [],
		omitted: 0,
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
		services: [],
		omitted: 0,
		metrics,
		processes: null,
		processesMessage: null
	};
}

async function loadServices(event: RequestEvent, host: Host, range: RangeKey, processSort: ProcessSort): Promise<HostPage> {
	const parsed = parseListPayload(await apiFetch(event, `/v1/hosts/${host.id}/services`));
	if (!parsed) throw new ApiError(502, 'error', 'The API returned an unexpected response.');
	const raw = parsed.raw.length > 500 ? parsed.raw.slice(0, 500) : parsed.raw;
	let omitted = parsed.raw.length - raw.length;
	const summaries: ServiceSummary[] = [];
	for (const item of raw) {
		const service = parseService(item);
		if (service) summaries.push(service);
		else omitted += 1;
	}
	const [projectName, services] = await Promise.all([
		loadProjectName(event, host.project_id),
		withChecks(event, summaries)
	]);
	return {
		host,
		projectName,
		tab: 'services',
		range,
		processSort,
		message: null,
		services,
		omitted,
		metrics: [],
		processes: null,
		processesMessage: null
	};
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
	const [projectName, processes] = await Promise.all([
		loadProjectName(event, host.project_id),
		readProcesses(event, host.id, processSort)
	]);
	return {
		host,
		projectName,
		tab: 'processes',
		range,
		processSort,
		message: null,
		services: [],
		omitted: 0,
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
		if (query.tab === 'services') return present(event, await loadServices(event, host, query.range, query.processSort));
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
	},

	probe: async (event) => {
		requireUser(event);
		hostId(event.params);
		const form = await event.request.formData();
		const serviceId = formText(form, 'service_id');
		const checkId = formText(form, 'check_id');
		if (!isUuid(serviceId) || !isUuid(checkId)) {
			return fail(400, present(event, { message: 'That health check is not valid.' }));
		}
		try {
			const probe = parseProbe(
				await apiFetch(event, `/v1/services/${serviceId}/probe`, {
					method: 'POST',
					body: JSON.stringify({ check_id: checkId })
				})
			);
			if (!probe) return fail(502, present(event, { message: 'The API returned an unexpected response.' }));
			return present(event, { probe, serviceId, checkId });
		} catch (err) {
			return actionFailure(event, err);
		}
	}
};
