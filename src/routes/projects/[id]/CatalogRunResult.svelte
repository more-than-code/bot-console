<script lang="ts">
	import { browser } from '$app/environment';
	import type { Snippet } from 'svelte';
	import Notice from '$lib/components/Notice.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import type { ImageStatus, ProgramStatus } from '$lib/api-types';
	import { APPROVAL_WAIT } from '$lib/catalog';
	import { shortDigest } from '$lib/image-spec';
	import type { CatalogRunState } from '$lib/project-action';

	let {
		result,
		close
	}: {
		result: CatalogRunState;
		/** The only control: a Close button. There is no submit in a result. */
		close: Snippet;
	} = $props();

	let focusEl = $state<HTMLElement | null>(null);
	let closeWrap = $state<HTMLDivElement | null>(null);

	// Focus the outcome (notice or status line), else Close, once the result shows.
	$effect(() => {
		if (!browser) return;
		const target = focusEl ?? closeWrap?.querySelector('button') ?? null;
		target?.focus();
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
</script>

<div class="grid gap-3">
	{#if result.message}
		<div bind:this={focusEl} tabindex="-1" class="max-w-full min-w-0 focus-visible:ring-3 focus-visible:ring-ring break-words">
			<Notice kind={result.message === APPROVAL_WAIT ? 'info' : 'error'}>{result.message}</Notice>
		</div>
	{/if}
	{#if result.status && !('active_state' in result.status) && result.status.state === 'unknown'}
		<p role="status" tabindex="-1" class="flex flex-wrap items-center gap-2 break-all" bind:this={focusEl}>
			{result.status.container ?? 'unnamed'}
			<StatusBadge status="unknown" />
		</p>
	{:else if result.status}
		<p role="status" tabindex="-1" class="break-all" bind:this={focusEl}>{statusLine(result.status)}</p>
	{/if}
	{#if result.logs}
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
	<div class="flex flex-wrap items-center gap-2" bind:this={closeWrap}>
		{@render close()}
	</div>
</div>
