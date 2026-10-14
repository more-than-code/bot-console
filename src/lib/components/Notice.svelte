<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Alert } from '$lib/components/ui/alert';

	let {
		kind,
		children
	}: {
		kind: 'error' | 'info' | 'success';
		children: Snippet;
	} = $props();
</script>

<Alert
	variant={kind === 'error' ? 'destructive' : 'default'}
	role={kind === 'error' ? 'alert' : 'status'}
	class={kind === 'success' ? 'text-status-up' : undefined}
>
	{@render children()}
</Alert>
