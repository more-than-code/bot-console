<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import PageHeader from '$lib/components/PageHeader.svelte';
</script>

<svelte:head>
	<title>{page.status} · deploybot</title>
</svelte:head>

<PageHeader title={String(page.status)} subtitle={page.error?.message ?? 'Something went wrong'} />
<p><Button href="/projects" variant="link">Projects</Button></p>
