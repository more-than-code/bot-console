<script lang="ts">
	import { enhance } from '$app/forms';
	import Notice from '$lib/components/Notice.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { Button } from '$lib/components/ui/button';

	let { data, form } = $props();
	const state = $derived(form ?? data);
	const title = $derived(state.view === 'join' && state.projectName ? `Join ${state.projectName}?` : 'Invite');
</script>

<svelte:head>
	<title>{title} · Deploybot</title>
</svelte:head>

<PageHeader title={title} breadcrumbs={[{ label: 'Projects', href: '/projects' }, { label: 'Invite' }]} />

{#if state.view === 'error'}
	<Notice kind="error">{state.message ?? 'The API is unavailable.'}</Notice>
{:else if state.view === 'member' && state.projectId && state.projectName}
	<p>
		You're already a member of <a class="text-primary underline-offset-4 hover:underline" href="/projects/{state.projectId}"
			>{state.projectName}</a
		>.
	</p>
{:else if state.view === 'join' && state.projectName && state.role}
	<p class="mb-4">You'll join as {state.role}.</p>
	<form method="POST" action="?/accept" use:enhance>
		<Button type="submit">Join</Button>
	</form>
{:else}
	<Notice kind="error">
		This invite link is invalid, expired or already used.
		<a class="text-primary underline-offset-4 hover:underline" href="/projects">Back to projects</a>
	</Notice>
{/if}
