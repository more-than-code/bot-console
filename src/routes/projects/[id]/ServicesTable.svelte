<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import type { Host, ProjectServiceRow, ServiceRuntime } from '$lib/api-types';
	import * as Table from '$lib/components/ui/table';
	import type { CopyState } from '$lib/catalog-copies';
	import type { ServiceControls, ServiceEntryRef } from '$lib/service-actions';
	import CatalogCopyRow from './CatalogCopyRow.svelte';
	import CatalogIdleRow from './CatalogIdleRow.svelte';

	/** What every service row shares (the dialogs' action results and the page's editing context). */
	type Shared = Omit<
		ComponentProps<typeof CatalogCopyRow>,
		'copy' | 'controls' | 'runtime' | 'state' | 'selected' | 'logsOpen' | 'now'
	>;

	let {
		label,
		entry,
		entryId,
		entryRef,
		copies,
		idle,
		controlsFor,
		runtimeOf,
		stateOf,
		selectedId = null,
		logsOpenId = null,
		now,
		shared,
		busy = false
	}: {
		/** Names the table for screen readers, e.g. "Services of web". */
		label: string;
		entry: string;
		entryId: string;
		/** The entry's grants (for Start on "Not started" rows), or null. */
		entryRef: ServiceEntryRef | null;
		/** The running copies, in host-name order. */
		copies: ProjectServiceRow[];
		/** Hosts a program never ran on ("Not started" rows). */
		idle: Host[];
		controlsFor: (copy: ProjectServiceRow) => ServiceControls | 'checking' | null;
		runtimeOf: (copy: ProjectServiceRow) => ServiceRuntime | null;
		stateOf: (copy: ProjectServiceRow) => CopyState;
		selectedId?: string | null;
		logsOpenId?: string | null;
		now: number;
		shared: Shared;
		/** Some service's state is still being read. */
		busy?: boolean;
	} = $props();
</script>

<!-- One entry's services: Host | Status | Port | Digest | Uptime | actions, in a tinted, rounded panel.
     Reusable on a host page later. Below `sm` the header hides and each row stacks into two lines. -->
<div class="bg-muted/40 rounded-lg px-1 py-1" data-services-table>
	<Table.Root aria-label={label} aria-busy={busy ? 'true' : undefined}>
		<Table.Header class="max-sm:hidden">
			<Table.Row class="border-b hover:bg-transparent">
				<Table.Head class="text-muted-foreground h-8 text-xs font-normal">Host</Table.Head>
				<Table.Head class="text-muted-foreground h-8 text-xs font-normal">Status</Table.Head>
				<Table.Head class="text-muted-foreground h-8 text-xs font-normal">Port</Table.Head>
				<Table.Head class="text-muted-foreground h-8 text-xs font-normal">Digest</Table.Head>
				<Table.Head class="text-muted-foreground h-8 text-xs font-normal">Uptime</Table.Head>
				<Table.Head class="h-8"><span class="sr-only">Actions</span></Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each copies as copy (copy.id)}
				<CatalogCopyRow
					{...shared}
					{copy}
					controls={controlsFor(copy)}
					runtime={runtimeOf(copy)}
					state={stateOf(copy)}
					selected={selectedId === copy.id}
					logsOpen={logsOpenId === copy.id}
					{now}
				/>
			{/each}
			{#each idle as host (host.id)}
				<CatalogIdleRow {entry} {entryRef} {host} id="not-started-{entryId}-{host.id}" runResult={shared.runResult ?? null} />
			{/each}
		</Table.Body>
	</Table.Root>
</div>
