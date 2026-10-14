<script lang="ts">
	import { enhance } from '$app/forms';
	import Plus from '@lucide/svelte/icons/plus';
	import { untrack } from 'svelte';
	import Notice from '$lib/components/Notice.svelte';
	import { formDialogOutcome, nextFormDialog, type DialogOutcome } from '$lib/dialog-open';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	let {
		action,
		failed,
		message = null
	}: {
		action: string;
		failed: boolean;
		message?: string | null;
	} = $props();

	let open = $state(untrack(() => failed));
	let sawFailure = $state(untrack(() => failed));

	$effect(() => {
		const next = nextFormDialog(untrack(() => ({ open, sawFailure })), failed ? 'failure' : 'idle');
		open = next.open;
		sawFailure = next.sawFailure;
	});

	function settle(outcome: DialogOutcome) {
		const next = nextFormDialog({ open, sawFailure }, outcome);
		open = next.open;
		sawFailure = next.sawFailure;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger class={buttonVariants()}>
		<Plus class="size-4" />
		New project
	</Dialog.Trigger>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>New project</Dialog.Title>
			<Dialog.Description>You become its owner.</Dialog.Description>
		</Dialog.Header>
		<form
			method="POST"
			{action}
			class="grid gap-3"
			use:enhance={() => {
				return async ({ result, update }) => {
					await update();
					settle(formDialogOutcome(result.type));
				};
			}}
		>
			{#if failed && message}
				<Notice kind="error">{message}</Notice>
			{/if}
			<Label class="grid gap-1.5" for="project-name">
				Project name
				<Input id="project-name" name="name" required maxlength={80} autocomplete="off" />
			</Label>
			<div class="flex flex-wrap items-center gap-2">
				<Button type="submit">Create project</Button>
				<Dialog.Close type="button" class={buttonVariants({ variant: 'outline' })}>Cancel</Dialog.Close>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>
