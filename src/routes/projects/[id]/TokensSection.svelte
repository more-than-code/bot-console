<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import AddHostGuide from './AddHostGuide.svelte';
	import CommandBlock from '$lib/components/CommandBlock.svelte';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import DataTable from '$lib/components/DataTable.svelte';
	import LocalTime from '$lib/components/LocalTime.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import type { CreatedJoin, JoinToken } from '$lib/api-types';
	import type { Column } from '$lib/table';
	import { actionUrlFrom } from '$lib/url';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	let {
		tokens,
		omitted,
		truncated,
		canAdmin,
		created,
		message,
		hostsMessage,
		slug,
		hasHosts
	}: {
		tokens: JoinToken[];
		omitted: number;
		truncated: boolean;
		canAdmin: boolean;
		created: CreatedJoin | null;
		message: string | null;
		hostsMessage: string | null;
		slug: string;
		hasHosts: boolean;
	} = $props();

	const PLACEHOLDER_SERVER = '<your server URL>';
	const enrol = $derived(
		created ? `sudo ./install.sh enroll --server '${created.server ?? PLACEHOLDER_SERVER}' --runner` : ''
	);

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
{#if hostsMessage}
	<Notice kind="error">{hostsMessage}</Notice>
{/if}
{#if created}
	<Card.Root class="mb-4" translate="no">
		<Card.Content class="grid gap-2">
			<Notice kind="success">Copy this now. It is shown once and is not saved in this browser.</Notice>
			<p class="text-muted-foreground text-sm">Join token</p>
			<p class="font-mono text-sm break-all">{created.token}</p>
			<CopyButton value={created.token} label="Copy token" />
			<p class="text-muted-foreground text-sm">Next: enrol the host</p>
			<CommandBlock command={enrol} label="Copy enrol command" ariaLabel="Enrol command" />
			<p class="text-sm">Paste the join token at the hidden prompt. Do not put it on the command line.</p>
		</Card.Content>
	</Card.Root>
{/if}
{#if canAdmin}
	<AddHostGuide {slug} open={!hasHosts && !hostsMessage} />
	<Card.Root class="mb-4">
		<Card.Header>
			<Card.Title>Create a join token</Card.Title>
		</Card.Header>
		<Card.Content>
			<form method="POST" action={actionUrlFrom(page.url, 'createToken')} class="grid gap-3" use:enhance>
				<Label class="grid gap-1.5" for="host-name-hint">
					Host name hint
					<Input id="host-name-hint" name="host_name_hint" maxlength={80} autocomplete="off" />
				</Label>
				<Label class="grid gap-1.5" for="token-expiry">
					Expiry in seconds
					<Input id="token-expiry" name="expires_in_sec" inputmode="numeric" min="300" max="604800" />
				</Label>
				<p class="text-muted-foreground text-sm">Leave expiry blank for 24 hours. The minimum is 300 and the maximum is 604800.</p>
				<div>
					<Button type="submit">Create join token</Button>
				</div>
			</form>
		</Card.Content>
	</Card.Root>
{/if}
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
