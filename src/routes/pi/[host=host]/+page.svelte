<script lang="ts">
	import { browser } from '$app/environment';
	import LineChart from '$lib/components/LineChart.svelte';
	import {
		formatCapacity,
		formatLoad,
		formatPercent,
		formatRate,
		formatTemp,
		formatUptime,
		formatWhen
	} from '$lib/format';
	import { POLL_MS } from '$lib/limits';
	import { RANGES, type RangeKey } from '$lib/ranges';
	import { isHostDetail, type HostDetail } from '$lib/types';

	let { data } = $props();
	let polled = $state<HostDetail | null>(null);
	let updateError = $state('');

	const detail = $derived(
		polled && polled.range === data.range && polled.host.name === data.host.name ? polled : data
	);
	const times = $derived(detail.points.map((point) => point.t));
	const bucketMs = $derived(RANGES[detail.range].bucketMs);
	const memoryCapacity = $derived(
		formatCapacity(detail.host.memoryUsedBytes, detail.host.memoryTotalBytes, detail.host.memoryPercent)
	);
	const diskCapacity = $derived(
		formatCapacity(detail.host.diskUsedBytes, detail.host.diskTotalBytes, detail.host.diskPercent)
	);
	const rangeKeys = Object.keys(RANGES) as RangeKey[];

	function column(pick: (point: (typeof detail.points)[number]) => number | null): Array<number | null> {
		return detail.points.map((point) => pick(point));
	}

	$effect(() => {
		if (!browser) return;
		const name = data.host.name;
		const range = data.range;
		let ignore = false;
		const id = setInterval(async () => {
			try {
				const response = await fetch(`/api/pi/${encodeURIComponent(name)}?range=${range}`);
				if (!response.ok) {
					if (!ignore) updateError = 'Latest refresh failed. Showing the last good data.';
					return;
				}
				const body: unknown = await response.json();
				if (!isHostDetail(body) || body.range !== range || body.host.name !== name) {
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
	<title>{detail.host.name} · deploybot</title>
</svelte:head>

<p><a class="back" href="/">Cluster</a></p>
<div class="pi-head">
	<div>
		<h1>{detail.host.name}</h1>
		<p class="meta">
			{#if detail.host.role}{detail.host.role} · {/if}
			<span class="status" class:online={detail.host.online} class:stale={!detail.host.online}>
				{detail.host.online ? 'online' : 'stale'}
			</span>
		</p>
		{#if detail.host.lanIp}<p class="meta">LAN {detail.host.lanIp}</p>{/if}
		{#if detail.host.tailscaleIp}<p class="meta">Tailscale {detail.host.tailscaleIp}</p>{/if}
		{#if detail.host.runs}<p class="runs">{detail.host.runs}</p>{/if}
	</div>
	<nav class="ranges" aria-label="Time range">
		{#each rangeKeys as key (key)}
			<a href="?range={key}" aria-current={detail.range === key ? 'page' : undefined}>{RANGES[key].label}</a>
		{/each}
	</nav>
</div>
<p class="sub">
	Updated {formatWhen(detail.generatedAt)}. Last report {formatWhen(detail.host.lastReported)}. Refreshes
	every 15 seconds.
</p>
{#if updateError}
	<p class="error" role="status">{updateError}</p>
{/if}

<dl class="stats">
	<div>
		<dt>CPU</dt>
		<dd class="num">{formatPercent(detail.host.cpuPercent)}</dd>
	</div>
	<div>
		<dt>Memory</dt>
		<dd class="num">{memoryCapacity}</dd>
	</div>
	<div>
		<dt>Disk</dt>
		<dd class="num">{diskCapacity}</dd>
	</div>
	<div>
		<dt>Temp</dt>
		<dd class="num">{formatTemp(detail.host.tempC)}</dd>
	</div>
	<div>
		<dt>Load</dt>
		<dd class="num">
			{formatLoad(detail.host.load1)} {formatLoad(detail.host.load5)} {formatLoad(detail.host.load15)}
		</dd>
	</div>
	<div>
		<dt>Uptime</dt>
		<dd class="num">{formatUptime(detail.host.uptimeSeconds)}</dd>
	</div>
</dl>

<div class="charts">
	<LineChart
		title="CPU"
		{times}
		{bucketMs}
		yMin={0}
		yMax={100}
		format={formatPercent}
		series={[{ label: 'CPU', color: '#7aa2f7', values: column((point) => point.cpu) }]}
	/>
	<LineChart
		title="Memory"
		subtitle={memoryCapacity}
		{times}
		{bucketMs}
		yMin={0}
		yMax={100}
		format={formatPercent}
		series={[{ label: 'Memory', color: '#bb9af7', values: column((point) => point.memory) }]}
	/>
	<LineChart
		title="Disk /"
		subtitle={diskCapacity}
		{times}
		{bucketMs}
		yMin={0}
		yMax={100}
		format={formatPercent}
		series={[{ label: 'Disk', color: '#e0af68', values: column((point) => point.disk) }]}
	/>
	<LineChart
		title="Temperature"
		{times}
		{bucketMs}
		format={formatTemp}
		series={[{ label: 'CPU', color: '#f7768e', values: column((point) => point.temp) }]}
	/>
	<LineChart
		title="Load"
		{times}
		{bucketMs}
		yMin={0}
		format={formatLoad}
		series={[{ label: 'load1', color: '#9ece6a', values: column((point) => point.load1) }]}
	/>
	<LineChart
		title="Network"
		{times}
		{bucketMs}
		yMin={0}
		format={formatRate}
		series={[
			{ label: 'Receive', color: '#7dcfff', values: column((point) => point.netRx) },
			{ label: 'Transmit', color: '#ff9e64', values: column((point) => point.netTx) }
		]}
	/>
	<LineChart
		title="Disk IO"
		{times}
		{bucketMs}
		yMin={0}
		format={formatRate}
		series={[
			{ label: 'Read', color: '#7dcfff', values: column((point) => point.diskRead) },
			{ label: 'Write', color: '#ff9e64', values: column((point) => point.diskWrite) }
		]}
	/>
</div>
