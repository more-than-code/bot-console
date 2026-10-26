<script lang="ts">
	import { enhance } from '$app/forms';
	import { tick } from 'svelte';
	import Lock from '@lucide/svelte/icons/lock';
	import Pencil from '@lucide/svelte/icons/pencil';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import RowAction from '$lib/components/RowAction.svelte';
	import type { EnvSet, EnvSetKey } from '$lib/api-types';
	import { COPY_FAILED_NOTE } from '$lib/copy-text';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Table from '$lib/components/ui/table';
	import EnvAddVariablesDialog from './EnvAddVariablesDialog.svelte';
	import EnvValueEditor from './EnvValueEditor.svelte';
	import {
		MAKE_SECRET_MESSAGE,
		editValueField,
		envDomId,
		envSetKeyCount,
		failureMessage,
		focusAfterEditSave,
		focusIsFree,
		initialEnvSetPanel,
		isCancelKey,
		keyWrapParts,
		madeSecretNote,
		rowEditErrorText,
		savedVariablesNote,
		rowEditFailed,
		secretEditRefusal,
		toggleEnvSet,
		type RowEdit
	} from './env-set-panel';

	let {
		set,
		putAction,
		deleteAction,
		deleteSetAction,
		makeSecretAction,
		mergeAction,
		mergeError = null,
		onAction = () => {}
	}: {
		set: EnvSet;
		putAction: string;
		deleteAction: string;
		deleteSetAction: string;
		makeSecretAction: string;
		mergeAction: string;
		/** An Add variables (paste) failure for this set, shown on that dialog's Paste several tab. */
		mergeError?: string | null;
		/** Another env action ran here (save, add, make secret, delete): the card clears "Saved env set …". */
		onAction?: () => void;
	} = $props();

	// The panel's one status line ("Made {KEY} secret.", "Added {KEY}.", "Saved {KEY}."). Local only:
	// the text comes from the submitted key, so it does not depend on reloaded data.
	let statusNote = $state('');

	// The row's trigger is gone by now (the row reloaded as secret), so the table moves focus.
	async function afterMakeSecret(form: FormData) {
		onAction();
		statusNote = madeSecretNote(String(form.get('keys')));
		await tick();
		document.getElementById(domId('status'))?.focus();
	}

	// An icon-only copy shows "Copied" on the button itself; a failure goes to the status line.
	function copyResult(note: string) {
		if (note === COPY_FAILED_NOTE) statusNote = note;
		else if (statusNote === COPY_FAILED_NOTE) statusNote = '';
	}

	// Collapse hides the table. It does not clear an edit in progress.
	let panel = $state(initialEnvSetPanel());
	// One row at a time is in edit state; Edit on another row replaces it.
	let edit = $state<RowEdit>(null);
	let plainDraft = $state('');

	const tableId = $derived(`env-table-${set.name}`);

	function domId(part: string, key = ''): string {
		return envDomId(set.name, part, key);
	}

	function focusById(target: string) {
		document.getElementById(target)?.focus();
	}

	async function startEdit(item: EnvSetKey) {
		edit = { key: item.key, error: '', retype: false };
		plainDraft = editValueField(item).value;
		await tick();
		focusById(domId('value', item.key));
	}

	async function cancelEdit(key: string) {
		edit = null;
		plainDraft = '';
		await tick();
		focusById(domId('edit', key));
	}

	function onRowKeydown(key: string) {
		return (event: KeyboardEvent) => {
			if (!isCancelKey(event)) return;
			event.preventDefault();
			void cancelEdit(key);
		};
	}

	function clearRowError() {
		if (edit && edit.error !== '') edit = { ...edit, error: '', retype: false };
	}

	async function showRowError(key: string, message: string, retype: boolean) {
		edit = rowEditFailed(edit, key, message, retype);
		await tick();
		focusById(domId('value', key));
	}

	function saveEdit(item: EnvSetKey) {
		return ({ formData, formElement, cancel }: { formData: FormData; formElement: HTMLFormElement; cancel: () => void }) => {
			// An empty secret would replace the stored value with nothing: refuse before sending.
			const refused = secretEditRefusal(item, String(formData.get('value') ?? ''));
			if (refused) {
				cancel();
				void showRowError(item.key, refused, false);
				return;
			}
			statusNote = '';
			onAction();
			return async ({ update, result }: { update: () => Promise<void>; result: { type: string; data?: unknown } }) => {
				const input = document.getElementById(domId('value', item.key));
				// A typed secret is not kept in the page after it is sent.
				if (item.is_secret && input instanceof HTMLInputElement) input.value = '';
				if (result.type === 'failure') {
					// Stay in edit state; the message (never the value) shows under the input.
					await showRowError(item.key, failureMessage(result), item.is_secret);
					return;
				}
				if (result.type !== 'redirect') {
					await update();
					return;
				}
				statusNote = `Saved ${item.key}.`;
				// Leave edit state only once the reloaded value is there, so the old one does not flash.
				const savedRow = formElement.closest('tr');
				await update();
				// A late result must not pull focus away from where the user has moved since.
				const free = focusIsFree(document.activeElement, document.body, savedRow);
				if (edit?.key === item.key) {
					edit = null;
					plainDraft = '';
				}
				await tick();
				if (free) focusById(focusAfterEditSave(set.name, set.keys.map((row) => row.key), item.key));
			};
		};
	}
