<script lang="ts">
	import Pencil from '@lucide/svelte/icons/pencil';
	import { untrack } from 'svelte';
	import RenameForm from '$lib/components/RenameForm.svelte';
	import RowAction from '$lib/components/RowAction.svelte';
	import { focusFallbackAfterClose, nextFormDialog, type DialogOutcome } from '$lib/dialog-open';
	import * as Dialog from '$lib/components/ui/dialog';

	let {
		action,
		serviceId,
		rowLabel,
		value,
		failed,
		message = null,
		openRequest = 0,
		fallbackFocusId = null,
		showTrigger = true
	}: {
		action: string;
		serviceId: string;
		rowLabel: string;
		value: string;
		failed: boolean;
		message?: string | null;
		/** A new value (a counter) opens the dialog: the row's "⋯" menu asks for it. */
		openRequest?: number;
		/** Where focus goes when the dialog closes and its own trigger is hidden or absent. */
		fallbackFocusId?: string | null;
		/** False: no icon of its own (it opens from a menu). */
		showTrigger?: boolean;
	} = $props();

	let open = $state(untrack(() => failed));
	let sawFailure = $state(untrack(() => failed));
	let draft = $state(untrack(() => value));

	$effect(() => {
		const failedNow = failed;
		const serverValue = value;
		const next = nextFormDialog(untrack(() => ({ open, sawFailure })), failedNow ? 'failure' : 'idle');
		open = next.open;
		sawFailure = next.sawFailure;
		// A closed dialog follows the server name, including after a successful save reloads it.
		if (failedNow || !next.open) draft = serverValue;
	});

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

	function settle(outcome: DialogOutcome) {
		const next = nextFormDialog({ open, sawFailure }, outcome);
		open = next.open;
		sawFailure = next.sawFailure;
		if (next.resetDraft) draft = value;
	}
</script>

<Dialog.Root bind:open>
	{#if showTrigger}
		<RowAction label="Rename {rowLabel}" icon={Pencil}>
			{#snippet trigger(props)}
				<Dialog.Trigger {...props}>
					<Pencil class="size-4" />
				</Dialog.Trigger>
			{/snippet}
		</RowAction>
	{/if}
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Rename service</Dialog.Title>
			<Dialog.Description>Changes only the name Deploybot shows. The container, unit or catalog entry keeps its own name. Clear restores the default name.</Dialog.Description>
		</Dialog.Header>
		<RenameForm {action} {serviceId} bind:value={draft} message={failed ? message : null} onSettled={settle}>
			{#snippet cancel()}
				<Dialog.Close type="button">Cancel</Dialog.Close>
			{/snippet}
		</RenameForm>
	</Dialog.Content>
</Dialog.Root>
