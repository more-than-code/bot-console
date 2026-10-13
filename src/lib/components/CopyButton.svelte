<script lang="ts">
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

<button type="button" onclick={copy} aria-live="polite">{note === 'Copied' ? 'Copied' : label}</button>
{#if note && note !== 'Copied'}
	<p class="sub" role="status">{note}</p>
{/if}
