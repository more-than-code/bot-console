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
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

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

<Card.Root class="mb-6">
	<Card.Header>
		<Card.Title>New project</Card.Title>
	</Card.Header>
	<Card.Content>
		<form method="POST" action={actionUrlFrom(page.url, 'create')} class="grid gap-3" use:enhance>
			<Label class="grid gap-1.5" for="project-name">
				New project name
				<Input id="project-name" name="name" required maxlength={80} autocomplete="off" />
			</Label>
			<div>
				<Button type="submit">Create project</Button>
			</div>
		</form>
	</Card.Content>
</Card.Root>

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
