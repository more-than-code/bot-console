<script lang="ts">
	import { browser } from '$app/environment';
	import DataTable from '$lib/components/DataTable.svelte';
	import SearchField from '$lib/components/SearchField.svelte';
	import { formatLatency, formatPercent, formatProcessMemory, formatWhen } from '$lib/format';
	import { POLL_MS } from '$lib/limits';
	import { httpLabel, statusLabel, unitLabel } from '$lib/service-view';
	import { servicesApiSearch } from '$lib/services-query';
	import { withQuery, type QueryValues } from '$lib/table-href';
	import { PAGE_SIZE_DEFAULT, type SortDir } from '$lib/table-query';
	import { isServicesPayload, type ServiceHealth, type ServicesPayload } from '$lib/types';

	let { data } = $props();
	let polled = $state<ServicesPayload | null>(null);
	let updateError = $state('');

	function same(
		body: Pick<ServicesPayload, 'host' | 'sort' | 'service' | 'q' | 'order' | 'dir' | 'page' | 'pageSize'>,
		current: Pick<ServicesPayload, 'host' | 'sort' | 'service' | 'q' | 'order' | 'dir' | 'page' | 'pageSize'>
	): boolean {
		return (
			body.host === current.host &&
			body.sort === current.sort &&
			body.service === current.service &&
			body.q === current.q &&
			body.order === current.order &&
			body.dir === current.dir &&
			body.page === current.page &&
			body.pageSize === current.pageSize
		);
	}

	const view = $derived(polled && same(polled, data) ? polled : data);
	const pageNumber = $derived(view.page ?? 1);
	const pageSize = $derived(view.pageSize ?? PAGE_SIZE_DEFAULT);

	const columns = [
		{ key: 'name', label: 'Service' },
		{ key: 'status', label: 'Status' },
		{ key: 'host', label: 'Host' },
		{ key: 'port', label: 'Port', numeric: true },
		{ key: 'unit', label: 'Unit' },
		{ key: 'http', label: 'HTTP', numeric: true },
		{ key: 'lastCheck', label: 'Last check' },
		{ key: 'latency', label: 'Latency', numeric: true },
		{ key: 'cpu', label: 'CPU', numeric: true, defaultDir: 'desc' as const },
		{ key: 'memory', label: 'Memory', numeric: true, defaultDir: 'desc' as const }
	];

	function queryState(): QueryValues {
		return {
			host: view.host,
			service: view.service,
			q: view.q,
			order: view.order === 'host' ? null : view.order,
			dir: view.dir === 'asc' ? null : view.dir,
			page: pageNumber === 1 ? null : String(pageNumber),
			pageSize: pageSize === PAGE_SIZE_DEFAULT ? null : String(pageSize)
		};
	}

	function hostHref(host: string | null): string {
		return withQuery('/services', queryState(), { host, page: null });
	}

	function sortHref(key: string, next: SortDir): string {
		return withQuery('/services', queryState(), {
			order: key === 'host' ? null : key,
			dir: next === 'asc' ? null : next,
			page: null
		});
	}

	function pageHref(page: number): string {
		return withQuery('/services', queryState(), { page: page === 1 ? null : String(page) });
	}

	function searchHref(q: string | null): string {
		return withQuery('/services', queryState(), { q, page: null });
	}

	function processesHref(row: ServiceHealth): string {
		return withQuery('/processes', { host: row.host, service: row.name });
	}

	const hidden = $derived.by(() => {
		const fields: Array<{ name: string; value: string }> = [];
		if (view.host) fields.push({ name: 'host', value: view.host });
		if (view.service) fields.push({ name: 'service', value: view.service });
		if (view.order !== 'host') fields.push({ name: 'order', value: view.order });
		if (view.dir !== 'asc') fields.push({ name: 'dir', value: view.dir });
		if (pageSize !== PAGE_SIZE_DEFAULT) fields.push({ name: 'pageSize', value: String(pageSize) });
		return fields;
	});

	$effect(() => {
		if (!browser) return;
		const search = servicesApiSearch({
			host: data.host,
			sort: data.sort,
			service: data.service,
			q: data.q,
			order: data.order,
			dir: data.dir,
			page: data.page,
			pageSize: data.pageSize
		});
		const current = {
			host: data.host,
			sort: data.sort,
			service: data.service,
			q: data.q,
			order: data.order,
			dir: data.dir,
			page: data.page,
			pageSize: data.pageSize
		};
		let ignore = false;
		const id = setInterval(async () => {
			try {
				const response = await fetch(`/api/services${search}`);
				if (!response.ok) {
					if (!ignore) updateError = 'Latest refresh failed. Showing the last good data.';
					return;
				}
				const body: unknown = await response.json();
				if (!isServicesPayload(body) || !same(body, current)) {
					if (!ignore) updateError = 'Latest refresh failed. Showing the last good data.';
					return;
				}
				if (!ignore) {
					polled = body;
					updateError = '';
				}
			} catch {
				if (!ignore) updateError = 'Latest refresh failed. Showing the last good data.';
			}
		}, POLL_MS);
		return () => {
			ignore = true;
			clearInterval(id);
		};
	});
