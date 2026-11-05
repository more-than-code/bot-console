<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import { IMAGE_RUN_TIP } from '$lib/catalog';
	import type { CatalogRunKind, CatalogRunState } from '$lib/project-action';
	import { RUN_FORM_ACTION } from '$lib/run-actions';
	import { CHECKING_NOTE, type ServiceControls } from '$lib/service-actions';
	import { actionUrlFrom } from '$lib/url';
	import CatalogRunDialog from './CatalogRunDialog.svelte';
	import LogsDrawer from './LogsDrawer.svelte';

	let {
		controls,
		hostId,
		hostName,
		serviceId = null,
		runResult = null,
		startOnly = false,
		logsOpen = false,
		extra,
		class: className = '',
		stateRequest = 0,
		restartRequest = 0,
		logsRequest = 0,
		fallbackFocusId = null
	}: {
		/** Null: no state buttons (no grant). 'checking': the copy's state is still being read. */
		controls: ServiceControls | 'checking' | null;
		hostId: string;
		hostName: string;
		/** The copy's service row. Null for a not-running item, which has no row yet. */
		serviceId?: string | null;
		/** The last start, stop, or restart result on this page. Shown only on its own row. Logs open in a drawer. */
		runResult?: CatalogRunState | null;
		/** A program that never ran: Start only, since there are no logs yet. */
		startOnly?: boolean;
		/** Open the Logs drawer (see `LogsDrawer` `initialOpen`). */
		logsOpen?: boolean;
		/** More row icons (Rename, Health checks) in the same group, so one element lays them all out. */
		extra?: Snippet;
		/** Layout of the group; it replaces the default one-line flex (copy rows pass the entry row's grid). */
		class?: string;
		/** Counters the row's "⋯" menu changes to open Start/Stop, Restart or Logs below `sm`, where the icons are hidden. */
		stateRequest?: number;
		restartRequest?: number;
		logsRequest?: number;
		/** The menu button, where focus returns when a dialog opened from the menu closes. */
		fallbackFocusId?: string | null;
	} = $props();

	let busy = $state(false);

	const live = $derived(controls != null && controls !== 'checking' ? controls : null);

	/** The restart-count line goes on Stop when there is one, else on Logs. */
	const logsTip = $derived(live == null || live.stateAction === 'stop' ? undefined : (live.crashNote ?? undefined));

	function mine(state: CatalogRunState): boolean {
		if (live == null || state.name !== live.entry || state.hostId !== hostId) return false;
		return state.serviceId === serviceId;
	}

	function resultFor(kinds: readonly CatalogRunKind[]): CatalogRunState | null {
		if (runResult == null || !mine(runResult) || !kinds.includes(runResult.kind)) return null;
		return runResult;
	}

	function stateTip(state: ServiceControls): string | undefined {
		if (state.stateAction === 'stop') return state.crashNote ?? undefined;
		if (state.stateAction === 'run' && state.entryKind === 'image') return IMAGE_RUN_TIP;
		return undefined;
	}

	function onRowBusy(next: boolean) {
		busy = next;
	}
</script>

<!-- Fixed slots so icons line up down the column: [Start/Stop] [Restart] [Logs] then `extra` (the ⋯ menu).
     A slot whose action does not apply stays empty. Below `sm` the slots hide and only the ⋯ menu shows.
     Icons only; reasons and restart counts are tooltips, never cell text. While a start, stop or restart
     runs, the whole group (extra too) is disabled. -->
<fieldset disabled={busy} class={className || 'm-0 flex flex-nowrap items-center gap-0.5 border-0 p-0 whitespace-nowrap'}>
	{#if controls === 'checking'}
		<span class="text-muted-foreground col-span-3 text-sm whitespace-nowrap max-sm:hidden" data-row-checking>{CHECKING_NOTE}</span>
	{:else}
		<span class="max-sm:hidden" data-slot-state>
			{#if live && (live.stateAction || live.blockedReason)}
				<!-- One control for Start and Stop, so its node and a shown result survive a state flip. -->
				<CatalogRunDialog
					kind={live.stateAction ?? 'run'}
					entryName={live.entry}
					{hostId}
					{hostName}
					{serviceId}
					action={actionUrlFrom(page.url, RUN_FORM_ACTION[live.stateAction ?? 'run'])}
					result={resultFor(['run', 'stop'])}
					entryKind={live.entryKind}
					tip={stateTip(live)}
					blockedReason={live.stateAction ? null : live.blockedReason}
					{onRowBusy}
					openRequest={stateRequest}
					{fallbackFocusId}
				/>
			{:else}
				<span class="block size-7" aria-hidden="true" data-empty-slot></span>
			{/if}
		</span>
		<span class="max-sm:hidden" data-slot-restart>
			{#if live && !startOnly && live.restart}
				<CatalogRunDialog
					kind="restart"
					entryName={live.entry}
					{hostId}
					{hostName}
					{serviceId}
					action={actionUrlFrom(page.url, RUN_FORM_ACTION.restart)}
					result={resultFor(['restart'])}
					entryKind={live.entryKind}
					{onRowBusy}
					openRequest={restartRequest}
					{fallbackFocusId}
				/>
			{:else}
				<span class="block size-7" aria-hidden="true" data-empty-slot></span>
			{/if}
		</span>
		<span class="max-sm:hidden" data-slot-logs>
			{#if live && !startOnly && live.logs}
				<!-- Logs open a drawer at once: read-only, so there is no confirm step. -->
				<LogsDrawer
					entryName={live.entry}
					entryKind={live.entryKind}
					{hostId}
					{hostName}
					action={actionUrlFrom(page.url, RUN_FORM_ACTION.logs)}
					tip={logsTip}
					initialOpen={logsOpen}
					openRequest={logsRequest}
					{fallbackFocusId}
				/>
			{:else}
				<span class="block size-7" aria-hidden="true" data-empty-slot></span>
			{/if}
		</span>
	{/if}
	{#if extra}{@render extra()}{/if}
</fieldset>
