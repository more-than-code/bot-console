<script lang="ts">
	import { Combobox as ComboboxPrimitive } from "bits-ui";
	import type { Snippet } from "svelte";
	import { cn, type WithoutChild } from "$lib/utils.js";
	import { comboboxNav } from "./context.js";

	let {
		ref = $bindable(null),
		class: className,
		sideOffset = 4,
		children,
		footer,
		...restProps
	}: Omit<WithoutChild<ComboboxPrimitive.ContentProps>, "id"> & {
		/** Text under the options, outside the listbox (a listbox holds only options). */
		footer?: Snippet;
	} = $props();

	const nav = comboboxNav();
</script>

<ComboboxPrimitive.Portal>
	<ComboboxPrimitive.Content bind:ref {sideOffset} {...restProps}>
		<!-- bits-ui puts no id on the listbox; the input's aria-controls needs one. -->
		{#snippet child({ props, wrapperProps })}
			<div {...wrapperProps}>
				<div
					data-slot="combobox-content"
					data-navigated={nav.navigated ? "" : undefined}
					class={cn(
						"bg-popover text-popover-foreground ring-foreground/10 group/combobox relative z-50 w-(--bits-floating-anchor-width) max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg shadow-md ring-1",
						className
					)}
				>
					<!-- z-50 sits on the element that receives `props`: bits-ui copies that element's z-index onto the
					     floating wrapper, whose transform makes it a stacking context. Without it the list paints under a dialog. -->
					<div {...props} id={nav.listId} class="z-50 max-h-[min(18rem,var(--bits-combobox-content-available-height))] overflow-x-hidden overflow-y-auto p-1 outline-none">
						{@render children?.()}
					</div>
					{#if footer}
						<div class="text-muted-foreground border-t px-2.5 py-1.5 text-sm">{@render footer()}</div>
					{/if}
				</div>
			</div>
		{/snippet}
	</ComboboxPrimitive.Content>
</ComboboxPrimitive.Portal>
