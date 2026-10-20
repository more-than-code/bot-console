<script lang="ts">
	import { page } from '$app/state';
	import DataTable from '$lib/components/DataTable.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import type { Project } from '$lib/api-types';
	import { formatWhen } from '$lib/format';
	import type { Column } from '$lib/table';
	import { actionUrlFrom } from '$lib/url';
	import NewProject from './NewProject.svelte';

	let { data, form } = $props();

	const columns: Column<Project>[] = [
		{ key: 'name', label: 'Name' },
		{ key: 'slug', label: 'Slug' },
		{ key: 'role', label: 'Role' },
		{ key: 'created', label: 'Created' }
	];
</script>

<svelte:head>
	<title>Projects · Deploybot</title>
</svelte:head>

<PageHeader title="Projects" headingId="projects-heading">
	{#snippet actions()}
		<NewProject action={actionUrlFrom(page.url, 'create')} failed={Boolean(form?.message)} message={form?.message ?? null} />
	{/snippet}
</PageHeader>
{#if data.message}
	<Notice kind="error">{data.message}</Notice>
{/if}


{#if data.omitted > 0}
	<p class="text-muted-foreground mb-2 text-sm">{data.omitted} more {data.omitted === 1 ? 'row' : 'rows'} left out.</p>
{/if}
{#if data.truncated}
	<p class="text-muted-foreground mb-2 text-sm">More items not shown</p>
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
			<td class="p-2 align-middle"><a class="text-primary underline-offset-4 hover:underline" href="/projects/{project.id}">{project.name}</a></td>
			<td class="p-2 align-middle">{project.slug}</td>
			<td class="p-2 align-middle">{project.role}</td>
			<td class="p-2 align-middle">{formatWhen(project.created_at)}</td>
		</tr>
	{/snippet}
</DataTable>
