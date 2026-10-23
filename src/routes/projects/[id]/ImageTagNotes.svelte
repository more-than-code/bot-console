<script lang="ts">
	import { imageNoteIds } from '$lib/image-tags';

	let {
		fieldId,
		message = null,
		authFailed = false,
		settingsHref,
		pinLine = null
	}: {
		fieldId: string;
		/** Why no tags are listed. Never blocks saving. */
		message?: string | null;
		/** Adds the link to Settings → Registries. */
		authFailed?: boolean;
		settingsHref: string;
		/** "Pinned to sha256:…" or the pin failure line. */
		pinLine?: string | null;
	} = $props();

	const ids = $derived(imageNoteIds(fieldId));
</script>

{#if message}
	<p id={ids.tags} class="text-muted-foreground text-sm break-words">
		{message}
		{#if authFailed}
			<!-- A new tab keeps the unsaved edit in this dialog. -->
			<a class="text-foreground underline underline-offset-3" href={settingsHref} rel="noopener noreferrer" target="_blank">Settings → Registries<span class="sr-only">{' (opens in a new tab)'}</span></a>
		{/if}
	</p>
{/if}
{#if pinLine}
	<p id={ids.pin} class="text-muted-foreground text-sm break-all">{pinLine}</p>
{/if}
