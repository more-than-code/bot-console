<script lang="ts">
	let { items }: { items: Array<{ label: string; href?: string }> } = $props();
</script>

<nav class="crumbs" aria-label="Breadcrumb">
	<ol>
		{#each items as item, index (index)}
			<li>
				{#if index > 0}
					<span aria-hidden="true">›</span>
				{/if}
				{#if item.href}
					<a href={item.href}>{item.label}</a>
				{:else}
					<span aria-current="page">{item.label}</span>
				{/if}
			</li>
		{/each}
	</ol>
</nav>
