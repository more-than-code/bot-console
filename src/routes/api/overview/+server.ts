import { getOverview } from '$lib/server/metrics';
import { withMetrics } from '$lib/server/errors';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () =>
	withMetrics(async () => json(await getOverview(), { headers: { 'cache-control': 'no-store' } }));
