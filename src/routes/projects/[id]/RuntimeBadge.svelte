<script lang="ts">
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';

	let {
		status,
		detail,
		hint = null
	}: {
		status: string;
		/** Live details for this copy (see `runtimeDetail`). */
		detail: string;
		/** Where the health came from, as on other rows. */
		hint?: string | null;
	} = $props();

	const detailId = $props.id();
	const text = $derived(hint ? `${detail} ${hint}.` : detail);
</script>

<!-- A button, so the details open on focus and on tap; screen readers get them as its description. -->
<Tooltip.Provider>
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<Button {...props} type="button" variant="ghost" class="h-auto p-0 hover:bg-transparent" aria-describedby={detailId}>
					<StatusBadge {status} />
				</Button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content class="max-w-sm break-words">{text}</Tooltip.Content>
	</Tooltip.Root>
</Tooltip.Provider>
<span id={detailId} class="sr-only">{text}</span>
