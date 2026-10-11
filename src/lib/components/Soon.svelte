<script lang="ts">
	let { title }: { title: string } = $props();
</script>

<svelte:head>
	<title>{title} · Pi Monitor</title>
</svelte:head>

<h1>{title}</h1>
<p class="sub">Coming soon. This pass shows Telegraf host metrics only.</p>
