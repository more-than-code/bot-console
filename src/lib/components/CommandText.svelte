<script lang="ts">
	import * as Tooltip from '$lib/components/ui/tooltip';

	let { value }: { value: string } = $props();
	const text = $derived(value || 'n/a');
</script>

<Tooltip.Provider>
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<span {...props} class="block max-w-64 truncate font-mono" title={text}>{text}</span>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content class="max-w-sm font-mono break-all">{text}</Tooltip.Content>
	</Tooltip.Root>
</Tooltip.Provider>
