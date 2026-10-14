<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import DataTable from '$lib/components/DataTable.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import type { Member } from '$lib/api-types';
	import { formatWhen } from '$lib/format';
	import type { Column } from '$lib/table';
	import { actionUrlFrom } from '$lib/url';

	let {
		members,
		omitted,
		truncated,
		canAdmin,
		canOwner,
		currentUserId,
		message
	}: {
		members: Member[];
		omitted: number;
		truncated: boolean;
		canAdmin: boolean;
		canOwner: boolean;
		currentUserId: string | null;
		message: string | null;
	} = $props();

	const successors = $derived(members.filter((member) => member.role !== 'owner'));
	const columns = $derived<Column<Member>[]>([
		{ key: 'name', label: 'Name' },
		{ key: 'email', label: 'Email' },
		{ key: 'role', label: 'Role' },
		{ key: 'joined', label: 'Joined' },
		...(canAdmin ? [{ key: 'access', label: 'Access' }] : [])
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
<h2 id="members-heading" class="sr">Members</h2>
<DataTable
	rows={members}
	{columns}
	id="members"
	labelledBy="members-heading"
	empty="No members returned."
	rowKey={(member) => member.user_id}
>
	{#snippet row(member)}
		<tr>
			<td>
				{member.name}
				{#if member.user_id === currentUserId}
					<span class="sub">(you)</span>
				{/if}
			</td>
			<td>{member.email}</td>
			<td>{member.role}</td>
			<td>{formatWhen(member.created_at)}</td>
			{#if canAdmin}
				<td class="wrap">
					{#if member.role !== 'owner'}
						<div class="actions">
							<form method="POST" action={actionUrlFrom(page.url, 'changeRole')} use:enhance>
								<input type="hidden" name="user_id" value={member.user_id} />
								<label class="field">
									<span class="sr">Role for {member.email}</span>
									<select name="role" value={member.role === 'admin' ? 'admin' : 'viewer'}>
										<option value="admin">admin</option>
										<option value="viewer">viewer</option>
									</select>
								</label>
								<button type="submit">Change role</button>
							</form>
							<ConfirmAction
								id="remove-member-{member.user_id}"
								action={actionUrlFrom(page.url, 'removeMember')}
								label="Remove"
								confirmLabel="Remove"
								message="Remove {member.email} from this project?"
								hidden={[{ name: 'user_id', value: member.user_id }]}
							/>
						</div>
					{/if}
				</td>
			{/if}
		</tr>
	{/snippet}
</DataTable>

{#if canAdmin}
	<form method="POST" action={actionUrlFrom(page.url, 'addMember')} class="panel" use:enhance>
		<h2>Add a member</h2>
		<label class="field">
			Email
			<input name="email" type="email" required maxlength="254" autocomplete="off" />
		</label>
		<label class="field">
			Role
			<select name="role">
				<option value="viewer">viewer</option>
				<option value="admin">admin</option>
			</select>
		</label>
		<button type="submit">Add member</button>
	</form>
{/if}

{#if canOwner}
	<form method="POST" action={actionUrlFrom(page.url, 'transfer')} class="panel" use:enhance>
		<h2>Transfer ownership</h2>
		{#if successors.length === 0}
			<p class="sub">Add another member before transferring ownership.</p>
		{:else}
			<label class="field">
				New owner
				<select name="user_id" required>
					{#each successors as member (member.user_id)}
						<option value={member.user_id}>{member.name} ({member.email})</option>
					{/each}
				</select>
			</label>
			<button type="submit">Transfer ownership</button>
		{/if}
	</form>
{/if}
