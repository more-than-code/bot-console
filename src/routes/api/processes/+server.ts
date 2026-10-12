import { parseProcessesQuery } from '$lib/process-query';
import { getProcesses } from '$lib/server/services';
import { withMetrics } from '$lib/server/errors';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) =>
	withMetrics(async () => {
		const parsed = parseProcessesQuery(url.searchParams);
		if (!parsed.ok) error(400, parsed.message);
		return json(await getProcesses(parsed.query), { headers: { 'cache-control': 'no-store' } });
	});
