import { isHostName } from './host.ts';
import {
	member,
	PAGE_SIZE_DEFAULT,
	parseDir,
	parseOptionalPage,
	parseSearch,
	SERVICE_SORTS,
	type ServiceSort,
	type SortDir
} from './table-query.ts';

export type ServicesQuery = {
	host: string | null;
	/** Legacy process-list sort on this payload. Not the service table column. */
	sort: 'cpu' | 'memory';
	service: string | null;
	q: string | null;
	order: ServiceSort;
	dir: SortDir;
	/** Null means the full service list (existing clients). */
	page: number | null;
	pageSize: number | null;
};

const SERVICE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function parseServicesQuery(
	params: URLSearchParams
): { ok: true; query: ServicesQuery } | { ok: false; message: string } {
	const hostRaw = params.get('host');
	let host: string | null = null;
	if (hostRaw && hostRaw !== 'all') {
		if (!isHostName(hostRaw)) return { ok: false, message: 'Invalid host' };
		host = hostRaw;
	}

	const sortRaw = params.get('sort');
	let sort: ServicesQuery['sort'] = 'cpu';
	if (sortRaw && sortRaw !== 'cpu') {
		if (sortRaw !== 'memory') return { ok: false, message: 'Sort must be cpu or memory' };
		sort = 'memory';
	}

	const serviceRaw = params.get('service');
	let service: string | null = null;
	if (serviceRaw) {
		if (!SERVICE_NAME.test(serviceRaw)) return { ok: false, message: 'Invalid service' };
		service = serviceRaw;
	}

	const q = parseSearch(params.get('q'));
	if (!q.ok) return q;
	const order = member(params.get('order'), SERVICE_SORTS, 'host', 'Order');
	if (!order.ok) return order;
	const dir = parseDir(params.get('dir'), 'asc');
	if (!dir.ok) return dir;
	const page = parseOptionalPage(params);
	if (!page.ok) return page;

	return {
		ok: true,
		query: {
			host,
			sort,
			service,
			q: q.q,
			order: order.value,
			dir: dir.dir,
			page: page.page,
			pageSize: page.pageSize
		}
	};
}

/** The HTML page always asks for one page. The JSON API stays unpaged until `page` is set. */
export function servicesPageQuery(query: ServicesQuery): ServicesQuery {
	if (query.page != null && query.pageSize != null) return query;
	return {
		...query,
		page: query.page ?? 1,
		pageSize: query.pageSize ?? PAGE_SIZE_DEFAULT
	};
}

/** Poll URL. Includes page when the UI query is paged so the API does not return the full list. */
export function servicesApiSearch(query: ServicesQuery): string {
	const params = new URLSearchParams();
	if (query.host) params.set('host', query.host);
	if (query.sort !== 'cpu') params.set('sort', query.sort);
	if (query.service) params.set('service', query.service);
	if (query.q) params.set('q', query.q);
	if (query.order !== 'host') params.set('order', query.order);
	if (query.dir !== 'asc') params.set('dir', query.dir);
	if (query.page != null) params.set('page', String(query.page));
	if (query.pageSize != null) params.set('pageSize', String(query.pageSize));
	const qs = params.toString();
	return qs ? `?${qs}` : '';
}
