<script lang="ts">
	import CopyButton from '$lib/components/CopyButton.svelte';

	let {
		name,
		content,
		contentId
	}: {
		name: string;
		/** A plain file's content. Secret files are never viewed. */
		content: string;
		/** The `<pre>` id, focused when the dialog opens. */
		contentId: string;
	} = $props();
</script>

<div class="grid min-h-0 min-w-0 gap-3" translate="no">
	<pre
		id={contentId}
		tabindex="-1"
		class="bg-muted max-h-[70dvh] min-w-0 overflow-auto rounded-lg p-2 font-mono text-xs break-all whitespace-pre-wrap focus-visible:ring-3 focus-visible:ring-ring"
		aria-label="File {name}">{content}</pre>
	<div>
		<CopyButton value={content} label="Copy {name}" />
	</div>
</div>
