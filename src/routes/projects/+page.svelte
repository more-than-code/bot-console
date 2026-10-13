<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatWhen } from '$lib/format';

	let { data, form } = $props();
</script>

<svelte:head>
	<title>Projects · deploybot</title>
</svelte:head>

<h1>Projects</h1>
{#if form?.message || data.message}
	<p class="error" role="alert">{form?.message ?? data.message}</p>
{/if}

<form method="POST" action="?/create" class="panel" use:enhance>
	<label class="field">
		New project name
		<input name="name" required maxlength="80" autocomplete="off" />
	</label>
	<button type="submit">Create project</button>
</form>

{#if data.omitted > 0}
	<p class="sub">{data.omitted} more {data.omitted === 1 ? 'row' : 'rows'} left out.</p>
{/if}
{#if data.truncated}
	<p class="sub">More items not shown</p>
{/if}
{#if data.projects.length === 0}
	<p class="empty">No projects yet.</p>
{:else}
	<div class="table-wrap">
		<table class="data">
			<thead>
				<tr>
					<th>Name</th>
					<th>Slug</th>
					<th>Role</th>
					<th>Created</th>
				</tr>
			</thead>
			<tbody>
				{#each data.projects as project (project.id)}
					<tr>
						<td><a href="/projects/{project.id}">{project.name}</a></td>
						<td>{project.slug}</td>
						<td>{project.role}</td>
						<td>{formatWhen(project.created_at)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
