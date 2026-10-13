<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
	const next = $derived(form?.next ?? data.next);
</script>

<svelte:head>
	<title>Sign in · deploybot</title>
</svelte:head>

<h1>Sign in</h1>
{#if data.signedInName}
	<p class="sub">Signed in as {data.signedInName}. <a href="/projects">Go to projects</a>.</p>
{/if}
{#if form?.message}
	<p class="error" role="alert">{form.message}</p>
{/if}
<form method="POST" use:enhance>
	<input type="hidden" name="next" value={next} />
	<button type="submit">Sign in with Google</button>
</form>
