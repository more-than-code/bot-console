<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import { Button } from '$lib/components/ui/button';

	let { value, label }: { value: string; label: string } = $props();
	let note = $state('');

	async function copy() {
		try {
			await navigator.clipboard.writeText(value);
			note = 'Copied';
		} catch {
			note = 'Copy failed. Select the text and copy it manually.';
		}
	}
</script>

<Button type="button" variant="outline" size="sm" onclick={copy} aria-live="polite">
	{#if note === 'Copied'}
		<Check class="size-4" />Copied
	{:else}
		<Copy class="size-4" />{label}
	{/if}
</Button>
{#if note && note !== 'Copied'}
	<p class="text-muted-foreground text-sm" role="status">{note}</p>
{/if}
