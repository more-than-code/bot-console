<script lang="ts">
	import { enhance } from '$app/forms';
	import type { Snippet } from 'svelte';
	import Notice from '$lib/components/Notice.svelte';
	import { formDialogOutcome, type DialogOutcome } from '$lib/dialog-open';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	let {
		action,
		serviceId,
		value = $bindable(''),
		message = null,
		onSettled,
		cancel
	}: {
		action: string;
		serviceId: string;
		value?: string;
		message?: string | null;
		onSettled?: (outcome: DialogOutcome) => void | Promise<void>;
		cancel?: Snippet;
	} = $props();
</script>

<form
	method="POST"
	{action}
	class="grid gap-3"
	use:enhance={() => {
		return async ({ result, update }) => {
			await update();
			await onSettled?.(formDialogOutcome(result.type));
		};
	}}
>
	{#if message}
		<Notice kind="error">{message}</Notice>
	{/if}
	<Input type="hidden" name="service_id" value={serviceId} />
	<Label class="grid gap-1.5">
		<span class="sr-only">Display name</span>
		<Input type="text" name="display_name" maxlength={64} autocomplete="off" bind:value />
	</Label>
	<div class="flex flex-wrap items-center gap-2">
		<Button type="submit">Save</Button>
		<Button type="submit" name="clear" value="1" variant="outline">Clear</Button>
		{#if cancel}
			{@render cancel()}
		{:else}
			<Button type="button">Cancel</Button>
		{/if}
	</div>
</form>
