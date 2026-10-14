<script lang="ts">
	import { page } from '$app/state';
	import DataTable from '$lib/components/DataTable.svelte';
	import SearchField from '$lib/components/SearchField.svelte';
	import type { ProcessSample } from '$lib/api-types';
	import { formatBytes, formatPercent, formatWhen } from '$lib/format';
	import { filterProcesses, hasProcessSample, serviceTabHref, type ProcessSort } from '$lib/host-view';
	import { parseSearch } from '$lib/table-query';
	import { withQuery } from '$lib/table-href';

	let {
		hostId,
		range,
		sort,
		processes,
		message
	}: {
		hostId: string;
		range: string;
		sort: ProcessSort;
		processes: ProcessSample | null;
		message: string | null;
	} = $props();

	const parsedQuery = $derived(parseSearch(page.url.searchParams.get('q')));
	const q = $derived(parsedQuery.ok ? parsedQuery.q : null);
	const searchMessage = $derived(parsedQuery.ok ? null : parsedQuery.message);
	const sample = $derived(hasProcessSample(processes) ? processes : null);
	const rows = $derived(sample ? filterProcesses(sample.items, q) : []);

	function hrefFor(next: string | null): string {
		return withQuery(`/hosts/${hostId}`, { tab: 'processes', sort, range, q: next });
	}

	const columns = $derived([
		{ key: 'pid', label: 'PID', numeric: true },
		{ key: 'process', label: 'Process' },
		{ key: 'user', label: 'User' },
		{ key: 'command', label: 'Command' },
		{ key: 'cpu', label: 'CPU %', numeric: true, href: withQuery(`/hosts/${hostId}`, { tab: 'processes', sort: 'cpu', range, q }) },
		{ key: 'rss', label: 'RSS', numeric: true },
		{ key: 'memory', label: 'Mem %', numeric: true, href: withQuery(`/hosts/${hostId}`, { tab: 'processes', sort: 'memory', range, q }) },
		{ key: 'threads', label: 'Threads', numeric: true },
		{ key: 'started', label: 'Started' }
	]);

	function count(value: number | null): string {
		if (value == null || !Number.isFinite(value)) return 'n/a';
		return String(value);
	}
</script>

<h2 id="processes-heading">Processes</h2>
<p class="sub">CPU % is irix mode: 100 means one core. RSS is resident memory.</p>
{#if message}
	<p class="error" role="alert">{message}</p>
{:else if !sample}
	<p class="empty">No process sample yet</p>
{:else}
	<p class="sub">Sampled {formatWhen(sample.sampled_at)}.</p>
	{#if sample.skipped > 0}
		<p class="sub">{sample.skipped} rows skipped</p>
	{/if}
	{#if searchMessage}
		<p class="error" role="alert">{searchMessage}</p>
	{/if}
	<SearchField
		{q}
		label="Search pid, process, user, or command"
		action="/hosts/{hostId}"
		hidden={[
			{ name: 'tab', value: 'processes' },
			{ name: 'sort', value: sort },
			{ name: 'range', value: range }
		]}
		{hrefFor}
	/>
	{#if rows.length === 0 && sample.items.length > 0}
		<p class="empty">No matching processes.</p>
	{:else if rows.length > 0}
		<DataTable {columns} {sort} labelledBy="processes-heading">
			{#each rows as row (`${row.pid}-${row.started_at ?? ''}`)}
				<tr>
					<td class="num">{row.pid}</td>
					<td>
						{#if row.service_id}
							<a href={serviceTabHref(row.service_id)}>{row.process_name || 'n/a'}</a>
						{:else}
							{row.process_name || 'n/a'}
						{/if}
					</td>
					<td>{row.user || 'n/a'}</td>
					<td class="wrap">{row.cmdline || 'n/a'}</td>
					<td class="num">{formatPercent(row.cpu_usage)}</td>
					<td class="num">{formatBytes(row.memory_rss)}</td>
					<td class="num">{formatPercent(row.memory_usage)}</td>
					<td class="num">{count(row.num_threads)}</td>
					<td>{formatWhen(row.started_at)}</td>
				</tr>
			{/each}
		</DataTable>
	{/if}
{/if}
