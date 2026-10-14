<script lang="ts">
	import { enhance } from '$app/forms';
	import LineChart from '$lib/components/LineChart.svelte';
	import StatusText from '$lib/components/StatusText.svelte';
	import type { Host, SnapshotView } from '$lib/api-types';
	import { formatBytes, formatCapacity, formatLoad, formatPercent, formatRate, formatTemp, formatUptime, formatWhen } from '$lib/format';
	import { alignSeries, hostFormAction, METRIC_SPECS, type MetricChart, type MetricFormat } from '$lib/host-view';
	import { RANGES, type RangeKey } from '$lib/ranges';

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

	function rawNumber(value: number | null): string {
		if (value == null || !Number.isFinite(value)) return 'n/a';
		return String(value);
	}
</script>

<dl class="facts">
	<div><dt>Status</dt><dd><StatusText status={host.status} /></dd></div>
	<div><dt>Last seen</dt><dd>{formatWhen(host.last_seen_at)}</dd></div>
	<div><dt>Agent</dt><dd>{host.agent_version ?? 'n/a'}</dd></div>
	<div><dt>System</dt><dd>{host.os}/{host.arch}</dd></div>
	<div><dt>Always on</dt><dd>{host.always_on ? 'yes' : 'no'}</dd></div>
</dl>

<nav class="ranges" aria-label="Time range">
	{#each rangeKeys as key (key)}
		<a href="?tab=overview&range={key}" aria-current={range === key ? 'page' : undefined}>{RANGES[key].label}</a>
	{/each}
</nav>

<form method="POST" action={hostFormAction('snapshot', { tab: 'overview', range })} use:enhance>
	<button type="submit">Snapshot</button>
</form>

{#if snapshot}
	<div class="panel">
		<h2>Snapshot</h2>
		<p class="sub">Sampled {formatWhen(snapshot.sampled_at)}.</p>
		<dl>
			<div><dt>CPU</dt><dd>{formatPercent(snapshot.cpu_percent)}</dd></div>
			<div>
				<dt>Memory</dt>
				<dd>
					{snapshot.mem
						? formatCapacity(snapshot.mem.used, snapshot.mem.total, snapshot.mem.used_percent)
						: 'n/a'}
				</dd>
			</div>
			<div>
				<dt>Load</dt>
				<dd>
					{snapshot.load
						? `${formatLoad(snapshot.load[0])} ${formatLoad(snapshot.load[1])} ${formatLoad(snapshot.load[2])}`
						: 'n/a'}
				</dd>
			</div>
			<div><dt>Temp</dt><dd>{formatTemp(snapshot.temp_celsius)}</dd></div>
			<div><dt>Uptime</dt><dd>{formatUptime(snapshot.uptime_sec)}</dd></div>
		</dl>
		{#if snapshot.disks.length > 0}
			<div class="table-wrap">
				<table class="data">
					<thead>
						<tr><th>Disk</th><th>Used</th></tr>
					</thead>
					<tbody>
						{#each snapshot.disks as disk (disk.path)}
							<tr>
								<td>{disk.path}</td>
								<td>{formatCapacity(disk.used, disk.total, disk.used_percent)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
		{#if snapshot.top.length > 0}
			<div class="table-wrap">
				<table class="data">
					<thead>
						<tr>
							<th>PID</th>
							<th>Process</th>
							<th>User</th>
							<th>CPU</th>
							<th>RSS</th>
						</tr>
					</thead>
					<tbody>
						{#each snapshot.top as row (row.pid)}
							<tr>
								<td>{row.pid}</td>
								<td class="wrap">{row.cmdline || row.process_name || 'n/a'}</td>
								<td>{row.user || 'n/a'}</td>
								<td>{rawNumber(row.cpu_usage)}</td>
								<td>{formatBytes(row.memory_rss)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
{/if}

<p class="sub">Charts refresh every 30 seconds while this tab is visible.</p>

<div class="charts">
	{#each charts as item (item.spec.m)}
		{#if item.chart?.message}
			<figure class="chart">
				<h2>{item.spec.title}</h2>
				<p class="error" role="status">{item.chart.message}</p>
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
