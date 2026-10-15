<script lang="ts">
	import { browser } from '$app/environment';
	import { enhance } from '$app/forms';
	import { untrack, type Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import Notice from '$lib/components/Notice.svelte';
	import type { Host, ProgramStatus } from '$lib/api-types';
	import { APPROVAL_WAIT, hostBlockReason, isCatalogHost, reuseIdempotencyKey } from '$lib/catalog';
	import type { CatalogRunKind, CatalogRunState } from '$lib/project-action';

	const LABELS = { run: 'Run', stop: 'Stop', restart: 'Restart', logs: 'Logs' } as const;

	let {
		kind,
		entryName,
		runAs,
		shell,
		hosts,
		action,
		result = null,
		cancel
	}: {
		kind: CatalogRunKind;
		entryName: string;
		runAs: string;
		shell: boolean;
		hosts: Host[];
		action: string;
		result?: CatalogRunState | null;
		cancel?: Snippet;
	} = $props();

	const label = $derived(LABELS[kind]);
	const eligible = $derived(hosts.filter((host) => isCatalogHost(host)));

	function firstHost(): string {
		return eligible.find((host) => hostBlockReason(host, runAs, shell) == null)?.id ?? '';
	}

	let hostId = $state(untrack(firstHost));
	let idempotencyKey = $state('');
	let submitting = $state(false);

	$effect(() => {
		if (!browser || kind === 'logs' || idempotencyKey !== '') return;
		idempotencyKey = crypto.randomUUID();
	});

	function statusLine(status: ProgramStatus): string {
		const pid = status.main_pid == null ? 'pid none' : `pid ${status.main_pid}`;
		const ports = status.ports.length > 0 ? `ports ${status.ports.join(', ')}` : 'ports none';
		return `${status.unit} ${status.active_state} (${status.sub_state}) ${pid} ${ports}`;
	}

	function reasonFor(host: Host): string | null {
		return hostBlockReason(host, runAs, shell);
	}
</script>

<form
	method="POST"
	{action}
	class="grid gap-3"
	use:enhance={({ formData, cancel }) => {
		if (kind !== 'logs') {
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
				if (kind === 'logs') return;
				submitting = false;
				if (!reuseIdempotencyKey(result.type)) idempotencyKey = crypto.randomUUID();
			}
		};
	}}
>
	<Input type="hidden" name="name" value={entryName} />
	{#if kind !== 'logs'}
		<Input type="hidden" name="idempotency_key" value={idempotencyKey} />
	{/if}
	<div class="grid gap-1.5">
		<Label for="{kind}-{entryName}-host">Host</Label>
		<Select.Root type="single" name="host_id" bind:value={hostId}>
			<Select.Trigger id="{kind}-{entryName}-host" class="w-full">
				<Select.Value placeholder="Choose a host" />
			</Select.Trigger>
			<Select.Content>
				{#each eligible as host (host.id)}
					{@const reason = reasonFor(host)}
					<Select.Item value={host.id} disabled={reason != null} label={host.name}>
						{host.name}
					</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		{#each eligible as host (host.id)}
			{@const reason = reasonFor(host)}
			{#if reason}
				<p class="text-muted-foreground text-sm">{host.name}: {reason}</p>
			{/if}
		{/each}
	</div>
	{#if result?.message === APPROVAL_WAIT}
		<Notice kind="info">{result.message}</Notice>
	{:else if result?.message}
		<Notice kind="error">{result.message}</Notice>
	{/if}
	{#if result?.status}
		<p role="status">{statusLine(result.status)}</p>
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
		<Button type="submit" disabled={kind !== 'logs' && submitting}>{label}</Button>
		{#if cancel}
			{@render cancel()}
		{/if}
	</div>
</form>
