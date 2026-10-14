<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import DataTable from '$lib/components/DataTable.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import type { Project } from '$lib/api-types';
	import { formatWhen } from '$lib/format';
	import type { Column } from '$lib/table';
	import { actionUrlFrom } from '$lib/url';

	let { data, form } = $props();

	const columns: Column<Project>[] = [
		{ key: 'name', label: 'Name' },
		{ key: 'slug', label: 'Slug' },
		{ key: 'role', label: 'Role' },
		{ key: 'created', label: 'Created' }
	];
</script>

<svelte:head>
	<title>Projects · deploybot</title>
</svelte:head>

<PageHeader title="Projects" headingId="projects-heading" />
{#if form?.message || data.message}
	<Notice kind="error">{form?.message ?? data.message}</Notice>
{/if}

<form method="POST" action={actionUrlFrom(page.url, 'create')} class="panel" use:enhance>
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
<DataTable
	rows={data.projects}
	{columns}
	id="projects"
	labelledBy="projects-heading"
	empty="No projects yet."
	rowKey={(project) => project.id}
>
	{#snippet row(project)}
		<tr>
			<td><a href="/projects/{project.id}">{project.name}</a></td>
			<td>{project.slug}</td>
			<td>{project.role}</td>
			<td>{formatWhen(project.created_at)}</td>
		</tr>
	{/snippet}
</DataTable>
