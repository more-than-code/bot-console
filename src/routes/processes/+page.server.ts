import { parseProcessesQuery } from '$lib/process-query';
import { withMetrics } from '$lib/server/errors';
import { getProcesses } from '$lib/server/services';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) =>
	withMetrics(async () => {
		const parsed = parseProcessesQuery(url.searchParams);
		if (!parsed.ok) error(400, parsed.message);
		return getProcesses(parsed.query);
	});
