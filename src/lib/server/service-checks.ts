import type { HealthCheck, ServiceSummary } from '../api-types';
import { apiFetch, loadFailure } from './api';
import { isRecord, parseHealthChecks } from './shape';

const CHECK_LIMIT = 50;
const CHECK_CONCURRENCY = 6;

/**
 * Shared deadline for the detail fan-out.
 * A test sets `ms` to 0 so the signal is already aborted, then restores 10_000.
 */
export const checkDeadline = { ms: 10_000 };

type ApiEvent = Parameters<typeof apiFetch>[0];

async function loadChecks<T extends ServiceSummary>(
	event: ApiEvent,
	service: T,
	signal: AbortSignal
): Promise<T & { checks: HealthCheck[]; checksMessage: string | null }> {
	try {
		const payload = await apiFetch(event, `/v1/services/${service.id}`, { signal });
		const checks = isRecord(payload) ? parseHealthChecks(payload.health_checks) : null;
		if (!checks) return { ...service, checks: [], checksMessage: 'Health checks could not be read.' };
		return { ...service, checks, checksMessage: null };
	} catch (err) {
		return { ...service, checks: [], checksMessage: loadFailure(err).message };
	}
}

/** Detail reads stay inside one shared deadline. Rows past the cap say why. */
export async function withChecks<T extends ServiceSummary>(
	event: ApiEvent,
	services: T[]
): Promise<Array<T & { checks: HealthCheck[]; checksMessage: string | null }>> {
	const pending = services.slice(0, CHECK_LIMIT);
	const skipped = services.slice(CHECK_LIMIT).map((service) => ({
		...service,
		checks: [] as HealthCheck[],
		checksMessage: 'checks not loaded'
	}));
	const rows: Array<T & { checks: HealthCheck[]; checksMessage: string | null }> = new Array(pending.length);
	const deadline = fanoutSignal(checkDeadline.ms);
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

/** `ms <= 0` aborts before any detail request. A positive value is a real timer. */
function fanoutSignal(ms: number): AbortSignal {
	if (ms <= 0) {
		const controller = new AbortController();
		controller.abort();
		return controller.signal;
	}
	return AbortSignal.timeout(ms);
}
