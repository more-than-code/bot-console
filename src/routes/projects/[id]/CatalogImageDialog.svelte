<script lang="ts">
	import { browser } from '$app/environment';
	import { enhance } from '$app/forms';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import { untrack } from 'svelte';
	import { buttonVariants } from '$lib/components/ui/button';
	import * as Sheet from '$lib/components/ui/sheet';
	import RowAction from '$lib/components/RowAction.svelte';
	import type { ImageEntry } from '$lib/api-types';
	import {
		imageDialogReveal,
		imageNoticeOnCloseComplete,
		imageSaveView,
		settleImageAuxLoad,
		type DialogOutcome
	} from '$lib/dialog-open';
	import type { KnownSet } from '$lib/image-spec';
	import type { ImageEditorState } from '$lib/project-action';
	import CatalogImageForm from './CatalogImageForm.svelte';

	let {
		mode,
		entry = null,
		saveAction,
		setsAction,
		filesAction,
		tagsAction = null,
		digestAction = null,
		revealed = false,
		editor = null,
		onSaved,
		disabled = false
	}: {
		mode: 'create' | 'edit';
		entry?: ImageEntry | null;
		saveAction: string;
		setsAction: string;
		filesAction: string;
		tagsAction?: string | null;
		digestAction?: string | null;
		revealed?: boolean;
		editor?: ImageEditorState | null;
		onSaved?: (name: string) => void;
		disabled?: boolean;
	} = $props();

	let open = $state(untrack(() => revealed));
	let sawReveal = $state(untrack(() => revealed));
	let sawFailure = $state(untrack(() => revealed));
	let wasOpen = $state(untrack(() => revealed));
	let pendingSaved = $state<string | null>(null);
	// Resolved when bits-ui finishes closing, so the save's update() waits until the toast has fired.
	let closeWait: (() => void) | null = null;
	let sets = $state<KnownSet[]>([]);
	let setsMessage = $state<string | null>(null);
	let setsStatus = $state<'loading' | 'ready' | 'error'>('loading');
	let fetched = $state(false);
	let setsForm = $state<HTMLFormElement | null>(null);
	let files = $state<Array<{ name: string }>>([]);
	let filesMessage = $state<string | null>(null);
	let filesStatus = $state<'loading' | 'ready' | 'error'>('loading');
	let filesFetched = $state(false);
	let filesForm = $state<HTMLFormElement | null>(null);

	// A new failure opens the dialog. A run while it is still revealed does not write it open again.
	$effect(() => {
		const next = imageDialogReveal(untrack(() => ({ open, sawReveal })), revealed);
		open = next.open;
		sawReveal = next.sawReveal;
	});

	// Opening create or edit drops a name still waiting for its toast. A close keeps it.
	$effect(() => {
		const now = open;
		const previous = untrack(() => wasOpen);
		if (!previous && now) pendingSaved = null;
		wasOpen = now;
	});

	function settle(outcome: DialogOutcome, name: string): void | Promise<void> {
		const next = imageSaveView({ open, sawFailure }, outcome, name);
		open = next.open;
		sawFailure = next.sawFailure;
		if (next.savedName == null) {
			pendingSaved = null;
			return;
		}
		pendingSaved = next.savedName;
		return new Promise<void>((resolve) => {
			closeWait = resolve;
			// If bits-ui never reports the close, do not hold the save's update() forever.
			setTimeout(() => {
				if (closeWait === resolve) onDialogOpenChangeComplete(false);
			}, 1000);
		});
	}

	// bits-ui calls this after the drawer content has left the tree, so the toast is not announced inside aria-modal.
	function onDialogOpenChangeComplete(isOpen: boolean) {
		const next = imageNoticeOnCloseComplete(pendingSaved, isOpen);
		pendingSaved = next.pending;
		if (next.announce != null) onSaved?.(next.announce);
		if (!isOpen) {
			closeWait?.();
			closeWait = null;
		}
	}

	// Names and key names only. This post does not replace the page form, so a later save keeps the list.
	$effect(() => {
		if (!open) {
			fetched = false;
			setsStatus = 'loading';
			setsMessage = null;
			sets = [];
			filesFetched = false;
			filesStatus = 'loading';
			filesMessage = null;
			files = [];
			return;
		}
		if (!browser || fetched || setsForm == null) return;
		fetched = true;
		setsForm.requestSubmit();
	});

	// File names only. Content is never on this post.
	$effect(() => {
		if (!open || !browser || filesFetched || filesForm == null) return;
		filesFetched = true;
		filesForm.requestSubmit();
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

	function takeFiles(data: Record<string, unknown> | null | undefined) {
		if (!data || !('catalogFiles' in data)) {
			filesStatus = 'error';
			filesMessage = 'Files could not be loaded.';
			return;
		}
		const next = data.catalogFiles;
		files = Array.isArray(next) ? (next as Array<{ name: string }>) : [];
		filesMessage = typeof data.catalogFilesMessage === 'string' ? data.catalogFilesMessage : null;
		filesStatus = filesMessage ? 'error' : 'ready';
	}

	function retryFiles() {
		filesMessage = null;
		filesStatus = 'loading';
		filesForm?.requestSubmit();
	}
</script>

<Sheet.Root bind:open onOpenChangeComplete={onDialogOpenChangeComplete}>
	{#if mode === 'create'}
		<Sheet.Trigger class={buttonVariants()}>
			<Plus class="size-4" />
			Container
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
			<Sheet.Title class="break-all">{mode === 'create' ? 'Container' : `Edit ${entry?.name ?? 'image'}`}</Sheet.Title>
			<Sheet.Description>An image runs on a host that has Docker.</Sheet.Description>
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
		<form
			bind:this={filesForm}
			method="POST"
			action={filesAction}
			class="hidden"
			use:enhance={() => {
				return async ({ result }) => {
					open = settleImageAuxLoad(result, open, takeFiles);
				};
			}}
		></form>
		<CatalogImageForm {mode} {entry} {saveAction} {sets} {setsMessage} {setsStatus} {retrySets} {files} {filesMessage} {filesStatus} {retryFiles} {tagsAction} {digestAction} {editor} onSettled={settle}>
			{#snippet cancel()}
				<Sheet.Close type="button" class={buttonVariants({ variant: 'outline' })}>Cancel</Sheet.Close>
			{/snippet}
		</CatalogImageForm>
	</Sheet.Content>
</Sheet.Root>
