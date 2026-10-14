<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import type { Host, ProbeView, ProjectServiceRow } from '$lib/api-types';
	import DataTable from '$lib/components/DataTable.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { formatLatency, formatWhen } from '$lib/format';
	import {
		SERVICE_DEFAULT_DIR,
		SERVICE_DEFAULT_SORT,
		serviceColumns,
		serviceDomId,
		serviceHostReachable,
		showProjectColumn
	} from '$lib/host-view';
	import { canRenameService, serviceEditCancelHref, serviceEditHref, serviceLabel } from '$lib/service-label';
	import { serverHostHiddenFields } from '$lib/table';
	import { actionUrlFrom } from '$lib/url';

	let {
		projectId,
		projectName,
		hosts,
		canAdmin,
		rows,
		total,
		prevCursor,
		nextCursor,
		omitted,
		message,
		probe,
		probeServiceId,
		renameServiceId,
		typedName
	}: {
		projectId: string;
		projectName: string;
		hosts: Host[];
		canAdmin: boolean;
		rows: ProjectServiceRow[];
		total: number;
		prevCursor: string | null;
		nextCursor: string | null;
		omitted: number;
		message: string | null;
		probe: ProbeView | null;
		probeServiceId: string | null;
		renameServiceId: string | null;
		typedName: string | null;
	} = $props();

	const showProject = $derived(showProjectColumn(projectName, rows));
	const columns = $derived(serviceColumns(showProject));
	const serviceHosts = $derived(hosts.filter((host) => serviceHostReachable(host)));
	const hostHidden = $derived(serverHostHiddenFields(page.url.searchParams, 'services'));
	const selectedHost = $derived(page.url.searchParams.get('services.host'));
	const hostChosen = $derived(serviceHosts.some((host) => host.id === selectedHost));
	const editingId = $derived(page.url.searchParams.get('services.edit'));
	const probed = $derived(rows.find((row) => row.id === probeServiceId) ?? null);

	function ports(values: number[]): string {
		return values.length ? values.join(', ') : 'n/a';
	}

	function renameAllowed(row: ProjectServiceRow): boolean {
		const host = hosts.find((item) => item.id === row.host_id);
		return canRenameService({
			canAdmin,
			projectId,
			serviceProjectId: row.project_id,
			hostOwnerProjectId: host?.project_id ?? null
		});
	}

	function typedFor(row: ProjectServiceRow): string {
		if (renameServiceId === row.id && typedName != null) return typedName;
		return row.display_name ?? '';
	}
</script>

{#if message}
	<Notice kind="error">{message}</Notice>
{/if}
{#if probe}
	<div class="panel" role="status">
		<h2>Probe</h2>
		<dl>
			<div><dt>Service</dt><dd>{probed ? serviceLabel(probed) : (probe.service ?? 'n/a')}</dd></div>
			<div><dt>Host</dt><dd>{probed?.host_name ?? 'n/a'}</dd></div>
			<div><dt>Check</dt><dd>{probe.protocol ?? 'n/a'} {probe.port ?? ''} {probe.path ?? ''}</dd></div>
			<div><dt>Result</dt><dd>{probe.result ?? 'n/a'}</dd></div>
			<div><dt>HTTP</dt><dd>{probe.http_status ?? 'n/a'}</dd></div>
			<div><dt>Latency</dt><dd>{formatLatency(probe.latency_ms)}</dd></div>
			<div><dt>Checked</dt><dd>{formatWhen(probe.checked_at)}</dd></div>
		</dl>
	</div>
{/if}

<h2 id="services-heading" class="sr">Services</h2>
{#if omitted > 0}
	<p class="sub">{omitted} more {omitted === 1 ? 'row' : 'rows'} left out.</p>
{/if}
<form class="form-row" method="GET" action={page.url.pathname}>
	{#each hostHidden as field (field.name)}
		<input type="hidden" name={field.name} value={field.value} />
	{/each}
	<label class="field">
		Host
		<select name="services.host">
			<option value="" selected={selectedHost == null || selectedHost === '' || !hostChosen}>All hosts</option>
			{#each serviceHosts as host (host.id)}
				<option value={host.id} selected={host.id === selectedHost}>{host.name}</option>
			{/each}
		</select>
	</label>
	<button type="submit">Apply</button>
</form>
<DataTable
	{rows}
	{columns}
	id="services"
	labelledBy="services-heading"
	empty="No services reported."
	rowKey={(row) => row.id}
	defaultSort={SERVICE_DEFAULT_SORT}
	defaultDir={SERVICE_DEFAULT_DIR}
	searchLabel="Search name, host, kind, user, or port"
	server={{ total, prevCursor, nextCursor }}
>
	{#snippet row(service)}
		<tr id={serviceDomId(service.id)}>
			<td>
				{#if editingId === service.id && renameAllowed(service)}
					<form method="POST" action={actionUrlFrom(page.url, 'rename')} class="actions" use:enhance>
						<input type="hidden" name="service_id" value={service.id} />
						<label>
							<span class="sr">Display name</span>
							<input
								class="inline-input"
								type="text"
								name="display_name"
								maxlength="64"
								autocomplete="off"
								value={typedFor(service)}
							/>
						</label>
						<button type="submit">Save</button>
						<button type="submit" name="clear" value="1">Clear</button>
						<a href={serviceEditCancelHref(page.url)}>Cancel</a>
					</form>
				{:else}
					{serviceLabel(service)}
					{#if renameAllowed(service)}
						<a href={serviceEditHref(page.url, service.id)}>Rename</a>
					{/if}
				{/if}
			</td>
			<td><a href="/hosts/{service.host_id}">{service.host_name}</a></td>
			{#if showProject}
				<td>{service.project_name}</td>
			{/if}
			<td>{service.kind}</td>
			<td>{ports(service.ports)}</td>
			<td><StatusBadge status={service.health?.status ?? 'unknown'} /></td>
			<td>{formatWhen(service.last_seen_at)}</td>
			<td class="wrap">
				{#if service.checksMessage}
					<span class="sub">{service.checksMessage}</span>
				{:else if service.checks.length === 0}
					<span class="sub">No health checks.</span>
				{:else}
					{#each service.checks as check (check.id)}
						<form method="POST" action={actionUrlFrom(page.url, 'probe')} class="actions" use:enhance>
							<input type="hidden" name="service_id" value={service.id} />
							<input type="hidden" name="check_id" value={check.id} />
							<span>{check.protocol} {check.port}{check.path ?? ''}{check.enabled ? '' : ' (disabled)'}</span>
							<button type="submit" aria-label="Probe {serviceLabel(service)} {check.protocol} {check.port}">Probe</button>
						</form>
					{/each}
				{/if}
			</td>
		</tr>
	{/snippet}
</DataTable>
