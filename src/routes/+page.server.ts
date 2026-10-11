import { withMetrics } from '$lib/server/errors';
import { getOverview } from '$lib/server/metrics';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => withMetrics(async () => ({ overview: await getOverview() }));
