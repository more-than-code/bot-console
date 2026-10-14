<script lang="ts">
	import Pencil from '@lucide/svelte/icons/pencil';
	import { untrack } from 'svelte';
	import RenameForm from '$lib/components/RenameForm.svelte';
	import RowAction from '$lib/components/RowAction.svelte';
	import { nextFormDialog, type DialogOutcome } from '$lib/dialog-open';
	import * as Dialog from '$lib/components/ui/dialog';

	let {
		action,
		serviceId,
		rowLabel,
		value,
		failed,
		message = null
	}: {
		action: string;
		serviceId: string;
		rowLabel: string;
		value: string;
		failed: boolean;
		message?: string | null;
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

	function settle(outcome: DialogOutcome) {
		const next = nextFormDialog({ open, sawFailure }, outcome);
		open = next.open;
		sawFailure = next.sawFailure;
		if (next.resetDraft) draft = value;
	}
</script>

<Dialog.Root bind:open>
	<RowAction label="Rename {rowLabel}" icon={Pencil}>
		{#snippet trigger(props)}
			<Dialog.Trigger {...props}>
				<Pencil class="size-4" />
			</Dialog.Trigger>
		{/snippet}
	</RowAction>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Rename service</Dialog.Title>
			<Dialog.Description>Shown in place of the discovered name. Clear removes it.</Dialog.Description>
		</Dialog.Header>
		<RenameForm {action} {serviceId} bind:value={draft} message={failed ? message : null} onSettled={settle}>
			{#snippet cancel()}
				<Dialog.Close type="button">Cancel</Dialog.Close>
			{/snippet}
		</RenameForm>
	</Dialog.Content>
</Dialog.Root>
