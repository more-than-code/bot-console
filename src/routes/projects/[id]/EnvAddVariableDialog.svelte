<script lang="ts">
	import { enhance } from '$app/forms';
	import { tick } from 'svelte';
	import Notice from '$lib/components/Notice.svelte';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { addErrorText, addFailed, addKeyError, addKeyRefused, addValueTyped, initialAddDraft, setAddSecret, settleAdd } from './env-add-variable';
	import { envDomId, failureMessage } from './env-set-panel';

	let {
		setName,
		action,
		onAdded
	}: {
		setName: string;
		action: string;
		/** Called after a successful add, before the reload, so the panel can set its status line. */
		onAdded: (key: string) => void;
	} = $props();

	let open = $state(false);
	let draft = $state(initialAddDraft());
	// Set when a success closes the dialog: focus moves to the status line after the reload, not on close.
	let closingAfterAdd = false;

	const id = (part: string) => envDomId(setName, part);
	const keyError = $derived(draft.errorField === 'key');

	function focusById(target: string) {
		document.getElementById(target)?.focus();
	}

	// Cancel, Escape and the close button drop the draft.
	function onOpenChange(next: boolean) {
		if (!next) draft = initialAddDraft();
	}

	// bits-ui would restore focus to the trigger, which Safari and Firefox never focused on click.
	function onCloseAutoFocus(event: Event) {
		event.preventDefault();
		if (closingAfterAdd) {
			closingAfterAdd = false;
			return;
		}
		focusById(id('add-variable'));
	}

	async function showError() {
		await tick();
		focusById(id(keyError ? 'add-key' : 'add-error'));
	}

	function submit({ formData, cancel }: { formData: FormData; cancel: () => void }) {
		const key = String(formData.get('key') ?? '');
		const invalid = addKeyError(key);
		if (invalid) {
			cancel();
			draft = addKeyRefused(draft, invalid);
			void showError();
			return;
		}
		return async ({ update, result }: { update: () => Promise<void>; result: { type: string; data?: unknown } }) => {
			await settleAdd(open, result.type, {
				added: () => {
					onAdded(key);
					draft = initialAddDraft();
				},
				close: () => {
					if (!open) return;
					closingAfterAdd = true;
					open = false;
				},
				failed: async () => {
					// Stay open. The server never echoes the value; a secret one is asked for again.
					draft = addFailed(draft, failureMessage(result));
					await showError();
				},
				update,
				tick,
				focusStatus: () => focusById(id('status'))
			});
		};
	}
</script>

<Dialog.Root bind:open {onOpenChange}>
	<Dialog.Trigger id={id('add-variable')} class={buttonVariants({ variant: 'outline', size: 'sm' })} aria-label="Add variable to {setName}">
		Add variable
	</Dialog.Trigger>
	<Dialog.Content class="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-md" {onCloseAutoFocus}>
		<Dialog.Header class="shrink-0 pr-8">
			<Dialog.Title class="break-all">Add variable to {setName}</Dialog.Title>
			<Dialog.Description>Secret values are encrypted and shown only as a short preview.</Dialog.Description>
		</Dialog.Header>
		<form method="POST" {action} class="grid min-h-0 gap-3 overflow-y-auto" use:enhance={submit}>
			<Input type="hidden" name="set" value={setName} />
			<Input type="hidden" name="op" value="add" />
			<Input type="hidden" name="is_secret" value={draft.secret ? '1' : '0'} />
			<Label class="grid gap-1.5" for={id('add-key')}>
				Key
				<Input
					id={id('add-key')}
					name="key"
					bind:value={draft.key}
					required
					maxlength={64}
					autocomplete="off"
					spellcheck="false"
					aria-invalid={keyError ? true : undefined}
					aria-describedby={keyError ? id('add-error') : undefined}
				/>
			</Label>
			<Label class="grid gap-1.5" for={id('add-value')}>
				Value
				<Input
					id={id('add-value')}
					name="value"
					type={draft.secret ? 'password' : 'text'}
					bind:value={draft.value}
					oninput={() => (draft = addValueTyped(draft))}
					autocomplete={draft.secret ? 'new-password' : 'off'}
					spellcheck="false"
					aria-describedby={draft.error ? id('add-error') : undefined}
				/>
			</Label>
			<Label class="flex items-center gap-2">
				<Checkbox
					id={id('add-secret')}
					checked={draft.secret}
					aria-label="Secret"
					onCheckedChange={(value) => (draft = setAddSecret(draft, value === true))}
				/>
				Secret
			</Label>
			{#if draft.error}
				<div id={id('add-error')} tabindex="-1" class="max-w-full min-w-0 break-words focus-visible:ring-3 focus-visible:ring-ring">
					<Notice kind="error">{addErrorText(draft)}</Notice>
				</div>
			{/if}
			<div class="flex flex-wrap items-center gap-2">
				<Button type="submit">Add</Button>
				<Dialog.Close type="button" class={buttonVariants({ variant: 'outline' })}>Cancel</Dialog.Close>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>
