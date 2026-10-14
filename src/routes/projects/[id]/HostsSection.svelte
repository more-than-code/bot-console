<script lang="ts">
	import { enhance } from '$app/forms';
	import StatusText from '$lib/components/StatusText.svelte';
	import type { Host } from '$lib/api-types';
	import { formatWhen } from '$lib/format';
	import { hostFormAction } from '$lib/host-view';

	let {
		projectId,
		hosts,
		omitted,
		truncated,
		canAdmin,
		confirmHostId,
		message
	}: {
		projectId: string;
		hosts: Host[];
		omitted: number;
		truncated: boolean;
		canAdmin: boolean;
		confirmHostId: string | null;
		message: string | null;
	} = $props();

	const pending = $derived(hosts.find((host) => host.id === confirmHostId) ?? null);
</script>

{#if message}
	<p class="error" role="alert">{message}</p>
{/if}
{#if omitted > 0}
	<p class="sub">{omitted} more {omitted === 1 ? 'row' : 'rows'} left out.</p>
{/if}
{#if truncated}
	<p class="sub">More items not shown</p>
{/if}
{#if confirmHostId}
	<form method="POST" action={hostFormAction('revokeCredential', { tab: 'hosts' })} class="panel" use:enhance>
		<p>Revoke the credential for {pending?.name ?? 'this host'}? The agent connection closes.</p>
		<input type="hidden" name="host_id" value={confirmHostId} />
		<div class="actions">
			<button type="submit" class="danger">Revoke credential</button>
			<a href="/projects/{projectId}?tab=hosts">Cancel</a>
		</div>
	</form>
{/if}
{#if hosts.length === 0}
	<p class="empty">No hosts enrolled.</p>
{:else}
	<div class="table-wrap">
		<table class="data">
			<thead>
				<tr>
					<th>Name</th>
					<th>Status</th>
					<th>Last seen</th>
					<th>Version</th>
					{#if canAdmin}
						<th>Credential</th>
					{/if}
				</tr>
			</thead>
			<tbody>
				{#each hosts as host (host.id)}
					<tr>
						<td><a href="/hosts/{host.id}">{host.name}</a></td>
						<td><StatusText status={host.status} /></td>
						<td>{formatWhen(host.last_seen_at)}</td>
						<td>{host.agent_version ?? 'n/a'}</td>
						{#if canAdmin}
							<td>
								{#if host.id !== confirmHostId}
									<form method="POST" action={hostFormAction('askRevoke', { tab: 'hosts' })} use:enhance>
										<input type="hidden" name="host_id" value={host.id} />
										<button type="submit" class="danger" aria-label="Revoke credential for {host.name}">
											Revoke credential
										</button>
									</form>
								{/if}
							</td>
						{/if}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
