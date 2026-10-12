import { isHostName } from './host.ts';
import {
	member,
	PAGE_SIZE_DEFAULT,
	parseDir,
	parseRequiredPage,
	parseSearch,
	PROCESS_SORTS,
	type ProcessSort,
	type SortDir
} from './table-query.ts';

export type ProcessesQuery = {
	host: string | null;
	service: string | null;
	q: string | null;
	sort: ProcessSort;
	dir: SortDir;
	page: number;
	pageSize: number;
};

const SERVICE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function parseProcessesQuery(
	params: URLSearchParams
): { ok: true; query: ProcessesQuery } | { ok: false; message: string } {
	const hostRaw = params.get('host');
	let host: string | null = null;
	if (hostRaw && hostRaw !== 'all') {
		if (!isHostName(hostRaw)) return { ok: false, message: 'Invalid host' };
		host = hostRaw;
	}

	const serviceRaw = params.get('service');
	let service: string | null = null;
	if (serviceRaw) {
		if (!SERVICE_NAME.test(serviceRaw)) return { ok: false, message: 'Invalid service' };
		service = serviceRaw;
	}

	const q = parseSearch(params.get('q'));
	if (!q.ok) return q;
	const sort = member(params.get('sort'), PROCESS_SORTS, 'cpu', 'Sort');
	if (!sort.ok) return sort;
	// Omitted direction follows the default CPU sort (highest first), including when another column is named.
	const dir = parseDir(params.get('dir'), 'desc');
	if (!dir.ok) return dir;
	const page = parseRequiredPage(params);
	if (!page.ok) return page;

	return {
		ok: true,
		query: {
			host,
			service,
			q: q.q,
			sort: sort.value,
			dir: dir.dir,
			page: page.page,
			pageSize: page.pageSize
		}
	};
}

export function processesApiSearch(query: ProcessesQuery): string {
	const params = new URLSearchParams();
	if (query.host) params.set('host', query.host);
	if (query.service) params.set('service', query.service);
	if (query.q) params.set('q', query.q);
	if (query.sort !== 'cpu') params.set('sort', query.sort);
	if (!(query.sort === 'cpu' && query.dir === 'desc')) params.set('dir', query.dir);
	if (query.page !== 1) params.set('page', String(query.page));
	if (query.pageSize !== PAGE_SIZE_DEFAULT) params.set('pageSize', String(query.pageSize));
	const qs = params.toString();
	return qs ? `?${qs}` : '';
}
