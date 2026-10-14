<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import DataTable from '$lib/components/DataTable.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import type { CreatedJoin, JoinToken } from '$lib/api-types';
	import { formatWhen } from '$lib/format';
	import type { Column } from '$lib/table';
	import { actionUrlFrom } from '$lib/url';

	let {
		tokens,
		omitted,
		truncated,
		canAdmin,
		created,
		message
	}: {
		tokens: JoinToken[];
		omitted: number;
		truncated: boolean;
		canAdmin: boolean;
		created: CreatedJoin | null;
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
{#if created}
	<div class="secret" translate="no">
		<Notice kind="success">Copy this now. It is shown once and is not saved in this browser.</Notice>
		<p class="sub">Join token</p>
		<p class="command">{created.token}</p>
		<CopyButton value={created.token} label="Copy token" />
		{#if created.install_command}
			<p class="sub">Install command</p>
			<pre class="command">{created.install_command}</pre>
			<CopyButton value={created.install_command} label="Copy install command" />
		{/if}
	</div>
{/if}
{#if canAdmin}
	<form method="POST" action={actionUrlFrom(page.url, 'createToken')} class="panel" use:enhance>
		<h2>Create a join token</h2>
		<label class="field">
			Host name hint
			<input name="host_name_hint" maxlength="80" autocomplete="off" />
		</label>
		<label class="field">
			Expiry in seconds
			<input name="expires_in_sec" inputmode="numeric" min="300" max="604800" />
		</label>
		<p class="sub">Leave expiry blank for 24 hours. The minimum is 300 and the maximum is 604800.</p>
		<button type="submit">Create join token</button>
	</form>
{/if}
{#if omitted > 0}
	<p class="sub">{omitted} more {omitted === 1 ? 'row' : 'rows'} left out.</p>
{/if}
{#if truncated}
	<p class="sub">More items not shown</p>
{/if}
<h2 id="tokens-heading" class="sr">Join tokens</h2>
<DataTable rows={tokens} {columns} id="tokens" labelledBy="tokens-heading" empty="No join tokens." rowKey={(token) => token.id}>
	{#snippet row(token)}
		<tr>
			<td>{token.host_name_hint ?? 'n/a'}</td>
			<td>{stateOf(token)}</td>
			<td>{formatWhen(token.created_at)}</td>
			<td>{formatWhen(token.expires_at)}</td>
			{#if canAdmin && !token.revoked_at}
				<td>
					<ConfirmAction
						id="revoke-token-{token.id}"
						action={actionUrlFrom(page.url, 'revokeToken')}
						label="Revoke"
						confirmLabel="Revoke"
						message="Revoke join token {token.host_name_hint ?? token.id}?"
						hidden={[{ name: 'token_id', value: token.id }]}
					/>
				</td>
			{:else if canAdmin}
				<td></td>
			{/if}
		</tr>
	{/snippet}
</DataTable>
