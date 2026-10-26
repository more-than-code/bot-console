<script lang="ts">
	import { page } from '$app/state';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import DataTable from '$lib/components/DataTable.svelte';
	import LocalTime from '$lib/components/LocalTime.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import type { JoinToken } from '$lib/api-types';
	import type { Column } from '$lib/table';
	import { actionUrlFrom } from '$lib/url';

	let {
		tokens,
		omitted,
		truncated,
		canAdmin,
		message
	}: {
		tokens: JoinToken[];
		omitted: number;
		truncated: boolean;
		canAdmin: boolean;
		message: string | null;
	} = $props();

	function stateOf(token: JoinToken): string {
		if (token.revoked_at) return 'revoked';
		if (token.used_at) return 'used';
		return 'active';
	}

	const columns = $derived<Column<JoinToken>[]>([
		{ key: 'hint', label: 'Hint' },
		{ key: 'state', label: 'State' },
		{ key: 'created', label: 'Created' },
		{ key: 'expires', label: 'Expires' },
		...(canAdmin ? [{ key: 'revoke', label: 'Revoke', srLabel: true }] : [])
	]);
</script>

{#if message}
	<Notice kind="error">{message}</Notice>
{/if}
<p class="text-muted-foreground mb-4 text-sm">
	Create join tokens from <a class="text-primary underline underline-offset-4" href="?tab=hosts#new-host">Hosts → Add a host</a>.
</p>
{#if omitted > 0}
	<p class="text-muted-foreground mb-2 text-sm">{omitted} more {omitted === 1 ? 'row' : 'rows'} left out.</p>
{/if}
{#if truncated}
	<p class="text-muted-foreground mb-2 text-sm">More items not shown</p>
{/if}
<h2 id="tokens-heading" class="sr-only">Join tokens</h2>
<DataTable rows={tokens} {columns} id="tokens" labelledBy="tokens-heading" empty="No join tokens." rowKey={(token) => token.id}>
	{#snippet row(token)}
		<tr>
			<td class="p-2 align-middle">{token.host_name_hint ?? 'n/a'}</td>
			<td class="p-2 align-middle">{stateOf(token)}</td>
			<td class="p-2 align-middle"><LocalTime iso={token.created_at} /></td>
			<td class="p-2 align-middle"><LocalTime iso={token.expires_at} /></td>
			{#if canAdmin && !token.revoked_at}
				<td class="p-2 align-middle">
					<ConfirmAction
						id="revoke-token-{token.id}"
						action={actionUrlFrom(page.url, 'revokeToken')}
						label="Revoke"
						confirmLabel="Revoke"
						message="Revoke join token {token.host_name_hint ?? token.id}?"
						hidden={[{ name: 'token_id', value: token.id }]}
						rowLabel="Revoke {token.host_name_hint ?? token.id}"
					/>
				</td>
			{:else if canAdmin}
				<td class="p-2 align-middle"></td>
			{/if}
		</tr>
	{/snippet}
</DataTable>
