<script lang="ts">
	import { browser } from '$app/environment';
	import HostCard from '$lib/components/HostCard.svelte';
	import { formatWhen } from '$lib/format';
	import { POLL_MS } from '$lib/limits';
	import { isOverview, type Overview } from '$lib/types';

	let { data } = $props();
	let polled = $state<Overview | null>(null);
	let updateError = $state('');
	const overview = $derived(polled ?? data.overview);

	$effect(() => {
		if (!browser) return;
		let ignore = false;
		const id = setInterval(async () => {
			try {
				const response = await fetch('/api/overview');
				if (!response.ok) {
					if (!ignore) updateError = 'Latest refresh failed. Showing the last good data.';
					return;
				}
				const body: unknown = await response.json();
				if (!isOverview(body)) {
					if (!ignore) updateError = 'Latest refresh failed. Showing the last good data.';
					return;
				}
				if (!ignore) {
					polled = body;
					updateError = '';
				}
			} catch {
				if (!ignore) updateError = 'Latest refresh failed. Showing the last good data.';
			}
		}, POLL_MS);
		return () => {
			ignore = true;
			clearInterval(id);
		};
	});
</script>

<svelte:head>
	<title>Cluster · Pi Monitor</title>
</svelte:head>

<h1>Cluster</h1>
<p class="sub">
	Updated {formatWhen(overview.generatedAt)}. Refreshes every 15 seconds. Times are Pacific/Auckland.
</p>
<noscript><p class="sub">Live refresh is off without JavaScript. Reload the page for new samples.</p></noscript>
{#if updateError}
	<p class="error" role="status">{updateError}</p>
{/if}

{#if overview.hosts.length === 0}
	<p class="empty">No hosts registered or reporting.</p>
{:else}
	<div class="cards">
		{#each overview.hosts as host (host.name)}
			<HostCard {host} />
		{/each}
	</div>
{/if}
