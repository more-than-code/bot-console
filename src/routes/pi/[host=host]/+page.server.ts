import { parseRange } from '$lib/ranges';
import { withMetrics } from '$lib/server/errors';
import { getHostSeries } from '$lib/server/metrics';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, url }) =>
	withMetrics(async () => {
		const requested = url.searchParams.get('range');
		if (requested && !parseRange(requested)) error(400, 'Range must be 1h, 1d, or 1w');
		const range = parseRange(requested) ?? '1h';
		const detail = await getHostSeries(params.host, range);
		if (!detail) error(404, 'Unknown host');
		return detail;
	});
