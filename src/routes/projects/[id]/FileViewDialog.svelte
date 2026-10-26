<script lang="ts">
	import FileViewBody from './FileViewBody.svelte';
	import LocalTime from '$lib/components/LocalTime.svelte';
	import type { ProjectFile } from '$lib/api-types';
	import { restoreFocusTo } from '$lib/dialog-focus';
	import { formatBytes } from '$lib/format';
	import { buttonVariants } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';

	let {
		file,
		content,
		open = $bindable(false),
		onClosed
	}: {
		/** The plain file being viewed; its row's View button gets focus back on close. */
		file: ProjectFile;
		content: string;
		open?: boolean;
		/** The close animation ended; the caller drops the viewed content. */
		onClosed: () => void;
	} = $props();

	const contentId = $derived(`file-view-${file.name}`);

	function onOpenAutoFocus(event: Event) {
		event.preventDefault();
		document.getElementById(contentId)?.focus();
	}
</script>

<Dialog.Root bind:open onOpenChangeComplete={(next) => !next && onClosed()}>
	<Dialog.Content class="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-3xl" {onOpenAutoFocus} onCloseAutoFocus={restoreFocusTo(viewButtonId(file.name))}>
		<Dialog.Header class="shrink-0 pr-8">
			<Dialog.Title class="font-mono break-all">{file.name}</Dialog.Title>
			<Dialog.Description>{formatBytes(file.size)} · <LocalTime iso={file.updated_at} /></Dialog.Description>
		</Dialog.Header>
		<FileViewBody name={file.name} {content} {contentId} />
		<div>
			<Dialog.Close type="button" class={buttonVariants({ variant: 'outline' })}>Close</Dialog.Close>
		</div>
	</Dialog.Content>
</Dialog.Root>

<script lang="ts" module>
	/** The id of a file row's View button. */
	export function viewButtonId(name: string): string {
		return `view-file-${name}`;
	}
</script>
