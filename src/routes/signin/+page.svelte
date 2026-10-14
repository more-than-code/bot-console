<script lang="ts">
	import { enhance } from '$app/forms';
	import Notice from '$lib/components/Notice.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';

	let { data, form } = $props();
	const next = $derived(form?.next ?? data.next);
</script>

<svelte:head>
	<title>Sign in · deploybot</title>
</svelte:head>

<PageHeader title="Sign in" />
{#if data.signedInName}
	<p class="sub">Signed in as {data.signedInName}. <a href="/projects">Go to projects</a>.</p>
{/if}
{#if form?.message}
	<Notice kind="error">{form.message}</Notice>
{/if}
<form method="POST" use:enhance>
	<input type="hidden" name="next" value={next} />
	<button type="submit">Sign in with Google</button>
</form>
