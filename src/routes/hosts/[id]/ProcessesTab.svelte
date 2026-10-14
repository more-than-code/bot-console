<script lang="ts">
	import CommandText from '$lib/components/CommandText.svelte';
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
		<a class="text-primary underline-offset-4 hover:underline" href={href}>{text}</a>
	{:else}
		{text}
	{/if}
{/snippet}

<h2 id="processes-heading" class="mb-1 text-base font-medium">Processes</h2>
<p class="text-muted-foreground mb-3 text-sm">CPU % is irix mode: 100 means one core. RSS is resident memory.</p>
{#if message}
	<Notice kind="error">{message}</Notice>
{:else if !sample}
	<p class="text-muted-foreground text-sm">No process sample yet</p>
{:else}
	<p class="text-muted-foreground mb-2 text-sm">Sampled {formatWhen(sample.sampled_at)}.</p>
	{#if sample.skipped > 0}
		<p class="text-muted-foreground mb-2 text-sm">{sample.skipped} rows skipped</p>
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
					<td class="p-2 text-right font-mono align-middle">{row.pid}</td>
					<td class="p-2 align-middle">{row.process_name || 'n/a'}</td>
					<td class="p-2 align-middle">{@render serviceCell(row)}</td>
					<td class="p-2 align-middle">{row.user || 'n/a'}</td>
					<td class="max-w-64 p-2 align-middle"><CommandText value={row.cmdline || 'n/a'} /></td>
					<td class="p-2 text-right font-mono align-middle">{formatPercent(row.cpu_usage)}</td>
					<td class="p-2 text-right font-mono align-middle">{formatBytes(row.memory_rss)}</td>
					<td class="p-2 text-right font-mono align-middle">{formatPercent(row.memory_usage)}</td>
					<td class="p-2 text-right font-mono align-middle">{count(row.num_threads)}</td>
					<td class="p-2 align-middle">{formatWhen(row.started_at)}</td>
				</tr>
			{/snippet}
		</DataTable>
	{/if}
{/if}
