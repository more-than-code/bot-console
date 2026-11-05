<script lang="ts">
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { menuOnWide, type MenuItem, type MenuKey } from '$lib/row-menu';
	import { cn } from '$lib/utils';

	let {
		id,
		label,
		items,
		onSelect,
		disabled = false
	}: {
		/** The ⋯ button's id: dialogs opened from the menu return focus here. */
		id: string;
		/** Accessible name and tooltip of the ⋯ button, e.g. "More actions for web". */
		label: string;
		items: MenuItem[];
		onSelect: (key: MenuKey) => void;
		disabled?: boolean;
	} = $props();

	const wide = $derived(menuOnWide(items));

	/** After the menu has closed and returned focus to its button, so the dialog it opens keeps focus. */
	function select(key: MenuKey) {
		setTimeout(() => onSelect(key), 0);
	}
</script>

<!-- One slot of the row's icon grid. From `sm` up it is empty when every item has its own icon there. -->
{#if items.length === 0}
	<span class="size-7" aria-hidden="true" data-empty-slot></span>
{:else}
	{#if !wide}
		<span class="size-7 max-sm:hidden" aria-hidden="true" data-empty-slot></span>
	{/if}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					{id}
					variant="ghost"
					size="icon-sm"
					class={cn('max-sm:size-11', !wide && 'sm:hidden')}
					aria-label={label}
					title={label}
					{disabled}
					data-row-menu={items.map((item) => item.key).join(' ')}
				>
					<Ellipsis class="size-4" />
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end" class="w-auto min-w-48">
			{#each items as item (item.key)}
				<DropdownMenu.Item
					class={cn(item.phoneOnly && 'sm:hidden', 'max-sm:min-h-11')}
					variant={item.destructive ? 'destructive' : 'default'}
					disabled={item.disabledReason != null}
					title={item.disabledReason ?? undefined}
					onSelect={() => select(item.key)}
					data-menu-key={item.key}
				>
					{item.label}{#if item.disabledReason}<span class="sr-only">. {item.disabledReason}</span>{/if}
				</DropdownMenu.Item>
			{/each}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{/if}
