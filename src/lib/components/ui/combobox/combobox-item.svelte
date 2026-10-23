<script lang="ts">
	import { Combobox as ComboboxPrimitive } from "bits-ui";
	import { cn, type WithoutChild } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		value,
		label,
		children: childrenProp,
		...restProps
	}: WithoutChild<ComboboxPrimitive.ItemProps> = $props();
</script>

<!-- A highlight shows only after keyboard navigation (data-navigated on the content) or under the pointer. -->
<ComboboxPrimitive.Item
	bind:ref
	{value}
	{label}
	data-slot="combobox-item"
	class={cn(
		"hover:bg-accent hover:text-accent-foreground group-data-[navigated]/combobox:data-highlighted:bg-accent group-data-[navigated]/combobox:data-highlighted:text-accent-foreground relative flex w-full cursor-default items-center rounded-md px-1.5 py-1 text-sm break-all outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50",
		className
	)}
	{...restProps}
>
	{#snippet children({ selected, highlighted })}
		{#if childrenProp}
			{@render childrenProp({ selected, highlighted })}
		{:else}
			{label || value}
		{/if}
	{/snippet}
</ComboboxPrimitive.Item>
