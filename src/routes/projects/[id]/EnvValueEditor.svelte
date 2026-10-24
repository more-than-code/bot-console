<script lang="ts">
	import type { EnvSetKey } from '$lib/api-types';
	import Notice from '$lib/components/Notice.svelte';
	import { Input } from '$lib/components/ui/input';
	import { editValueField } from './env-set-panel';

	// The inline value input of a row in edit state. It belongs to the row's form in the row's edit cell.
	// Escape is handled by the row, so it cancels from anywhere in it.
	let {
		item,
		inputId,
		errorId,
		formId,
		error,
		draft = $bindable(''),
		onInput
	}: {
		item: EnvSetKey;
		inputId: string;
		errorId: string;
		formId: string;
		/** Full error text, empty when there is none. */
		error: string;
		draft?: string;
		/** Typing clears the row error. */
		onInput: () => void;
	} = $props();

	const placeholder = $derived(editValueField(item).placeholder);
</script>

<div class="grid gap-1">
	{#if item.is_secret}
		<!-- Uncontrolled and empty: the stored secret never reaches the browser. -->
		<Input
			id={inputId}
			form={formId}
			name="value"
			type="password"
			class="min-w-40 sm:min-w-48"
			{placeholder}
			aria-label="New value for {item.key}"
			aria-invalid={error ? true : undefined}
			aria-describedby={error ? errorId : undefined}
			autocomplete="new-password"
			spellcheck="false"
			oninput={onInput}
		/>
	{:else}
		<Input
			id={inputId}
			form={formId}
			name="value"
			type="text"
			class="min-w-40 sm:min-w-48"
			bind:value={draft}
			aria-label="Value for {item.key}"
			aria-invalid={error ? true : undefined}
			aria-describedby={error ? errorId : undefined}
			autocomplete="off"
			spellcheck="false"
			oninput={onInput}
		/>
	{/if}
	{#if error}
		<!-- Notice renders the shared alert role. -->
		<div id={errorId} class="max-w-full min-w-0 break-words">
			<Notice kind="error">{error}</Notice>
		</div>
	{/if}
</div>
