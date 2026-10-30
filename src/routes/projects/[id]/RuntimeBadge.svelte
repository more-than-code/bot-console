<script lang="ts">
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { statusTooltipText } from '$lib/service-view';
	import { timeZoneSource } from '$lib/time-zone';

	let {
		status,
		detail,
		hint = null,
		lastSeen = null
	}: {
		status: string;
		/** Live details for this copy (see `runtimeDetail`), or empty when there are none. */
		detail: string;
		/** Where the health came from, as on other rows. */
		hint?: string | null;
		/** The row's `last_seen_at`, shown in the viewer's time zone like `LocalTime`. */
		lastSeen?: string | null;
	} = $props();

	const zones = timeZoneSource();
	const detailId = $props.id();
	const text = $derived(statusTooltipText(detail, hint, lastSeen, zones?.current));
	/** Controlled so a tap (click) toggles it: bits-ui opens tooltips on mouse hover and keyboard focus, not on touch. */
	let open = $state(false);
</script>

{#if text === ''}
	<StatusBadge {status} />
{:else}
	<!-- A button: hover and keyboard focus open the details, a click or tap toggles them, and screen readers get them as its description. Outside click and Escape close them. -->
	<Tooltip.Provider>
		<Tooltip.Root bind:open disableCloseOnTriggerClick>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						type="button"
						variant="ghost"
						class="h-auto p-0 hover:bg-transparent"
						aria-describedby={detailId}
						onclick={() => (open = !open)}
					>
						<StatusBadge {status} />
					</Button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content class="max-w-sm break-words">{text}</Tooltip.Content>
		</Tooltip.Root>
	</Tooltip.Provider>
	<span id={detailId} class="sr-only">{text}</span>
{/if}
