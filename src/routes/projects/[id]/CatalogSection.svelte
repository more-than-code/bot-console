<script lang="ts">
	import { page } from '$app/state';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import CommandText from '$lib/components/CommandText.svelte';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import DataTable from '$lib/components/DataTable.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import RowAction from '$lib/components/RowAction.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import type { CatalogEntry, Host, Member } from '$lib/api-types';
	import {
		CATALOG_KIND_OPTIONS,
		catalogDefaultSort,
		catalogKindInfo,
		catalogKindOf,
		LAST_DEPLOYED_SORT,
		lastDeployedValue
	} from '$lib/catalog';
	import { formatAgo, formatWhen } from '$lib/format';
	import { imagePortText } from '$lib/image-spec';
	import type { CatalogEditorState, CatalogPermissionsState, ImageDeployState, ImageEditorState } from '$lib/project-action';
	import { CATALOG_TABLE_ID, tableParam, type Column } from '$lib/table';
	import { timeZoneSource } from '$lib/time-zone';
	import { actionUrlFrom, permissionsCloseHrefFor, permissionsOpenFields } from '$lib/url';
	import CatalogDeployDialog from './CatalogDeployDialog.svelte';
	import CatalogEntryDialog from './CatalogEntryDialog.svelte';
	import CatalogImageDialog from './CatalogImageDialog.svelte';
	import CatalogPermissions from './CatalogPermissions.svelte';

	const permissionsCloseHref = $derived(permissionsCloseHrefFor(page.url));

	/** The row's Permissions button, where focus returns when its drawer closes or saves. */
	function permissionsButtonId(entryId: string): string {
		return `catalog-permissions-${entryId}`;
	}

	let {
		canOwner,
		canAdmin = false,
		entries,
		omitted,
		truncated,
		message,
		hosts,
		members,
		editor = null,
		permissions = null,
		imageEditor = null,
		imageDeploy = null,
		onImageSaved,
		projectId = null
	}: {
		canOwner: boolean;
		canAdmin?: boolean;
		entries: CatalogEntry[];
		omitted: number;
		truncated: boolean;
		message: string | null;
		hosts: Host[];
		members: Member[];
		editor?: CatalogEditorState | null;
		permissions?: CatalogPermissionsState | null;
		imageEditor?: ImageEditorState | null;
		imageDeploy?: ImageDeployState | null;
		onImageSaved?: (name: string) => void;
		/** For the Deploy drawer's "View logs in Services" link. */
		projectId?: string | null;
	} = $props();

	let rowBusy = $state<string | null>(null);

	function setRowBusy(name: string, busy: boolean) {
		rowBusy = busy ? name : rowBusy === name ? null : rowBusy;
	}

	const columns: Column<CatalogEntry>[] = [
		{ key: 'name', label: 'Name', sortable: true, searchable: true, value: (row) => row.name },
		{
			key: 'kind',
			label: 'Kind',
			sortable: true,
			searchable: true,
			// Program, Service, Job, then by name.
			value: (row) => `${catalogKindInfo(row).order}:${row.name}`,
			searchValue: (row) => catalogKindInfo(row).label,
			filter: { param: 'kind', label: 'Kind', options: CATALOG_KIND_OPTIONS, value: (row) => catalogKindOf(row) }
		},
		{ key: 'command', label: 'Command', sortable: true, searchable: true, value: (row) => row.command_display },
		{
			key: 'run_as',
			label: 'Run as',
			sortable: true,
			hideBelowSm: true,
			value: (row) => (row.kind === 'image' ? row.spec.user : row.spec.run_as)
		},
		{ key: 'port', label: 'Port', sortable: true, hideBelowSm: true, value: (row) => portOf(row) },
		{
			key: LAST_DEPLOYED_SORT,
			label: 'Last deployed',
			sortable: true,
			hideBelowSm: true,
			firstDir: 'desc',
			value: (row) => lastDeployedValue(row)
		},
		{ key: 'actions', label: 'Actions', srLabel: true }
	];

	function portOf(entry: CatalogEntry): string {
		if (entry.kind === 'image') {
			if (entry.spec.ports.length === 0) return 'n/a';
			return entry.spec.ports.map((port) => imagePortText(port)).join(', ');
		}
		return entry.spec.port == null ? 'n/a' : String(entry.spec.port);
	}

	const sortableKeys = columns.filter((column) => column.sortable).map((column) => column.key);
	const tableDefaults = $derived(
		catalogDefaultSort(entries, page.url.searchParams.get(tableParam(CATALOG_TABLE_ID, 'sort')), sortableKeys)
	);

	const zones = timeZoneSource();
	/** One clock for every row, read again whenever the entries reload. */
	const now = $derived.by(() => {
		void entries;
		return Date.now();
	});

	const permissionEntry = $derived(permissions ? (entries.find((item) => item.name === permissions.name) ?? null) : null);
</script>

