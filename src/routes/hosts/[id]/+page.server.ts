import { error, fail } from '@sveltejs/kit';
import type { ServiceRow, ServiceSummary } from '$lib/api-types';
import { ApiError, actionFailure, apiFetch, loadFailure } from '$lib/server/api';
import { formText } from '$lib/server/form';
import { requireUser } from '$lib/server/guard';
import { present } from '$lib/server/redact';
import { isRecord, parseHealthChecks, parseHost, parseListPayload, parseProbe, parseService, parseSnapshot } from '$lib/server/shape';
import { isUuid } from '$lib/server/validate';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

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

export const load: PageServerLoad = async (event) => {
	requireUser(event);
	const id = hostId(event.params);
	try {
		const host = parseHost(await apiFetch(event, `/v1/hosts/${id}`));
		if (!host) return present(event, { host: null, services: [], omitted: 0, message: 'The API returned an unexpected response.' });
		// This list is not paginated (at most 500). Do not send limit or cursor.
		const parsed = parseListPayload(await apiFetch(event, `/v1/hosts/${id}/services`));
		if (!parsed) throw new ApiError(502, 'error', 'The API returned an unexpected response.');
		const raw = parsed.raw.length > 500 ? parsed.raw.slice(0, 500) : parsed.raw;
		let omitted = parsed.raw.length - raw.length;
		const summaries: ServiceSummary[] = [];
		for (const item of raw) {
			const service = parseService(item);
			if (service) summaries.push(service);
			else omitted += 1;
		}
		const services = await withChecks(event, summaries);
		return present(event, { host, services, omitted, message: null });
	} catch (err) {
		const failure = loadFailure(err);
		return present(event, { host: null, services: [], omitted: 0, message: failure.message });
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
