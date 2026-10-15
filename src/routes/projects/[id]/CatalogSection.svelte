<script lang="ts">
	import { page } from '$app/state';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import CommandText from '$lib/components/CommandText.svelte';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import DataTable from '$lib/components/DataTable.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import RowAction from '$lib/components/RowAction.svelte';
	import { Input } from '$lib/components/ui/input';
	import type { CatalogEntry, Host, Member } from '$lib/api-types';
	import { GRANT_ACTIONS } from '$lib/catalog';
	import type { CatalogEditorState, CatalogPermissionsState, CatalogRunState } from '$lib/project-action';
	import type { Column } from '$lib/table';
	import { actionUrlFrom } from '$lib/url';
	import CatalogEntryDialog from './CatalogEntryDialog.svelte';
	import CatalogPermissions from './CatalogPermissions.svelte';
	import CatalogRunDialog from './CatalogRunDialog.svelte';

	const RUN_ACTION = { run: 'catalogRun', stop: 'catalogStop', restart: 'catalogRestart', logs: 'catalogLogs' } as const;

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
		entries,
		omitted,
		truncated,
		message,
		hosts,
		members,
		editor = null,
		run = null,
		permissions = null
	}: {
		canOwner: boolean;
		entries: CatalogEntry[];
		omitted: number;
		truncated: boolean;
		message: string | null;
		hosts: Host[];
		members: Member[];
		editor?: CatalogEditorState | null;
		run?: CatalogRunState | null;
		permissions?: CatalogPermissionsState | null;
	} = $props();

	const columns: Column<CatalogEntry>[] = [
		{ key: 'name', label: 'Name', sortable: true, searchable: true, value: (row) => row.name },
		{ key: 'command', label: 'Command', sortable: true, searchable: true, value: (row) => row.command_display },
		{ key: 'run_as', label: 'Run as', sortable: true, value: (row) => row.spec.run_as },
		{ key: 'port', label: 'Port', sortable: true, value: (row) => (row.spec.port == null ? '' : String(row.spec.port)) },
		{ key: 'actions', label: 'Actions', srLabel: true }
	];

	function portOf(entry: CatalogEntry): string {
		return entry.spec.port == null ? 'n/a' : String(entry.spec.port);
	}

	function runFor(entry: CatalogEntry): CatalogRunState | null {
		if (run == null || run.name !== entry.name) return null;
		return run;
	}
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
	id="catalog"
	labelledBy="catalog-heading"
	empty="No catalog entries."
	rowKey={(row) => row.id}
	searchLabel="Search name or command"
>
	{#snippet row(entry)}
		<tr>
			<td class="p-2 align-middle">{entry.name}</td>
			<td class="p-2 align-middle"><CommandText value={entry.command_display} /></td>
			<td class="p-2 align-middle">{entry.spec.run_as}</td>
			<td class="p-2 align-middle font-mono">{portOf(entry)}</td>
			<td class="p-2 align-middle whitespace-normal">
				<div class="flex flex-wrap items-center gap-1">
					{#each GRANT_ACTIONS as action (action)}
						{#if entry.my_actions.includes(action)}
							<CatalogRunDialog
								kind={action}
								entryName={entry.name}
								runAs={entry.spec.run_as}
								shell={entry.spec.shell}
								{hosts}
								action={actionUrlFrom(page.url, RUN_ACTION[action])}
								result={runFor(entry)?.kind === action ? runFor(entry) : null}
							/>
						{/if}
					{/each}
					{#if canOwner}
						<CatalogEntryDialog
							mode="edit"
							{entry}
							{hosts}
							saveAction={actionUrlFrom(page.url, 'catalogUpdate')}
							parseAction={actionUrlFrom(page.url, 'catalogParse')}
							revealed={editor?.mode === 'edit' && editor.name === entry.name}
							editor={editor?.mode === 'edit' && editor.name === entry.name ? editor : null}
						/>
						<form method="GET" action={page.url.pathname}>
							<Input type="hidden" name="tab" value="catalog" />
							<Input type="hidden" name="permissions" value={entry.name} />
							<RowAction type="submit" label="Permissions {entry.name}" icon={ShieldCheck} />
						</form>
						<ConfirmAction
							id="delete-catalog-{entry.id}"
							action={actionUrlFrom(page.url, 'catalogDelete')}
							label="Delete"
							confirmLabel="Delete"
							message="Delete {entry.name}? Running units are not stopped."
							hidden={[{ name: 'name', value: entry.name }]}
							rowLabel="Delete {entry.name}"
						/>
					{/if}
				</div>
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
	/>
{/if}
