<script lang="ts">
	import type { Snippet } from 'svelte';
	import { enhance } from '$app/forms';
	import Notice from '$lib/components/Notice.svelte';
	import { clearSecretField } from '$lib/secret-field';
	import { Button } from '$lib/components/ui/button';
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
		/** The saveRegistry failure message. */
		error?: string | null;
		/** The saved registry host, or null when a new save starts. */
		onSaved: (host: string | null) => void;
		onSettled: (resultType: string) => void;
		/** The dialog's Cancel button. */
		cancel?: Snippet;
	} = $props();

	// Write-only. Cleared on every result, and dropped when the dialog closes.
	let token = $state('');

	function clearToken({ formData }: { formData: FormData }) {
		const host = String(formData.get('host') ?? '').trim();
		onSaved(null);
		return async ({ update, result }: { update: () => Promise<void>; result: { type: string } }) => {
			await clearSecretField((value) => {
				token = value;
			}, update);
			if (result.type === 'redirect') onSaved(host);
			onSettled(result.type);
			document.getElementById('registry-token-error')?.focus();
		};
	}
</script>

<form method="POST" {action} class="grid gap-3" use:enhance={clearToken}>
	<Label class="grid gap-1.5" for="registry-host">
		Host
		<Input id="registry-host" name="host" required maxlength={255} autocomplete="off" spellcheck="false" />
	</Label>
	<Label class="grid gap-1.5" for="registry-username">
		Username
		<Input id="registry-username" name="username" required maxlength={255} autocomplete="off" spellcheck="false" />
	</Label>
	<Label class="grid gap-1.5" for="registry-token">
		Token
		<Input
			id="registry-token"
			name="token"
			type="password"
			bind:value={token}
			required
			maxlength={4096}
			autocomplete="off"
			aria-invalid={error ? true : undefined}
			aria-describedby={error ? 'registry-token-error' : undefined}
		/>
	</Label>
	{#if error}
		<div id="registry-token-error" tabindex="-1" class="max-w-full min-w-0 break-words focus-visible:ring-3 focus-visible:ring-ring">
			<Notice kind="error">{error}</Notice>
		</div>
	{/if}
	<div class="flex flex-wrap items-center gap-2">
		<Button type="submit">Add registry</Button>
		{@render cancel?.()}
	</div>
</form>
