<script lang="ts">
	import { enhance } from '$app/forms';
	import StatusText from '$lib/components/StatusText.svelte';
	import type { ProbeView, ServiceRow } from '$lib/api-types';
	import { formatLatency, formatWhen } from '$lib/format';
	import { hostFormAction, serviceDomId } from '$lib/host-view';
	import type { RangeKey } from '$lib/ranges';

	let {
		services,
		omitted,
		probe,
		range
	}: {
		services: ServiceRow[];
		omitted: number;
		probe: ProbeView | null;
		range: RangeKey;
	} = $props();

	function ports(values: number[]): string {
		return values.length ? values.join(', ') : 'n/a';
	}
</script>

{#if probe}
	<div class="panel" role="status">
		<h2>Probe</h2>
		<dl>
			<div><dt>Service</dt><dd>{probe.service ?? 'n/a'}</dd></div>
			<div><dt>Check</dt><dd>{probe.protocol ?? 'n/a'} {probe.port ?? ''} {probe.path ?? ''}</dd></div>
			<div><dt>Result</dt><dd>{probe.result ?? 'n/a'}</dd></div>
			<div><dt>HTTP</dt><dd>{probe.http_status ?? 'n/a'}</dd></div>
			<div><dt>Latency</dt><dd>{formatLatency(probe.latency_ms)}</dd></div>
			<div><dt>Checked</dt><dd>{formatWhen(probe.checked_at)}</dd></div>
		</dl>
	</div>
{/if}

<h2 id="services-heading">Services</h2>
{#if omitted > 0}
	<p class="sub">{omitted} more {omitted === 1 ? 'row' : 'rows'} left out.</p>
{/if}
{#if services.length === 0}
	<p class="empty">No services reported.</p>
{:else}
	<div class="table-wrap">
		<table class="data" aria-labelledby="services-heading">
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
				{#each services as service (service.id)}
					<tr id={serviceDomId(service.id)}>
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
									<form method="POST" action={hostFormAction('probe', { tab: 'services', range })} class="actions" use:enhance>
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
