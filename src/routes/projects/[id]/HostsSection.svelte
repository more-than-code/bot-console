<script lang="ts">
	import { page } from '$app/state';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import DataTable from '$lib/components/DataTable.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import type { Host } from '$lib/api-types';
	import { formatWhen } from '$lib/format';
	import type { Column } from '$lib/table';
	import { actionUrlFrom } from '$lib/url';

	let {
		hosts,
		omitted,
		truncated,
		canAdmin,
		message
	}: {
		hosts: Host[];
		omitted: number;
		truncated: boolean;
		canAdmin: boolean;
		message: string | null;
	} = $props();

	const columns = $derived<Column<Host>[]>([
		{ key: 'name', label: 'Name' },
		{ key: 'status', label: 'Status' },
		{ key: 'seen', label: 'Last seen' },
		{ key: 'version', label: 'Version' },
		...(canAdmin ? [{ key: 'credential', label: 'Credential' }] : [])
	]);
</script>

{#if message}
	<Notice kind="error">{message}</Notice>
{/if}
{#if omitted > 0}
	<p class="sub">{omitted} more {omitted === 1 ? 'row' : 'rows'} left out.</p>
{/if}
{#if truncated}
	<p class="sub">More items not shown</p>
{/if}
<h2 id="hosts-heading" class="sr">Hosts</h2>
<DataTable rows={hosts} {columns} id="hosts" labelledBy="hosts-heading" empty="No hosts enrolled." rowKey={(host) => host.id}>
	{#snippet row(host)}
		<tr>
			<td><a href="/hosts/{host.id}">{host.name}</a></td>
			<td><StatusBadge status={host.status} /></td>
			<td>{formatWhen(host.last_seen_at)}</td>
			<td>{host.agent_version ?? 'n/a'}</td>
			{#if canAdmin}
				<td>
					<ConfirmAction
						id="revoke-host-{host.id}"
						action={actionUrlFrom(page.url, 'revokeCredential')}
						label="Revoke credential"
						confirmLabel="Revoke credential"
						message="Revoke the credential for {host.name}? The agent connection closes."
						hidden={[{ name: 'host_id', value: host.id }]}
					/>
				</td>
			{/if}
		</tr>
	{/snippet}
</DataTable>
