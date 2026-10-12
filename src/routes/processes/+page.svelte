<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import DataTable from '$lib/components/DataTable.svelte';
	import SearchField from '$lib/components/SearchField.svelte';
	import { formatPercent, formatProcessMemory, formatUptime, formatWhen } from '$lib/format';
	import { POLL_MS } from '$lib/limits';
	import { withQuery, type QueryValues } from '$lib/table-href';
	import { PAGE_SIZE_DEFAULT, type SortDir } from '$lib/table-query';
	import { isProcessesPayload, type ProcessSample, type ProcessesPayload } from '$lib/types';

	let { data } = $props();
	let polled = $state<ProcessesPayload | null>(null);
	let updateError = $state('');

	function same(
		body: Pick<ProcessesPayload, 'host' | 'service' | 'q' | 'sort' | 'dir' | 'page' | 'pageSize'>,
		current: Pick<ProcessesPayload, 'host' | 'service' | 'q' | 'sort' | 'dir' | 'page' | 'pageSize'>
	): boolean {
		return (
			body.host === current.host &&
			body.service === current.service &&
			body.q === current.q &&
			body.sort === current.sort &&
			body.dir === current.dir &&
			body.page === current.page &&
			body.pageSize === current.pageSize
		);
	}

	const view = $derived(polled && same(polled, data) ? polled : data);

	const columns = [
		{ key: 'host', label: 'Host' },
		{ key: 'process', label: 'Process' },
		{ key: 'pid', label: 'PID', numeric: true },
		{ key: 'user', label: 'User' },
		{ key: 'threads', label: 'Threads', numeric: true, defaultDir: 'desc' as const },
		{ key: 'cpu', label: 'CPU', numeric: true, defaultDir: 'desc' as const },
		{ key: 'memory', label: 'Memory', numeric: true, defaultDir: 'desc' as const },
		{ key: 'uptime', label: 'Uptime', numeric: true, defaultDir: 'desc' as const },
		{ key: 'sampledAt', label: 'Sample', defaultDir: 'desc' as const }
	];

	function queryState(): QueryValues {
		return {
			host: view.host,
			service: view.service,
			q: view.q,
			sort: view.sort === 'cpu' ? null : view.sort,
			dir: view.sort === 'cpu' && view.dir === 'desc' ? null : view.dir,
			page: view.page === 1 ? null : String(view.page),
			pageSize: view.pageSize === PAGE_SIZE_DEFAULT ? null : String(view.pageSize)
		};
	}

	function hostHref(host: string | null): string {
		return withQuery('/processes', queryState(), { host, page: null });
	}

	function sortHref(key: string, next: SortDir): string {
		return withQuery('/processes', queryState(), {
			sort: key === 'cpu' ? null : key,
			dir: key === 'cpu' && next === 'desc' ? null : next,
			page: null
		});
	}

	function pageHref(page: number): string {
		return withQuery('/processes', queryState(), { page: page === 1 ? null : String(page) });
	}

	function searchHref(q: string | null): string {
		return withQuery('/processes', queryState(), { q, page: null });
	}

	function threadsText(row: ProcessSample): string {
		return row.threads == null ? 'n/a' : String(row.threads);
	}

	const hidden = $derived.by(() => {
		const fields: Array<{ name: string; value: string }> = [];
		if (view.host) fields.push({ name: 'host', value: view.host });
		if (view.service) fields.push({ name: 'service', value: view.service });
		if (view.sort !== 'cpu') fields.push({ name: 'sort', value: view.sort });
		if (!(view.sort === 'cpu' && view.dir === 'desc')) fields.push({ name: 'dir', value: view.dir });
		if (view.pageSize !== PAGE_SIZE_DEFAULT) fields.push({ name: 'pageSize', value: String(view.pageSize) });
		return fields;
	});

	$effect(() => {
		if (!browser) return;
		const search = page.url.search;
		const current = {
			host: data.host,
			service: data.service,
			q: data.q,
			sort: data.sort,
			dir: data.dir,
			page: data.page,
			pageSize: data.pageSize
		};
		let ignore = false;
		const id = setInterval(async () => {
			try {
				const response = await fetch(`/api/processes${search}`);
				if (!response.ok) {
					if (!ignore) updateError = 'Latest refresh failed. Showing the last good data.';
					return;
				}
				const body: unknown = await response.json();
				if (!isProcessesPayload(body) || !same(body, current)) {
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
	<title>Processes · deploybot</title>
</svelte:head>

<h1>Processes</h1>
<p class="sub">
	Updated {formatWhen(view.generatedAt)}. Latest sample {formatWhen(view.sampledAt)}. Refreshes every 15
	seconds. Times are Pacific/Auckland.
</p>
<p class="sub">
	CPU is per core, as in top, so one process can pass 100%. Memory percent is that process's share of host
	RAM. Rows are the newest sample per process in the latest window. The process column is a shortened
	command line when one was stored. Node reports every process as MainThread.
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
	<SearchField q={view.q} label="Search processes" action="/processes" {hidden} hrefFor={searchHref} />
</div>
{#if view.service}
	<p class="sub">
		Showing processes linked to {view.service}.
		<a href={withQuery('/processes', queryState(), { service: null, page: null })}>Show all</a>
	</p>
{/if}

<section class="block">
	<h2 id="procs-heading">Processes</h2>
	{#if !view.processesAvailable}
		<p class="empty">Process samples are not available yet.</p>
	{:else if view.total === 0}
		<p class="empty">
			{view.q || view.service ? 'No processes match.' : 'No process samples in the latest window.'}
		</p>
	{:else}
		<DataTable
			{columns}
			sort={view.sort}
			dir={view.dir}
			page={view.page}
			pageSize={view.pageSize}
			total={view.total}
			labelledBy="procs-heading"
			{sortHref}
			{pageHref}
		>
			{#snippet body()}
				{#each view.processes as row (`${row.host}\0${row.pid}`)}
					<tr>
						<td><a href={hostHref(row.host)}>{row.host}</a></td>
						<td title={row.cmdline && row.cmdline !== row.processName ? row.processName : undefined}>
							{row.cmdline ?? row.processName}
						</td>
						<td class="num">{row.pid}</td>
						<td>{row.user ?? 'n/a'}</td>
						<td class="num">{threadsText(row)}</td>
						<td class="num">{formatPercent(row.cpuPercent)}</td>
						<td class="num">{formatProcessMemory(row.memoryRssBytes, row.memoryPercent)}</td>
						<td class="num">{formatUptime(row.uptimeSeconds)}</td>
						<td>{formatWhen(row.sampledAt)}</td>
					</tr>
				{:else}
					<tr>
						<td colspan={columns.length}>No processes on this page.</td>
					</tr>
				{/each}
			{/snippet}
		</DataTable>
	{/if}
</section>
