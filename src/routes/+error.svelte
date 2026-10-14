<script lang="ts">
	import { page } from '$app/state';
	import PageHeader from '$lib/components/PageHeader.svelte';
</script>

<svelte:head>
	<title>{page.status} · deploybot</title>
</svelte:head>

<PageHeader title={String(page.status)} subtitle={page.error?.message ?? 'Something went wrong'} />
<p><a class="back" href="/projects">Projects</a></p>
