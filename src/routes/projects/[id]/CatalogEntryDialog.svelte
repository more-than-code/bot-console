<script lang="ts">
	import { browser } from '$app/environment';
	import { enhance } from '$app/forms';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import { untrack } from 'svelte';
	import { focusFallbackAfterClose, settleImageAuxLoad } from '$lib/dialog-open';
	import { buttonVariants } from '$lib/components/ui/button';
	import * as Sheet from '$lib/components/ui/sheet';
	import DrawerResize from '$lib/components/DrawerResize.svelte';
	import RowAction from '$lib/components/RowAction.svelte';
	import type { Host, ProgramEntry } from '$lib/api-types';
	import type { KnownSet } from '$lib/image-spec';
	import type { CatalogEditorState } from '$lib/project-action';
	import CatalogEntryForm from './CatalogEntryForm.svelte';

	let {
		mode,
		entry = null,
		hosts,
		saveAction,
		parseAction,
		setsAction,
		revealed = false,
		editor = null,
		disabled = false,
		openRequest = 0,
		fallbackFocusId = null
	}: {
		mode: 'create' | 'edit';
		entry?: ProgramEntry | null;
		hosts: Host[];
		saveAction: string;
		parseAction: string;
		/** `?/catalogEnvSets`: set names and key names for the Env sets and Secret env fields. */
		setsAction: string;
		revealed?: boolean;
		editor?: CatalogEditorState | null;
		disabled?: boolean;
		/** A new value (a counter) opens it: the row's "⋯" menu asks for it (below `sm`, where its icon is hidden). */
		openRequest?: number;
		/** Where focus goes when it closes and its own trigger is hidden (the menu button). */
		fallbackFocusId?: string | null;
	} = $props();

	let open = $state(untrack(() => revealed));
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
	let sawReveal = $state(untrack(() => revealed));

	$effect(() => {
		if (revealed && !untrack(() => sawReveal)) open = true;
		sawReveal = revealed;
	});

	let sets = $state<KnownSet[]>([]);
	let setsMessage = $state<string | null>(null);
	let setsStatus = $state<'loading' | 'ready' | 'error'>('loading');
	let setsForm = $state<HTMLFormElement | null>(null);
	let fetched = $state(false);

	// Names and key names only, read each time the drawer opens. This post does not replace the page form.
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

	function takeSets(data: Record<string, unknown>) {
		if (!('catalogSets' in data)) {
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

<Sheet.Root bind:open>
	{#if mode === 'create'}
		<Sheet.Trigger class={buttonVariants()}>
			<Plus class="size-4" />
			Program
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
		{#snippet after()}<DrawerResize type="program" />{/snippet}
		<Sheet.Header class="pr-12 pb-0">
			<Sheet.Title class="break-all">{mode === 'create' ? 'New program' : `Edit ${entry?.name ?? 'program'}`}</Sheet.Title>
			<Sheet.Description>A program runs one command in a working directory.</Sheet.Description>
		</Sheet.Header>
		<form
			bind:this={setsForm}
			method="POST"
			action={setsAction}
			class="hidden"
			use:enhance={() => {
				return async ({ result }) => {
					open = settleImageAuxLoad(result, open, takeSets);
				};
			}}
		></form>
		<CatalogEntryForm {mode} {entry} {hosts} {saveAction} {parseAction} {editor} {sets} {setsMessage} {setsStatus} {retrySets}>
			{#snippet cancel()}
				<Sheet.Close type="button" class={buttonVariants({ variant: 'outline' })}>Cancel</Sheet.Close>
			{/snippet}
		</CatalogEntryForm>
	</Sheet.Content>
</Sheet.Root>
