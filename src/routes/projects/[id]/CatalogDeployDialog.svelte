<script lang="ts">
	import Rocket from '@lucide/svelte/icons/rocket';
	import { browser } from '$app/environment';
	import { untrack } from 'svelte';
	import { focusFallbackAfterClose } from '$lib/dialog-open';
	import { buttonVariants } from '$lib/components/ui/button';
	import * as Sheet from '$lib/components/ui/sheet';
	import DrawerResize from '$lib/components/DrawerResize.svelte';
	import RowAction from '$lib/components/RowAction.svelte';
	import type { Host, ImageEntry } from '$lib/api-types';
	import { IMAGE_DEPLOY_TIP } from '$lib/catalog';
	import { flightFocusReturn } from '$lib/catalog-flight';
	import type { ImageDeployState } from '$lib/project-action';
	import CatalogDeployForm from './CatalogDeployForm.svelte';

	let {
		entry,
		hosts,
		deployAction,
		rollbackAction,
		removeAction,
		confirmAction,
		historyAction,
		result = null,
		disabled = false,
		onRowBusy,
		projectId = null,
		openRequest = 0,
		fallbackFocusId = null
	}: {
		entry: ImageEntry;
		hosts: Host[];
		deployAction: string;
		rollbackAction: string;
		removeAction: string;
		confirmAction: string;
		historyAction: string;
		result?: ImageDeployState | null;
		disabled?: boolean;
		onRowBusy?: (busy: boolean) => void;
		/** For the "View logs" link. */
		projectId?: string | null;
		/** A new value (a counter) opens it: the row's "⋯" menu asks for it (below `sm`, where its icon is hidden). */
		openRequest?: number;
		/** Where focus goes when it closes and its own trigger is hidden (the menu button). */
		fallbackFocusId?: string | null;
	} = $props();

	let open = $state(untrack(() => result != null));
	// The row's "⋯" menu opens this by changing `openRequest`; closing returns focus to that menu button.
	let requestSeen = untrack(() => openRequest);
	$effect(() => {
		const request = openRequest;
		if (request === requestSeen) return;
		requestSeen = request;
		untrack(() => (open = true));
	});
	let openBefore = untrack(() => open);
	$effect(() => {
		const now = open;
		if (openBefore && !now) focusFallbackAfterClose(untrack(() => fallbackFocusId));
		openBefore = now;
	});
	let seen = $state<string | null>(untrack(() => result?.resultId ?? null));
	let flight = $state(false);
	let contentEl = $state<HTMLDivElement | null>(null);

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
		if (id != null && id !== untrack(() => seen)) open = true;
		seen = id;
	});
</script>

<Sheet.Root bind:open>
	<RowAction label="Deploy {entry.name}" tip={IMAGE_DEPLOY_TIP} icon={Rocket} {disabled}>
		{#snippet trigger(props)}
			<Sheet.Trigger {...props}>
				<Rocket class="size-4" />
			</Sheet.Trigger>
		{/snippet}
	</RowAction>
	<!-- A drawer from the right, full width on a phone. The log grows into the free height; Deploy and Cancel stay pinned at the bottom. -->
	<Sheet.Content
		bind:ref={contentEl}
		side="right"
		tabindex={flight ? -1 : undefined}
		class="data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
		showCloseButton={!flight}
		escapeKeydownBehavior={flight ? 'ignore' : 'close'}
		interactOutsideBehavior={flight ? 'ignore' : 'close'}
	>
		{#snippet after()}<DrawerResize type="deploy" />{/snippet}
		<Sheet.Header class="pr-12 pb-0">
			<Sheet.Title class="break-all">{entry.spec.kind === 'job' ? 'Run' : 'Deploy'} {entry.name}</Sheet.Title>
			<Sheet.Description>Choose a host in this project, or a host shared with it at deploy.</Sheet.Description>
		</Sheet.Header>
		<CatalogDeployForm
			{entry}
			{hosts}
			{deployAction}
			{rollbackAction}
			{removeAction}
			{confirmAction}
			{historyAction}
			{result}
			active={open}
			{onBusy}
			{projectId}
			onViewLogs={() => (open = false)}
		>
			{#snippet cancel()}
				<Sheet.Close type="button" class={buttonVariants({ variant: 'outline' })} disabled={flight}>Cancel</Sheet.Close>
			{/snippet}
		</CatalogDeployForm>
	</Sheet.Content>
</Sheet.Root>
