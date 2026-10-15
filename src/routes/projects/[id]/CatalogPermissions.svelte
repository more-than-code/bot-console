<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import type { CatalogGrant, Member } from '$lib/api-types';
	import CatalogPermissionsForm from './CatalogPermissionsForm.svelte';

	let {
		action,
		name,
		grants,
		members,
		message = null,
		loaded,
		closeHref
	}: {
		action: string;
		name: string;
		grants: CatalogGrant[];
		members: Member[];
		message?: string | null;
		loaded: boolean;
		closeHref: string;
	} = $props();
</script>

<section class="mt-8 max-h-[calc(100dvh-2rem)] overflow-y-auto" aria-labelledby="catalog-permissions-heading">
	<h2 id="catalog-permissions-heading" class="text-lg font-semibold tracking-tight">Permissions for {name}</h2>
	<p class="text-muted-foreground mb-3 text-sm">The owner always has every action. Admins, viewers, and members get only what is checked.</p>
	{#key name}
		<CatalogPermissionsForm {action} {name} {grants} {members} {message} {loaded}>
			{#snippet cancel()}
				<Button href={closeHref} variant="outline">Cancel</Button>
			{/snippet}
		</CatalogPermissionsForm>
	{/key}
</section>