{#if message}
	<Notice kind="error">{message}</Notice>
{/if}
{#if omitted > 0}
	<p class="text-muted-foreground mb-2 text-sm">{omitted} more {omitted === 1 ? 'row' : 'rows'} left out.</p>
{/if}
{#if truncated}
	<p class="text-muted-foreground mb-2 text-sm">More items not shown</p>
{/if}
<h2 id="catalog-heading" class="sr-only">Catalog</h2>
<DataTable
	rows={entries}
	{columns}
	id={CATALOG_TABLE_ID}
	labelledBy="catalog-heading"
	empty="No catalog entries."
	rowKey={(row) => row.id}
	searchLabel="Search name, kind or command"
	defaultSort={tableDefaults.sort}
	defaultDir={tableDefaults.dir}
>
	{#snippet row(entry)}
		{@const kind = catalogKindInfo(entry)}
		<tr>
			<td class="p-2 align-middle">{entry.name}</td>
			<td class="p-2 align-middle">
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
			<td class="p-2 align-middle"><CommandText value={entry.command_display} /></td>
			<td class="p-2 align-middle max-sm:hidden">{entry.kind === 'image' ? entry.spec.user : entry.spec.run_as}</td>
			<td class="p-2 align-middle font-mono max-sm:hidden">{portOf(entry)}</td>
			<td class="p-2 align-middle whitespace-nowrap max-sm:hidden" data-last-deployed>
				{#if entry.last_deployed_at}
					{@const iso = entry.last_deployed_at}
					{@const when = formatWhen(iso, zones?.current)}
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
				{:else}
					<span aria-hidden="true">—</span><span class="sr-only">Unknown</span>
				{/if}
			</td>
			<td class="p-2 align-middle whitespace-normal">
				<!-- A grid of at most four icons per line keeps the row short when the table is squeezed. -->
				<fieldset
					disabled={rowBusy === entry.name}
					class="m-0 grid min-w-0 grid-cols-[repeat(4,max-content)] items-center gap-1 border-0 p-0"
				>
					{#if entry.kind === 'image' && entry.my_actions.includes('deploy')}
						<CatalogDeployDialog
							{entry}
							{hosts}
							deployAction={actionUrlFrom(page.url, 'catalogDeploy')}
							rollbackAction={actionUrlFrom(page.url, 'catalogRollback')}
							removeAction={actionUrlFrom(page.url, 'catalogRemove')}
							confirmAction={actionUrlFrom(page.url, 'catalogConfirm')}
							historyAction={actionUrlFrom(page.url, 'catalogDeploys')}
							result={imageDeploy?.name === entry.name ? imageDeploy : null}
							disabled={rowBusy === entry.name}
							onRowBusy={(busy) => setRowBusy(entry.name, busy)}
							{projectId}
						/>
					{/if}
					{#if (canOwner || canAdmin) && entry.kind === 'program'}
						<CatalogEntryDialog
							mode="edit"
							{entry}
							{hosts}
							saveAction={actionUrlFrom(page.url, 'catalogUpdate')}
							parseAction={actionUrlFrom(page.url, 'catalogParse')}
							revealed={editor?.mode === 'edit' && editor.name === entry.name}
							editor={editor?.mode === 'edit' && editor.name === entry.name ? editor : null}
							disabled={rowBusy === entry.name}
						/>
					{:else if (canOwner || canAdmin) && entry.kind === 'image'}
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
							disabled={rowBusy === entry.name}
						/>
					{/if}
					{#if canOwner}
						<!-- Opens the Permissions drawer. Focus and scroll stay, so the drawer takes focus and closes back to this button. -->
						<form method="GET" action={page.url.pathname} data-sveltekit-keepfocus data-sveltekit-noscroll>
							{#each permissionsOpenFields(page.url, entry.name) as field, index (index)}
								<Input type="hidden" name={field.name} value={field.value} />
							{/each}
							<RowAction
								type="submit"
								id={permissionsButtonId(entry.id)}
								label="Permissions {entry.name}"
								icon={ShieldCheck}
								disabled={rowBusy === entry.name}
							/>
						</form>
						<ConfirmAction
							id="delete-catalog-{entry.id}"
							action={actionUrlFrom(page.url, 'catalogDelete')}
							label="Delete"
							confirmLabel="Delete"
							disabled={rowBusy === entry.name}
							message={entry.kind === 'image'
								? `Delete ${entry.name}? Its containers keep running on their hosts.`
								: `Delete ${entry.name}? Running units are not stopped.`}
							hidden={[{ name: 'name', value: entry.name }]}
							rowLabel="Delete {entry.name}"
						/>
					{/if}
				</fieldset>
			</td>
		</tr>
	{/snippet}
</DataTable>
{#if permissions}
	<CatalogPermissions
		action={actionUrlFrom(page.url, 'catalogPermissions')}
		name={permissions.name}
		grants={permissions.grants}
		{members}
		message={permissions.message}
		loaded={permissions.loaded}
		closeHref={permissionsCloseHref}
		returnFocusId={permissionEntry ? permissionsButtonId(permissionEntry.id) : null}
		includeDeploy={permissionEntry?.kind === 'image'}
	/>
{/if}
