<script lang="ts">
	import { browser } from '$app/environment';
	import { enhance } from '$app/forms';
	import { untrack, type Snippet } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import Notice from '$lib/components/Notice.svelte';
	import type { CatalogEntry, Host } from '$lib/api-types';
	import { mergePreviewEnv, runAsChoices, shellRisk, shouldApplyPreviewUpdate, submitCatalogPreview } from '$lib/catalog';
	import type { CatalogDraft, CatalogEditorState } from '$lib/project-action';

	let {
		mode,
		entry = null,
		hosts,
		saveAction,
		parseAction,
		editor = null,
		cancel
	}: {
		mode: 'create' | 'edit';
		entry?: CatalogEntry | null;
		hosts: Host[];
		saveAction: string;
		parseAction: string;
		editor?: CatalogEditorState | null;
		cancel?: Snippet;
	} = $props();

	function emptyDraft(): CatalogDraft {
		return { name: '', command: '', shell: false, dir: '', runAs: '', port: '', restart: 'on-failure', env: [] };
	}

	function fromEntry(item: CatalogEntry): CatalogDraft {
		return {
			name: item.name,
			command: item.command_display,
			shell: item.spec.shell,
			dir: item.spec.dir,
			runAs: item.spec.run_as,
			port: item.spec.port == null ? '' : String(item.spec.port),
			restart: item.spec.restart,
			env: Object.entries(item.spec.env).map(([key, value]) => ({ key, value }))
		};
	}

	function starting(): CatalogDraft {
		const base = editor ? editor.draft : entry ? fromEntry(entry) : emptyDraft();
		const shown = editor?.preview;
		if (!editor || !shown) return base;
		if (editor.draft.command !== base.command || editor.draft.shell !== base.shell) return base;
		return { ...base, env: mergePreviewEnv(base.env, shown.env) };
	}

	const initial = untrack(starting);
	let name = $state(initial.name);
	let command = $state(initial.command);
	let shell = $state(initial.shell);
	let dir = $state(initial.dir);
	let runAs = $state(initial.runAs);
	let port = $state(initial.port);
	let restart = $state(initial.restart);
	let envRows = $state(initial.env.map((row) => ({ key: row.key, value: row.value })));
	let formEl = $state<HTMLFormElement | null>(null);
	let previewButton = $state<HTMLButtonElement | null>(null);
	let previewRequest = 0;
	let previewTimer: ReturnType<typeof setTimeout> | undefined;
	let lastPreview = '';
	let appliedPreview = '';

	function clearPreviewTimer() {
		if (previewTimer !== undefined) {
			clearTimeout(previewTimer);
			previewTimer = undefined;
		}
	}

	function previewIdentity(exec: string, args: readonly string[], env: Record<string, string>, display: string): string {
		return `${display}\n${exec}\n${args.join('\n')}\n${JSON.stringify(env)}`;
	}

	const choices = $derived(runAsChoices(hosts, shell));
	const fieldId = $derived(mode === 'edit' && entry ? `catalog-${entry.name}` : 'catalog-new');
	const matched = $derived(editor != null && editor.draft.command === command && editor.draft.shell === shell);
	const preview = $derived(matched ? (editor?.preview ?? null) : null);
	const previewMessage = $derived(matched ? (editor?.previewMessage ?? null) : null);
	const saveMessage = $derived(editor?.message ?? null);
	const argv = $derived(preview ? [preview.exec, ...preview.args] : []);
	const risk = $derived(shellRisk(runAs));

	$effect(() => {
		if (runAs !== '' && !choices.includes(runAs)) runAs = '';
	});

	$effect(() => {
		const current = preview;
		if (!current) return;
		const identity = previewIdentity(current.exec, current.args, current.env, current.command_display);
		if (identity === appliedPreview) return;
		appliedPreview = identity;
		const rows = untrack(() => envRows);
		envRows = mergePreviewEnv(rows, current.env);
	});

	$effect(() => {
		if (!browser) return;
		const line = command;
		const useShell = shell;
		const token = `${useShell ? '1' : '0'}\n${line}`;
		if (line.length === 0 || token === lastPreview) return;
		previewTimer = setTimeout(() => {
			previewTimer = undefined;
			if (!formEl || !previewButton) return;
			const lineToken = token;
			submitCatalogPreview(formEl, previewButton, () => {
				lastPreview = lineToken;
			});
		}, 400);
		return () => clearPreviewTimer();
	});

	function addEnv() {
		if (envRows.length >= 64) return;
		envRows = [...envRows, { key: '', value: '' }];
	}

	function removeEnv(index: number) {
		envRows = envRows.filter((_, item) => item !== index);
	}

</script>

