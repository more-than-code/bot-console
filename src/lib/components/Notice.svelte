<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		kind,
		children
	}: {
		kind: 'error' | 'info' | 'success';
		children: Snippet;
	} = $props();
</script>

<p class="notice {kind}" role={kind === 'error' ? 'alert' : 'status'}>{@render children()}</p>
