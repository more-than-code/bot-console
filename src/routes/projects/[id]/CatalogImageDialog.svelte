<script lang="ts">
	import { browser } from '$app/environment';
	import { enhance } from '$app/forms';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import { untrack } from 'svelte';
	import { buttonVariants } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import RowAction from '$lib/components/RowAction.svelte';
	import type { ImageEntry } from '$lib/api-types';
	import type { KnownSet } from '$lib/image-spec';
	import type { ImageEditorState } from '$lib/project-action';
	import CatalogImageForm from './CatalogImageForm.svelte';

	let {
		mode,
		entry = null,
		saveAction,
		setsAction,
		revealed = false,
		editor = null
	}: {
		mode: 'create' | 'edit';
		entry?: ImageEntry | null;
		saveAction: string;
		setsAction: string;
		revealed?: boolean;
		editor?: ImageEditorState | null;
	} = $props();

	let open = $state(untrack(() => revealed));
	let sawReveal = $state(untrack(() => revealed));
	let sets = $state<KnownSet[]>([]);
	let setsMessage = $state<string | null>(null);
	let setsStatus = $state<'loading' | 'ready' | 'error'>('loading');
	let fetched = $state(false);
	let setsForm = $state<HTMLFormElement | null>(null);

	$effect(() => {
		if (revealed && !untrack(() => sawReveal)) open = true;
		sawReveal = revealed;
	});

	// Names and key names only. This post does not replace the page form, so a later save keeps the list.
	$effect(() => {
		if (!open) {
			fetched = false;
			setsStatus = 'loading';
			setsMessage = null;
			sets = [];
			return;
		}
		if (!browser || fetched || setsForm == null) return;
		fetched = true;
		setsForm.requestSubmit();
	});

	function takeSets(data: Record<string, unknown> | null | undefined) {
		if (!data || !('catalogSets' in data)) {
			setsStatus = 'error';
			setsMessage = 'Env sets could not be loaded.';
			return;
		}
		const next = data.catalogSets;
		sets = Array.isArray(next) ? (next as KnownSet[]) : [];
		setsMessage = typeof data.catalogSetsMessage === 'string' ? data.catalogSetsMessage : null;
		setsStatus = setsMessage ? 'error' : 'ready';
	}

	function retrySets() {
		setsMessage = null;
		setsStatus = 'loading';
		setsForm?.requestSubmit();
	}
</script>

<Dialog.Root bind:open>
	{#if mode === 'create'}
		<Dialog.Trigger class={buttonVariants()}>
			<Plus class="size-4" />
			Container
		</Dialog.Trigger>
	{:else if entry}
		<RowAction label="Edit {entry.name}" icon={Pencil}>
			{#snippet trigger(props)}
				<Dialog.Trigger {...props}>
					<Pencil class="size-4" />
				</Dialog.Trigger>
			{/snippet}
		</RowAction>
	{/if}
	<Dialog.Content class="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-xl">
		<Dialog.Header class="shrink-0 pr-8">
			<Dialog.Title class="break-all">{mode === 'create' ? 'Container' : `Edit ${entry?.name ?? 'image'}`}</Dialog.Title>
			<Dialog.Description>An image runs on a host that has Docker.</Dialog.Description>
		</Dialog.Header>
		<div class="min-h-0 overflow-y-auto">
			<form
				bind:this={setsForm}
				method="POST"
				action={setsAction}
				class="hidden"
				use:enhance={() => {
					return async ({ result }) => {
						if (result.type === 'success' || result.type === 'failure') takeSets(result.data as Record<string, unknown>);
					};
				}}
			></form>
			<CatalogImageForm {mode} {entry} {saveAction} {sets} {setsMessage} {setsStatus} {retrySets} {editor}>
				{#snippet cancel()}
					<Dialog.Close type="button">Cancel</Dialog.Close>
				{/snippet}
			</CatalogImageForm>
		</div>
	</Dialog.Content>
</Dialog.Root>
