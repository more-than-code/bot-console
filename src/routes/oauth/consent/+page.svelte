<script lang="ts">
	import { enhance } from '$app/forms';
	import Notice from '$lib/components/Notice.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { actionUrl } from '$lib/url';

	let { data, form } = $props();

	const message = $derived(form?.message ?? data.message);
	const approveAction = $derived(data.request ? actionUrl('approve', { request: data.request.id }) : '');
	const denyAction = $derived(data.request ? actionUrl('deny', { request: data.request.id }) : '');
</script>

<svelte:head>
	<title>Allow access? · deploybot</title>
</svelte:head>

<PageHeader title="Allow access?" />
{#if message}
	<Notice kind="error">{message}</Notice>
{/if}
{#if data.request}
	<p class="mb-2 flex flex-wrap items-center gap-2">
		<strong>{data.request.client.name}</strong>
		{#if !data.request.client.verified}
			<Badge variant="outline" class="text-status-unknown">Unverified app</Badge>
		{/if}
	</p>
	<p class="mb-2 font-mono text-sm break-all">{data.request.redirect_host}</p>
	<p class="mb-4">acts as you, with your role in each of your {data.request.projects_count} projects</p>
	<form method="POST" class="flex flex-wrap gap-2" use:enhance>
		<Input type="hidden" name="request" value={data.request.id} />
		<Button type="submit" formaction={approveAction}>Allow</Button>
		<Button type="submit" variant="outline" formaction={denyAction}>Deny</Button>
	</form>
{/if}
