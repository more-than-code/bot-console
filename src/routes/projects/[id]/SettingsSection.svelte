<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import LocalTime from '$lib/components/LocalTime.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Textarea from '$lib/components/Textarea.svelte';
	import EnvSetDialog from './EnvSetDialog.svelte';
	import EnvSetTable from './EnvSetTable.svelte';
	import type { EnvSet, Project, ProjectFile, Registry } from '$lib/api-types';
	import { formatBytes } from '$lib/format';
	import { clearSecretField, settleFileSave, showViewedFile } from '$lib/secret-field';
	import { actionUrlFrom } from '$lib/url';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Checkbox } from '$lib/components/ui/checkbox';
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

	let token = $state('');
	let fileContent = $state('');
	let fileName = $state('');
	let fileSecret = $state(true);
	let savedFile = $state<string | null>(null);

	function clearToken() {
		return async ({ update }: { update: () => Promise<void> }) => {
			await clearSecretField((value) => {
				token = value;
			}, update);
			document.getElementById('registry-token-error')?.focus();
		};
	}

	function clearFile({ formData }: { formData: FormData }) {
		const submittedName = String(formData.get('name') ?? '');
		return async ({ update, result }: { update: () => Promise<void>; result: { type: string } }) => {
			await settleFileSave(
				(next) => {
					fileContent = next.content;
					fileName = next.name;
					fileSecret = next.secret;
					savedFile = next.saved;
				},
				{ name: fileName, secret: fileSecret },
				submittedName,
				update,
				result.type
			);
			document.getElementById('file-error')?.focus();
		};
	}
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
				<EnvSetDialog action={actionUrlFrom(page.url, 'saveEnvSet')} {message} {settingsField} />
			</Card.Action>
		</Card.Header>
		<Card.Content class="grid gap-4">
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
				/>
			{/each}
		</Card.Content>
	</Card.Root>
	<Card.Root class="mt-4">
		<Card.Header>
			<Card.Title>Files</Card.Title>
			<Card.Description>Secret files stay on the API. The paste box is never filled in.</Card.Description>
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
			<form method="POST" action={actionUrlFrom(page.url, 'saveProjectFile')} class="grid gap-3" use:enhance={clearFile}>
				<Label class="grid gap-1.5" for="file-name">
					Name
					<Input id="file-name" name="name" bind:value={fileName} required maxlength={64} autocomplete="off" spellcheck="false" />
				</Label>
				<Label class="grid gap-1.5" for="file-content">
					Content
					<Textarea
						id="file-content"
						name="content"
						bind:value={fileContent}
						rows={6}
						spellcheck="false"
						autocomplete="off"
						aria-label="File content"
						aria-invalid={settingsField === 'file' && message ? true : undefined}
						aria-describedby={settingsField === 'file' && message ? 'file-error' : undefined}
					/>
				</Label>
				<Input type="hidden" name="secret" value={fileSecret ? '1' : '0'} />
				<Label class="flex items-center gap-2">
					<Checkbox id="file-secret" checked={fileSecret} aria-label="Secret file" onCheckedChange={(value) => (fileSecret = value === true)} />
					Secret
				</Label>
				{#if savedFile && !(settingsField === 'file' && message)}
					<Notice kind="success">Saved file {savedFile}.</Notice>
				{/if}
				{#if settingsField === 'file' && message}
					<div id="file-error" tabindex="-1" class="max-w-full min-w-0 break-words focus-visible:ring-3 focus-visible:ring-ring">
						<Notice kind="error">{message}</Notice>
					</div>
				{/if}
				<div>
					<Button type="submit">Save file</Button>
				</div>
			</form>
		</Card.Content>
	</Card.Root>
	<Card.Root id="registries" class="mt-4">
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
