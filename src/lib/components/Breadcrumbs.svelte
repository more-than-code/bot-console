<script lang="ts">
	import * as Breadcrumb from '$lib/components/ui/breadcrumb';

	let { items }: { items: Array<{ label: string; href?: string }> } = $props();
</script>

<Breadcrumb.Root aria-label="Breadcrumb">
	<Breadcrumb.List>
		{#each items as item, index (index)}
			{#if index > 0}
				<Breadcrumb.Separator />
			{/if}
			<Breadcrumb.Item>
				{#if item.href}
					<Breadcrumb.Link href={item.href}>{item.label}</Breadcrumb.Link>
				{:else}
					<Breadcrumb.Page>{item.label}</Breadcrumb.Page>
				{/if}
			</Breadcrumb.Item>
		{/each}
	</Breadcrumb.List>
</Breadcrumb.Root>
