<script lang="ts">
	import { enhance } from '$app/forms';
	import type { Member } from '$lib/api-types';
	import { formatWhen } from '$lib/format';

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
{#if members.length === 0}
	<p class="empty">No members returned.</p>
{:else}
	<div class="table-wrap">
		<table class="data">
			<thead>
				<tr>
					<th>Name</th>
					<th>Email</th>
					<th>Role</th>
					<th>Joined</th>
					{#if canAdmin}
						<th>Access</th>
					{/if}
				</tr>
			</thead>
			<tbody>
				{#each members as member (member.user_id)}
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
										<form method="POST" action="?/changeRole" use:enhance>
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
										<form method="POST" action="?/removeMember" use:enhance>
											<input type="hidden" name="user_id" value={member.user_id} />
											<button type="submit" class="danger" aria-label="Remove {member.email}">Remove</button>
										</form>
									</div>
								{/if}
							</td>
						{/if}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

{#if canAdmin}
	<form method="POST" action="?/addMember" class="panel" use:enhance>
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
	<form method="POST" action="?/transfer" class="panel" use:enhance>
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
