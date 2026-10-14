<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import type { Project } from '$lib/api-types';
	import { actionUrlFrom } from '$lib/url';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	let {
		project,
		canOwner,
		message
	}: {
		project: Project;
		canOwner: boolean;
		message: string | null;
	} = $props();
</script>

{#if message}
	<Notice kind="error">{message}</Notice>
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
{:else}
	<p class="text-muted-foreground text-sm">Only the owner can change these settings.</p>
{/if}
