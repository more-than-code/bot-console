<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import { untrack, type Snippet } from 'svelte';
	import { restoreFocusTo } from '$lib/dialog-focus';
	import { formDialogOutcome, nextFormDialog } from '$lib/dialog-open';
	import { buttonVariants } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';

	let {
		id,
		label,
		title,
		description = null,
		failed = false,
		children
	}: {
		/** The trigger's id. Closing returns focus to it. */
		id: string;
		/** Trigger text. */
		label: string;
		title: string;
		description?: string | null;
		/** This dialog's own action failed. A new failure forces it open (the `nextFormDialog` rule). */
		failed?: boolean;
		/**
		 * The form. Call `settle` with the action result type: success closes the dialog, a failure keeps it open.
		 * Render `cancel` next to the submit button. The form unmounts on close, so anything it holds
		 * (a pasted secret) is dropped.
		 */
		children: Snippet<[settle: (resultType: string) => void, cancel: Snippet]>;
	} = $props();

	let open = $state(untrack(() => failed));
	let sawFailure = $state(untrack(() => failed));

	$effect(() => {
		const next = nextFormDialog(untrack(() => ({ open, sawFailure })), failed ? 'failure' : 'idle');
		open = next.open;
		sawFailure = next.sawFailure;
	});

	function settle(resultType: string) {
		const next = nextFormDialog({ open, sawFailure }, formDialogOutcome(resultType));
		open = next.open;
		sawFailure = next.sawFailure;
	}

</script>

{#snippet cancel()}
	<Dialog.Close type="button" class={buttonVariants({ variant: 'outline' })}>Cancel</Dialog.Close>
{/snippet}

<Dialog.Root bind:open>
	<Dialog.Trigger {id} class={buttonVariants({ variant: 'outline' })}>
		<Plus class="size-4" />
		{label}
	</Dialog.Trigger>
	<Dialog.Content class="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-md" onCloseAutoFocus={restoreFocusTo(id)}>
		<Dialog.Header class="shrink-0 pr-8">
			<Dialog.Title>{title}</Dialog.Title>
			{#if description}
				<Dialog.Description>{description}</Dialog.Description>
			{/if}
		</Dialog.Header>
		<div class="min-h-0 overflow-y-auto">
			{@render children(settle, cancel)}
		</div>
	</Dialog.Content>
</Dialog.Root>
