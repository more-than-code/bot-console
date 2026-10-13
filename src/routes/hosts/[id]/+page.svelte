<script lang="ts">
	import { enhance } from '$app/forms';
	import StatusText from '$lib/components/StatusText.svelte';
	import {
		formatBytes,
		formatCapacity,
		formatLatency,
		formatLoad,
		formatPercent,
		formatTemp,
		formatUptime,
		formatWhen
	} from '$lib/format';

	let { data, form } = $props();

	const back = $derived(
		data.host?.project_id ? `/projects/${data.host.project_id}` : '/projects'
	);

	function ports(values: number[]): string {
		return values.length ? values.join(', ') : 'n/a';
	}

	function rawNumber(value: number | null): string {
		if (value == null || !Number.isFinite(value)) return 'n/a';
		return String(value);
	}
</script>

<svelte:head>
	<title>{data.host ? data.host.name : 'Host'} · deploybot</title>
</svelte:head>

<p><a class="back" href={back}>Project</a></p>
{#if !data.host}
	<h1>Host</h1>
	<p class="error" role="alert">{data.message ?? 'This host is not available.'}</p>
{:else}
	<h1>{data.host.name}</h1>
	<p class="sub">
		<StatusText status={data.host.status} />
		· {data.host.node_type} · {data.host.os}/{data.host.arch}
		· version {data.host.agent_version ?? 'n/a'}
	</p>
	<p class="sub">
		Last seen {formatWhen(data.host.last_seen_at)}. Enrolled {formatWhen(data.host.enrolled_at)}.
		Always on {data.host.always_on ? 'yes' : 'no'}.
	</p>
	{#if data.message || form?.message}
		<p class="error" role="alert">{form?.message ?? data.message}</p>
	{/if}

	<form method="POST" action="?/snapshot" use:enhance>
		<button type="submit">Snapshot</button>
	</form>

	{#if form?.snapshot}
		<div class="panel">
			<h2>Snapshot</h2>
			<p class="sub">Sampled {formatWhen(form.snapshot.sampled_at)}.</p>
			<dl>
				<div><dt>CPU</dt><dd>{formatPercent(form.snapshot.cpu_percent)}</dd></div>
				<div>
					<dt>Memory</dt>
					<dd>
						{form.snapshot.mem
							? formatCapacity(form.snapshot.mem.used, form.snapshot.mem.total, form.snapshot.mem.used_percent)
							: 'n/a'}
					</dd>
				</div>
				<div>
					<dt>Load</dt>
					<dd>
						{form.snapshot.load
							? `${formatLoad(form.snapshot.load[0])} ${formatLoad(form.snapshot.load[1])} ${formatLoad(form.snapshot.load[2])}`
							: 'n/a'}
					</dd>
				</div>
				<div><dt>Temp</dt><dd>{formatTemp(form.snapshot.temp_celsius)}</dd></div>
				<div><dt>Uptime</dt><dd>{formatUptime(form.snapshot.uptime_sec)}</dd></div>
			</dl>
			{#if form.snapshot.disks.length > 0}
				<div class="table-wrap">
					<table class="data">
						<thead>
							<tr><th>Disk</th><th>Used</th></tr>
						</thead>
						<tbody>
							{#each form.snapshot.disks as disk (disk.path)}
								<tr>
									<td>{disk.path}</td>
									<td>{formatCapacity(disk.used, disk.total, disk.used_percent)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
			{#if form.snapshot.top.length > 0}
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
							{#each form.snapshot.top as row (row.pid)}
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

	{#if form?.probe}
		<div class="panel" role="status">
			<h2>Probe</h2>
			<dl>
				<div><dt>Service</dt><dd>{form.probe.service ?? 'n/a'}</dd></div>
				<div><dt>Check</dt><dd>{form.probe.protocol ?? 'n/a'} {form.probe.port ?? ''} {form.probe.path ?? ''}</dd></div>
				<div><dt>Result</dt><dd>{form.probe.result ?? 'n/a'}</dd></div>
				<div><dt>HTTP</dt><dd>{form.probe.http_status ?? 'n/a'}</dd></div>
				<div><dt>Latency</dt><dd>{formatLatency(form.probe.latency_ms)}</dd></div>
				<div><dt>Checked</dt><dd>{formatWhen(form.probe.checked_at)}</dd></div>
			</dl>
		</div>
	{/if}

	<h2>Services</h2>
	{#if data.omitted > 0}
		<p class="sub">{data.omitted} more {data.omitted === 1 ? 'row' : 'rows'} left out.</p>
	{/if}
	{#if data.services.length === 0}
		<p class="empty">No services reported.</p>
	{:else}
		<div class="table-wrap">
			<table class="data">
				<thead>
					<tr>
						<th>Name</th>
						<th>Source</th>
						<th>Kind</th>
						<th>Ports</th>
						<th>Health</th>
						<th>Checks</th>
					</tr>
				</thead>
				<tbody>
					{#each data.services as service (service.id)}
						<tr>
							<td>{service.name}</td>
							<td>{service.source}</td>
							<td>{service.kind}</td>
							<td>{ports(service.ports)}</td>
							<td><StatusText status={service.health?.status ?? 'unknown'} /></td>
							<td class="wrap">
								{#if service.checksMessage}
									<span class="sub">{service.checksMessage}</span>
								{:else if service.checks.length === 0}
									<span class="sub">No health checks.</span>
								{:else}
									{#each service.checks as check (check.id)}
										<form method="POST" action="?/probe" class="actions" use:enhance>
											<input type="hidden" name="service_id" value={service.id} />
											<input type="hidden" name="check_id" value={check.id} />
											<span>{check.protocol} {check.port}{check.path ?? ''}{check.enabled ? '' : ' (disabled)'}</span>
											<button type="submit" aria-label="Probe {service.name} {check.protocol} {check.port}">Probe</button>
										</form>
									{/each}
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
{/if}
