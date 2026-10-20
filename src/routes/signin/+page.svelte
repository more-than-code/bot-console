<script lang="ts">
	import { enhance } from '$app/forms';
	import Notice from '$lib/components/Notice.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';

	let { data, form } = $props();
	const next = $derived(form?.next ?? data.next);
</script>

<svelte:head>
	<title>Sign in · Deploybot</title>
</svelte:head>

<PageHeader title="Sign in" />
{#if data.signedInName}
	<p class="text-muted-foreground mb-3 text-sm">Signed in as {data.signedInName}. <a class="text-primary underline-offset-4 hover:underline" href="/projects">Go to projects</a>.</p>
{/if}
{#if form?.message}
	<Notice kind="error">{form.message}</Notice>
{/if}
<form method="POST" class="mt-4" use:enhance>
	<Input type="hidden" name="next" value={next} />
	<Button type="submit">Sign in with Google</Button>
</form>
