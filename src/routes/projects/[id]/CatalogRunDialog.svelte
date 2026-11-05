<script lang="ts">
	import { browser } from '$app/environment';
	import { untrack } from 'svelte';
	import { focusFallbackAfterClose } from '$lib/dialog-open';
	import * as Dialog from '$lib/components/ui/dialog';
	import RowAction from '$lib/components/RowAction.svelte';
	import { flightFocusReturn } from '$lib/catalog-flight';
	import type { CatalogRunKind, CatalogRunState } from '$lib/project-action';
	import { RUN_ICON, RUN_LABEL, runResultTitle, shownOnOpen } from '$lib/run-actions';
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
		onRowBusy,
		openRequest = 0,
		fallbackFocusId = null
	}: {
		/** What the trigger and a new form do now. A shown result keeps the kind that ran. Logs use `LogsDrawer`. */
		kind: Exclude<CatalogRunKind, 'logs'>;
		entryName: string;
		/** The copy's host. */
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
		/** A new value (a counter) opens it: the row's "⋯" menu asks for it (below `sm`, where its icon is hidden). */
		openRequest?: number;
		/** Where focus goes when it closes and its own trigger is hidden (the menu button). */
		fallbackFocusId?: string | null;
	} = $props();

	const Icon = $derived(RUN_ICON[kind]);
	const label = $derived(RUN_LABEL[kind]);

	let open = $state(untrack(() => result != null));
	// The row's "⋯" menu opens this by changing `openRequest`; closing returns focus to that menu button.
	let requestSeen = untrack(() => openRequest);
	$effect(() => {
		const request = openRequest;
		if (request === requestSeen) return;
		requestSeen = request;
		untrack(() => {
			// From the menu, like the icon: a fresh form, not the last result.
			shown = shownOnOpen('user', shown);
			open = true;
		});
	});
	let openBefore = untrack(() => open);
	$effect(() => {
		const now = open;
		if (openBefore && !now) focusFallbackAfterClose(untrack(() => fallbackFocusId));
		openBefore = now;
	});
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
			shown = shownOnOpen('result', result);
			open = true;
		}
		seen = id;
	});

	/** Opening from the trigger starts a fresh form; a result opens the dialog on its own. */
	function onOpenChange(next: boolean) {
		if (next) shown = shownOnOpen('user', shown);
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
