<script lang="ts">
	import { browser } from '$app/environment';
	import { untrack } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import RowAction from '$lib/components/RowAction.svelte';
	import { flightFocusReturn } from '$lib/catalog-flight';
	import type { CatalogRunKind, CatalogRunState } from '$lib/project-action';
	import { RUN_ICON, RUN_LABEL, runResultTitle } from '$lib/run-actions';
	import CatalogRunForm from './CatalogRunForm.svelte';
	import CatalogRunResult from './CatalogRunResult.svelte';

	let {
		kind,
		entryName,
		hostId,
		hostName,
		serviceId = null,
		action,
		result = null,
		entryKind = 'program',
		tip,
		blockedReason = null,
		onRowBusy
	}: {
		/** What the trigger and a new form do now. A shown result keeps the kind that ran. Logs use `LogsDrawer`. */
		kind: Exclude<CatalogRunKind, 'logs'>;
		entryName: string;
		/** The Services row's host. */
		hostId: string;
		hostName: string;
		serviceId?: string | null;
		action: string;
		/** The latest result for this control, already matched to its row. */
		result?: CatalogRunState | null;
		entryKind?: 'program' | 'image';
		/** Extra hover sentence. Omit it to keep the tooltip as the action and the name. */
		tip?: string;
		/** The trigger stays focusable but does nothing, and says why. */
		blockedReason?: string | null;
		onRowBusy?: (busy: boolean) => void;
	} = $props();

	const Icon = $derived(RUN_ICON[kind]);
	const label = $derived(RUN_LABEL[kind]);

	let open = $state(untrack(() => result != null));
	let seen = $state<string | null>(untrack(() => result?.resultId ?? null));
	/** The result on view. Null shows the form. */
	let shown = $state<CatalogRunState | null>(untrack(() => result));
	let flight = $state(false);
	let contentEl = $state<HTMLDivElement | null>(null);
	let slotEl = $state<HTMLSpanElement | null>(null);

	function onBusy(busy: boolean) {
		flight = busy;
		onRowBusy?.(busy);
	}

	// While a flight runs, a focus move onto the page is pulled back. The submit stays focusable.
	$effect(() => {
		const current = contentEl;
		if (!browser || !flight || current == null) return;
		const node: HTMLDivElement = current;
		function onFocusOut(event: FocusEvent) {
			const next = event.relatedTarget;
			if (next instanceof Node && node.contains(next)) return;
			flightFocusReturn(node);
		}
		node.addEventListener('focusout', onFocusOut);
		return () => node.removeEventListener('focusout', onFocusOut);
	});

	$effect(() => {
		const id = result?.resultId ?? null;
		if (id != null && id !== untrack(() => seen)) {
			shown = result;
			open = true;
		}
		seen = id;
	});

	/** Opening from the trigger starts a fresh form; a result opens the dialog on its own. */
	function onOpenChange(next: boolean) {
		if (next) shown = null;
	}

	/** Back to this row's control, whatever it now shows. */
	function returnFocus(event: Event) {
		event.preventDefault();
		slotEl?.querySelector('button')?.focus();
	}
</script>

<Dialog.Root bind:open {onOpenChange}>
	<span bind:this={slotEl} class="inline-flex" data-run-slot={kind}>
		{#if blockedReason}
			<RowAction label="{label} {entryName} on {hostName}" icon={Icon} {blockedReason} />
		{:else}
			<RowAction label="{label} {entryName} on {hostName}" {tip} icon={Icon}>
				{#snippet trigger(props)}
					<Dialog.Trigger {...props}>
						<Icon class="size-4" />
					</Dialog.Trigger>
				{/snippet}
			</RowAction>
		{/if}
	</span>
	<Dialog.Content
		bind:ref={contentEl}
		tabindex={flight ? -1 : undefined}
		class="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-xl"
		showCloseButton={!flight}
		escapeKeydownBehavior={flight ? 'ignore' : 'close'}
		interactOutsideBehavior={flight ? 'ignore' : 'close'}
		onOpenAutoFocus={(event) => {
			if (shown) event.preventDefault();
		}}
		onCloseAutoFocus={returnFocus}
	>
		<Dialog.Header class="shrink-0 pr-8">
			<Dialog.Title class="break-all">{shown ? runResultTitle(shown, entryName) : `${label} ${entryName}`}</Dialog.Title>
			<Dialog.Description class="break-all">On {hostName}.</Dialog.Description>
		</Dialog.Header>
		<div class="max-h-[calc(100dvh-2rem)] overflow-y-auto">
			{#if shown}
				<CatalogRunResult result={shown}>
					{#snippet close()}
						<Dialog.Close type="button">Close</Dialog.Close>
					{/snippet}
				</CatalogRunResult>
			{:else}
				<CatalogRunForm {kind} {entryName} {hostId} {serviceId} {action} {entryKind} {onBusy}>
					{#snippet cancel()}
						<Dialog.Close type="button" disabled={flight}>Cancel</Dialog.Close>
					{/snippet}
				</CatalogRunForm>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
