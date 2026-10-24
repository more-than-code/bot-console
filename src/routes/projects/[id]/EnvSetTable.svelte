<script lang="ts">
	import { enhance } from '$app/forms';
	import { tick } from 'svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import type { EnvSet, EnvSetKey } from '$lib/api-types';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Table from '$lib/components/ui/table';
	import { beginAddVariable, cancelAddVariable, envSetKeyCount, initialEnvSetPanel, setAddSecret, toggleEnvSet } from './env-set-panel';

	let {
		set,
		putAction,
		deleteAction,
		deleteSetAction
	}: { set: EnvSet; putAction: string; deleteAction: string; deleteSetAction: string } = $props();

	// Collapse hides the table. It does not clear an edit or a new-row draft.
	let panel = $state(initialEnvSetPanel());
	let editing = $state<string | null>(null);
	let plainDraft = $state('');

	const tableId = $derived(`env-table-${set.name}`);
	const editingItem = $derived(set.keys.find((item) => item.key === editing) ?? null);

	function domId(part: string, key = ''): string {
		return key === '' ? `env-${part}-${set.name}` : `env-${part}-${set.name}-${key}`;
	}

	async function startEdit(item: EnvSetKey) {
		editing = item.key;
		plainDraft = item.is_secret ? '' : (item.value ?? '');
		await tick();
		document.getElementById(domId('value', item.key))?.focus();
	}

	async function cancelEdit(key: string) {
		editing = null;
		plainDraft = '';
		await tick();
		document.getElementById(domId('edit', key))?.focus();
	}

	async function startAdd() {
		panel = beginAddVariable(panel);
		await tick();
		document.getElementById(domId('add-key'))?.focus();
	}

	async function cancelAdd() {
		panel = cancelAddVariable(panel);
		await tick();
		document.getElementById(domId('add-variable'))?.focus();
	}

	function afterKey(secret: boolean, clearAdd = false) {
		return ({ formElement }: { formElement: HTMLFormElement }) => {
			return async ({ update, result }: { update: () => Promise<void>; result: { type: string } }) => {
				if (secret) {
					const input = formElement.querySelector('input[name="value"]');
					if (input instanceof HTMLInputElement) input.value = '';
					if (clearAdd) panel.addPlain = '';
				}
				await update();
				if (result.type !== 'redirect') document.getElementById('settings-error')?.focus();
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
			onclick={() => (panel = toggleEnvSet(panel))}
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
			<Button type="button" id={domId('add-variable')} variant="outline" size="sm" aria-label="Add variable to {set.name}" onclick={startAdd}>
				Add variable
			</Button>
			<ConfirmAction
				id="delete-env-{set.name}"
				action={deleteSetAction}
				label="Delete"
				confirmLabel="Delete"
				message="Delete env set {set.name}?"
				closeOnFailure
				hidden={[{ name: 'set', value: set.name }]}
			/>
		</div>
	</div>
	<div class="grid gap-3" hidden={!panel.open}>
		{#if panel.adding}
			<form method="POST" action={putAction} class="grid gap-3 sm:flex sm:flex-wrap sm:items-end" aria-label="New variable in {set.name}" use:enhance={afterKey(panel.addSecret, true)}>
				<Input type="hidden" name="set" value={set.name} />
				<Input type="hidden" name="op" value="add" />
				<Input type="hidden" name="is_secret" value={panel.addSecret ? '1' : '0'} />
				<Label class="grid w-full gap-1.5 sm:w-auto sm:min-w-36 sm:flex-1" for={domId('add-key')}>
					Key
					<Input id={domId('add-key')} name="key" bind:value={panel.addKey} required maxlength={64} autocomplete="off" spellcheck="false" />
				</Label>
				<Label class="grid w-full gap-1.5 sm:w-auto sm:min-w-36 sm:flex-1" for={domId('add-value')}>
					Value
					<Input id={domId('add-value')} name="value" type={panel.addSecret ? 'password' : 'text'} bind:value={panel.addPlain} autocomplete="off" spellcheck="false" />
				</Label>
				<Label class="flex items-center gap-2 pb-1">
					<Checkbox
						id={domId('add-secret')}
						checked={panel.addSecret}
						aria-label="Secret"
						onCheckedChange={(value) => (panel = setAddSecret(panel, value === true))}
					/>
					Secret
				</Label>
				<Button type="submit" aria-label="Save new variable in {set.name}">Save</Button>
				<Button type="button" variant="outline" aria-label="Cancel new variable in {set.name}" onclick={cancelAdd}>Cancel</Button>
			</form>
		{/if}
		{#if editingItem}
			{@const item = editingItem}
			<form id={domId('edit-form', item.key)} method="POST" action={putAction} class="grid gap-3 sm:flex sm:flex-wrap sm:items-end" aria-label="Edit {item.key} in {set.name}" use:enhance={afterKey(item.is_secret)}>
				<Input type="hidden" name="set" value={set.name} />
				<Input type="hidden" name="key" value={item.key} />
				<p class="w-full font-mono text-sm break-all sm:w-auto">{item.key}</p>
				{#if item.is_secret}
					<Label class="grid w-full gap-1.5 sm:w-auto sm:min-w-36 sm:flex-1" for={domId('value', item.key)}>
						New value
						<Input id={domId('value', item.key)} name="value" type="password" autocomplete="off" spellcheck="false" />
					</Label>
				{:else}
					<Label class="grid w-full gap-1.5 sm:w-auto sm:min-w-36 sm:flex-1" for={domId('value', item.key)}>
						Value
						<Input id={domId('value', item.key)} name="value" type="text" bind:value={plainDraft} autocomplete="off" spellcheck="false" />
					</Label>
				{/if}
				<Button type="submit" aria-label="Save {item.key}">Save</Button>
				<Button type="button" variant="outline" aria-label="Cancel editing {item.key}" onclick={() => cancelEdit(item.key)}>Cancel</Button>
			</form>
		{/if}
		<Table.Root id={tableId} aria-label="{set.name} variables">
		<Table.Header>
			<Table.Row>
				<Table.Head>Key</Table.Head>
				<Table.Head>Value</Table.Head>
				<Table.Head>Kind</Table.Head>
				<Table.Head>Actions</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#if set.keys.length === 0 && !panel.adding}
				<Table.Row>
					<Table.Cell colspan={4} class="text-muted-foreground whitespace-normal">No keys.</Table.Cell>
				</Table.Row>
			{/if}
			{#each set.keys as item (`${set.name}:${item.key}`)}
				<Table.Row>
					<Table.Cell class="max-w-48 whitespace-normal">
						<span class="break-all font-mono">{item.key}</span>
					</Table.Cell>
					<Table.Cell class="max-w-md whitespace-normal">
						{#if item.is_secret}
							<span class="font-mono text-sm">
								<span class="sr-only">secret, preview only</span>
								<span class="select-none" aria-hidden="true">{item.preview ?? ''}</span>
							</span>
						{:else}
							<span class="font-mono text-sm break-all">{item.value ?? ''}</span>
						{/if}
					</Table.Cell>
					<Table.Cell>
						<Badge variant="outline">{item.is_secret ? 'Secret' : 'Plain'}</Badge>
					</Table.Cell>
					<Table.Cell class="whitespace-normal">
						<div class="flex flex-wrap items-center gap-2">
							{#if editing !== item.key}
								<Button type="button" id={domId('edit', item.key)} variant="outline" size="sm" aria-label="Edit {item.key}" onclick={() => startEdit(item)}>Edit</Button>
								{#if !item.is_secret}
									<CopyButton value={item.value ?? ''} label="Copy {item.key}" />
								{/if}
							{/if}
							<ConfirmAction
								id={domId('delete', item.key)}
								action={deleteAction}
								label="Delete {item.key}"
								confirmLabel="Delete"
								message="Delete {item.key} from {set.name}?"
								hidden={[
									{ name: 'set', value: set.name },
									{ name: 'key', value: item.key }
								]}
							/>
						</div>
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
		</Table.Root>
	</div>
</div>
