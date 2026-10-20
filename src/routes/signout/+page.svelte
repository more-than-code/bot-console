<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { Button } from '$lib/components/ui/button';
	import LogOut from '@lucide/svelte/icons/log-out';
</script>

<svelte:head>
	<title>Sign out · Deploybot</title>
</svelte:head>

<PageHeader title="Sign out" subtitle="This ends the console session on this browser." />
<form method="POST" use:enhance>
	<Button type="submit"><LogOut class="size-4" />Sign out</Button>
</form>
