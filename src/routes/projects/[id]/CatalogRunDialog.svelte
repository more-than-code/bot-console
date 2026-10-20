<script lang="ts">
	import Activity from '@lucide/svelte/icons/activity';
	import Play from '@lucide/svelte/icons/play';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import ScrollText from '@lucide/svelte/icons/scroll-text';
	import Square from '@lucide/svelte/icons/square';
	import { browser } from '$app/environment';
	import { untrack } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import RowAction from '$lib/components/RowAction.svelte';
	import type { Host } from '$lib/api-types';
	import { flightFocusReturn } from '$lib/catalog-flight';
	import type { CatalogRunKind, CatalogRunState } from '$lib/project-action';
	import CatalogRunForm from './CatalogRunForm.svelte';

	const ICONS = { run: Play, stop: Square, restart: RotateCw, logs: ScrollText, status: Activity } as const;
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
		tip,
		disabled = false,
		deployedHostIds = null,
		onRowBusy
	}: {
		kind: CatalogRunKind;
		entryName: string;
		runAs: string;
		shell: boolean;
		hosts: Host[];
		action: string;
		result?: CatalogRunState | null;
		entryKind?: 'program' | 'image';
		/** Extra hover sentence. Omit it to keep the tooltip as the action and the name. */
		tip?: string;
		disabled?: boolean;
		/** Hosts that already have this image. Null skips the not-deployed check. */
		deployedHostIds?: string[] | null;
		onRowBusy?: (busy: boolean) => void;
	} = $props();

	const Icon = $derived(ICONS[kind]);
	const label = $derived(LABELS[kind]);

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
	<RowAction label="{label} {entryName}" {tip} icon={Icon} {disabled}>
		{#snippet trigger(props)}
			<Dialog.Trigger {...props}>
				<Icon class="size-4" />
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
			<Dialog.Title class="break-all">{label} {entryName}</Dialog.Title>
			<Dialog.Description>Choose a host in this project, or a host shared with it at deploy.</Dialog.Description>
		</Dialog.Header>
		<div class="max-h-[calc(100dvh-2rem)] overflow-y-auto">
			<CatalogRunForm {kind} {entryName} {runAs} {shell} {hosts} {action} {result} {entryKind} {deployedHostIds} {onBusy}>
				{#snippet cancel()}
					<Dialog.Close type="button" disabled={flight}>Cancel</Dialog.Close>
				{/snippet}
			</CatalogRunForm>
		</div>
	</Dialog.Content>
</Dialog.Root>
