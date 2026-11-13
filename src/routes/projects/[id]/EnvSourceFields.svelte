<script lang="ts">
	import InfoIcon from '@lucide/svelte/icons/info';
	import type { Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import Notice from '$lib/components/Notice.svelte';
	import { secretOverrideNote, setConflictNotes, setOrderLine, type EnvOverrides } from '$lib/env-precedence';
	import type { KnownSet } from '$lib/image-spec';

	/**
	 * The Env sets checkboxes and Secret env rows of a catalog entry form (image or program).
	 * Posts `env_set` (in draft order), `secret_key`, `secret_set` and `secret_name`. Names and key names only.
	 */
	let {
		fieldId,
		envSets = $bindable(),
		secrets = $bindable(),
		sets,
		setsStatus,
		setsMessage = null,
		retrySets,
		overrides,
		invalid = () => false,
		describedBy = () => undefined,
		notice
	}: {
		fieldId: string;
		envSets: string[];
		secrets: Array<{ key: string; set: string; name: string }>;
		sets: readonly KnownSet[];
		setsStatus: 'loading' | 'ready' | 'error';
		setsMessage?: string | null;
		retrySets?: () => void;
		/** `envOverrides` of the whole form, so these notes match the inline env rows' notes. */
		overrides: EnvOverrides;
		/** The form's field error state for `env_sets` and `secret_env`. */
		invalid?: (name: string) => boolean;
		describedBy?: (name: string) => string | undefined;
		/** The form's error notice for `env_sets` or `secret_env`. */
		notice?: Snippet<[string]>;
	} = $props();

	const setOptions = $derived.by(() => {
		const names = new Set(sets.map((set) => set.name));
		for (const name of envSets) names.add(name);
		return [...names].sort();
	});
	const setNotes = $derived(setConflictNotes(overrides));
	const orderLine = $derived(setOrderLine(envSets));

	/** Ids of the order line (for a selected set) and the set notes that name this set, for its checkbox. */
	function setNoteIds(name: string): string | undefined {
		const order = orderLine && envSets.includes(name) ? [`${fieldId}-set-order`] : [];
		const ids = [...order, ...setNotes.flatMap((note, index) => (note.sets.includes(name) ? [`${fieldId}-set-note-${index}`] : []))];
		return ids.length > 0 ? ids.join(' ') : undefined;
	}

	function withNote(noteId: string | null, name: string): string | undefined {
		const ids = [noteId, describedBy(name) ?? null].filter((id) => id != null);
		return ids.length > 0 ? ids.join(' ') : undefined;
	}

	function keysFor(setName: string, current: string): string[] {
		const keys = sets.find((set) => set.name === setName)?.keys ?? [];
		if (current !== '' && !keys.includes(current)) return [current, ...keys];
		return [...keys];
	}

	function toggleSet(name: string, checked: boolean) {
		if (checked) {
			if (!envSets.includes(name)) envSets = [...envSets, name];
			return;
		}
		envSets = envSets.filter((item) => item !== name);
	}
</script>

{#snippet overrideNote(id: string, text: string)}
	<p {id} class="text-muted-foreground flex min-w-0 items-start gap-1.5 text-sm break-words">
		<InfoIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
		<span class="min-w-0">{text}</span>
	</p>
{/snippet}

<div class="grid gap-1.5">
	<p class="text-sm font-medium">Env sets</p>
	<!-- Posted in draft order, not the alphabetical list order: a later set wins (api-v1 rule 12). -->
	{#each envSets as name (name)}
		<Input type="hidden" name="env_set" value={name} />
	{/each}
	{#if setsStatus === 'loading'}
		<p class="text-muted-foreground text-sm">Loading env sets…</p>
	{:else if setsStatus === 'error'}
		<Notice kind="error">{setsMessage ?? 'Env sets could not be loaded.'}</Notice>
		{#if retrySets}
			<Button type="button" variant="outline" onclick={retrySets}>Retry</Button>
		{/if}
	{:else if setOptions.length === 0}
		<p class="text-muted-foreground text-sm">No env sets yet.</p>
	{:else}
		{#each setOptions as name (name)}
			<Label class="flex min-w-0 items-start gap-2">
				<Checkbox checked={envSets.includes(name)} aria-describedby={setNoteIds(name)} onCheckedChange={(value) => toggleSet(name, value === true)} />
				<span class="min-w-0 break-all">{name}</span>
			</Label>
		{/each}
		{#if orderLine}
			<p id="{fieldId}-set-order" class="text-muted-foreground text-sm break-words">{orderLine}</p>
		{/if}
		{#each setNotes as note, index (note.key)}
			{@render overrideNote(`${fieldId}-set-note-${index}`, note.text)}
		{/each}
	{/if}
	{@render notice?.('env_sets')}
</div>
<div class="grid gap-1.5">
	<p class="text-sm font-medium">Secret env</p>
	{#each secrets as row, index (index)}
		{@const note = secretOverrideNote(overrides, row.key)}
		<div class="grid gap-2">
			<div class="flex flex-wrap items-center gap-2">
				<Label class="sr-only" for="{fieldId}-secret-key-{index}">Secret key {index + 1}</Label>
				<Input
					id="{fieldId}-secret-key-{index}"
					name="secret_key"
					bind:value={secrets[index].key}
					maxlength={64}
					placeholder="KEY"
					spellcheck="false"
					aria-invalid={invalid('secret_env')}
					aria-describedby={withNote(note ? `${fieldId}-secret-note-${index}` : null, 'secret_env')}
				/>
				<Button type="button" variant="outline" aria-label="Remove secret {index + 1}" onclick={() => (secrets = secrets.filter((_, item) => item !== index))}>Remove</Button>
			</div>
			{#if note}
				{@render overrideNote(`${fieldId}-secret-note-${index}`, note)}
			{/if}
			<Input type="hidden" name="secret_set" value={row.set} />
			<div role="radiogroup" aria-label="Secret set {index + 1}" class="grid min-w-0 gap-1">
				{#each setOptions as name (name)}
					<Button
						type="button"
						role="radio"
						variant={row.set === name ? 'secondary' : 'outline'}
						aria-checked={row.set === name}
						class="h-auto w-full min-w-0 justify-start text-left whitespace-normal break-all"
						onclick={() => (secrets[index].set = name)}>{name}</Button>
				{/each}
			</div>
			<Input type="hidden" name="secret_name" value={row.name} />
			<div role="radiogroup" aria-label="Secret name {index + 1}" class="grid min-w-0 gap-1">
				{#each keysFor(row.set, row.name) as key (key)}
					<Button
						type="button"
						role="radio"
						variant={row.name === key ? 'secondary' : 'outline'}
						aria-checked={row.name === key}
						class="h-auto w-full min-w-0 justify-start text-left whitespace-normal break-all"
						onclick={() => (secrets[index].name = key)}>{key}</Button>
				{/each}
			</div>
		</div>
	{/each}
	<Button type="button" variant="outline" disabled={secrets.length >= 64} onclick={() => (secrets = [...secrets, { key: '', set: '', name: '' }])}>Add secret</Button>
	{@render notice?.('secret_env')}
</div>
