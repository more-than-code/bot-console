<script lang="ts">
	import { formatLoad, formatPercent, formatTemp, formatUptime, formatWhen } from '$lib/format';
	import type { HostSnapshot } from '$lib/types';

	let { host }: { host: HostSnapshot } = $props();

	function meter(value: number | null): string | null {
		if (value == null || !Number.isFinite(value)) return null;
		return `${Math.max(0, Math.min(100, value)).toFixed(1)}%`;
	}

	const cpuWidth = $derived(meter(host.cpuPercent));
	const memoryWidth = $derived(meter(host.memoryPercent));
	const diskWidth = $derived(meter(host.diskPercent));
</script>

<a class="card" class:stale={!host.online} href="/pi/{host.name}">
	<div class="card-head">
		<h2>{host.name}</h2>
		<span class="status" class:online={host.online} class:stale={!host.online}>
			{host.online ? 'online' : 'stale'}
		</span>
	</div>
	{#if host.role}
		<p class="meta">{host.role}</p>
	{/if}
	{#if host.lanIp}
		<p class="meta">LAN {host.lanIp}</p>
	{/if}
	{#if host.tailscaleIp}
		<p class="meta">Tailscale {host.tailscaleIp}</p>
	{/if}
	{#if host.runs}
		<p class="runs">{host.runs}</p>
	{/if}
	<dl>
		<div>
			<dt>CPU</dt>
			<dd>
				<span class="num">{formatPercent(host.cpuPercent)}</span>
				{#if cpuWidth}
					<span class="meter"><span style="width: {cpuWidth}; background: #7aa2f7"></span></span>
				{/if}
			</dd>
		</div>
		<div>
			<dt>Memory</dt>
			<dd>
				<span class="num">{formatPercent(host.memoryPercent)}</span>
				{#if memoryWidth}
					<span class="meter"><span style="width: {memoryWidth}; background: #bb9af7"></span></span>
				{/if}
			</dd>
		</div>
		<div>
			<dt>Disk</dt>
			<dd>
				<span class="num">{formatPercent(host.diskPercent)}</span>
				{#if diskWidth}
					<span class="meter"><span style="width: {diskWidth}; background: #e0af68"></span></span>
				{/if}
			</dd>
		</div>
		<div>
			<dt>Temp</dt>
			<dd class="num">{formatTemp(host.tempC)}</dd>
		</div>
		<div>
			<dt>Load</dt>
			<dd class="num">{formatLoad(host.load1)} {formatLoad(host.load5)} {formatLoad(host.load15)}</dd>
		</div>
		<div>
			<dt>Uptime</dt>
			<dd class="num">{formatUptime(host.uptimeSeconds)}</dd>
		</div>
		<div>
			<dt>Reported</dt>
			<dd>{formatWhen(host.lastReported)}</dd>
		</div>
	</dl>
</a>
