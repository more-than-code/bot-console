<script lang="ts">
	import { browser } from '$app/environment';
	import { enhance } from '$app/forms';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import { untrack, type Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import Notice from '$lib/components/Notice.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import type { Host, ImageStatus, ProgramStatus } from '$lib/api-types';
	import { APPROVAL_WAIT, hostBlockReason, imageHostBlockReason, isCatalogHost, reuseIdempotencyKey } from '$lib/catalog';
	import { NOT_DEPLOYED_MARK, blockInFlightSubmit, flightFocusTarget, flightLabel, flightOfRunKind } from '$lib/catalog-flight';
	import { shortDigest } from '$lib/image-spec';
	import type { CatalogRunKind, CatalogRunState } from '$lib/project-action';
	import FlightStatus from './FlightStatus.svelte';

	const LABELS = { run: 'Run', stop: 'Stop', restart: 'Restart', logs: 'Logs', status: 'Status' } as const;

	let {
		kind,
		entryName,
		runAs,
		shell,
		hosts,
		action,
		result = null,
		entryKind = 'program',
		deployedHostIds = null,
		inFlight = false,
		onBusy,
		cancel
	}: {
		kind: CatalogRunKind;
		entryName: string;
		runAs: string;
		shell: boolean;
		hosts: Host[];
		action: string;
		result?: CatalogRunState | null;
		entryKind?: 'program' | 'image';
		/** Hosts that already have this container. Null skips the check (programs, Status, or an unknown list). */
		deployedHostIds?: string[] | null;
		/** Renders the in-flight state without a browser submit. Logs and Status ignore it. */
		inFlight?: boolean;
		onBusy?: (busy: boolean) => void;
		cancel?: Snippet;
	} = $props();

	const label = $derived(LABELS[kind]);
	const flight = $derived(flightOfRunKind(kind));
	const keyed = $derived(flight != null);
	const eligible = $derived(hosts.filter((host) => isCatalogHost(host)));
	let submitting = $state(false);
	const busy = $derived(flight != null && (inFlight || submitting));
	let submitEl = $state<HTMLButtonElement | null>(null);
	let noticeEl = $state<HTMLDivElement | null>(null);
	// Plain flag so recording it does not rerun the focus effect.
	let sawFlight = false;

	function undeployed(host: Host): boolean {
		return deployedHostIds != null && !deployedHostIds.includes(host.id);
	}

	function blocked(host: Host): boolean {
		return reasonFor(host) != null || undeployed(host);
	}

	function firstHost(): string {
		return eligible.find((host) => !blocked(host))?.id ?? '';
	}

	let hostId = $state(untrack(firstHost));
	let idempotencyKey = $state('');

	$effect(() => {
		onBusy?.(busy);
	});

	$effect(() => {
		const flying = busy;
		const ended = sawFlight;
		const hasNotice = Boolean(result?.message);
		sawFlight = flying;
		if (!browser || !ended || flying) return;
		if (flightFocusTarget(hasNotice) === 'notice' && noticeEl != null) noticeEl.focus();
		else submitEl?.focus();
	});

	$effect(() => {
		if (!browser || !keyed || idempotencyKey !== '') return;
		idempotencyKey = crypto.randomUUID();
	});

	function statusLine(status: ProgramStatus | ImageStatus): string {
		if ('active_state' in status) {
			const pid = status.main_pid == null ? 'pid none' : `pid ${status.main_pid}`;
			const ports = status.ports.length > 0 ? `ports ${status.ports.join(', ')}` : 'ports none';
			return `${status.unit} ${status.active_state} (${status.sub_state}) ${pid} ${ports}`;
		}
		const exit = status.exit_code == null ? 'exit none' : `exit ${status.exit_code}`;
		const ports = status.ports.length > 0 ? `ports ${status.ports.join(', ')}` : 'ports none';
		const digest = shortDigest(status.digest);
		const name = status.container ?? 'unnamed';
		return digest ? `${name} ${status.state} ${exit} restarts ${status.restart_count} ${digest}` : `${name} ${status.state} ${exit} restarts ${status.restart_count} ${ports}`;
	}

	function reasonFor(host: Host): string | null {
		if (entryKind === 'image') return imageHostBlockReason(host);
		return hostBlockReason(host, runAs, shell);
	}
</script>

<form
	method="POST"
	{action}
	class="grid gap-3"
	use:enhance={({ formData, cancel }) => {
		if (blockInFlightSubmit(busy)) {
			cancel();
			return async () => {};
		}
		if (keyed) {
			submitting = true;
			if (idempotencyKey === '') idempotencyKey = crypto.randomUUID();
			formData.set('idempotency_key', idempotencyKey);
		}
		return async ({ result, update }) => {
			try {
				await update({ reset: false });
			} finally {
				if (!keyed) return;
				submitting = false;
				if (!reuseIdempotencyKey(result.type)) idempotencyKey = crypto.randomUUID();
			}
		};
	}}
>
	<Input type="hidden" name="name" value={entryName} />
	{#if entryKind === 'image'}
		<Input type="hidden" name="entry_kind" value="image" />
	{/if}
	{#if keyed}
		<Input type="hidden" name="idempotency_key" value={idempotencyKey} />
	{/if}
	<div class="grid min-w-0 gap-1.5">
		<Label id="{kind}-{entryName}-host">Host</Label>
		<div role="radiogroup" aria-labelledby="{kind}-{entryName}-host" class="grid min-w-0 gap-1">
			{#each eligible as host (host.id)}
				<Button
					type="button"
					role="radio"
					variant={hostId === host.id ? 'secondary' : 'outline'}
					aria-checked={hostId === host.id}
					class="h-auto w-full min-w-0 justify-start text-left whitespace-normal break-all"
					disabled={blocked(host) || busy}
					onclick={() => {
						if (!blocked(host) && !busy) hostId = host.id;
					}}
				>
					{host.name}{undeployed(host) ? ` ${NOT_DEPLOYED_MARK}` : ''}
				</Button>
			{/each}
		</div>
		<Input type="hidden" name="host_id" value={hostId} />
		{#each eligible as host (host.id)}
			{@const reason = reasonFor(host)}
			{#if reason}
				<p class="text-muted-foreground text-sm">{host.name}: {reason}</p>
			{/if}
		{/each}
	</div>
	{#if result?.message === APPROVAL_WAIT}
		<div bind:this={noticeEl} tabindex="-1" class="max-w-full min-w-0 focus-visible:ring-3 focus-visible:ring-ring break-words">
			<Notice kind="info">{result.message}</Notice>
		</div>
	{:else if result?.message}
		<div bind:this={noticeEl} tabindex="-1" class="max-w-full min-w-0 focus-visible:ring-3 focus-visible:ring-ring break-words">
			<Notice kind="error">{result.message}</Notice>
		</div>
	{/if}
	{#if result?.status && !('active_state' in result.status) && result.status.state === 'unknown'}
		<p role="status" class="flex flex-wrap items-center gap-2 break-all">
			{result.status.container ?? 'unnamed'}
			<StatusBadge status="unknown" />
		</p>
	{:else if result?.status}
		<p role="status" class="break-all">{statusLine(result.status)}</p>
	{/if}
	{#if result?.logs}
		{#if result.logs.lines.length === 0}
			<p class="text-muted-foreground text-sm">No log lines.</p>
		{:else}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<pre tabindex="0" aria-label="Log lines" class="bg-muted max-h-64 overflow-auto font-mono whitespace-pre-wrap">{result.logs.lines.join('\n')}</pre>
		{/if}
		{#if result.logs.truncated}
			<p class="text-muted-foreground text-sm">Older lines were left out.</p>
		{/if}
	{/if}
	<div class="flex flex-wrap items-center gap-2">
		<Button
			type="submit"
			bind:ref={submitEl}
			aria-disabled={busy ? 'true' : undefined}
			aria-busy={busy ? 'true' : undefined}
			onclick={(event) => {
				if (blockInFlightSubmit(busy)) event.preventDefault();
			}}
		>
			{#if busy && flight}
				<Loader2 class="size-4 motion-safe:animate-spin" />
				{flightLabel(flight)}
			{:else}
				{label}
			{/if}
		</Button>
		{#if cancel}
			{@render cancel()}
		{/if}
	</div>
	{#if busy}
		<FlightStatus />
	{/if}
</form>
