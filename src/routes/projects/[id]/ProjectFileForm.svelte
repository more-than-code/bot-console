<script lang="ts">
	import type { Snippet } from 'svelte';
	import { enhance } from '$app/forms';
	import Notice from '$lib/components/Notice.svelte';
	import Textarea from '$lib/components/Textarea.svelte';
	import { settleFileSave } from '$lib/secret-field';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	let {
		action,
		error = null,
		onSaved,
		onSettled,
		cancel
	}: {
		action: string;
		/** The saveProjectFile failure message. */
		error?: string | null;
		/** The saved file's name, or null when a new save starts. */
		onSaved: (name: string | null) => void;
		onSettled: (resultType: string) => void;
		/** The dialog's Cancel button. */
		cancel?: Snippet;
	} = $props();

	// The paste is cleared on every result, and dropped when the dialog closes.
	let fileContent = $state('');
	let fileName = $state('');
	let fileSecret = $state(true);

	function clearFile({ formData }: { formData: FormData }) {
		const submittedName = String(formData.get('name') ?? '');
		return async ({ update, result }: { update: () => Promise<void>; result: { type: string } }) => {
			await settleFileSave(
				(next) => {
					fileContent = next.content;
					fileName = next.name;
					fileSecret = next.secret;
					onSaved(next.saved);
				},
				{ name: fileName, secret: fileSecret },
				submittedName,
				update,
				result.type
			);
			onSettled(result.type);
			document.getElementById('file-error')?.focus();
		};
	}
</script>

<form method="POST" {action} class="grid gap-3" use:enhance={clearFile}>
	<Label class="grid gap-1.5" for="file-name">
		Name
		<Input id="file-name" name="name" bind:value={fileName} required maxlength={64} autocomplete="off" spellcheck="false" />
	</Label>
	<Label class="grid gap-1.5" for="file-content">
		Content
		<Textarea
			id="file-content"
			name="content"
			bind:value={fileContent}
			rows={6}
			spellcheck="false"
			autocomplete="off"
			aria-label="File content"
			aria-invalid={error ? true : undefined}
			aria-describedby={error ? 'file-error' : undefined}
		/>
	</Label>
	<Input type="hidden" name="secret" value={fileSecret ? '1' : '0'} />
	<Label class="flex items-center gap-2">
		<Checkbox id="file-secret" checked={fileSecret} aria-label="Secret file" onCheckedChange={(value) => (fileSecret = value === true)} />
		Secret
	</Label>
	{#if error}
		<div id="file-error" tabindex="-1" class="max-w-full min-w-0 break-words focus-visible:ring-3 focus-visible:ring-ring">
			<Notice kind="error">{error}</Notice>
		</div>
	{/if}
	<div class="flex flex-wrap items-center gap-2">
		<Button type="submit">Save file</Button>
		{@render cancel?.()}
	</div>
</form>
