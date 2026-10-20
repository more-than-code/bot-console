<script lang="ts">
	import { browser } from '$app/environment';
	import { elapsedSeconds, formatElapsed } from '$lib/catalog-flight';

	let { note = null }: { note?: string | null } = $props();

	let seconds = $state(0);

	$effect(() => {
		if (!browser) return;
		const startedAt = Date.now();
		const tick = () => {
			seconds = elapsedSeconds(startedAt, Date.now());
		};
		tick();
		const timer = setInterval(tick, 1000);
		return () => clearInterval(timer);
	});
</script>

<!-- The elapsed line stays out of any live region. It updates every second. -->
<p class="text-muted-foreground text-sm">Elapsed {formatElapsed(seconds)}</p>
{#if note}
	<p class="text-muted-foreground text-sm">{note}</p>
{/if}
