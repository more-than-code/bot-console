<script lang="ts">
	import { enhance } from '$app/forms';
	import type { Snippet } from 'svelte';
	import { confirmSubmitDisabled } from '$lib/confirm';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	type TypeToConfirm = {
		name: string;
		expected: string;
		label: string;
	};

	let {
		id,
		action,
		confirmLabel,
		hidden = [],
		typeToConfirm = null,
		typed = $bindable(''),
		onSettled,
		cancel
	}: {
		id: string;
		action: string;
		confirmLabel: string;
		hidden?: Array<{ name: string; value: string }>;
		/** Visible text the user must type. Nothing hidden carries `expected`. */
		typeToConfirm?: TypeToConfirm | null;
		typed?: string;
		/** `form` is what was submitted, read before the reload changes the props. */
		onSettled?: (resultType: string, form: FormData) => void | Promise<void>;
		cancel?: Snippet;
	} = $props();

	const disabled = $derived(confirmSubmitDisabled(typed, typeToConfirm?.expected ?? null));
</script>

<form
	method="POST"
	{action}
	{id}
	use:enhance={({ formData }) => {
		return async ({ result, update }) => {
			await update();
			await onSettled?.(result.type, formData);
		};
	}}
>
	{#each hidden as field (field.name)}
		<Input type="hidden" name={field.name} value={field.value} />
	{/each}
	{#if typeToConfirm}
		<Label class="mb-3 grid gap-1.5">
			{typeToConfirm.label}
			<Input name={typeToConfirm.name} autocomplete="off" bind:value={typed} />
		</Label>
	{/if}
	<div class="flex flex-wrap items-center gap-2">
		<Button type="submit" variant="destructive" {disabled}>{confirmLabel}</Button>
		{#if cancel}
			{@render cancel()}
		{:else}
			<Button type="button">Cancel</Button>
		{/if}
	</div>
</form>
