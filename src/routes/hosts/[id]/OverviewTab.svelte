<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import CommandText from '$lib/components/CommandText.svelte';
	import DataTable from '$lib/components/DataTable.svelte';
	import LineChart from '$lib/components/LineChart.svelte';
	import LocalTime from '$lib/components/LocalTime.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import type { Host, SnapshotView } from '$lib/api-types';
	import { formatBytes, formatCapacity, formatLoad, formatPercent, formatRate, formatTemp, formatUptime } from '$lib/format';
	import { alignSeries, METRIC_SPECS, type MetricChart, type MetricFormat } from '$lib/host-view';
	import type { Column } from '$lib/table';
	import { actionUrlFrom } from '$lib/url';
	import { RANGES, type RangeKey } from '$lib/ranges';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';

	let {
		host,
		range,
		metrics,
		snapshot
	}: {
		host: Host;
		range: RangeKey;
		metrics: MetricChart[];
		snapshot: SnapshotView | null;
	} = $props();

	const formatters: Record<MetricFormat, (value: number) => string> = {
		percent: (value) => formatPercent(value),
		rate: (value) => formatRate(value),
		load: (value) => formatLoad(value),
		temp: (value) => formatTemp(value)
	};

	const charts = $derived(
		METRIC_SPECS.map((spec) => {
			const chart = metrics.find((item) => item.m === spec.m) ?? null;
			const aligned = alignSeries(chart?.series ?? []);
			const drawn = spec.series.map((series) => {
				const index = chart?.series.findIndex((item) => item.name === series.name) ?? -1;
				return {
					label: series.label,
					color: series.color,
					values: index >= 0 ? (aligned.columns[index] ?? []) : aligned.times.map(() => null)
				};
			});
			return { spec, chart, times: aligned.times, drawn };
		})
	);

	const rangeKeys = Object.keys(RANGES) as RangeKey[];
	type Disk = SnapshotView['disks'][number];
	type Top = SnapshotView['top'][number];
	const diskColumns: Column<Disk>[] = [
		{ key: 'path', label: 'Disk' },
		{ key: 'used', label: 'Used' }
	];
	const topColumns: Column<Top>[] = [
		{ key: 'pid', label: 'PID' },
		{ key: 'process', label: 'Process' },
		{ key: 'user', label: 'User' },
		{ key: 'cpu', label: 'CPU' },
		{ key: 'rss', label: 'RSS' }
	];

	function rawNumber(value: number | null): string {
		if (value == null || !Number.isFinite(value)) return 'n/a';
		return String(value);
	}
</script>

<dl class="mb-4 grid gap-3 sm:grid-cols-2">
	<div><dt class="text-muted-foreground text-sm">Status</dt><dd><StatusBadge status={host.status} /></dd></div>
	<div><dt class="text-muted-foreground text-sm">Last seen</dt><dd><LocalTime iso={host.last_seen_at} /></dd></div>
	<div><dt class="text-muted-foreground text-sm">Agent</dt><dd class="font-mono">{host.agent_version ?? 'n/a'}</dd></div>
	<div><dt class="text-muted-foreground text-sm">System</dt><dd>{host.os}/{host.arch}</dd></div>
	<div><dt class="text-muted-foreground text-sm">Always on</dt><dd>{host.always_on ? 'yes' : 'no'}</dd></div>
</dl>

