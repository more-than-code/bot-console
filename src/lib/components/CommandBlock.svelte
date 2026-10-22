<script lang="ts">
	import CopyButton from './CopyButton.svelte';

	let {
		command,
		label,
		ariaLabel
	}: {
		command: string;
		label: string;
		ariaLabel?: string;
	} = $props();
</script>

<div class="grid min-w-0 max-w-full gap-2" translate="no">
	<pre class="bg-muted max-h-40 min-w-0 overflow-auto rounded-lg p-2 font-mono text-xs break-all whitespace-pre-wrap" aria-label={ariaLabel}>{command}</pre>
	<CopyButton value={command} {label} />
</div>
