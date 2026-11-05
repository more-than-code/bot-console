<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import type { CatalogEntry, Host } from '$lib/api-types';
	import CommandText from '$lib/components/CommandText.svelte';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import RowMenu from '$lib/components/RowMenu.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { catalogKindInfo } from '$lib/catalog';
	import { CATALOG_CELL, hostsText, NOT_DEPLOYED, worstState, type CopySummary } from '$lib/catalog-copies';
	import { rowClickToggles } from '$lib/catalog-open';
	import { formatAgo, formatWhen } from '$lib/format';
	import type { CatalogEditorState, ImageDeployState, ImageEditorState } from '$lib/project-action';
	import { catalogEntryMenuId, entryMenuItems, type MenuKey } from '$lib/row-menu';
	import { actionUrlFrom, permissionsOpenHref } from '$lib/url';
	import CatalogDeployDialog from './CatalogDeployDialog.svelte';
	import CatalogEntryDialog from './CatalogEntryDialog.svelte';
	import CatalogImageDialog from './CatalogImageDialog.svelte';

	let {
		entry,
		summary,
		opens,
		isOpen,
		controlsId,
		onToggle,
		canOwner,
		canAdmin,
		hosts,
		projectId,
		copiesComplete,
		editor = null,
		imageEditor = null,
		imageDeploy = null,
		onImageSaved,
		now,
		timeZone
	}: {
		entry: CatalogEntry;
		/** The Services column (see `copySummary`). */
		summary: CopySummary;
		/** It has services to show (an arrow). */
		opens: boolean;
		isOpen: boolean;
		/** The id of the services row the arrow shows and hides. */
		controlsId: string;
		onToggle: () => void;
		canOwner: boolean;
		canAdmin: boolean;
		hosts: Host[];
		projectId: string;
		/** "Not deployed" needs a complete services list. */
		copiesComplete: boolean;
		editor?: CatalogEditorState | null;
		imageEditor?: ImageEditorState | null;
		imageDeploy?: ImageDeployState | null;
		onImageSaved?: (name: string) => void;
		/** One clock for every row. */
		now: number;
		timeZone?: string;
	} = $props();

	const kind = $derived(catalogKindInfo(entry));
	const worst = $derived(worstState(summary));
	const canEdit = $derived(canOwner || canAdmin);
	const deploys = $derived(entry.kind === 'image' && entry.my_actions.includes('deploy'));
	const menuItems = $derived(entryMenuItems({ name: entry.name, deploy: deploys, edit: canEdit, owner: canOwner }));
	const menuId = $derived(catalogEntryMenuId(entry.id));

	/** A deploy, rollback or remove is running: the row's actions wait. */
	let rowBusy = $state(false);

	function setRowBusy(busy: boolean) {
		rowBusy = busy;
	}

	// The ⋯ menu opens Deploy and Edit (below `sm`) and Delete by bumping these counters.
	let requests = $state({ deploy: 0, edit: 0, delete: 0 });

	function onMenu(key: MenuKey) {
		if (key === 'permissions') {
			// Focus and scroll stay, so the drawer takes focus and closes back to the ⋯ button.
			void goto(permissionsOpenHref(page.url, entry.name), { keepFocus: true, noScroll: true });
			return;
		}
		if (key === 'deploy' || key === 'edit' || key === 'delete') requests[key] += 1;
	}

	/** A click on the row background (not on a button, link or menu) toggles the entry too. */
	function rowToggle(node: HTMLElement) {
		const onclick = (event: MouseEvent) => {
			if (opens && rowClickToggles(event.target as Element | null, window.getSelection())) onToggle();
		};
		node.addEventListener('click', onclick);
		return {
			destroy() {
				node.removeEventListener('click', onclick);
			}
		};
	}
</script>

