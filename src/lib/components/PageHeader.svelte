<script lang="ts">
	import type { Snippet } from 'svelte';
	import Breadcrumbs from './Breadcrumbs.svelte';

	let {
		title,
		breadcrumbs = [],
		subtitle,
		headingId,
		actions
	}: {
		title: string;
		breadcrumbs?: Array<{ label: string; href?: string }>;
		subtitle?: string;
		headingId?: string;
		actions?: Snippet;
	} = $props();
</script>

<header class="mb-6 flex min-w-0 flex-col gap-3">
	{#if breadcrumbs.length > 0}
		<Breadcrumbs items={breadcrumbs} />
	{/if}
	<div class="flex min-w-0 flex-wrap items-start justify-between gap-3">
		<div class="min-w-0">
			<h1 id={headingId} class="text-2xl font-semibold tracking-tight">{title}</h1>
			{#if subtitle}
				<p class="text-muted-foreground text-sm">{subtitle}</p>
			{/if}
		</div>
		{#if actions}
			<div class="flex flex-wrap items-center gap-2">
				{@render actions()}
			</div>
		{/if}
	</div>
</header>
