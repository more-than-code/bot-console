<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '$lib/components/PageHeader.svelte';
</script>

<svelte:head>
	<title>Sign out · deploybot</title>
</svelte:head>

<PageHeader title="Sign out" subtitle="This ends the console session on this browser." />
<form method="POST" use:enhance>
	<button type="submit">Sign out</button>
</form>
