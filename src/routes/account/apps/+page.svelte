<script lang="ts">
	import { page } from '$app/state';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import DataTable from '$lib/components/DataTable.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import type { Grant } from '$lib/api-types';
	import { formatWhen } from '$lib/format';
	import type { Column } from '$lib/table';
	import { actionUrlFrom } from '$lib/url';

	let { data, form } = $props();

	const columns: Column<Grant>[] = [
		{ key: 'app', label: 'App' },
		{ key: 'host', label: 'Redirect host' },
		{ key: 'kind', label: 'Kind' },
		{ key: 'created', label: 'Created' },
		{ key: 'used', label: 'Last used' },
		{ key: 'revoke', label: 'Revoke', srLabel: true }
	];
</script>

<svelte:head>
	<title>Connected apps · deploybot</title>
</svelte:head>

<PageHeader title="Connected apps" />
{#if form?.message || data.message}
	<Notice kind="error">{form?.message ?? data.message}</Notice>
{/if}
{#if data.grants.length === 0 && !data.message}
	<Notice kind="info">No connected apps.</Notice>
{:else if data.grants.length > 0}
	<h2 id="apps-heading" class="sr-only">Connected apps</h2>
	<DataTable rows={data.grants} {columns} id="apps" labelledBy="apps-heading" empty="No connected apps." rowKey={(grant) => grant.id}>
		{#snippet row(grant)}
			<tr>
				<td class="p-2 align-middle">{grant.client_name}</td>
				<td class="p-2 align-middle font-mono break-all">{grant.redirect_host}</td>
				<td class="p-2 align-middle">{grant.kind}</td>
				<td class="p-2 align-middle">{formatWhen(grant.created_at)}</td>
				<td class="p-2 align-middle">{formatWhen(grant.last_used_at)}</td>
				<td class="p-2 align-middle">
					<ConfirmAction
						id="revoke-grant-{grant.id}"
						action={actionUrlFrom(page.url, 'revoke')}
						label="Revoke"
						confirmLabel="Revoke"
						message="Revoke {grant.client_name}?"
						hidden={[{ name: 'grant_id', value: grant.id }]}
						rowLabel="Revoke {grant.client_name}"
					/>
				</td>
			</tr>
		{/snippet}
	</DataTable>
{/if}
