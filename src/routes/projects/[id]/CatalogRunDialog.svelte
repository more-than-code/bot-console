<script lang="ts">
	import Play from '@lucide/svelte/icons/play';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import ScrollText from '@lucide/svelte/icons/scroll-text';
	import Square from '@lucide/svelte/icons/square';
	import { untrack } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import RowAction from '$lib/components/RowAction.svelte';
	import type { Host } from '$lib/api-types';
	import type { CatalogRunKind, CatalogRunState } from '$lib/project-action';
	import CatalogRunForm from './CatalogRunForm.svelte';

	const ICONS = { run: Play, stop: Square, restart: RotateCw, logs: ScrollText } as const;
	const LABELS = { run: 'Run', stop: 'Stop', restart: 'Restart', logs: 'Logs' } as const;

	let {
		kind,
		entryName,
		runAs,
		shell,
		hosts,
		action,
		result = null
	}: {
		kind: CatalogRunKind;
		entryName: string;
		runAs: string;
		shell: boolean;
		hosts: Host[];
		action: string;
		result?: CatalogRunState | null;
	} = $props();

	const Icon = $derived(ICONS[kind]);
	const label = $derived(LABELS[kind]);

	let open = $state(untrack(() => result != null));
	let seen = $state<string | null>(untrack(() => result?.resultId ?? null));

	$effect(() => {
		const id = result?.resultId ?? null;
		if (id != null && id !== untrack(() => seen)) open = true;
		seen = id;
	});
</script>

<Dialog.Root bind:open>
	<RowAction label="{label} {entryName}" icon={Icon}>
		{#snippet trigger(props)}
			<Dialog.Trigger {...props}>
				<Icon class="size-4" />
			</Dialog.Trigger>
		{/snippet}
	</RowAction>
	<Dialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
		<Dialog.Header>
			<Dialog.Title>{label} {entryName}</Dialog.Title>
			<Dialog.Description>Choose a host in this project, or a host shared with it at deploy.</Dialog.Description>
		</Dialog.Header>
		<CatalogRunForm {kind} {entryName} {runAs} {shell} {hosts} {action} {result}>
			{#snippet cancel()}
				<Dialog.Close type="button">Cancel</Dialog.Close>
			{/snippet}
		</CatalogRunForm>
	</Dialog.Content>
</Dialog.Root>
