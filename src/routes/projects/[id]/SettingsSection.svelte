<script lang="ts">
	import { enhance } from '$app/forms';
	import type { Project } from '$lib/api-types';

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
	<p class="error" role="alert">{message}</p>
{/if}
{#if canOwner}
	<form method="POST" action="?/rename" class="panel" use:enhance>
		<h2>Rename</h2>
		<label class="field">
			Project name
			<input name="name" value={project.name} required maxlength="80" autocomplete="off" />
		</label>
		<button type="submit">Rename project</button>
	</form>
	<form method="POST" action="?/deleteProject" class="panel" use:enhance>
		<h2>Delete</h2>
		<p class="sub">Deleting revokes this project's host credentials. Type the project name to confirm.</p>
		<label class="field">
			Type {project.name}
			<input name="confirm" autocomplete="off" spellcheck="false" required />
		</label>
		<button type="submit" class="danger">Delete project</button>
	</form>
{:else}
	<p class="sub">Only the owner can change these settings.</p>
{/if}
