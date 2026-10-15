<script lang="ts">
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	let {
		ref = $bindable(null),
		value = $bindable(''),
		class: className,
		...rest
	}: HTMLTextareaAttributes & { ref?: HTMLTextAreaElement | null; value?: string } = $props();
</script>

<textarea
	bind:this={ref}
	bind:value
	class={cn(
		'border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 min-h-24 w-full min-w-0 rounded-lg border bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:ring-3 md:text-sm',
		className
	)}
	{...rest}
></textarea>
