<script lang="ts">
	import { browser } from '$app/environment';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { tick, untrack } from 'svelte';
	import Activity from '@lucide/svelte/icons/activity';
	import Fingerprint from '@lucide/svelte/icons/fingerprint';
	import RowAction from '$lib/components/RowAction.svelte';
	import type { Host, ProbeView, ProjectServiceRow } from '$lib/api-types';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import { COPY_FAILED_NOTE, COPY_FAILURE_MS, COPIED_NOTE, shownDigestFailure } from '$lib/copy-text';
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
	import { canEditHealthChecks, SAVED_HEALTH_CHECKS } from '$lib/health-checks';
	import { serviceLabel } from '$lib/service-label';
	import {
		SERVICE_SHOW_LABEL,
		SERVICE_SHOWS,
		discoveredListenersHref,
		healthSourceLabel,
		imageDigestText,
		serviceRowStatus,
		serviceShow,
		showDeploybotEmpty,
		showsDockerHealthcheck
	} from '$lib/service-view';
	import { readSearch, serverHostHiddenFields } from '$lib/table';
	import { actionUrlFrom } from '$lib/url';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import HealthChecks from './HealthChecks.svelte';
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
		editorProbe = false,
		renameServiceId,
		typedName,
		savedHealthId = null,
		healthServiceId = null,
		healthField = null,
		healthIndex = null,
		healthMessage = null,
		probeIndex = null,
		probeMessage = null,
		onHealthSaved,
		onHealthOpen
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
		editorProbe?: boolean;
		renameServiceId: string | null;
		typedName: string | null;
		savedHealthId?: string | null;
		healthServiceId?: string | null;
		healthField?: string | null;
		healthIndex?: number | null;
		healthMessage?: string | null;
		probeIndex?: number | null;
		probeMessage?: string | null;
		onHealthSaved?: (serviceId: string | null) => void;
		onHealthOpen?: () => void;
	} = $props();

	const showProject = $derived(showProjectColumn(projectName, rows));
	const columns = $derived(serviceColumns(showProject));
	const serviceHosts = $derived(hosts.filter((host) => serviceHostReachable(host)));
	// `show` is the select's own field. Copying it from the URL would submit the old value beside the new one.
	const hostHidden = $derived(
		serverHostHiddenFields(page.url.searchParams, 'services').filter((field) => field.name !== 'show')
	);
	const selectedHost = $derived(page.url.searchParams.get('services.host'));
	const hostChosen = $derived(serviceHosts.some((host) => host.id === selectedHost));
	const showFromUrl = $derived(serviceShow(page.url.searchParams.get('show')));
	const probed = $derived(rows.find((row) => row.id === probeServiceId) ?? null);
	let hostValue = $state(untrack(() => (hostChosen && selectedHost ? selectedHost : 'all')));
	let showValue = $state<string>(untrack(() => serviceShow(page.url.searchParams.get('show')).show));
	const hostLabel = $derived(
		hostValue === 'all' ? 'All hosts' : (serviceHosts.find((host) => host.id === hostValue)?.name ?? 'All hosts')
	);
	const showLabel = $derived(SERVICE_SHOW_LABEL[serviceShow(showValue).show]);
	const discoveredHref = $derived(discoveredListenersHref(page.url));
	const deploybotEmpty = $derived(
		showDeploybotEmpty({
			show: showFromUrl.show,
			search: readSearch(page.url.searchParams.get('services.q')),
			message
		})
	);

	$effect(() => {
		hostValue = hostChosen && selectedHost ? selectedHost : 'all';
	});

	$effect(() => {
		showValue = showFromUrl.show;
	});

	let filterForm = $state<HTMLFormElement | null>(null);

	// A filter applies as soon as it changes. Wait for the hidden fields to take the new value first.
	async function applyFilters() {
		await tick();
		filterForm?.requestSubmit();
	}

	function ports(values: number[]): string {
		return values.length ? values.join(', ') : 'n/a';
	}

	function renameAllowed(row: ProjectServiceRow): boolean {
		const host = hosts.find((item) => item.id === row.host_id);
		return canEditHealthChecks({
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

	type DigestFailure = { value: string; failedAt: number };
	let digestFailures = $state<Record<string, DigestFailure>>({});

	function onDigestResult(serviceId: string, value: string, note: string) {
		if (note === COPIED_NOTE) {
			if (digestFailures[serviceId] == null) return;
			const next = { ...digestFailures };
			delete next[serviceId];
			digestFailures = next;
			return;
		}
		if (note !== COPY_FAILED_NOTE) return;
		digestFailures = { ...digestFailures, [serviceId]: { value, failedAt: Date.now() } };
	}

	$effect(() => {
		if (!browser) return;
		const pending = Object.entries(digestFailures);
		if (pending.length === 0) return;
		const timers = pending.map(([id, failure]) =>
			setTimeout(() => {
				const current = digestFailures[id];
				if (current == null || current.failedAt !== failure.failedAt) return;
				if (shownDigestFailure(current.value, current.failedAt, Date.now()) != null) return;
				const next = { ...digestFailures };
				delete next[id];
				digestFailures = next;
			}, Math.max(0, failure.failedAt + COPY_FAILURE_MS - Date.now()))
		);
		return () => {
			for (const timer of timers) clearTimeout(timer);
		};
	});
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
<form class="mb-3 flex min-w-0 flex-wrap items-end gap-2" method="GET" action={page.url.pathname} bind:this={filterForm}>
	{#each hostHidden as field (field.name)}
		<Input type="hidden" name={field.name} value={field.value} />
	{/each}
	<Input type="hidden" name="services.host" value={hostValue === 'all' ? '' : hostValue} />
	<Input type="hidden" name="show" value={serviceShow(showValue).show} />
	<div class="grid min-w-0 basis-full gap-1.5 sm:max-w-xs sm:basis-0 sm:flex-1">
		<Label for="services-host">Host</Label>
		<Select.Root type="single" bind:value={hostValue} onValueChange={applyFilters}>
			<Select.Trigger id="services-host" class="w-full min-w-0">
				<Select.Value class="min-w-0 truncate" placeholder="All hosts">{hostLabel}</Select.Value>
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="all">All hosts</Select.Item>
				{#each serviceHosts as host (host.id)}
					<Select.Item value={host.id}>{host.name}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>
	<div class="grid min-w-0 basis-full gap-1.5 sm:max-w-sm sm:basis-0 sm:flex-1">
		<Label for="services-show">Show</Label>
		<Select.Root type="single" bind:value={showValue} onValueChange={applyFilters}>
			<Select.Trigger id="services-show" class="w-full min-w-0">
				<Select.Value class="min-w-0 truncate" placeholder="Deploybot services">{showLabel}</Select.Value>
			</Select.Trigger>
			<Select.Content>
				{#each SERVICE_SHOWS as option (option)}
					<Select.Item value={option}>{SERVICE_SHOW_LABEL[option]}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>
</form>
<DataTable
	{rows}
	{columns}
	id="services"
	labelledBy="services-heading"
	empty={deploybotEmpty ? 'No services run by Deploybot yet.' : 'No services reported.'}
	rowKey={(row) => row.id}
	defaultSort={SERVICE_DEFAULT_SORT}
	defaultDir={SERVICE_DEFAULT_DIR}
	searchLabel="Search name, host, kind, user, or port"
	server={{ total, prevCursor, nextCursor }}
>
	{#snippet emptyExtra()}
		{#if deploybotEmpty}
			{' '}<a
				class="text-primary underline underline-offset-4 rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring"
				href={discoveredHref}>Show discovered listeners</a
			>
		{/if}
	{/snippet}
	{#snippet row(service)}
		{@const label = serviceLabel(service)}
		{@const digest = imageDigestText(service.image_digest)}
		{@const digestFailure = digestFailures[service.id]}
		<tr id={serviceDomId(service.id)}>
			<td class="p-2 align-middle">
				<div class="flex min-w-0 items-center gap-2">
					<span class="inline-block max-w-48 min-w-0 truncate" title={label}>{label}</span>
					{#if service.source === 'owned' && service.kind === 'container' && service.container_name && service.container_name !== label}
						<span class="text-muted-foreground inline-block max-w-40 min-w-0 truncate font-mono text-sm" title={service.container_name}>{service.container_name}</span>
					{/if}
					<span class="ml-auto inline-flex shrink-0 items-center gap-1">
						{#if digest}
							<CopyButton value={digest} label="Image digest {digest}" icon={Fingerprint} iconOnly onResult={(note) => onDigestResult(service.id, digest, note)} />
						{/if}
						{#if service.catalog_entry}
							<Badge variant="secondary">catalog</Badge>
						{/if}
						{#if renameAllowed(service)}
							<RenameService
								action={actionUrlFrom(page.url, 'rename')}
								serviceId={service.id}
								rowLabel={label}
								value={typedFor(service)}
								failed={renameServiceId === service.id}
								{message}
							/>
							<HealthChecks
								action={actionUrlFrom(page.url, 'saveHealthChecks')}
								probeAction={actionUrlFrom(page.url, 'probe')}
								serviceId={service.id}
								rowLabel={label}
								ports={service.ports}
								checks={service.checks}
								checksMessage={service.checksMessage}
								health={service.health}
								failed={healthServiceId === service.id}
								serverField={healthServiceId === service.id ? healthField : null}
								serverIndex={healthServiceId === service.id ? healthIndex : null}
								serverMessage={healthServiceId === service.id ? healthMessage : null}
								{probe}
								{probeIndex}
								{probeMessage}
								showProbe={editorProbe && probeServiceId === service.id}
								onSaved={onHealthSaved}
								onOpened={onHealthOpen}
							/>
						{/if}
					</span>
				</div>
				{#if digestFailure}
					<div class="mt-1 grid gap-1">
						<p class="font-mono text-sm break-all select-text">{digestFailure.value}</p>
						<p class="text-muted-foreground text-sm" role="status">{COPY_FAILED_NOTE}</p>
					</div>
				{/if}
				{#if savedHealthId === service.id}
					<div class="mt-2">
						<Notice kind="success">{SAVED_HEALTH_CHECKS}</Notice>
					</div>
				{/if}
			</td>
			<td class="p-2 align-middle"><a class="text-primary underline-offset-4 hover:underline" href="/hosts/{service.host_id}">{service.host_name}</a></td>
			{#if showProject}
				<td class="p-2 align-middle">{service.project_name}</td>
			{/if}
			<td class="p-2 align-middle">{service.kind}</td>
			<td class="p-2 align-middle font-mono">{ports(service.ports)}</td>
			<td class="p-2 align-middle"><StatusBadge status={serviceRowStatus(service)} hint={healthSourceLabel(service)} /></td>
			<td class="p-2 align-middle whitespace-nowrap">{formatWhen(service.last_seen_at)}</td>
			<td class="p-2 align-middle">
				{#if showsDockerHealthcheck(service)}
					<p class="text-muted-foreground text-sm">docker healthcheck</p>
				{/if}
				{#if service.checksMessage}
					<span class="text-muted-foreground text-sm">{service.checksMessage}</span>
				{:else if service.checks.length === 0 && !showsDockerHealthcheck(service)}
					<span class="text-muted-foreground text-sm">No health checks.</span>
				{:else}
					{#each service.checks as check (check.id)}
						<form method="POST" action={actionUrlFrom(page.url, 'probe')} class="mb-1 flex flex-wrap items-center gap-2" use:enhance>
							<Input type="hidden" name="service_id" value={service.id} />
							<Input type="hidden" name="check_id" value={check.id} />
							<span class="font-mono text-sm">{check.protocol} {check.port}{check.path ?? ''}{check.enabled ? '' : ' (disabled)'}</span>
							<RowAction
								type="submit"
								label="Probe {label} {check.protocol} {check.port}"
								icon={Activity}
							/>
						</form>
					{/each}
				{/if}
			</td>
		</tr>
	{/snippet}
</DataTable>
