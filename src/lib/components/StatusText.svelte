<script lang="ts">
	let { status }: { status: string } = $props();

	const known = ['online', 'offline', 'asleep', 'revoked', 'up', 'down', 'unknown'];
	const text = $derived(known.includes(status) ? status : 'unknown');
	const online = $derived(text === 'online' || text === 'up');
	const stale = $derived(text === 'revoked' || text === 'down');
	const quiet = $derived(text === 'offline' || text === 'unknown');
</script>

<span class="status" class:online class:stale class:asleep={text === 'asleep'} class:offline={quiet}>{text}</span>
