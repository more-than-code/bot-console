import { servicesPageQuery, parseServicesQuery } from '$lib/services-query';
import { withMetrics } from '$lib/server/errors';
import { getServices } from '$lib/server/services';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) =>
	withMetrics(async () => {
		const parsed = parseServicesQuery(url.searchParams);
		if (!parsed.ok) error(400, parsed.message);
		return getServices(servicesPageQuery(parsed.query));
	});
