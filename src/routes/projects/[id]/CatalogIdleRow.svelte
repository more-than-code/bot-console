<script lang="ts">
	import type { Host } from '$lib/api-types';
	import RowMenu from '$lib/components/RowMenu.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { CATALOG_CELL, NOT_STARTED, SERVICES_CELL } from '$lib/catalog-copies';
	import type { CatalogRunState } from '$lib/project-action';
	import { copyMenuItems, type MenuKey } from '$lib/row-menu';
	import { serviceControls, type ServiceEntryRef } from '$lib/service-actions';
	import ServiceRowActions from './ServiceRowActions.svelte';

	let {
		entry,
		entryRef,
		host,
		id,
		runResult = null
	}: {
		/** The program's name. */
		entry: string;
		/** Its grants, or null when the caller has none (then the row has no Start). */
		entryRef: ServiceEntryRef | null;
		/** A host that can run the program and never did. */
		host: Host;
		id: string;
		runResult?: CatalogRunState | null;
	} = $props();

	const controls = $derived(entryRef ? serviceControls(entryRef, host.status, { state: 'stopped', restarts: null }) : null);
	const menuId = $derived(`${id}-menu`);
	const items = $derived(
		copyMenuItems({
			entry,
			host: host.name,
			state:
				controls && (controls.stateAction || controls.blockedReason)
					? { label: 'Start', disabledReason: controls.stateAction ? null : controls.blockedReason }
					: null,
			restart: false,
			logs: false,
			health: null,
			rename: false,
			label: entry
		})
	);
	let startRequest = $state(0);

	function onMenu(key: MenuKey) {
		if (key === 'state') startRequest += 1;
	}
</script>

<!-- A program that never ran on this host: a row of the entry's services table, "Not started" and Start only. -->
<tr {id} class="hover:bg-muted/50 border-b last:border-b-0" data-not-running="{entry} {host.id}">
	<td class={SERVICES_CELL.host}>
		<div class="flex min-w-0 flex-wrap items-center gap-x-2">
			<span class="sr-only">{`${entry} on `}</span>
			<a class="text-primary min-w-0 truncate underline-offset-4 hover:underline" href="/hosts/{host.id}">{host.name}</a>
			<span class="sm:hidden"><StatusBadge status="unknown" text={NOT_STARTED} /></span>
		</div>
	</td>
	<td class={SERVICES_CELL.status}><StatusBadge status="unknown" text={NOT_STARTED} /></td>
	<td class={SERVICES_CELL.port}></td>
	<td class={SERVICES_CELL.digest}></td>
	<td class={SERVICES_CELL.uptime}>—</td>
	<td class={SERVICES_CELL.actions}>
		<ServiceRowActions
			class={CATALOG_CELL.actionsGroup}
			{controls}
			hostId={host.id}
			hostName={host.name}
			{runResult}
			startOnly
			stateRequest={startRequest}
			fallbackFocusId={menuId}
			extra={menu}
		/>
	</td>
</tr>

{#snippet menu()}
	<RowMenu id={menuId} label="More actions for {entry} on {host.name}" {items} onSelect={onMenu} />
{/snippet}
