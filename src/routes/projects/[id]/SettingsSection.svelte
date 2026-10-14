<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import type { Project } from '$lib/api-types';
	import { actionUrlFrom } from '$lib/url';

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
	<form method="POST" action={actionUrlFrom(page.url, 'rename')} class="panel" use:enhance>
		<h2>Rename</h2>
		<label class="field">
			Project name
			<input name="name" value={project.name} required maxlength="80" autocomplete="off" />
		</label>
		<button type="submit">Rename project</button>
	</form>
	<div class="panel">
		<h2>Delete</h2>
		<p class="sub">Deleting revokes this project's host credentials.</p>
		<ConfirmAction
			id="delete-project"
			action={actionUrlFrom(page.url, 'deleteProject')}
			label="Delete project"
			confirmLabel="Delete project"
			message="Delete {project.name}? This revokes the project's host credentials."
			typeToConfirm={{ name: 'confirm', expected: project.name, label: `Type ${project.name} to confirm` }}
		/>
	</div>
{:else}
	<p class="sub">Only the owner can change these settings.</p>
{/if}
