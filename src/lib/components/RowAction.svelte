<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { cn } from '$lib/utils';

	/** The dialog trigger only needs these. The tooltip handlers stay on the object at runtime. */
	type TriggerProps = {
		class?: string;
		'aria-label'?: string;
	};

	function tooltipClass(value: unknown): string | undefined {
		return typeof value === 'string' ? value : undefined;
	}

	let {
		label,
		icon: Icon,
		destructive = false,
		type = 'button',
		name,
		value,
		trigger
	}: {
		label: string;
		icon: Component;
		/** Destructive row actions use the destructive text colour. */
		destructive?: boolean;
		type?: 'button' | 'submit';
		name?: string;
		value?: string;
		/** Dialog or alert-dialog trigger. Omit it for a form submit. */
		trigger?: Snippet<[TriggerProps]>;
	} = $props();

	const controlClass = $derived(
		cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), destructive && 'text-destructive')
	);
</script>

<Tooltip.Provider>
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				{#if trigger}
					{@render trigger({
						...props,
						class: cn(controlClass, tooltipClass(props.class)),
						'aria-label': label
					} as TriggerProps)}
				{:else}
					<Button
						{...props}
						{type}
						{name}
						{value}
						variant="ghost"
						size="icon-sm"
						class={cn(destructive && 'text-destructive', tooltipClass(props.class))}
						aria-label={label}
					>
						<Icon class="size-4" />
					</Button>
				{/if}
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content>{label}</Tooltip.Content>
	</Tooltip.Root>
</Tooltip.Provider>
