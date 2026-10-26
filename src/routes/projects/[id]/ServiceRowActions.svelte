<script lang="ts">
	import { page } from '$app/state';
	import { IMAGE_RUN_TIP } from '$lib/catalog';
	import type { CatalogRunKind, CatalogRunState } from '$lib/project-action';
	import { RUN_FORM_ACTION } from '$lib/run-actions';
	import type { ServiceControls } from '$lib/service-actions';
	import { actionUrlFrom } from '$lib/url';
	import CatalogRunDialog from './CatalogRunDialog.svelte';

	let {
		controls,
		hostId,
		hostName,
		serviceId = null,
		runResult = null,
		startOnly = false
	}: {
		controls: ServiceControls;
		hostId: string;
		hostName: string;
		/** The Services row. Null for a not-running item, which has no row yet. */
		serviceId?: string | null;
		/** The last start, stop, restart, or logs result on this page. Shown only on its own row. */
		runResult?: CatalogRunState | null;
		/** A program that never ran: Start only, since there are no logs yet. */
		startOnly?: boolean;
	} = $props();

	let busy = $state(false);

	const others = $derived(
		startOnly
			? []
			: [...(controls.restart ? (['restart'] as const) : []), ...(controls.logs ? (['logs'] as const) : [])]
	);
	/** The restart-count line goes on Stop when there is one, else on Logs. */
	const logsTip = $derived(controls.stateAction === 'stop' ? undefined : (controls.crashNote ?? undefined));

	function mine(state: CatalogRunState): boolean {
		if (state.name !== controls.entry || state.hostId !== hostId) return false;
		return state.serviceId === serviceId;
	}

	function resultFor(kinds: readonly CatalogRunKind[]): CatalogRunState | null {
		if (runResult == null || !mine(runResult) || !kinds.includes(runResult.kind)) return null;
		return runResult;
	}

	function stateTip(): string | undefined {
		if (controls.stateAction === 'stop') return controls.crashNote ?? undefined;
		if (controls.stateAction === 'run' && controls.entryKind === 'image') return IMAGE_RUN_TIP;
		return undefined;
	}

	function onRowBusy(next: boolean) {
		busy = next;
	}
</script>

<!-- Icons only, on one line. Reasons and restart counts are tooltips, never cell text. Status is the badge's tooltip. -->
<fieldset disabled={busy} class="m-0 flex flex-nowrap items-center gap-0.5 border-0 p-0 whitespace-nowrap">
	{#if controls.stateAction || controls.blockedReason}
		<!-- One control for Start and Stop, so its node and a shown result survive a state flip. -->
		<CatalogRunDialog
			kind={controls.stateAction ?? 'run'}
			entryName={controls.entry}
			{hostId}
			{hostName}
			{serviceId}
			action={actionUrlFrom(page.url, RUN_FORM_ACTION[controls.stateAction ?? 'run'])}
			result={resultFor(['run', 'stop'])}
			entryKind={controls.entryKind}
			tip={stateTip()}
			blockedReason={controls.stateAction ? null : controls.blockedReason}
			{onRowBusy}
		/>
	{/if}
	{#each others as kind (kind)}
		<CatalogRunDialog
			{kind}
			entryName={controls.entry}
			{hostId}
			{hostName}
			{serviceId}
			action={actionUrlFrom(page.url, RUN_FORM_ACTION[kind])}
			result={resultFor([kind])}
			entryKind={controls.entryKind}
			tip={kind === 'logs' ? logsTip : undefined}
			{onRowBusy}
		/>
	{/each}
</fieldset>
