<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import DataTable from '$lib/components/DataTable.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import type { Member } from '$lib/api-types';
	import { formatWhen } from '$lib/format';
	import type { Column } from '$lib/table';
	import { actionUrlFrom } from '$lib/url';
	import UserCog from '@lucide/svelte/icons/user-cog';
	import RowAction from '$lib/components/RowAction.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';

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
	let ownerId = $state(untrack(() => successors[0]?.user_id ?? ''));
	const ownerLabel = $derived.by(() => {
		const member = successors.find((item) => item.user_id === ownerId);
		return member ? `${member.name} (${member.email})` : '';
	});

	$effect(() => {
		const current = ownerId;
		if (successors.length > 0 && !successors.some((member) => member.user_id === current)) {
			ownerId = successors[0]?.user_id ?? '';
		}
	});
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
	<p class="text-muted-foreground mb-2 text-sm">{omitted} more {omitted === 1 ? 'row' : 'rows'} left out.</p>
{/if}
{#if truncated}
	<p class="text-muted-foreground mb-2 text-sm">More items not shown</p>
{/if}
<h2 id="members-heading" class="sr-only">Members</h2>
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
			<td class="p-2 align-middle">
				{member.name}
				{#if member.user_id === currentUserId}
					<span class="text-muted-foreground text-sm">(you)</span>
				{/if}
			</td>
			<td class="p-2 align-middle">{member.email}</td>
			<td class="p-2 align-middle">{member.role}</td>
			<td class="p-2 align-middle">{formatWhen(member.created_at)}</td>
			{#if canAdmin}
				<td class="p-2 align-middle whitespace-normal">
					{#if member.role !== 'owner'}
						<div class="flex flex-wrap items-end gap-2">
							<form method="POST" action={actionUrlFrom(page.url, 'changeRole')} class="flex flex-wrap items-end gap-2" use:enhance>
								<Input type="hidden" name="user_id" value={member.user_id} />
								<Label class="sr-only" for="member-role-{member.user_id}">Role for {member.email}</Label>
								<Select.Root type="single" name="role" value={member.role === 'admin' ? 'admin' : 'viewer'}>
									<Select.Trigger id="member-role-{member.user_id}" class="w-28">
										<Select.Value />
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="admin">admin</Select.Item>
										<Select.Item value="viewer">viewer</Select.Item>
									</Select.Content>
								</Select.Root>
								<RowAction type="submit" label="Change role {member.email}" icon={UserCog} />
							</form>
							<ConfirmAction
								id="remove-member-{member.user_id}"
								action={actionUrlFrom(page.url, 'removeMember')}
								label="Remove"
								confirmLabel="Remove"
								message="Remove {member.email} from this project?"
								hidden={[{ name: 'user_id', value: member.user_id }]}
								rowLabel="Remove {member.email}"
							/>
						</div>
					{/if}
				</td>
			{/if}
		</tr>
	{/snippet}
</DataTable>

{#if canAdmin}
	<Card.Root class="mt-4">
		<Card.Header>
			<Card.Title>Add a member</Card.Title>
		</Card.Header>
		<Card.Content>
			<form method="POST" action={actionUrlFrom(page.url, 'addMember')} class="grid gap-3" use:enhance>
				<Label class="grid gap-1.5" for="member-email">
					Email
					<Input id="member-email" name="email" type="email" required maxlength={254} autocomplete="off" />
				</Label>
				<div class="grid gap-1.5">
					<Label for="member-role">Role</Label>
					<Select.Root type="single" name="role" value="viewer">
						<Select.Trigger id="member-role" class="w-full sm:w-40">
							<Select.Value />
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="viewer">viewer</Select.Item>
							<Select.Item value="admin">admin</Select.Item>
						</Select.Content>
					</Select.Root>
				</div>
				<div>
					<Button type="submit">Add member</Button>
				</div>
			</form>
		</Card.Content>
	</Card.Root>
{/if}

{#if canOwner}
	<Card.Root class="mt-4">
		<Card.Header>
			<Card.Title>Transfer ownership</Card.Title>
		</Card.Header>
		<Card.Content>
			<form method="POST" action={actionUrlFrom(page.url, 'transfer')} class="grid gap-3" use:enhance>
				{#if successors.length === 0}
					<p class="text-muted-foreground text-sm">Add another member before transferring ownership.</p>
				{:else}
					<div class="grid gap-1.5">
						<Label for="new-owner">New owner</Label>
						<Select.Root type="single" name="user_id" bind:value={ownerId} required>
							<Select.Trigger id="new-owner" class="w-full">
								<Select.Value placeholder="Choose a member">{ownerLabel}</Select.Value>
							</Select.Trigger>
							<Select.Content>
								{#each successors as member (member.user_id)}
									<Select.Item value={member.user_id}>{member.name} ({member.email})</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
					<div>
						<Button type="submit">Transfer ownership</Button>
					</div>
				{/if}
			</form>
		</Card.Content>
	</Card.Root>
{/if}
