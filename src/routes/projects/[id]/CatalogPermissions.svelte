<script lang="ts">
	import { afterNavigate, goto } from '$app/navigation';
	import { navigating, page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import * as Sheet from '$lib/components/ui/sheet';
	import type { CatalogGrant, Member } from '$lib/api-types';
	import { restoreFocusTo } from '$lib/dialog-focus';
	import { isPlainClick, permissionsCloseTarget, permissionsRequested } from '$lib/url';
	import CatalogPermissionsForm from './CatalogPermissionsForm.svelte';

	let {
		action,
		name,
		grants,
		members,
		message = null,
		loaded,
		closeHref,
		returnFocusId = null,
		includeDeploy = false
	}: {
		action: string;
		name: string;
		grants: CatalogGrant[];
		members: Member[];
		message?: string | null;
		loaded: boolean;
		closeHref: string;
		/** The row's Permissions button: focus goes back there on close and after a save. */
		returnFocusId?: string | null;
		includeDeploy?: boolean;
	} = $props();

	// The `permissions` query opens this drawer; closing it drops the query.
	let open = $state(true);

	// Only a navigation that lands on a `permissions` URL (the same or another row) reopens it, never the drawer's own close.
	afterNavigate((navigation) => {
		if (navigation.to && permissionsRequested(navigation.to.url)) open = true;
	});

	// A user close drops the query, unless a click on another row's Permissions is already navigating.
	function onOpenChangeComplete(isOpen: boolean) {
		if (isOpen) return;
		const target = permissionsCloseTarget(closeHref, page.url, navigating.to?.url ?? null);
		if (target != null) void goto(target, { keepFocus: true, noScroll: true });
	}

	/** Back to this row's Permissions button, which opened the drawer through the URL. */
	function onCloseAutoFocus(event: Event) {
		if (returnFocusId) restoreFocusTo(returnFocusId)(event);
	}

	/** A plain click closes the drawer first; a new-tab click follows the link. */
	function onCancel(event: MouseEvent) {
		if (!isPlainClick(event)) return;
		event.preventDefault();
		open = false;
	}
</script>

<!-- A drawer from the right, full width on a phone. The grants scroll between the header and the pinned Save footer. -->
<Sheet.Root bind:open {onOpenChangeComplete}>
	<Sheet.Content side="right" class="data-[side=right]:w-full data-[side=right]:sm:max-w-2xl" {onCloseAutoFocus}>
		<Sheet.Header class="pr-12 pb-0">
			<Sheet.Title class="break-all">Permissions for {name}</Sheet.Title>
			<Sheet.Description>The owner always has every action. Admins, viewers, and members get only what is checked.</Sheet.Description>
		</Sheet.Header>
		{#key name}
			<CatalogPermissionsForm {action} {name} {grants} {members} {message} {loaded} {includeDeploy} {returnFocusId}>
				{#snippet cancel()}
					<Button href={closeHref} variant="outline" onclick={onCancel}>Cancel</Button>
				{/snippet}
			</CatalogPermissionsForm>
		{/key}
	</Sheet.Content>
</Sheet.Root>
