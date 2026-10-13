<script lang="ts">
	import { enhance } from '$app/forms';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import type { CreatedJoin, JoinToken } from '$lib/api-types';
	import { formatWhen } from '$lib/format';

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
</script>

{#if message}
	<p class="error" role="alert">{message}</p>
{/if}
{#if created}
	<div class="secret" translate="no">
		<p class="notice" role="status">Copy this now. It is shown once and is not saved in this browser.</p>
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
	<form method="POST" action="?/createToken" class="panel" use:enhance>
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
{#if tokens.length === 0}
	<p class="empty">No join tokens.</p>
{:else}
	<div class="table-wrap">
		<table class="data">
			<thead>
				<tr>
					<th>Hint</th>
					<th>State</th>
					<th>Created</th>
					<th>Expires</th>
					{#if canAdmin}
						<th><span class="sr">Revoke</span></th>
					{/if}
				</tr>
			</thead>
			<tbody>
				{#each tokens as token (token.id)}
					<tr>
						<td>{token.host_name_hint ?? 'n/a'}</td>
						<td>{stateOf(token)}</td>
						<td>{formatWhen(token.created_at)}</td>
						<td>{formatWhen(token.expires_at)}</td>
						{#if canAdmin && !token.revoked_at}
							<td>
								<form method="POST" action="?/revokeToken" use:enhance>
									<input type="hidden" name="token_id" value={token.id} />
									<button type="submit" class="danger" aria-label="Revoke join token {token.host_name_hint ?? token.id}">
										Revoke
									</button>
								</form>
							</td>
						{:else if canAdmin}
							<td></td>
						{/if}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
