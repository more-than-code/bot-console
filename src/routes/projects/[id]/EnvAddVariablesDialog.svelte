<script lang="ts">
	import { enhance } from '$app/forms';
	import { tick, untrack } from 'svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Textarea from '$lib/components/Textarea.svelte';
	import { restoreFocusTo } from '$lib/dialog-focus';
	import { nextFormDialog } from '$lib/dialog-open';
	import { updateInPlace } from '$lib/form-redirect';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Tabs from '$lib/components/ui/tabs';
	import {
		addErrorText,
		addKeyError,
		addKeyRefused,
		addTabFailed,
		addValueTyped,
		closeAddVariables,
		initialAddVariables,
		pasteTabFailed,
		setAddSecret,
		settleAdd,
		settleMerge,
		switchAddTab,
		type AddTab
	} from './env-add-variable';
	import { envDomId, failureMessage } from './env-set-panel';

	let {
		setName,
		existingKeys,
		addAction,
		mergeAction,
		mergeError = null,
		onAdded,
		onMerged
	}: {
		setName: string;
		/** Keys already in the set: One variable refuses them instead of overwriting. */
		existingKeys: readonly string[];
		/** putEnvKey, sent with op=add. */
		addAction: string;
		/** mergeEnvSet (api-v1 v1.19 merge). */
		mergeAction: string;
		/** This set's mergeEnvSet failure from the page's form result (a post without JS), else null. */
		mergeError?: string | null;
		/** After a successful Add variable, before the reload: the panel sets "Added {KEY}.". */
		onAdded: (key: string) => void;
		/** After a successful Add variables, before the reload: the panel sets "Saved variables in {set}.". */
		onMerged: () => void;
	} = $props();

	const id = (part: string) => envDomId(setName, part);
	const triggerId = $derived(id('add-variables'));
	const serverFailed = $derived(mergeError != null && mergeError !== '');

	let open = $state(untrack(() => serverFailed));
	let sawFailure = $state(untrack(() => serverFailed));
	let view = $state(untrack(() => (serverFailed ? pasteTabFailed(initialAddVariables(), mergeError ?? '') : initialAddVariables())));
	// Set when a success closes the dialog: focus moves to the status line after the reload, not on close.
	let closingAfterSave = false;

	const keyError = $derived(view.draft.errorField === 'key');

	// A new form-result failure opens the dialog on Paste several. Closing it stays closed while it is current.
	$effect(() => {
		const failed = serverFailed;
		const next = nextFormDialog(untrack(() => ({ open, sawFailure })), failed ? 'failure' : 'idle');
		if (next.open && !untrack(() => open)) view = pasteTabFailed(untrack(() => view), mergeError ?? '');
		open = next.open;
		sawFailure = next.sawFailure;
	});

	function focusById(target: string) {
		document.getElementById(target)?.focus();
	}

	// Opening from the trigger, and closing with Cancel, Escape or the X, start from One variable with both inputs empty.
	function onOpenChange() {
		view = closeAddVariables(view);
	}

	function onCloseAutoFocus(event: Event) {
		if (closingAfterSave) {
			event.preventDefault();
			closingAfterSave = false;
			return;
		}
		restoreFocusTo(triggerId)(event);
	}

	function closeAfterSave() {
		if (!open) return;
		closingAfterSave = true;
		open = false;
		view = closeAddVariables(view);
	}

	function submitOne({ formData, cancel }: { formData: FormData; cancel: () => void }) {
		const key = String(formData.get('key') ?? '');
		const invalid = addKeyError(key, existingKeys);
		if (invalid) {
			cancel();
			view = { ...view, draft: addKeyRefused(view.draft, invalid) };
			void tick().then(() => focusById(id('add-key')));
			return;
		}
		return async ({ update, result }: { update: () => Promise<void>; result: { type: string; data?: unknown; location?: string } }) => {
			await settleAdd(open, result.type, {
				added: () => onAdded(key),
				close: closeAfterSave,
				failed: async () => {
					// Stay open on this tab. The server never echoes the value; a secret one is asked for again.
					view = addTabFailed(view, failureMessage(result));
					await tick();
					focusById(id(keyError ? 'add-key' : 'add-error'));
				},
				update: () => updateInPlace(result, update),
				tick,
				focusStatus: () => focusById(id('status'))
			});
		};
	}

	function submitPaste() {
		return async ({ update, result }: { update: () => Promise<void>; result: { type: string; data?: unknown; location?: string } }) => {
			await settleMerge(open, result.type, {
				clearPaste: () => {
					view = { ...view, paste: '' };
				},
				merged: onMerged,
				close: closeAfterSave,
				failed: async () => {
					view = pasteTabFailed(view, failureMessage(result));
					await tick();
					focusById(id('merge-error'));
				},
				update: () => updateInPlace(result, update),
				tick,
				focusStatus: () => focusById(id('status'))
			});
		};
	}
