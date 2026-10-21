<script lang="ts">
	import { formatWhen } from '$lib/format';
	import { timeZoneSource } from '$lib/time-zone';

	let { iso }: { iso: string | null } = $props();

	const zones = timeZoneSource();
	const text = $derived(formatWhen(iso, zones?.current));
	const valid = $derived(iso != null && text !== 'n/a');
</script>

{#if valid && iso}
	<time datetime={iso}>{text}</time>
{:else}
	{text}
{/if}
