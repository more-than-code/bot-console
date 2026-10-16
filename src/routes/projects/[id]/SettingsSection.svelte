<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Textarea from '$lib/components/Textarea.svelte';
	import type { EnvSet, Project, Registry } from '$lib/api-types';
	import { clearSecretField } from '$lib/secret-field';
	import { actionUrlFrom } from '$lib/url';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	let {
		project,
		canOwner,
		canAdmin = false,
		message,
		settingsField = null,
		envSets = [],
		envSetsMessage = null,
		registries = [],
		registriesMessage = null
	}: {
		project: Project;
		canOwner: boolean;
		canAdmin?: boolean;
		message: string | null;
		settingsField?: 'dotenv' | 'token' | null;
		envSets?: EnvSet[];
		envSetsMessage?: string | null;
		registries?: Registry[];
		registriesMessage?: string | null;
	} = $props();

	let dotenv = $state('');
	let setName = $state('');
	let savedSet = $state<string | null>(null);
	let token = $state('');

	function clearPaste({ formData }: { formData: FormData }) {
		const name = String(formData.get('set') ?? '');
		return async ({ update, result }: { update: () => Promise<void>; result: { type: string } }) => {
			await clearSecretField((value) => {
				dotenv = value;
			}, update);
			// A save ends in a redirect. Say so, and clear the name so the next paste starts empty.
			savedSet = result.type === 'redirect' ? name : null;
			if (savedSet) setName = '';
			document.getElementById('env-set-error')?.focus();
		};
	}

	function clearToken() {
		return async ({ update }: { update: () => Promise<void> }) => {
			await clearSecretField((value) => {
				token = value;
			}, update);
			document.getElementById('registry-token-error')?.focus();
		};
	}
</script>

{#if message && !settingsField}
	<Notice kind="error">{message}</Notice>
{/if}
{#if envSetsMessage}
	<Notice kind="error">{envSetsMessage}</Notice>
{/if}
{#if registriesMessage}
	<Notice kind="error">{registriesMessage}</Notice>
{/if}
{#if canOwner}
	<Card.Root class="mb-4">
		<Card.Header>
			<Card.Title>Rename</Card.Title>
		</Card.Header>
		<Card.Content>
			<form method="POST" action={actionUrlFrom(page.url, 'rename')} class="grid gap-3" use:enhance>
				<Label class="grid gap-1.5" for="project-rename">
					Project name
					<Input id="project-rename" name="name" value={project.name} required maxlength={80} autocomplete="off" />
				</Label>
				<div>
					<Button type="submit">Rename project</Button>
				</div>
			</form>
		</Card.Content>
	</Card.Root>
	<Card.Root>
		<Card.Header>
			<Card.Title>Delete</Card.Title>
			<Card.Description>Deleting revokes this project's host credentials.</Card.Description>
		</Card.Header>
		<Card.Content>
			<ConfirmAction
				id="delete-project"
				action={actionUrlFrom(page.url, 'deleteProject')}
				label="Delete project"
				confirmLabel="Delete project"
				message="Delete {project.name}? This revokes the project's host credentials."
				typeToConfirm={{ name: 'confirm', expected: project.name, label: `Type ${project.name} to confirm` }}
			/>
		</Card.Content>
	</Card.Root>
{:else if !canAdmin}
	<p class="text-muted-foreground text-sm">Only the owner can change these settings.</p>
{:else}
	<p class="text-muted-foreground text-sm">Only the owner can rename or delete this project.</p>
{/if}
{#if canAdmin}
	<Card.Root class="mt-4">
		<Card.Header>
			<Card.Title>Env sets</Card.Title>
			<Card.Description>Secret values stay on the API. This page lists key names only.</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-4">
			{#if envSets.length === 0}
				<p class="text-muted-foreground text-sm">No env sets.</p>
			{/if}
			{#each envSets as set (set.name)}
				<div class="grid gap-2">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<p class="min-w-0 text-sm font-medium break-all">{set.name}</p>
						<ConfirmAction
							id="delete-env-{set.name}"
							action={actionUrlFrom(page.url, 'deleteEnvSet')}
							label="Delete"
							confirmLabel="Delete"
							message="Delete env set {set.name}?"
							hidden={[{ name: 'set', value: set.name }]}
						/>
					</div>
					{#if set.keys.length === 0}
						<p class="text-muted-foreground text-sm">No keys.</p>
					{/if}
					{#each set.keys as item (`${set.name}:${item.key}`)}
						<form method="POST" action={actionUrlFrom(page.url, 'patchEnvKey')} class="flex flex-wrap items-center gap-2" use:enhance>
							<Input type="hidden" name="set" value={set.name} />
							<Input type="hidden" name="key" value={item.key} />
							{#if !item.is_secret}
								<Input type="hidden" name="is_secret" value="1" />
							{/if}
							<span class="min-w-0 font-mono text-sm break-all">{item.key}</span>
							<span class="text-muted-foreground text-sm">{item.is_secret ? 'secret' : 'plain'}</span>
							<Button type="submit" variant="outline" size="sm">{item.is_secret ? 'Make plain' : 'Make secret'}</Button>
						</form>
					{/each}
				</div>
			{/each}
			<form method="POST" action={actionUrlFrom(page.url, 'saveEnvSet')} class="grid gap-3" use:enhance={clearPaste}>
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
				{#if savedSet && !(settingsField === 'dotenv' && message)}
					<Notice kind="success">Saved env set {savedSet}.</Notice>
				{/if}
				{#if settingsField === 'dotenv' && message}
					<div id="env-set-error" tabindex="-1" class="max-w-full min-w-0 break-words focus-visible:ring-3 focus-visible:ring-ring">
						<Notice kind="error">{message}</Notice>
					</div>
				{/if}
				<div>
					<Button type="submit">Save env set</Button>
				</div>
			</form>
		</Card.Content>
	</Card.Root>
	<Card.Root class="mt-4">
		<Card.Header>
			<Card.Title>Registries</Card.Title>
			<Card.Description>The token is write-only. It is not shown again.</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-4">
			{#if registries.length === 0}
				<p class="text-muted-foreground text-sm">No registries.</p>
			{/if}
			{#each registries as row (row.host)}
				<div class="flex flex-wrap items-center justify-between gap-2">
					<p class="min-w-0 text-sm break-all"><span class="font-mono">{row.host}</span> <span class="text-muted-foreground">{row.username}</span></p>
					<ConfirmAction
						id="delete-registry-{row.host}"
						action={actionUrlFrom(page.url, 'deleteRegistry')}
						label="Delete"
						confirmLabel="Delete"
						message="Delete registry {row.host}?"
						hidden={[{ name: 'host', value: row.host }]}
					/>
				</div>
			{/each}
			<form method="POST" action={actionUrlFrom(page.url, 'saveRegistry')} class="grid gap-3" use:enhance={clearToken}>
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
						aria-invalid={settingsField === 'token' && message ? true : undefined}
						aria-describedby={settingsField === 'token' && message ? 'registry-token-error' : undefined}
					/>
				</Label>
				{#if settingsField === 'token' && message}
					<div id="registry-token-error" tabindex="-1" class="max-w-full min-w-0 break-words focus-visible:ring-3 focus-visible:ring-ring">
						<Notice kind="error">{message}</Notice>
					</div>
				{/if}
				<div>
					<Button type="submit">Save registry</Button>
				</div>
			</form>
		</Card.Content>
	</Card.Root>
{/if}