</script>

<Dialog.Root bind:open {onOpenChange}>
	<Dialog.Trigger id={triggerId} class={buttonVariants({ variant: 'outline', size: 'sm' })} aria-label="Add variables to {setName}">
		Add variables
	</Dialog.Trigger>
	<Dialog.Content class="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-xl" {onCloseAutoFocus}>
		<Dialog.Header class="shrink-0 pr-8">
			<Dialog.Title class="break-all">Add variables to {setName}</Dialog.Title>
			<Dialog.Description>Secret values are encrypted and shown only as a short preview.</Dialog.Description>
		</Dialog.Header>
		<div class="grid min-h-0 gap-3 overflow-y-auto">
			<Tabs.Root bind:value={() => view.tab, (tab) => (view = switchAddTab(view, tab as AddTab))}>
				<Tabs.List aria-label="How to add" class="group-data-[orientation=horizontal]/tabs:h-10">
					<Tabs.Trigger value="one" id={id('tab-one')}>One variable</Tabs.Trigger>
					<Tabs.Trigger value="paste" id={id('tab-paste')}>Paste several</Tabs.Trigger>
				</Tabs.List>
				<Tabs.Content value="one">
					<form id={id('add-form')} method="POST" action={addAction} class="grid gap-3" use:enhance={submitOne}>
						<Input type="hidden" name="set" value={setName} />
						<Input type="hidden" name="op" value="add" />
						<Input type="hidden" name="is_secret" value={view.draft.secret ? '1' : '0'} />
						<Label class="grid gap-1.5" for={id('add-key')}>
							Key
							<Input
								id={id('add-key')}
								name="key"
								bind:value={view.draft.key}
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
								type={view.draft.secret ? 'password' : 'text'}
								bind:value={view.draft.value}
								oninput={() => (view = { ...view, draft: addValueTyped(view.draft) })}
								autocomplete={view.draft.secret ? 'new-password' : 'off'}
								spellcheck="false"
								aria-describedby={view.draft.error ? id('add-error') : undefined}
							/>
						</Label>
						<Label class="flex items-center gap-2">
							<Checkbox
								id={id('add-secret')}
								checked={view.draft.secret}
								aria-label="Secret"
								onCheckedChange={(value) => (view = { ...view, draft: setAddSecret(view.draft, value === true) })}
							/>
							Secret
						</Label>
						{#if view.draft.error}
							<div id={id('add-error')} tabindex="-1" class="max-w-full min-w-0 break-words focus-visible:ring-3 focus-visible:ring-ring">
								<Notice kind="error">{addErrorText(view.draft)}</Notice>
							</div>
						{/if}
					</form>
				</Tabs.Content>
				<Tabs.Content value="paste">
					<form id={id('merge-form')} method="POST" action={mergeAction} class="grid gap-3" use:enhance={submitPaste}>
						<Input type="hidden" name="set" value={setName} />
						<p class="text-muted-foreground text-sm">
							Paste the variables, one KEY=value per line, like a .env file. Existing keys keep the secret flag they already have; other keys in the set are kept.
						</p>
						<Label class="grid gap-1.5" for={id('merge-dotenv')}>
							Variables (one KEY=value per line)
							<Textarea
								id={id('merge-dotenv')}
								name="dotenv"
								bind:value={view.paste}
								rows={6}
								spellcheck="false"
								autocomplete="off"
								aria-invalid={view.pasteError ? true : undefined}
								aria-describedby={view.pasteError ? id('merge-error') : undefined}
							/>
						</Label>
						<Input type="hidden" name="new_keys_secret" value={view.pasteSecret ? '1' : '0'} />
						<Label class="flex items-center gap-2">
							<Checkbox
								id={id('merge-new-secret')}
								checked={view.pasteSecret}
								aria-label="New keys are secret"
								onCheckedChange={(value) => (view = { ...view, pasteSecret: value === true })}
							/>
							New keys are secret
						</Label>
						{#if view.pasteError}
							<div id={id('merge-error')} tabindex="-1" class="max-w-full min-w-0 break-words focus-visible:ring-3 focus-visible:ring-ring">
								<Notice kind="error">{view.pasteError}</Notice>
							</div>
						{/if}
					</form>
				</Tabs.Content>
			</Tabs.Root>
			<div class="flex flex-wrap items-center gap-2">
				{#if view.tab === 'one'}
					<Button type="submit" form={id('add-form')}>Add variable</Button>
				{:else}
					<Button type="submit" form={id('merge-form')}>Add variables</Button>
				{/if}
				<Dialog.Close type="button" class={buttonVariants({ variant: 'outline' })}>Cancel</Dialog.Close>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
