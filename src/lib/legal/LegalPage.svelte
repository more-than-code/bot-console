<script lang="ts">
	import type { Snippet } from 'svelte';
	import { LAST_UPDATED } from './last-updated';

	let { title, children }: { title: string; children: Snippet } = $props();

	// Typography as Tailwind child selectors (no typography plugin).
	const prose = [
		'max-w-3xl py-6 leading-relaxed',
		'[&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold',
		'[&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6',
		'[&_a]:text-primary [&_a]:rounded-sm [&_a]:break-words [&_a]:underline [&_a]:underline-offset-4',
		'[&_a]:focus-visible:outline-2 [&_a]:focus-visible:outline-offset-2 [&_a]:focus-visible:outline-ring'
	].join(' ');
</script>

<article class={prose}>
	<h1 class="text-3xl font-semibold tracking-tight">{title}</h1>
	<p class="text-muted-foreground text-sm">Last updated: {LAST_UPDATED}</p>
	{@render children()}
</article>
