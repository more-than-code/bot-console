<script lang="ts">
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import { untrack } from 'svelte';
	import { buttonVariants } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
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

<Dialog.Root bind:open>
	{#if mode === 'create'}
		<Dialog.Trigger class={buttonVariants()}>
			<Plus class="size-4" />
			New service
		</Dialog.Trigger>
	{:else if entry}
		<RowAction label="Edit {entry.name}" icon={Pencil} {disabled}>
			{#snippet trigger(props)}
				<Dialog.Trigger {...props}>
					<Pencil class="size-4" />
				</Dialog.Trigger>
			{/snippet}
		</RowAction>
	{/if}
	<Dialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
		<Dialog.Header>
			<Dialog.Title>{mode === 'create' ? 'New service' : `Edit ${entry?.name ?? 'service'}`}</Dialog.Title>
			<Dialog.Description>A program runs one command in a working directory.</Dialog.Description>
		</Dialog.Header>
		<CatalogEntryForm {mode} {entry} {hosts} {saveAction} {parseAction} {editor}>
			{#snippet cancel()}
				<Dialog.Close type="button">Cancel</Dialog.Close>
			{/snippet}
		</CatalogEntryForm>
	</Dialog.Content>
</Dialog.Root>