</script>

<svelte:head>
	<title>Services · deploybot</title>
</svelte:head>

<h1>Services</h1>
<p class="sub">
	Updated {formatWhen(view.generatedAt)}. Latest sample {formatWhen(view.sampledAt)}. Refreshes every 15
	seconds. Times are Pacific/Auckland.
</p>
<p class="sub">
	One row per declared service. CPU and memory are the sum of that service's processes. Per-host processes
	are on the Processes page.
</p>
<noscript><p class="sub">Live refresh is off without JavaScript. Reload the page for new samples.</p></noscript>
{#if updateError}
	<p class="error" role="status">{updateError}</p>
{/if}

<div class="filters">
	<nav class="ranges" aria-label="Host">
		<a href={hostHref(null)} aria-current={view.host == null ? 'page' : undefined}>All hosts</a>
		{#each view.hosts as name (name)}
			<a href={hostHref(name)} aria-current={view.host === name ? 'page' : undefined}>{name}</a>
		{/each}
	</nav>
	<SearchField q={view.q} label="Search services" action="/services" {hidden} hrefFor={searchHref} />
</div>
{#if view.service}
	<p class="sub">
		Process rows for {view.service} are on the Processes page.
		<a href={withQuery('/processes', { service: view.service, host: view.host })}>Show processes</a>
	</p>
{/if}

<section class="block">
	<h2 id="health-heading">Service health</h2>
	{#if !view.servicesAvailable}
		<p class="empty">No service registry yet.</p>
	{:else if view.servicesTotal === 0}
		<p class="empty">
			{view.q ? 'No services match.' : view.host ? 'No declared services on this host.' : 'No declared services.'}
		</p>
	{:else}
		<DataTable
			{columns}
			sort={view.order}
			dir={view.dir}
			page={pageNumber}
			{pageSize}
			total={view.servicesTotal}
			labelledBy="health-heading"
			{sortHref}
			{pageHref}
		>
			{#snippet body()}
				{#each view.services as row (`${row.host}\0${row.name}`)}
					<tr>
						<td><a href={processesHref(row)}>{row.name}</a></td>
						<td>
							<span class="status" class:online={row.status === 'up'} class:stale={row.status === 'down'}>
								{statusLabel(row.status)}
							</span>
						</td>
						<td><a href={hostHref(row.host)}>{row.host}</a></td>
						<td class="num">{row.port == null ? 'n/a' : row.port}</td>
						<td>{unitLabel(row)}</td>
						<td class="num">{httpLabel(row)}</td>
						<td>{formatWhen(row.lastCheck)}</td>
						<td class="num">{formatLatency(row.latencyMs)}</td>
						<td class="num">{formatPercent(row.cpuPercent)}</td>
						<td class="num">{formatProcessMemory(row.memoryRssBytes, row.memoryPercent)}</td>
					</tr>
				{:else}
					<tr>
						<td colspan={columns.length}>No services on this page.</td>
					</tr>
				{/each}
			{/snippet}
		</DataTable>
	{/if}
</section>
