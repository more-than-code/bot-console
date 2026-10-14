<script lang="ts">
	import DataTable from '$lib/components/DataTable.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import type { ProcessSample } from '$lib/api-types';
	import { formatBytes, formatPercent, formatWhen } from '$lib/format';
	import { hasProcessSample, processColumns, processServiceText, type ProcessSort, type ServiceLink } from '$lib/host-view';

	let {
		sort,
		processes,
		message,
		serviceLinks
	}: {
		sort: ProcessSort;
		processes: ProcessSample | null;
		message: string | null;
		serviceLinks: Record<string, ServiceLink>;
	} = $props();

	const sample = $derived(hasProcessSample(processes) ? processes : null);
	const columns = $derived(processColumns(serviceLinks));

	function count(value: number | null): string {
		if (value == null || !Number.isFinite(value)) return 'n/a';
		return String(value);
	}
</script>

{#snippet serviceCell(row: ProcessSample['items'][number])}
	{@const text = processServiceText(row, serviceLinks)}
	{@const href = row.service_id ? (serviceLinks[row.service_id]?.href ?? null) : null}
	{#if href}
		<a href={href}>{text}</a>
	{:else}
		{text}
	{/if}
{/snippet}

<h2 id="processes-heading">Processes</h2>
<p class="sub">CPU % is irix mode: 100 means one core. RSS is resident memory.</p>
{#if message}
	<Notice kind="error">{message}</Notice>
{:else if !sample}
	<p class="empty">No process sample yet</p>
{:else}
	<p class="sub">Sampled {formatWhen(sample.sampled_at)}.</p>
	{#if sample.skipped > 0}
		<p class="sub">{sample.skipped} rows skipped</p>
	{/if}
	{#if sample.items.length > 0}
		<DataTable
			rows={sample.items}
			{columns}
			id="processes"
			labelledBy="processes-heading"
			empty="No matching processes."
			rowKey={(row) => `${row.pid}-${row.started_at ?? ''}`}
			defaultSort={sort}
			defaultDir="desc"
			searchLabel="Search pid, process, service, user, or command"
		>
			{#snippet row(row)}
				<tr>
					<td class="num">{row.pid}</td>
					<td>{row.process_name || 'n/a'}</td>
					<td>{@render serviceCell(row)}</td>
					<td>{row.user || 'n/a'}</td>
					<td class="wrap">{row.cmdline || 'n/a'}</td>
					<td class="num">{formatPercent(row.cpu_usage)}</td>
					<td class="num">{formatBytes(row.memory_rss)}</td>
					<td class="num">{formatPercent(row.memory_usage)}</td>
					<td class="num">{count(row.num_threads)}</td>
					<td>{formatWhen(row.started_at)}</td>
				</tr>
			{/snippet}
		</DataTable>
	{/if}
{/if}
