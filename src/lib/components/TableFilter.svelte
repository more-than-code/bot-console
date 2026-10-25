<script lang="ts">
	import { onMount } from 'svelte';
	import Check from '@lucide/svelte/icons/check';
	import Funnel from '@lucide/svelte/icons/funnel';
	import { buttonVariants } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { cn } from '$lib/utils';

	let {
		label,
		options,
		current,
		hrefFor
	}: {
		/** Column noun: the button is "Filter {label}". */
		label: string;
		options: { value: string; label: string }[];
		/** The active option, or null for All. */
		current: { value: string; label: string } | null;
		/** Same-page link for an option; null is All. */
		hrefFor: (value: string | null) => string;
	} = $props();

	// Before hydration (and without JavaScript) the menu is a <details> of plain links.
	let enhanced = $state(false);
	onMount(() => {
		enhanced = true;
	});

	const name = $derived(current ? `Filter ${label}: ${current.label}` : `Filter ${label}`);
	const items = $derived([{ value: null as string | null, label: 'All' }, ...options]);
	const triggerClass = $derived(
		cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'size-6', current ? 'text-primary' : 'text-muted-foreground')
	);
	const linkClass = 'hover:bg-accent hover:text-accent-foreground flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm';

	function isCurrent(value: string | null): boolean {
		return (current?.value ?? null) === value;
	}
</script>

{#snippet option(item: { value: string | null; label: string })}
	<Check class={cn('size-3.5', !isCurrent(item.value) && 'invisible')} aria-hidden="true" />{item.label}{#if isCurrent(item.value)}<span
			class="sr-only">{' (current)'}</span
		>{/if}
{/snippet}

{#snippet icon()}
	<Funnel class={cn('size-3.5', current && 'fill-current')} aria-hidden="true" />
{/snippet}

{#if enhanced}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger class={triggerClass} aria-label={name}>{@render icon()}</DropdownMenu.Trigger>
		<DropdownMenu.Content align="start">
			{#each items as item (item.value ?? '')}
				<DropdownMenu.Item>
					{#snippet child({ props })}
						<a href={hrefFor(item.value)} aria-current={isCurrent(item.value) ? 'true' : undefined} {...props}
							>{@render option(item)}</a
						>
					{/snippet}
				</DropdownMenu.Item>
			{/each}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{:else}
	<details class="inline-block">
		<summary class={cn(triggerClass, 'list-none [&::-webkit-details-marker]:hidden')} aria-label={name}>{@render icon()}</summary>
		<!-- In flow, not absolute: the table's scroll box would clip a floating list. -->
		<ul class="bg-popover text-popover-foreground ring-foreground/10 mt-1 min-w-32 rounded-lg p-1 ring-1">
			{#each items as item (item.value ?? '')}
				<li>
					<a class={linkClass} href={hrefFor(item.value)} aria-current={isCurrent(item.value) ? 'true' : undefined}
						>{@render option(item)}</a
					>
				</li>
			{/each}
		</ul>
	</details>
{/if}
