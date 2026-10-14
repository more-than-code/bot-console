<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import Activity from '@lucide/svelte/icons/activity';
	import RowAction from '$lib/components/RowAction.svelte';
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
	import { canRenameService, serviceLabel } from '$lib/service-label';
	import { serverHostHiddenFields } from '$lib/table';
	import { actionUrlFrom } from '$lib/url';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import RenameService from './RenameService.svelte';

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
	const probed = $derived(rows.find((row) => row.id === probeServiceId) ?? null);
	let hostValue = $state(untrack(() => (hostChosen && selectedHost ? selectedHost : 'all')));
	const hostLabel = $derived(
		hostValue === 'all' ? 'All hosts' : (serviceHosts.find((host) => host.id === hostValue)?.name ?? 'All hosts')
	);

	$effect(() => {
		hostValue = hostChosen && selectedHost ? selectedHost : 'all';
	});

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
	<Card.Root class="mb-4" role="status">
		<Card.Header>
			<Card.Title>Probe</Card.Title>
		</Card.Header>
		<Card.Content>
			<dl class="grid gap-2 sm:grid-cols-2">
				<div><dt class="text-muted-foreground text-sm">Service</dt><dd>{probed ? serviceLabel(probed) : (probe.service ?? 'n/a')}</dd></div>
				<div><dt class="text-muted-foreground text-sm">Host</dt><dd>{probed?.host_name ?? 'n/a'}</dd></div>
				<div><dt class="text-muted-foreground text-sm">Check</dt><dd class="font-mono">{probe.protocol ?? 'n/a'} {probe.port ?? ''} {probe.path ?? ''}</dd></div>
				<div><dt class="text-muted-foreground text-sm">Result</dt><dd>{probe.result ?? 'n/a'}</dd></div>
				<div><dt class="text-muted-foreground text-sm">HTTP</dt><dd>{probe.http_status ?? 'n/a'}</dd></div>
				<div><dt class="text-muted-foreground text-sm">Latency</dt><dd>{formatLatency(probe.latency_ms)}</dd></div>
				<div><dt class="text-muted-foreground text-sm">Checked</dt><dd>{formatWhen(probe.checked_at)}</dd></div>
			</dl>
		</Card.Content>
	</Card.Root>
{/if}

<h2 id="services-heading" class="sr-only">Services</h2>
{#if omitted > 0}
	<p class="text-muted-foreground mb-2 text-sm">{omitted} more {omitted === 1 ? 'row' : 'rows'} left out.</p>
{/if}
<form class="mb-3 flex min-w-0 flex-wrap items-end gap-2" method="GET" action={page.url.pathname}>
	{#each hostHidden as field (field.name)}
		<Input type="hidden" name={field.name} value={field.value} />
	{/each}
	<Input type="hidden" name="services.host" value={hostValue === 'all' ? '' : hostValue} />
	<div class="grid min-w-0 flex-1 gap-1.5 sm:max-w-xs">
		<Label for="services-host">Host</Label>
		<Select.Root type="single" bind:value={hostValue}>
			<Select.Trigger id="services-host" class="w-full">
				<Select.Value placeholder="All hosts">{hostLabel}</Select.Value>
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="all">All hosts</Select.Item>
				{#each serviceHosts as host (host.id)}
					<Select.Item value={host.id}>{host.name}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>
	<Button type="submit" variant="outline">Apply</Button>
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
			<td class="p-2 align-middle">
				<span class="mr-2">{serviceLabel(service)}</span>
				{#if renameAllowed(service)}
					<RenameService
						action={actionUrlFrom(page.url, 'rename')}
						serviceId={service.id}
						rowLabel={serviceLabel(service)}
						value={typedFor(service)}
						failed={renameServiceId === service.id}
						{message}
					/>
				{/if}
			</td>
			<td class="p-2 align-middle"><a class="text-primary underline-offset-4 hover:underline" href="/hosts/{service.host_id}">{service.host_name}</a></td>
			{#if showProject}
				<td class="p-2 align-middle">{service.project_name}</td>
			{/if}
			<td class="p-2 align-middle">{service.kind}</td>
			<td class="p-2 align-middle font-mono">{ports(service.ports)}</td>
			<td class="p-2 align-middle"><StatusBadge status={service.health?.status ?? 'unknown'} /></td>
			<td class="p-2 align-middle">{formatWhen(service.last_seen_at)}</td>
			<td class="p-2 align-middle whitespace-normal">
				{#if service.checksMessage}
					<span class="text-muted-foreground text-sm">{service.checksMessage}</span>
				{:else if service.checks.length === 0}
					<span class="text-muted-foreground text-sm">No health checks.</span>
				{:else}
					{#each service.checks as check (check.id)}
						<form method="POST" action={actionUrlFrom(page.url, 'probe')} class="mb-1 flex flex-wrap items-center gap-2" use:enhance>
							<Input type="hidden" name="service_id" value={service.id} />
							<Input type="hidden" name="check_id" value={check.id} />
							<span class="font-mono text-sm">{check.protocol} {check.port}{check.path ?? ''}{check.enabled ? '' : ' (disabled)'}</span>
							<RowAction
								type="submit"
								label="Probe {serviceLabel(service)} {check.protocol} {check.port}"
								icon={Activity}
							/>
						</form>
					{/each}
				{/if}
			</td>
		</tr>
	{/snippet}
</DataTable>
