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
	import { CATALOG_KIND_OPTIONS, catalogKindInfo, catalogKindOf, IMAGE_RUN_TIP } from '$lib/catalog';
	import { DEPLOY_FIRST_TIP } from '$lib/catalog-flight';
	import { imagePortText } from '$lib/image-spec';
	import type { CatalogEditorState, CatalogPermissionsState, CatalogRunState, ImageDeployState, ImageEditorState } from '$lib/project-action';
	import { CATALOG_TABLE_ID, type Column } from '$lib/table';
	import { actionUrlFrom } from '$lib/url';
	import CatalogDeployDialog from './CatalogDeployDialog.svelte';
	import CatalogEntryDialog from './CatalogEntryDialog.svelte';
	import CatalogImageDialog from './CatalogImageDialog.svelte';
	import CatalogPermissions from './CatalogPermissions.svelte';
	import CatalogRunDialog from './CatalogRunDialog.svelte';

	const ROW_ACTIONS = ['run', 'stop', 'restart', 'logs', 'status'] as const;
	const RUN_ACTION = {
		run: 'catalogRun',
		stop: 'catalogStop',
		restart: 'catalogRestart',
		logs: 'catalogLogs',
		status: 'catalogStatus'
	} as const;

	const permissionsCloseHref = $derived.by(() => {
		const params = new URLSearchParams(page.url.searchParams);
		params.delete('permissions');
		for (const key of [...params.keys()]) {
			if (key.startsWith('/')) params.delete(key);
		}
		const qs = params.toString();
		return qs ? `${page.url.pathname}?${qs}` : page.url.pathname;
	});

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
		run = null,
		permissions = null,
		imageEditor = null,
		imageDeploy = null,
		savedImage = null,
		onImageSaved,
		onEditOpen,
		containers = {},
		containersKnown = false
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
		run?: CatalogRunState | null;
		permissions?: CatalogPermissionsState | null;
		imageEditor?: ImageEditorState | null;
		imageDeploy?: ImageDeployState | null;
		savedImage?: string | null;
		onImageSaved?: (name: string | null) => void;
		onEditOpen?: () => void;
		/** Entry name to host ids that have its container. Used only when `containersKnown` is true. */
		containers?: Record<string, string[]>;
		/** False until the catalog tab has a complete services page. Image actions stay enabled. */
		containersKnown?: boolean;
	} = $props();

	let rowBusy = $state<string | null>(null);

	function setRowBusy(name: string, busy: boolean) {
		rowBusy = busy ? name : rowBusy === name ? null : rowBusy;
	}

	function imageUndeployed(entry: CatalogEntry): boolean {
		if (entry.kind !== 'image' || !containersKnown) return false;
		return (containers[entry.name] ?? []).length === 0;
	}

	function actionNeedsDeploy(entry: CatalogEntry, action: (typeof ROW_ACTIONS)[number]): boolean {
		return action !== 'status' && imageUndeployed(entry);
	}

	function actionTip(entry: CatalogEntry, action: (typeof ROW_ACTIONS)[number]): string | undefined {
		if (actionNeedsDeploy(entry, action)) return DEPLOY_FIRST_TIP;
		return entry.kind === 'image' && action === 'run' ? IMAGE_RUN_TIP : undefined;
	}

	function deployedHosts(entry: CatalogEntry, action: (typeof ROW_ACTIONS)[number]): string[] | null {
		if (entry.kind !== 'image' || action === 'status' || !containersKnown) return null;
		return containers[entry.name] ?? [];
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
		{ key: 'actions', label: 'Actions', srLabel: true }
	];

	function portOf(entry: CatalogEntry): string {
		if (entry.kind === 'image') {
			if (entry.spec.ports.length === 0) return 'n/a';
			return entry.spec.ports.map((port) => imagePortText(port)).join(', ');
		}
		return entry.spec.port == null ? 'n/a' : String(entry.spec.port);
	}

	function runFor(entry: CatalogEntry): CatalogRunState | null {
		if (run == null || run.name !== entry.name) return null;
		return run;
	}

	const permissionEntry = $derived(permissions ? (entries.find((item) => item.name === permissions.name) ?? null) : null);
</script>

{#if savedImage}
	<div class="max-w-full min-w-0 break-all">
		<Notice kind="success">Saved {savedImage}.</Notice>
	</div>
{/if}
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
			<td class="p-2 align-middle whitespace-normal">
				<!-- Below sm, a grid of at most four icons per line keeps the row short. -->
				<fieldset
					disabled={rowBusy === entry.name}
					class="m-0 flex min-w-0 flex-wrap items-center gap-1 border-0 p-0 max-sm:grid max-sm:grid-cols-[repeat(4,max-content)]"
				>
					{#each ROW_ACTIONS as action (action)}
						{#if entry.my_actions.includes(action)}
							<CatalogRunDialog
								kind={action}
								entryName={entry.name}
								runAs={entry.kind === 'program' ? entry.spec.run_as : ''}
								shell={entry.kind === 'program' ? entry.spec.shell : false}
								{hosts}
								action={actionUrlFrom(page.url, RUN_ACTION[action])}
								result={runFor(entry)?.kind === action ? runFor(entry) : null}
								entryKind={entry.kind === 'image' ? 'image' : 'program'}
								tip={actionTip(entry, action)}
								disabled={actionNeedsDeploy(entry, action) || rowBusy === entry.name}
								deployedHostIds={deployedHosts(entry, action)}
								onRowBusy={(busy) => setRowBusy(entry.name, busy)}
							/>
						{/if}
					{/each}
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
							onOpened={onEditOpen}
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
						<form method="GET" action={page.url.pathname}>
							<Input type="hidden" name="tab" value="catalog" />
							<Input type="hidden" name="permissions" value={entry.name} />
							<RowAction type="submit" label="Permissions {entry.name}" icon={ShieldCheck} disabled={rowBusy === entry.name} />
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
		includeDeploy={permissionEntry?.kind === 'image'}
	/>
{/if}