<nav class="mb-3 flex flex-wrap gap-2" aria-label="Time range">
	{#each rangeKeys as key (key)}
		<Button
			href="?tab=overview&range={key}"
			variant={range === key ? 'default' : 'outline'}
			size="sm"
			aria-current={range === key ? 'page' : undefined}>{RANGES[key].label}</Button>
	{/each}
</nav>

<form method="POST" action={actionUrlFrom(page.url, 'snapshot')} class="mb-4" use:enhance>
	<Button type="submit">Snapshot</Button>
</form>

{#if snapshot}
	<Card.Root class="mb-4">
		<Card.Header>
			<Card.Title>Snapshot</Card.Title>
			<Card.Description>Sampled <LocalTime iso={snapshot.sampled_at} />.</Card.Description>
		</Card.Header>
		<Card.Content class="grid min-w-0 gap-3">
			<dl class="grid gap-2 sm:grid-cols-2">
				<div><dt class="text-muted-foreground text-sm">CPU</dt><dd>{formatPercent(snapshot.cpu_percent)}</dd></div>
				<div>
					<dt class="text-muted-foreground text-sm">Memory</dt>
					<dd>
						{snapshot.mem
							? formatCapacity(snapshot.mem.used, snapshot.mem.total, snapshot.mem.used_percent)
							: 'n/a'}
					</dd>
				</div>
				<div>
					<dt class="text-muted-foreground text-sm">Load</dt>
					<dd>
						{snapshot.load
							? `${formatLoad(snapshot.load[0])} ${formatLoad(snapshot.load[1])} ${formatLoad(snapshot.load[2])}`
							: 'n/a'}
					</dd>
				</div>
				<div><dt class="text-muted-foreground text-sm">Temp</dt><dd>{formatTemp(snapshot.temp_celsius)}</dd></div>
				<div><dt class="text-muted-foreground text-sm">Uptime</dt><dd>{formatUptime(snapshot.uptime_sec)}</dd></div>
			</dl>
			{#if snapshot.disks.length > 0}
				<span id="snapshot-disks" class="sr-only">Disks</span>
				<DataTable
					rows={snapshot.disks}
					columns={diskColumns}
					id="snapshot-disks"
					labelledBy="snapshot-disks"
					empty="No disks."
					rowKey={(disk) => disk.path}
				>
					{#snippet row(disk)}
						<tr>
							<td class="p-2 align-middle font-mono">{disk.path}</td>
							<td class="p-2 align-middle">{formatCapacity(disk.used, disk.total, disk.used_percent)}</td>
						</tr>
					{/snippet}
				</DataTable>
			{/if}
			{#if snapshot.top.length > 0}
				<span id="snapshot-top" class="sr-only">Top processes</span>
				<DataTable
					rows={snapshot.top}
					columns={topColumns}
					id="snapshot-top"
					labelledBy="snapshot-top"
					empty="No processes."
					rowKey={(row) => row.pid}
				>
					{#snippet row(row)}
						<tr>
							<td class="p-2 align-middle font-mono">{row.pid}</td>
							<td class="max-w-64 p-2 align-middle"><CommandText value={row.cmdline || row.process_name || 'n/a'} /></td>
							<td class="p-2 align-middle">{row.user || 'n/a'}</td>
							<td class="p-2 text-right font-mono align-middle">{rawNumber(row.cpu_usage)}</td>
							<td class="p-2 text-right font-mono align-middle">{formatBytes(row.memory_rss)}</td>
						</tr>
					{/snippet}
				</DataTable>
			{/if}
		</Card.Content>
	</Card.Root>
{/if}

<p class="text-muted-foreground mb-3 text-sm">Charts refresh every 30 seconds while this tab is visible.</p>

<div class="grid min-w-0 gap-4 md:grid-cols-2">
	{#each charts as item (item.spec.m)}
		{#if item.chart?.message}
			<figure class="bg-card min-w-0 rounded-xl p-3 ring-1 ring-foreground/10">
				<h2 class="mb-2 text-base font-medium">{item.spec.title}</h2>
				<Notice kind="error">{item.chart.message}</Notice>
			</figure>
		{:else}
			<LineChart
				title={item.spec.title}
				times={item.times}
				series={item.drawn}
				format={formatters[item.spec.format]}
				yMin={item.spec.yMin}
				yMax={item.spec.yMax}
				bucketMs={item.chart?.step ? item.chart.step * 1000 : 0}
			/>
		{/if}
	{/each}
</div>
