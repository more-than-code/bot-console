<script lang="ts">
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import { untrack } from 'svelte';
	import { buttonVariants } from '$lib/components/ui/button';
	import * as Sheet from '$lib/components/ui/sheet';
	import RowAction from '$lib/components/RowAction.svelte';
	import type { Host, ProgramEntry } from '$lib/api-types';
	import type { CatalogEditorState } from '$lib/project-action';
	import CatalogEntryForm from './CatalogEntryForm.svelte';

	let {
		mode,
		entry = null,
		hosts,
		saveAction,
		parseAction,
		revealed = false,
		editor = null,
		disabled = false
	}: {
		mode: 'create' | 'edit';
		entry?: ProgramEntry | null;
		hosts: Host[];
		saveAction: string;
		parseAction: string;
		revealed?: boolean;
		editor?: CatalogEditorState | null;
		disabled?: boolean;
	} = $props();

	let open = $state(untrack(() => revealed));
	let sawReveal = $state(untrack(() => revealed));

	$effect(() => {
		if (revealed && !untrack(() => sawReveal)) open = true;
		sawReveal = revealed;
	});
</script>

<Sheet.Root bind:open>
	{#if mode === 'create'}
		<Sheet.Trigger class={buttonVariants()}>
			<Plus class="size-4" />
			New service
		</Sheet.Trigger>
	{:else if entry}
		<RowAction label="Edit {entry.name}" icon={Pencil} {disabled}>
			{#snippet trigger(props)}
				<Sheet.Trigger {...props}>
					<Pencil class="size-4" />
				</Sheet.Trigger>
			{/snippet}
		</RowAction>
	{/if}
	<!-- A drawer from the right, full width on a phone. The form scrolls between the header and its pinned Save footer. -->
	<Sheet.Content side="right" class="data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
		<Sheet.Header class="pr-12 pb-0">
			<Sheet.Title class="break-all">{mode === 'create' ? 'New service' : `Edit ${entry?.name ?? 'service'}`}</Sheet.Title>
			<Sheet.Description>A program runs one command in a working directory.</Sheet.Description>
		</Sheet.Header>
		<CatalogEntryForm {mode} {entry} {hosts} {saveAction} {parseAction} {editor}>
			{#snippet cancel()}
				<Sheet.Close type="button" class={buttonVariants({ variant: 'outline' })}>Cancel</Sheet.Close>
			{/snippet}
		</CatalogEntryForm>
	</Sheet.Content>
</Sheet.Root>
