<script lang="ts">
	import type { Component } from 'svelte';
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { COPY_FAILED_NOTE, COPIED_NOTE, copyText } from '$lib/copy-text';
	import { cn } from '$lib/utils';

	let {
		value,
		label,
		iconOnly = false,
		tip,
		icon: Icon = Copy,
		onResult
	}: {
		value: string;
		label: string;
		/** Icon button. The tooltip is `tip`, else `value`. The accessible name stays `label`. */
		iconOnly?: boolean;
		/** Icon-only tooltip text instead of `value` (an env row shows "Copy {KEY}"). */
		tip?: string;
		icon?: Component;
		/** Called with the copy note. Icon-only failure is rendered by the caller. */
		onResult?: (note: string) => void;
	} = $props();
	let note = $state('');
	const copied = $derived(note === COPIED_NOTE);

	function tooltipClass(prop: unknown): string | undefined {
		return typeof prop === 'string' ? prop : undefined;
	}

	async function copy() {
		note = await copyText(value, (text) => navigator.clipboard.writeText(text));
		onResult?.(note);
	}
</script>

{#if iconOnly}
	<span class="inline-flex flex-col items-start">
		<Tooltip.Provider>
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							type="button"
							variant="ghost"
							size="icon-sm"
							class={cn('text-muted-foreground', tooltipClass(props.class))}
							onclick={copy}
							aria-label={label}
							aria-live="polite"
							title={tip ?? value}
						>
							{#if copied}
								<Check class="size-4" />
								<span class="sr-only">Copied</span>
							{:else}
								<Icon class="size-4" />
							{/if}
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content class={tip ? 'max-w-sm' : 'max-w-sm font-mono break-all'}>{tip ?? value}</Tooltip.Content>
			</Tooltip.Root>
		</Tooltip.Provider>
	</span>
{:else}
	<Button type="button" variant="outline" size="sm" onclick={copy} aria-live="polite">
		{#if copied}
			<Check class="size-4" />Copied
		{:else}
			<Copy class="size-4" />{label}
		{/if}
	</Button>
	{#if note === COPY_FAILED_NOTE}
		<p class="text-muted-foreground text-sm" role="status">{note}</p>
	{/if}
{/if}
