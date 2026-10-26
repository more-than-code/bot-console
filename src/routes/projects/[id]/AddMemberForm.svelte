<script lang="ts">
	import type { Snippet } from 'svelte';
	import { enhance } from '$app/forms';
	import Notice from '$lib/components/Notice.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';

	let {
		action,
		error = null,
		onAdded,
		onSettled,
		cancel
	}: {
		action: string;
		/** The addMember failure message. */
		error?: string | null;
		/** The added email, or null when a new add starts. */
		onAdded: (email: string | null) => void;
		onSettled: (resultType: string) => void;
		/** The dialog's Cancel button. */
		cancel?: Snippet;
	} = $props();
</script>

<form
	method="POST"
	{action}
	class="grid gap-3"
	use:enhance={({ formData }) => {
		const email = String(formData.get('email') ?? '').trim();
		onAdded(null);
		return async ({ result, update }) => {
			await update();
			if (result.type === 'redirect') onAdded(email);
			onSettled(result.type);
			document.getElementById('add-member-error')?.focus();
		};
	}}
>
	{#if error}
		<div id="add-member-error" tabindex="-1" class="max-w-full min-w-0 break-words focus-visible:ring-3 focus-visible:ring-ring">
			<Notice kind="error">{error}</Notice>
		</div>
	{/if}
	<Label class="grid gap-1.5" for="member-email">
		Email
		<Input
			id="member-email"
			name="email"
			type="email"
			required
			maxlength={254}
			autocomplete="off"
			aria-invalid={error ? true : undefined}
			aria-describedby={error ? 'add-member-error' : undefined}
		/>
	</Label>
	<div class="grid gap-1.5">
		<Label for="member-role">Role</Label>
		<Select.Root type="single" name="role" value="viewer">
			<Select.Trigger id="member-role" class="w-full sm:w-40">
				<Select.Value />
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="viewer">viewer</Select.Item>
				<Select.Item value="admin">admin</Select.Item>
			</Select.Content>
		</Select.Root>
	</div>
	<div class="flex flex-wrap items-center gap-2">
		<Button type="submit">Add member</Button>
		{@render cancel?.()}
	</div>
</form>