<!-- Collapsed by default. The arrow, or a click on the row background, shows the copies. -->
<tr data-entry={entry.name} data-open={isOpen ? 'true' : 'false'} class={opens ? 'cursor-pointer' : undefined} use:rowToggle>
	<td class={CATALOG_CELL.toggle}>
			{#if opens}
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					class="max-sm:size-11"
					aria-expanded={isOpen}
					aria-controls={controlsId}
					aria-label="Services of {entry.name}"
					onclick={onToggle}
					data-toggle
				>
					<ChevronRight class="size-4 transition-transform {isOpen ? 'rotate-90' : ''}" aria-hidden="true" />
				</Button>
			{:else}
				<span class="block size-7 shrink-0 max-sm:size-11" aria-hidden="true"></span>
			{/if}
	</td>
	<td class={CATALOG_CELL.name}>
		<div class="flex min-w-0 items-center gap-2">
			<span class="min-w-0 truncate font-semibold" data-entry-name>{entry.name}</span>
			<span class="sm:hidden" data-phone-kind><Badge variant="outline">{kind.label}</Badge></span>
		</div>
		<div class="text-muted-foreground min-w-0 truncate text-sm sm:hidden" data-phone-command>{entry.command_display}</div>
		<!-- Below sm the Services column hides, so a problem stays visible here: the worst state and where it runs. -->
		{#if summary.total > 0}
			<div class="flex min-w-0 items-center gap-1 text-sm sm:hidden" data-phone-summary>
				{#if summary.loading}
					<LoaderCircle class="text-muted-foreground size-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
					<span class="sr-only">Reading the states…</span>
				{:else if worst}
					<StatusBadge status={worst.tone} text={worst.text} />
				{/if}
				<span class="text-muted-foreground min-w-0 truncate">{summary.total} on {hostsText(summary.hosts)}</span>
			</div>
		{:else if copiesComplete}
			<div class="sm:hidden" data-phone-summary><StatusBadge status="unknown" text={NOT_DEPLOYED} /></div>
		{/if}
	</td>
	<td class={CATALOG_CELL.kind}>
		{#if kind.tip}
			<Tooltip.Provider>
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<span {...props} title={kind.tip} data-kind={kind.kind}>
								<Badge variant="outline">{kind.label}<span class="sr-only">: {kind.tip}</span></Badge>
							</span>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>{kind.tip}</Tooltip.Content>
				</Tooltip.Root>
			</Tooltip.Provider>
		{:else}
			<span data-kind={kind.kind}><Badge variant="outline">{kind.label}</Badge></span>
		{/if}
	</td>
	<td class={CATALOG_CELL.command}><CommandText value={entry.command_display} /></td>
	<!-- Services: "N on host1, host2" and counts by state; a problem stays visible while collapsed. -->
	<td class={CATALOG_CELL.services} data-summary>
		{#if summary.total === 0}
			<!-- Only a complete copy list may say so (spec §10): not capped, nothing left out, no failure. -->
			{#if copiesComplete}<StatusBadge status="unknown" text={NOT_DEPLOYED} />{/if}
		{:else}
			<div class="flex min-w-0 flex-wrap items-center gap-1">
				<span class="text-sm" title={summary.hosts.join(', ')}>{summary.total} on {hostsText(summary.hosts)}</span>
				{#if summary.running > 0}<StatusBadge status="up" text="{summary.running} running" />{/if}
				{#if summary.unhealthy > 0}<StatusBadge status="down" text="{summary.unhealthy} unhealthy" />{/if}
				{#if summary.stopped > 0}<StatusBadge status="stopped" text="{summary.stopped} stopped" />{/if}
				{#if summary.notStarted > 0}<StatusBadge status="unknown" text="{summary.notStarted} not started" />{/if}
				{#if summary.noStatus > 0}<StatusBadge status="unknown" text="{summary.noStatus} no status" />{/if}
				{#if summary.loading}
					<span class="text-muted-foreground inline-flex items-center" data-state-loading>
						<LoaderCircle class="size-4 motion-safe:animate-spin" aria-hidden="true" />
						<span class="sr-only">Reading the states…</span>
					</span>
				{/if}
			</div>
		{/if}
	</td>
	<td class={CATALOG_CELL.lastDeployed} data-last-deployed>
		{#if entry.last_deployed_at}
			{@const iso = entry.last_deployed_at}
			{@const when = formatWhen(iso, timeZone)}
			<Tooltip.Provider>
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<time {...props} datetime={iso} title={when}
								>{formatAgo(iso, now)}<span class="sr-only">, {when}</span></time
							>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>{when}</Tooltip.Content>
				</Tooltip.Root>
			</Tooltip.Provider>
		{:else if entry.last_deployed_at === null}
			Never
		{/if}
	</td>
	<td class={CATALOG_CELL.actions}>
		<!-- Fixed slots: [Deploy] [Edit] [ ] [⋯ Permissions, Delete]. An action that does not apply keeps its
		     slot empty, so icons line up with the copies' [Start/Stop] [Restart] [Logs] [⋯]. -->
		<fieldset disabled={rowBusy} class={CATALOG_CELL.actionsGroup}>
			<span class="max-sm:hidden" data-slot-deploy>
				{#if entry.kind === 'image' && deploys}
					<CatalogDeployDialog
						{entry}
						{hosts}
						deployAction={actionUrlFrom(page.url, 'catalogDeploy')}
						rollbackAction={actionUrlFrom(page.url, 'catalogRollback')}
						removeAction={actionUrlFrom(page.url, 'catalogRemove')}
						confirmAction={actionUrlFrom(page.url, 'catalogConfirm')}
						historyAction={actionUrlFrom(page.url, 'catalogDeploys')}
						result={imageDeploy?.name === entry.name ? imageDeploy : null}
						disabled={rowBusy}
						onRowBusy={setRowBusy}
						{projectId}
						openRequest={requests.deploy}
						fallbackFocusId={menuId}
					/>
				{:else}
					<span class="block size-7" aria-hidden="true" data-empty-slot></span>
				{/if}
			</span>
			<span class="max-sm:hidden" data-slot-edit>
				{#if canEdit && entry.kind === 'program'}
					<CatalogEntryDialog
						mode="edit"
						{entry}
						{hosts}
						saveAction={actionUrlFrom(page.url, 'catalogUpdate')}
						parseAction={actionUrlFrom(page.url, 'catalogParse')}
						revealed={editor?.mode === 'edit' && editor.name === entry.name}
						editor={editor?.mode === 'edit' && editor.name === entry.name ? editor : null}
						disabled={rowBusy}
						openRequest={requests.edit}
						fallbackFocusId={menuId}
					/>
				{:else if canEdit && entry.kind === 'image'}
					<CatalogImageDialog
						mode="edit"
						{entry}
						saveAction={actionUrlFrom(page.url, 'catalogUpdate')}
						setsAction={actionUrlFrom(page.url, 'catalogEnvSets')}
						filesAction={actionUrlFrom(page.url, 'catalogFiles')}
						tagsAction={actionUrlFrom(page.url, 'catalogImageTags')}
						digestAction={actionUrlFrom(page.url, 'catalogImageDigest')}
						revealed={imageEditor?.mode === 'edit' && imageEditor.name === entry.name}
						editor={imageEditor?.mode === 'edit' && imageEditor.name === entry.name ? imageEditor : null}
						onSaved={onImageSaved}
						disabled={rowBusy}
						openRequest={requests.edit}
						fallbackFocusId={menuId}
					/>
				{:else}
					<span class="block size-7" aria-hidden="true" data-empty-slot></span>
				{/if}
			</span>
			<span class="block size-7 max-sm:hidden" aria-hidden="true" data-empty-slot></span>
			<RowMenu
				id={menuId}
				label="More actions for {entry.name}"
				items={menuItems}
				onSelect={onMenu}
			/>
			{#if canOwner}
				<ConfirmAction
					id="delete-catalog-{entry.id}"
					action={actionUrlFrom(page.url, 'catalogDelete')}
					label="Delete"
					confirmLabel="Delete"
					message={entry.kind === 'image'
						? `Delete ${entry.name}? Its containers keep running on their hosts.`
						: `Delete ${entry.name}? Running units are not stopped.`}
					hidden={[{ name: 'name', value: entry.name }]}
					rowLabel="Delete {entry.name}"
					showTrigger={false}
					openRequest={requests.delete}
					fallbackFocusId={menuId}
				/>
			{/if}
		</fieldset>
	</td>
</tr>
