<script lang="ts">
	import { browser } from '$app/environment';
	import { enhance } from '$app/forms';
	import { untrack, type Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import Notice from '$lib/components/Notice.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import type { Host, ImageStatus, ProgramStatus } from '$lib/api-types';
	import { APPROVAL_WAIT, hostBlockReason, imageHostBlockReason, isCatalogHost, reuseIdempotencyKey } from '$lib/catalog';
	import { shortDigest } from '$lib/image-spec';
	import type { CatalogRunKind, CatalogRunState } from '$lib/project-action';

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
		cancel?: Snippet;
	} = $props();

	const label = $derived(LABELS[kind]);
	const keyed = $derived(kind !== 'logs' && kind !== 'status');
	const eligible = $derived(hosts.filter((host) => isCatalogHost(host)));

	function firstHost(): string {
		return eligible.find((host) => reasonFor(host) == null)?.id ?? '';
	}

	let hostId = $state(untrack(firstHost));
	const hostLabel = $derived(eligible.find((host) => host.id === hostId)?.name ?? hostId);
	let idempotencyKey = $state('');
	let submitting = $state(false);

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
		if (keyed) {
			if (submitting) {
				cancel();
				return async () => {};
			}
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
				{@const reason = reasonFor(host)}
				<Button
					type="button"
					role="radio"
					variant={hostId === host.id ? 'secondary' : 'outline'}
					aria-checked={hostId === host.id}
					class="h-auto w-full min-w-0 justify-start text-left whitespace-normal break-all"
					disabled={reason != null}
					onclick={() => {
						if (reason == null) hostId = host.id;
					}}>{host.name}</Button>
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
		<div class="max-w-full min-w-0 break-words">
			<Notice kind="info">{result.message}</Notice>
		</div>
	{:else if result?.message}
		<div class="max-w-full min-w-0 break-words">
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
		<Button type="submit" disabled={keyed && submitting}>{label}</Button>
		{#if cancel}
			{@render cancel()}
		{/if}
	</div>
</form>
