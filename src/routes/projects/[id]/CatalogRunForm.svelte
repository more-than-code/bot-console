<script lang="ts">
	import { browser } from '$app/environment';
	import { enhance } from '$app/forms';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import { onDestroy, type Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { blockInFlightSubmit, flightLabel, flightOfRunKind } from '$lib/catalog-flight';
	import type { CatalogRunKind } from '$lib/project-action';
	import { RUN_LABEL } from '$lib/run-actions';
	import { keyAfterResult, keyForKind } from '$lib/service-actions';
	import FlightStatus from './FlightStatus.svelte';

	let {
		kind,
		entryName,
		hostId,
		serviceId = null,
		action,
		entryKind = 'program',
		onBusy,
		cancel
	}: {
		kind: CatalogRunKind;
		entryName: string;
		/** The Services row's host. There is no host choice. */
		hostId: string;
		/** The Services row, so only that row shows the result. Null for a not-running item. */
		serviceId?: string | null;
		action: string;
		entryKind?: 'program' | 'image';
		onBusy?: (busy: boolean) => void;
		cancel?: Snippet;
	} = $props();

	const label = $derived(RUN_LABEL[kind]);
	const flight = $derived(flightOfRunKind(kind));
	const keyed = $derived(flight != null);
	let submitting = $state(false);
	const busy = $derived(flight != null && submitting);

	let idempotencyKey = $state('');
	let keyKind: CatalogRunKind | null = null;

	$effect(() => {
		onBusy?.(busy);
	});

	// The result view replaces this form while a submit is still finishing; the row must not stay busy.
	onDestroy(() => onBusy?.(false));

	// A new key for each kind: Start and Stop share this form when the row's state flips.
	$effect(() => {
		const current = kind;
		if (!browser || !keyed) return;
		idempotencyKey = keyForKind(idempotencyKey, keyKind, current, () => crypto.randomUUID());
		keyKind = current;
	});
</script>

<form
	method="POST"
	{action}
	class="grid gap-3"
	use:enhance={({ formData, cancel }) => {
		if (blockInFlightSubmit(busy)) {
			cancel();
			return async () => {};
		}
		if (keyed) {
			submitting = true;
			if (idempotencyKey === '') idempotencyKey = crypto.randomUUID();
			formData.set('idempotency_key', idempotencyKey);
		}
		return async ({ result, update }) => {
			try {
				await update({ reset: false });
			} finally {
				if (keyed) {
					submitting = false;
					idempotencyKey = keyAfterResult(idempotencyKey, result, () => crypto.randomUUID());
				}
			}
		};
	}}
>
	<Input type="hidden" name="name" value={entryName} />
	{#if entryKind === 'image'}
		<Input type="hidden" name="entry_kind" value="image" />
	{/if}
	{#if keyed}
		<Input type="hidden" name="idempotency_key" value={idempotencyKey} />
	{/if}
	<Input type="hidden" name="host_id" value={hostId} />
	{#if serviceId}
		<Input type="hidden" name="service_id" value={serviceId} />
	{/if}
	<div class="flex flex-wrap items-center gap-2">
		<Button
			type="submit"
			aria-disabled={busy ? 'true' : undefined}
			aria-busy={busy ? 'true' : undefined}
			onclick={(event) => {
				if (blockInFlightSubmit(busy)) event.preventDefault();
			}}
		>
			{#if busy && flight}
				<Loader2 class="size-4 motion-safe:animate-spin" />
				{flightLabel(flight)}
			{:else}
				{label}
			{/if}
		</Button>
		{#if cancel}
			{@render cancel()}
		{/if}
	</div>
	{#if busy}
		<FlightStatus />
	{/if}
</form>
