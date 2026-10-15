<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Check from '@lucide/svelte/icons/check';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import CommandText from '$lib/components/CommandText.svelte';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import DataTable from '$lib/components/DataTable.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import RowAction from '$lib/components/RowAction.svelte';
	import type { Approval } from '$lib/api-types';
	import type { Column } from '$lib/table';
	import { actionUrlFrom } from '$lib/url';

	let {
		approvals,
		omitted,
		truncated,
		message
	}: {
		approvals: Approval[];
		omitted: number;
		truncated: boolean;
		message: string | null;
	} = $props();

	function envLines(env: Record<string, string>): string {
		return Object.entries(env)
			.map(([key, value]) => `${key}=${value}`)
			.join('\n');
	}

	const columns: Column<Approval>[] = [
		{ key: 'project', label: 'Project', sortable: true, value: (row) => row.project_name },
		{ key: 'entry', label: 'Entry', sortable: true, searchable: true, value: (row) => row.entry_name },
		{ key: 'command', label: 'Command', searchable: true, value: (row) => row.command_display },
		{ key: 'exec', label: 'Exec', value: (row) => row.exec },
		{ key: 'args', label: 'Args', value: (row) => row.args.join(' ') },
		{ key: 'env', label: 'Env', searchable: true, value: (row) => envLines(row.env) },
		{ key: 'dir', label: 'Dir', value: (row) => row.dir },
		{ key: 'run_as', label: 'Run as', value: (row) => row.run_as },
		{ key: 'shell', label: 'Shell', value: (row) => (row.shell ? 'yes' : 'no') },
		{ key: 'requested_by', label: 'Requested by', value: (row) => row.requested_by },
		{ key: 'status', label: 'Status', value: (row) => row.status },
		{ key: 'actions', label: 'Actions', srLabel: true }
	];
</script>

<section class="mt-8">
	<h2 id="catalog-approvals-heading" class="mb-3 text-lg font-semibold tracking-tight">Catalog approvals</h2>
	{#if message}
		<Notice kind="error">{message}</Notice>
	{/if}
	{#if omitted > 0}
		<p class="text-muted-foreground mb-2 text-sm">{omitted} more {omitted === 1 ? 'row' : 'rows'} left out.</p>
	{/if}
	{#if truncated}
		<p class="text-muted-foreground mb-2 text-sm">More items not shown</p>
	{/if}
	<DataTable
		rows={approvals}
		{columns}
		id="approvals"
		labelledBy="catalog-approvals-heading"
		empty="No catalog approvals."
		rowKey={(row) => row.entry_id}
		searchLabel="Search entry or command"
	>
		{#snippet row(item)}
			<tr>
				<td class="p-2 align-middle">{item.project_name}</td>
				<td class="p-2 align-middle">{item.entry_name}</td>
				<td class="p-2 align-middle"><CommandText value={item.command_display} /></td>
				<td class="p-2 align-middle font-mono break-all">{item.exec}</td>
				<td class="p-2 align-middle font-mono break-all whitespace-pre-wrap">{item.args.join(' ')}</td>
				<td class="p-2 align-middle font-mono break-all whitespace-pre-wrap">{envLines(item.env)}</td>
				<td class="p-2 align-middle font-mono">{item.dir}</td>
				<td class="p-2 align-middle">{item.run_as}</td>
				<td class="p-2 align-middle">{item.shell ? 'yes' : 'no'}</td>
				<td class="p-2 align-middle">{item.requested_by}</td>
				<td class="p-2 align-middle"><Badge variant="outline">{item.status}</Badge></td>
				<td class="p-2 align-middle whitespace-normal">
					<div class="flex flex-wrap items-center gap-1">
						<form method="POST" action={actionUrlFrom(page.url, 'approveCatalog')} use:enhance>
							<Input type="hidden" name="entry_id" value={item.entry_id} />
							<Input type="hidden" name="spec_hash" value={item.spec_hash} />
							<RowAction type="submit" label="Approve {item.entry_name}" icon={Check} />
						</form>
						<ConfirmAction
							id="revoke-approval-{item.entry_id}"
							action={actionUrlFrom(page.url, 'revokeCatalog')}
							label="Revoke"
							confirmLabel="Revoke"
							message="Revoke the approval for {item.entry_name}?"
							hidden={[{ name: 'entry_id', value: item.entry_id }]}
							rowLabel="Revoke {item.entry_name}"
						/>
					</div>
				</td>
			</tr>
		{/snippet}
	</DataTable>
</section>
