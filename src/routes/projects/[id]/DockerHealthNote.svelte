<script lang="ts">
	import type { DockerCheckView } from '$lib/api-types';
	import { DOCKER_IMAGE_DEFAULT, catalogEntryHref, dockerCheckTimings, formatArgv } from '$lib/health-checks';

	let {
		dockerCheck = null,
		catalogEntry = null,
		onNavigate
	}: {
		/** Null when the catalog could not be read or the entry is not visible. */
		dockerCheck?: DockerCheckView;
		/** Set only for a row of this project. */
		catalogEntry?: string | null;
		/** Runs before the link navigates, so the dialog closes first. */
		onNavigate?: () => void;
	} = $props();
</script>

{#if dockerCheck != null || catalogEntry}
<div class="grid gap-1 text-sm">
	{#if dockerCheck === 'image-default'}
		<p>{DOCKER_IMAGE_DEFAULT}</p>
	{:else if dockerCheck != null}
		<p>
			Docker runs (from the catalog entry): <code class="font-mono break-all">{formatArgv(dockerCheck.test)}</code>
			<span class="whitespace-nowrap">{dockerCheckTimings(dockerCheck)}</span>
		</p>
	{/if}
	{#if catalogEntry}
		<p>
			<a class="text-primary underline underline-offset-4" href={catalogEntryHref(catalogEntry)} onclick={() => onNavigate?.()}
				>Edit the Docker health check in the catalog</a
			>
			<span class="text-muted-foreground">Changes apply on the next deploy.</span>
		</p>
	{/if}
</div>
{/if}
