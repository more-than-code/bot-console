<script lang="ts">
	import Rocket from '@lucide/svelte/icons/rocket';
	import { untrack } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import RowAction from '$lib/components/RowAction.svelte';
	import type { Host, ImageEntry } from '$lib/api-types';
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
		result = null
	}: {
		entry: ImageEntry;
		hosts: Host[];
		deployAction: string;
		rollbackAction: string;
		removeAction: string;
		confirmAction: string;
		historyAction: string;
		result?: ImageDeployState | null;
	} = $props();

	let open = $state(untrack(() => result != null));
	let seen = $state<string | null>(untrack(() => result?.resultId ?? null));

	$effect(() => {
		const id = result?.resultId ?? null;
		if (id != null && id !== untrack(() => seen)) open = true;
		seen = id;
	});
</script>

<Dialog.Root bind:open>
	<RowAction label="Deploy {entry.name}" icon={Rocket}>
		{#snippet trigger(props)}
			<Dialog.Trigger {...props}>
				<Rocket class="size-4" />
			</Dialog.Trigger>
		{/snippet}
	</RowAction>
	<Dialog.Content class="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-xl">
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
			>
				{#snippet cancel()}
					<Dialog.Close type="button">Cancel</Dialog.Close>
				{/snippet}
			</CatalogDeployForm>
		</div>
	</Dialog.Content>
</Dialog.Root>
