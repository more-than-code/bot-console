<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import LocalTime from '$lib/components/LocalTime.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import FormDialog from '$lib/components/FormDialog.svelte';
	import EnvSetDialog from './EnvSetDialog.svelte';
	import EnvSetTable from './EnvSetTable.svelte';
	import ProjectFileForm from './ProjectFileForm.svelte';
	import RegistryForm from './RegistryForm.svelte';
	import { ENV_SET_STATUS_ID } from './env-set-panel';
	import type { EnvSet, Project, ProjectFile, Registry } from '$lib/api-types';
	import { formatBytes } from '$lib/format';
	import { showViewedFile } from '$lib/secret-field';
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
		files = [],
		filesMessage = null,
		viewedFile = null,
		settingsName = null,
		registries = [],
		registriesMessage = null
	}: {
		project: Project;
		canOwner: boolean;
		canAdmin?: boolean;
		message: string | null;
		settingsField?: 'dotenv' | 'token' | 'file' | null;
		envSets?: EnvSet[];
		envSetsMessage?: string | null;
		files?: ProjectFile[];
		filesMessage?: string | null;
		viewedFile?: { name: string; content: string } | null;
		settingsName?: string | null;
		registries?: Registry[];
		registriesMessage?: string | null;
	} = $props();

	// The Files card's "Saved file {name}." line, set by the Add file dialog.
	let savedFile = $state<string | null>(null);
	// The Registries card's "Saved registry {host}." line, set by the Add registry dialog.
	let savedRegistry = $state<string | null>(null);
	// The Env sets card's status line ("Saved env set {name}."), set by the New env set dialog.
	let envSetNote = $state('');
</script>

{#if message && !settingsField && !settingsName}
	<div id="settings-error" tabindex="-1" class="mb-4 max-w-full min-w-0 break-words focus-visible:ring-3 focus-visible:ring-ring">
		<Notice kind="error">{message}</Notice>
	</div>
{/if}
{#if envSetsMessage}
	<Notice kind="error">{envSetsMessage}</Notice>
{/if}
{#if filesMessage}
	<Notice kind="error">{filesMessage}</Notice>
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
			<Card.Description>Plain values are shown. A secret shows only a short preview.</Card.Description>
			<Card.Action>
				<EnvSetDialog action={actionUrlFrom(page.url, 'saveEnvSet')} {message} {settingsField} onStatus={(text) => (envSetNote = text)} />
			</Card.Action>
		</Card.Header>
		<Card.Content class="grid gap-4">
			<!-- Always present (sr-only while empty), so the live region exists before text arrives. -->
			<p id={ENV_SET_STATUS_ID} role="status" tabindex="-1" class={envSetNote ? 'text-sm break-all rounded-md focus-visible:ring-3 focus-visible:ring-ring' : 'sr-only'}>{envSetNote}</p>
			{#if envSets.length === 0}
				<p class="text-muted-foreground text-sm">No env sets.</p>
			{/if}
			{#each envSets as set (set.name)}
				<EnvSetTable
					{set}
					putAction={actionUrlFrom(page.url, 'putEnvKey')}
					deleteAction={actionUrlFrom(page.url, 'deleteEnvKey')}
					deleteSetAction={actionUrlFrom(page.url, 'deleteEnvSet')}
					makeSecretAction={actionUrlFrom(page.url, 'makeEnvKeysSecret')}
					onAction={() => (envSetNote = '')}
				/>
			{/each}
		</Card.Content>
	</Card.Root>
	<Card.Root class="mt-4">
		<Card.Header>
			<Card.Title>Files</Card.Title>
			<Card.Description>Secret files stay on the API. The paste box is never filled in.</Card.Description>
			<Card.Action>
				<FormDialog id="add-file" label="Add file" title="Add file" description="A secret file stays on the API. Its content is not shown again." failed={settingsField === 'file' && message != null}>
					{#snippet children(settle, cancel)}
						<ProjectFileForm
							action={actionUrlFrom(page.url, 'saveProjectFile')}
							error={settingsField === 'file' ? message : null}
							onSaved={(name) => (savedFile = name)}
							onSettled={settle}
							{cancel}
						/>
					{/snippet}
				</FormDialog>
			</Card.Action>
		</Card.Header>
		<Card.Content class="grid gap-4">
			{#if files.length === 0}
				<p class="text-muted-foreground text-sm">No files.</p>
			{/if}
			{#each files as file (file.name)}
				<div class="grid gap-2">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<p class="min-w-0 text-sm break-all">
							<span class="font-mono">{file.name}</span>
							<span class="text-muted-foreground">{file.is_secret ? 'secret' : 'plain'}</span>
							<span class="text-muted-foreground">{formatBytes(file.size)}</span>
							<span class="text-muted-foreground"><LocalTime iso={file.updated_at} /></span>
						</p>
						<div class="flex flex-wrap items-center gap-2">
							{#if !file.is_secret}
								<form
									method="POST"
									action={actionUrlFrom(page.url, 'viewProjectFile')}
									use:enhance={() => {
										const viewId = `file-view-${file.name}`;
										return async ({ update }) => {
											await showViewedFile(update, () => document.getElementById(viewId)?.focus());
										};
									}}
								>
									<Input type="hidden" name="name" value={file.name} />
									<Button type="submit" variant="outline" size="sm" aria-label="View {file.name}">View</Button>
								</form>
							{/if}
							<ConfirmAction
								id="delete-file-{file.name}"
								action={actionUrlFrom(page.url, 'deleteProjectFile')}
								label="Delete"
								confirmLabel="Delete"
								message="Delete file {file.name}?"
								messageClass="max-w-full min-w-0 break-all"
								closeOnFailure
								hidden={[{ name: 'name', value: file.name }]}
							/>
						</div>
					</div>
					{#if message && settingsName === file.name}
						<div class="max-w-full min-w-0 break-all">
							<Notice kind="error">{message}</Notice>
						</div>
					{/if}
					{#if !file.is_secret && viewedFile?.name === file.name}
						<pre id="file-view-{file.name}" tabindex="-1" class="bg-muted max-h-40 overflow-auto rounded-lg p-2 font-mono text-xs whitespace-pre-wrap focus-visible:ring-3 focus-visible:ring-ring" aria-label="File {file.name}">{viewedFile.content}</pre>
					{/if}
				</div>
			{/each}
			{#if savedFile}
				<Notice kind="success">Saved file {savedFile}.</Notice>
			{/if}
		</Card.Content>
	</Card.Root>
	<Card.Root id="registries" class="mt-4">
		<Card.Header>
			<Card.Title>Registries</Card.Title>
			<Card.Description>The token is write-only. It is not shown again.</Card.Description>
			<Card.Action>
				<FormDialog
					id="add-registry"
					label="Add registry"
					title="Add registry"
					description="Sign-in for a private image registry, such as ghcr.io. Saving the same host again replaces it."
					failed={settingsField === 'token' && message != null}
				>
					{#snippet children(settle, cancel)}
						<RegistryForm
							action={actionUrlFrom(page.url, 'saveRegistry')}
							error={settingsField === 'token' ? message : null}
							onSaved={(host) => (savedRegistry = host)}
							onSettled={settle}
							{cancel}
						/>
					{/snippet}
				</FormDialog>
			</Card.Action>
		</Card.Header>
		<Card.Content class="grid gap-4">
			{#if savedRegistry}
				<Notice kind="success">Saved registry {savedRegistry}.</Notice>
			{/if}
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
		</Card.Content>
	</Card.Root>
{/if}
