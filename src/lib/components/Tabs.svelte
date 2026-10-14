<script lang="ts">
	let {
		items,
		current,
		label
	}: {
		items: Array<{ key: string; label: string; href: string }>;
		current: string;
		label: string;
	} = $props();
</script>

<nav class="nav tabs" aria-label={label}>
	{#each items as item (item.key)}
		<a href={item.href} aria-current={item.key === current ? 'page' : undefined}>{item.label}</a>
	{/each}
</nav>
