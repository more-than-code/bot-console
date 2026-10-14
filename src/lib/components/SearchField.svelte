<script lang="ts">
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import { SEARCH_DEBOUNCE_MS, SEARCH_MAX } from '$lib/table-query';

	let {
		q,
		label,
		action,
		hidden,
		hrefFor,
		name = 'q'
	}: {
		q: string | null;
		label: string;
		action: string;
		hidden: Array<{ name: string; value: string }>;
		hrefFor: (q: string | null) => string;
		name?: string;
	} = $props();

	let draft = $state(untrack(() => q ?? ''));
	let sent = $state(untrack(() => q ?? ''));
	let currentQ = untrack(() => q ?? '');
	let timer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		const incoming = q ?? '';
		currentQ = incoming;
		if (incoming !== sent) {
			draft = incoming;
			sent = incoming;
		}
	});

	$effect(() => () => clearTimeout(timer));

	function oninput(event: Event) {
		const value = (event.currentTarget as HTMLInputElement).value;
		draft = value;
		clearTimeout(timer);
		timer = setTimeout(() => {
			const next = value.trim();
			if (next === currentQ) return;
			sent = next;
			void goto(hrefFor(next === '' ? null : next), {
				keepFocus: true,
				noScroll: true,
				replaceState: true
			});
		}, SEARCH_DEBOUNCE_MS);
	}

	function onsubmit() {
		clearTimeout(timer);
	}
</script>

<form class="search" {action} method="get" role="search" onsubmit={onsubmit}>
	{#each hidden as field (field.name)}
		<input type="hidden" name={field.name} value={field.value} />
	{/each}
	<label>
		<span class="sr">{label}</span>
		<input
			type="search"
			name={name}
			maxlength={SEARCH_MAX}
			placeholder={label}
			value={draft}
			oninput={oninput}
		/>
	</label>
	<button type="submit">Search</button>
</form>
