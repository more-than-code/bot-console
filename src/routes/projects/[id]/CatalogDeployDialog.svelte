<script lang="ts">
	import Rocket from '@lucide/svelte/icons/rocket';
	import { browser } from '$app/environment';
	import { untrack } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog';
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
		projectId = null
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
		/** For the "View logs in Services" link. */
		projectId?: string | null;
	} = $props();

	let open = $state(untrack(() => result != null));
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

<Dialog.Root bind:open>
	<RowAction label="Deploy {entry.name}" tip={IMAGE_DEPLOY_TIP} icon={Rocket} {disabled}>
		{#snippet trigger(props)}
			<Dialog.Trigger {...props}>
				<Rocket class="size-4" />
			</Dialog.Trigger>
		{/snippet}
	</RowAction>
	<Dialog.Content
		bind:ref={contentEl}
		tabindex={flight ? -1 : undefined}
		class="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-xl"
		showCloseButton={!flight}
		escapeKeydownBehavior={flight ? 'ignore' : 'close'}
		interactOutsideBehavior={flight ? 'ignore' : 'close'}
	>
		<Dialog.Header class="shrink-0 pr-8">
			<Dialog.Title class="break-all">{entry.spec.kind === 'job' ? 'Run' : 'Deploy'} {entry.name}</Dialog.Title>
			<Dialog.Description>Choose a host in this project, or a host shared with it at deploy.</Dialog.Description>
		</Dialog.Header>
		<div class="min-h-0 overflow-y-auto">
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
					<Dialog.Close type="button" disabled={flight}>Cancel</Dialog.Close>
				{/snippet}
			</CatalogDeployForm>
		</div>
	</Dialog.Content>
</Dialog.Root>
