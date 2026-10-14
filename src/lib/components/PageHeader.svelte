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

{#if breadcrumbs.length > 0}
	<Breadcrumbs items={breadcrumbs} />
{/if}
<h1 id={headingId}>{title}</h1>
{#if subtitle}
	<p class="sub">{subtitle}</p>
{/if}
{#if actions}
	{@render actions()}
{/if}