</script>

<div class="grid gap-2">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<Button
			type="button"
			variant="ghost"
			class="h-auto min-w-0 justify-start whitespace-normal text-left"
			aria-expanded={panel.open}
			aria-controls={tableId}
			onclick={() => {
				panel = toggleEnvSet(panel);
				statusNote = '';
			}}
		>
			{#if panel.open}
				<ChevronDown aria-hidden="true" />
			{:else}
				<ChevronRight aria-hidden="true" />
			{/if}
			<span class="break-all font-medium">{set.name}</span>
			<span class="text-muted-foreground">{envSetKeyCount(set.keys.length)}</span>
		</Button>
		<div class="flex flex-wrap items-center gap-2">
			<EnvAddVariablesDialog
				setName={set.name}
				existingKeys={set.keys.map((row) => row.key)}
				addAction={putAction}
				{mergeAction}
				{mergeError}
				onAdded={(key) => {
					onAction();
					statusNote = `Added ${key}.`;
					panel = { ...panel, open: true };
				}}
				onMerged={() => {
					onAction();
					statusNote = savedVariablesNote(set.name);
					panel = { ...panel, open: true };
				}}
			/>
			<ConfirmAction
				id="delete-env-{set.name}"
				action={deleteSetAction}
				label="Delete"
				confirmLabel="Delete"
				message="Delete env set {set.name}?"
				onSuccess={onAction}
				closeOnFailure
				failureFocusId="settings-error"
				hidden={[{ name: 'set', value: set.name }]}
			/>
		</div>
	</div>
	<p id={domId('status')} role="status" tabindex="-1" class={statusNote ? 'text-sm break-all rounded-md focus-visible:ring-3 focus-visible:ring-ring' : 'sr-only'}>{statusNote}</p>
	<div class="grid gap-3" hidden={!panel.open}>
		<Table.Root id={tableId} aria-label="{set.name} variables">
		<Table.Header>
			<Table.Row>
				<Table.Head>Key</Table.Head>
				<Table.Head>Value</Table.Head>
				<Table.Head>Kind</Table.Head>
				<!-- Below sm the word would set the column wider than its icons; it stays for screen readers. -->
				<Table.Head><span class="sr-only sm:not-sr-only">Actions</span></Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#if set.keys.length === 0}
				<Table.Row>
					<Table.Cell colspan={4} class="text-muted-foreground whitespace-normal">No keys.</Table.Cell>
				</Table.Row>
			{/if}
			{#each set.keys as item (`${set.name}:${item.key}`)}
				{@const editingRow = edit?.key === item.key}
				<Table.Row onkeydown={editingRow ? onRowKeydown(item.key) : undefined}>
					<Table.Cell class="whitespace-normal">
						<!-- Wraps after an underscore (<wbr>); only a part wider than the cap breaks inside. -->
						<span class="inline-block max-w-28 font-mono break-words sm:max-w-48">{#each keyWrapParts(item.key) as part, i}{#if i > 0}<wbr />{/if}{part}{/each}</span>
					</Table.Cell>
					{#if editingRow}
						<!-- Spans Value, Kind and Actions so Save and Cancel stay on screen at 375 px. -->
						<Table.Cell colspan={3} class="whitespace-normal">
							<div class="grid gap-2 sm:flex sm:items-start">
								<div class="min-w-0 sm:flex-1">
									<EnvValueEditor
										{item}
										inputId={domId('value', item.key)}
										errorId={domId('value-error', item.key)}
										formId={domId('edit-form', item.key)}
										error={rowEditErrorText(edit)}
										bind:draft={plainDraft}
										onInput={clearRowError}
									/>
								</div>
								<form
									id={domId('edit-form', item.key)}
									method="POST"
									action={putAction}
									class="flex flex-wrap items-center gap-2"
									aria-label="Edit {item.key} in {set.name} ({item.is_secret ? 'secret' : 'plain'})"
									use:enhance={saveEdit(item)}
								>
									<Input type="hidden" name="set" value={set.name} />
									<Input type="hidden" name="key" value={item.key} />
									<Button type="submit" size="sm" aria-label="Save {item.key}">Save</Button>
									<Button type="button" variant="outline" size="sm" aria-label="Cancel editing {item.key}" onclick={() => cancelEdit(item.key)}>Cancel</Button>
								</form>
							</div>
						</Table.Cell>
					{:else}
						<Table.Cell class="max-w-md whitespace-normal">
							{#if item.is_secret}
								<span class="font-mono text-sm">
									<span class="sr-only">secret, preview only</span>
									<span class="select-none" aria-hidden="true">{item.preview ?? ''}</span>
								</span>
							{:else}
								<!-- Wraps at spaces and hyphens first; only a token wider than the column breaks inside. -->
								<span class="font-mono text-sm [overflow-wrap:anywhere]">{item.value ?? ''}</span>
							{/if}
						</Table.Cell>
						<Table.Cell>
							<Badge variant="outline">{item.is_secret ? 'Secret' : 'Plain'}</Badge>
						</Table.Cell>
						<Table.Cell class="whitespace-normal">
							<div class="flex flex-wrap items-center gap-1">
								<RowAction id={domId('edit', item.key)} label="Edit {item.key}" icon={Pencil} onclick={() => startEdit(item)} />
								{#if !item.is_secret}
									<CopyButton value={item.value ?? ''} label="Copy {item.key}" tip="Copy {item.key}" iconOnly onResult={copyResult} />
								{/if}
								{#if !item.is_secret}
									<!-- `label` stays fixed so a key name such as DELETE_ME never makes it destructive. -->
									<ConfirmAction
										id={domId('make-secret', item.key)}
										action={makeSecretAction}
										label="Make secret"
										rowLabel="Make {item.key} secret"
										icon={Lock}
										confirmLabel="Make secret"
										message="Make {item.key} secret? {MAKE_SECRET_MESSAGE}"
										messageClass="max-w-full min-w-0 break-words"
										closeOnFailure
										failureFocusId="settings-error"
										onSuccess={afterMakeSecret}
										hidden={[
											{ name: 'set', value: set.name },
											{ name: 'keys', value: item.key }
										]}
									/>
								{/if}
								<ConfirmAction
									id={domId('delete', item.key)}
									action={deleteAction}
									label="Delete {item.key}"
									rowLabel="Delete {item.key}"
									confirmLabel="Delete"
									message="Delete {item.key} from {set.name}?"
									onSuccess={onAction}
									closeOnFailure
									failureFocusId="settings-error"
									hidden={[
										{ name: 'set', value: set.name },
										{ name: 'key', value: item.key }
									]}
								/>
							</div>
						</Table.Cell>
					{/if}
				</Table.Row>
			{/each}
		</Table.Body>
		</Table.Root>
	</div>
</div>
