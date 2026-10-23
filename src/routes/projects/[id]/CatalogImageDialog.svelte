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
	import {
		imageDialogReveal,
		imageNoticeOnCloseComplete,
		imageNoticeOnDialog,
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
		onSaved?: (name: string | null) => void;
		disabled?: boolean;
	} = $props();

	let open = $state(untrack(() => revealed));
	let sawReveal = $state(untrack(() => revealed));
	let sawFailure = $state(untrack(() => revealed));
	let wasOpen = $state(untrack(() => revealed));
	let pendingSaved = $state<string | null>(null);
	// Resolved when bits-ui finishes closing, so update() cannot drop the notice first.
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

	// Opening create or edit drops the previous notice. A close keeps a name that is waiting to be announced.
	$effect(() => {
		const now = open;
		const previous = untrack(() => wasOpen);
		// 'notice' is a stand-in. Only the opening transition returns null; the page holds the real name.
		if (imageNoticeOnDialog('notice', previous, now) == null) {
			pendingSaved = null;
			onSaved?.(null);
		}
		wasOpen = now;
	});

	function settle(outcome: DialogOutcome, name: string): void | Promise<void> {
		const next = imageSaveView({ open, sawFailure }, outcome, name);
		open = next.open;
		sawFailure = next.sawFailure;
		if (next.savedName == null) {
			pendingSaved = null;
			onSaved?.(null);
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

	// bits-ui calls this after the dialog content has left the tree, so the notice is not inside aria-modal.
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

<Dialog.Root bind:open onOpenChangeComplete={onDialogOpenChangeComplete}>
	{#if mode === 'create'}
		<Dialog.Trigger class={buttonVariants()}>
			<Plus class="size-4" />
			Container
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
					<Dialog.Close type="button">Cancel</Dialog.Close>
				{/snippet}
			</CatalogImageForm>
		</div>
	</Dialog.Content>
</Dialog.Root>