<form
	bind:this={formEl}
	method="POST"
	action={saveAction}
	class="grid gap-3"
	use:enhance={({ submitter }) => {
		const previewing = submitter === previewButton;
		if (!previewing) {
			clearPreviewTimer();
			previewRequest += 1;
		}
		const mine = previewing ? ++previewRequest : previewRequest;
		return async ({ update }) => {
			if (!shouldApplyPreviewUpdate(previewing, mine, previewRequest)) return;
			await update({ reset: false });
			if (previewing) lastPreview = `${shell ? '1' : '0'}\n${command}`;
		};
	}}
>
	{#if saveMessage}
		<Notice kind="error">{saveMessage}</Notice>
	{/if}
	<Input type="hidden" name="editor_mode" value={mode === 'edit' ? 'edit' : 'create'} />
	{#if mode === 'edit' && entry}
		<Input type="hidden" name="entry_name" value={entry.name} />
	{:else}
		<Label class="grid gap-1.5" for="{fieldId}-name">
			Name
			<Input id="{fieldId}-name" name="name" bind:value={name} required maxlength={48} autocomplete="off" />
		</Label>
	{/if}
	<Label class="grid gap-1.5" for="{fieldId}-dir">
		Working directory
		<Input id="{fieldId}-dir" name="dir" bind:value={dir} required maxlength={255} autocomplete="off" />
	</Label>
	<Label class="grid gap-1.5" for="{fieldId}-command">
		Command
		<Input id="{fieldId}-command" name="command" bind:value={command} required maxlength={4096} autocomplete="off" />
	</Label>
	<Label class="flex items-center gap-2" for="{fieldId}-shell">
		<Checkbox id="{fieldId}-shell" name="shell" value="1" checked={shell} onCheckedChange={(value) => (shell = value)} />
		Run through a shell
	</Label>
	{#if shell && risk}
		<p class="text-muted-foreground text-sm">{risk}</p>
	{/if}
	<div class="grid gap-1.5">
		<Label for="{fieldId}-run-as">Run as</Label>
		<Select.Root type="single" name="run_as" bind:value={runAs}>
			<Select.Trigger id="{fieldId}-run-as" class="w-full">
				<Select.Value placeholder="Choose an account" />
			</Select.Trigger>
			<Select.Content>
				{#each choices as account (account)}
					<Select.Item value={account}>{account}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		{#if choices.length === 0}
			<p class="text-muted-foreground text-sm">No eligible host allows a run-as account.</p>
		{/if}
	</div>
	<Label class="grid gap-1.5" for="{fieldId}-port">
		Expected port
		<Input id="{fieldId}-port" name="port" bind:value={port} inputmode="numeric" maxlength={5} autocomplete="off" />
	</Label>
	<div class="grid gap-1.5">
		<Label for="{fieldId}-restart">Restart</Label>
		<Select.Root type="single" name="restart" bind:value={restart}>
			<Select.Trigger id="{fieldId}-restart" class="w-40">
				<Select.Value />
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="on-failure">on-failure</Select.Item>
				<Select.Item value="no">no</Select.Item>
			</Select.Content>
		</Select.Root>
	</div>
	<div class="grid gap-2">
		<p class="text-sm font-medium">Environment</p>
		{#each envRows as row, index (index)}
			<div class="flex flex-wrap items-end gap-2">
				<Label class="grid min-w-0 flex-1 gap-1.5" for="{fieldId}-env-key-{index}">
					Key
					<Input id="{fieldId}-env-key-{index}" name="env_key" bind:value={envRows[index].key} maxlength={64} autocomplete="off" />
				</Label>
				<Label class="grid min-w-0 flex-1 gap-1.5" for="{fieldId}-env-value-{index}">
					Value
					<Input id="{fieldId}-env-value-{index}" name="env_value" bind:value={envRows[index].value} maxlength={4096} autocomplete="off" />
				</Label>
				<Button type="button" variant="outline" onclick={() => removeEnv(index)}>Remove</Button>
			</div>
		{/each}
		<Button type="button" variant="outline" disabled={envRows.length >= 64} onclick={addEnv}>Add variable</Button>
	</div>
	{#if preview}
		<p class="flex flex-wrap items-center gap-1">
			will run:
			{#each argv as arg, index (index)}
				<Badge variant="outline" class="max-w-full min-w-0 whitespace-normal break-all">{arg}</Badge>
			{/each}
		</p>
	{/if}
	{#if previewMessage}
		<Notice kind="error">{previewMessage}</Notice>
	{/if}
	<div class="flex flex-wrap items-center gap-2">
		<Button type="submit">Save</Button>
		<Button type="submit" variant="outline" formaction={parseAction} formnovalidate bind:ref={previewButton}>Preview</Button>
		{#if cancel}
			{@render cancel()}
		{/if}
	</div>
</form>
