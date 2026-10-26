<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import { untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import AddHostGuide from './AddHostGuide.svelte';
	import JoinTokenResult from './JoinTokenResult.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import {
		JOIN_DIALOG_CLOSED,
		createEnrolPoller,
		enrolStatus,
		joinPollId,
		nextJoinDialog,
		type JoinDialogEvent,
		type JoinDialogFocus,
		type JoinDialogState
	} from '$lib/add-host';
	import type { CreatedJoin, Host, JoinToken } from '$lib/api-types';
	import { focusAfterTick, restoreFocusTo } from '$lib/dialog-focus';
	import { actionUrlFrom } from '$lib/url';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	let {
		tokens,
		hosts,
		created,
		slug,
		open,
		message = null
	}: {
		/** Join tokens, read only to see whether the created token was used. */
		tokens: JoinToken[];
		hosts: Host[];
		created: CreatedJoin | null;
		slug: string;
		/** Initial state of the guide. */
		open: boolean;
		/** The createToken action's message: a failure, or a note with the created token. */
		message?: string | null;
	} = $props();

	const TRIGGER_ID = 'create-join-token';
	const FOCUS_IDS: Record<Exclude<JoinDialogFocus, null>, string> = {
		'copy-instructions': 'join-token-copy-instructions',
		'keep-open': 'join-token-keep-open',
		close: 'join-token-close',
		error: 'create-token-error'
	};

	// A created token present at mount (a full-page create) opens the dialog on it.
	let dialog = $state<JoinDialogState>(
		untrack(() => (created ? nextJoinDialog(JOIN_DIALOG_CLOSED, { type: 'created', id: created.id }).state : JOIN_DIALOG_CLOSED))
	);
	let seenId = untrack(() => created?.id ?? null);
	const shown = $derived(created && created.id === dialog.shownId ? created : null);

	function dispatch(event: JoinDialogEvent) {
		const next = nextJoinDialog(dialog, event);
		dialog = next.state;
		if (next.focus) void focusAfterTick(FOCUS_IDS[next.focus]);
	}

	// A new created token is shown once, in the dialog. The same id again (a reload) is not shown again.
	$effect.pre(() => {
		const id = created?.id ?? null;
		if (id === seenId) return;
		seenId = id;
		if (id !== null) untrack(() => dispatch({ type: 'created', id }));
	});

	const ENROL_POLL_MS = 5000;
	let startedAt = $state(Date.now());
	let now = $state(Date.now());
	const enrolment = $derived(shown ? enrolStatus(shown, tokens, hosts, now, startedAt) : null);

	// The host enrolled or the token ended while "Close anyway?" was up: back to the result.
	$effect(() => {
		const status = enrolment;
		untrack(() => dispatch({ type: 'enrolment', status }));
	});

	// Keyed on the shown token id while the dialog is open: a reload that brings a new `created` object with the
	// same id does not restart the 15-minute window. Closing the dialog disposes the poller.
	const pollId = $derived(joinPollId(dialog, created?.id ?? null));
	// While the tab is visible, reload tokens and hosts until the host enrols. Only the load data changes; the token
	// comes from the action result. `now` moves only after a refresh lands, so the status is read from data that new.
	$effect(() => {
		if (!browser || !pollId) return;
		startedAt = now = Date.now();
		const poller = createEnrolPoller({
			isWaiting: () => untrack(() => enrolment?.kind === 'waiting'),
			refresh: async () => {
				await invalidate('project:enrol');
				now = Date.now();
			},
			doc: document,
			intervalMs: ENROL_POLL_MS
		});
		poller.start();
		return () => poller.dispose();
	});

	// Escape, the close button and Close all come here. While the token may still be needed, ask first.
	function setOpen(next: boolean) {
		dispatch(next ? { type: 'open-request' } : { type: 'close-request', status: enrolment });
	}

	function onOpenChangeComplete(next: boolean) {
		if (!next) dispatch({ type: 'closed' });
	}
</script>

<div id="new-host">
	<AddHostGuide {slug} {open} />
	<div class="mb-4">
		<Dialog.Root bind:open={() => dialog.open, setOpen} {onOpenChangeComplete}>
			<Dialog.Trigger id={TRIGGER_ID} class={buttonVariants()}>
				<Plus class="size-4" />
				Create join token
			</Dialog.Trigger>
			<Dialog.Content class="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-lg" onCloseAutoFocus={restoreFocusTo(TRIGGER_ID)}>
				<Dialog.Header class="shrink-0 pr-8">
					<Dialog.Title>{shown || dialog.confirming ? 'Join token created' : 'Create join token'}</Dialog.Title>
					<Dialog.Description>
						{shown || dialog.confirming ? 'Enrol the host with this token. It is not shown again.' : 'A host enrols into this project with a join token.'}
					</Dialog.Description>
				</Dialog.Header>
				<div class="min-h-0 overflow-y-auto">
					{#if dialog.confirming}
						<div class="grid gap-3">
							<p class="text-sm">The token is not shown again. Close anyway?</p>
							<div class="flex flex-wrap items-center gap-2">
								<Button type="button" id={FOCUS_IDS['keep-open']} onclick={() => dispatch({ type: 'keep-open' })}>Keep open</Button>
								<Button type="button" variant="outline" onclick={() => dispatch({ type: 'close-anyway' })}>Close anyway</Button>
							</div>
						</div>
					{:else if shown}
						<JoinTokenResult created={shown} {slug} {enrolment} {message} copyId={FOCUS_IDS['copy-instructions']} />
						<div class="mt-3">
							<Dialog.Close type="button" id={FOCUS_IDS.close} class={buttonVariants({ variant: 'outline' })}>Close</Dialog.Close>
						</div>
					{:else}
						<form
							method="POST"
							action={actionUrlFrom(page.url, 'createToken')}
							class="grid gap-3"
							use:enhance={() => {
								dispatch({ type: 'submit' });
								return async ({ result, update }) => {
									await update();
									if (result.type === 'failure') dispatch({ type: 'failed' });
								};
							}}
						>
							{#if dialog.sent && message}
								<div id="create-token-error" tabindex="-1" class="max-w-full min-w-0 break-words focus-visible:ring-3 focus-visible:ring-ring">
									<Notice kind="error">{message}</Notice>
								</div>
							{/if}
							<Label class="grid gap-1.5" for="host-name-hint">
								Host name hint
								<Input id="host-name-hint" name="host_name_hint" maxlength={80} autocomplete="off" />
							</Label>
							<Label class="grid gap-1.5" for="token-expiry">
								Expiry in seconds
								<Input id="token-expiry" name="expires_in_sec" inputmode="numeric" min="300" max="604800" />
							</Label>
							<p class="text-muted-foreground text-sm">Leave expiry blank for 24 hours. The minimum is 300 and the maximum is 604800.</p>
							<div class="flex flex-wrap items-center gap-2">
								<Button type="submit">Create join token</Button>
								<Dialog.Close type="button" class={buttonVariants({ variant: 'outline' })}>Cancel</Dialog.Close>
							</div>
						</form>
					{/if}
				</div>
			</Dialog.Content>
		</Dialog.Root>
	</div>
</div>
