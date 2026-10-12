import { parseServicesQuery } from '$lib/services-query';
import { getServices } from '$lib/server/services';
import { withMetrics } from '$lib/server/errors';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) =>
	withMetrics(async () => {
		const parsed = parseServicesQuery(url.searchParams);
		if (!parsed.ok) error(400, parsed.message);
		return json(await getServices(parsed.query), { headers: { 'cache-control': 'no-store' } });
	});
