<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import { browser } from '$app/environment';
	import { enhance } from '$app/forms';
	import { tick, untrack } from 'svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Textarea from '$lib/components/Textarea.svelte';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { ENV_SET_STATUS_ID, savedEnvSetNote, settleEnvSetSave } from './env-set-panel';

	let {
		action,
		message,
		settingsField = null,
		onStatus = () => {}
	}: {
		action: string;
		message: string | null;
		settingsField?: 'dotenv' | 'token' | 'file' | null;
		/** Sets the Env sets card's status line: empty when a save starts, "Saved env set {name}." on success. */
		onStatus?: (text: string) => void;
	} = $props();

	const failedNow = () => settingsField === 'dotenv' && !!message;
	let open = $state(untrack(failedNow));
	let sawFailure = $state(untrack(failedNow));
	let dotenv = $state('');
	let setName = $state('');
	let newKeysSecret = $state(false);
	// Set when a success closes the dialog: focus moves to the status line after the reload, not on close.
	let closingAfterSave = false;

	// A new failure opens the dialog. Closing it stays closed while that failure is still current.
	$effect(() => {
		const next = settingsField === 'dotenv' && !!message;
		if (next && !untrack(() => sawFailure)) open = true;
		sawFailure = next;
	});

	$effect(() => {
		if (!browser || settingsField !== 'dotenv' || !message) return;
		void tick().then(() => document.getElementById('env-set-error')?.focus());
	});

	function focusById(target: string) {
		document.getElementById(target)?.focus();
	}

	// bits-ui would restore focus to the trigger, which Safari and Firefox never focused on click.
	function onCloseAutoFocus(event: Event) {
		event.preventDefault();
		if (closingAfterSave) {
			closingAfterSave = false;
			return;
		}
		focusById('new-env-set');
	}

	function submit({ formData }: { formData: FormData }) {
		const name = String(formData.get('set') ?? '');
		onStatus('');
		return async ({ update, result }: { update: () => Promise<void>; result: { type: string } }) => {
			await settleEnvSetSave(open, result.type, {
				clearPaste: () => {
					dotenv = '';
				},
				saved: () => {
					onStatus(savedEnvSetNote(name));
					// The next set starts empty and with the safe default.
					setName = '';
					newKeysSecret = false;
				},
				close: () => {
					if (!open) return;
					closingAfterSave = true;
					open = false;
				},
				update,
				tick,
				focusStatus: () => focusById(ENV_SET_STATUS_ID),
				focusError: () => focusById('env-set-error')
			});
		};
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger id="new-env-set" class={buttonVariants({ variant: 'outline' })}>
		<Plus class="size-4" />
		Add env set
	</Dialog.Trigger>
	<Dialog.Content class="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-xl" {onCloseAutoFocus}>
		<Dialog.Header class="shrink-0 pr-8">
			<Dialog.Title>Add env set</Dialog.Title>
			<Dialog.Description>Paste a dotenv file. Existing keys keep the secret flag they already have.</Dialog.Description>
		</Dialog.Header>
		<form method="POST" {action} class="grid min-h-0 gap-3 overflow-y-auto" use:enhance={submit}>
			<Label class="grid gap-1.5" for="env-set-name">
				Set name
				<Input id="env-set-name" name="set" bind:value={setName} required maxlength={48} autocomplete="off" spellcheck="false" />
			</Label>
			<Label class="grid gap-1.5" for="env-set-dotenv">
				Dotenv
				<Textarea
					id="env-set-dotenv"
					name="dotenv"
					bind:value={dotenv}
					rows={6}
					spellcheck="false"
					autocomplete="off"
					aria-label="Env set dotenv"
					aria-invalid={settingsField === 'dotenv' && message ? true : undefined}
					aria-describedby={settingsField === 'dotenv' && message ? 'env-set-error' : undefined}
				/>
			</Label>
			<Input type="hidden" name="new_keys_secret" value={newKeysSecret ? '1' : '0'} />
			<Label class="flex items-center gap-2">
				<Checkbox
					id="env-set-new-secret"
					checked={newKeysSecret}
					aria-label="New keys are secret"
					onCheckedChange={(value) => (newKeysSecret = value === true)}
				/>
				New keys are secret
			</Label>
			{#if settingsField === 'dotenv' && message}
				<div id="env-set-error" tabindex="-1" class="max-w-full min-w-0 break-words focus-visible:ring-3 focus-visible:ring-ring">
					<Notice kind="error">{message}</Notice>
				</div>
			{/if}
			<div class="flex flex-wrap items-center gap-2">
				<Button type="submit">Add env set</Button>
				<Dialog.Close type="button">Cancel</Dialog.Close>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>
