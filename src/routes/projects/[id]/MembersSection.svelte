<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import DataTable from '$lib/components/DataTable.svelte';
	import FormDialog from '$lib/components/FormDialog.svelte';
	import LocalTime from '$lib/components/LocalTime.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import type { Invite, InviteRole, Member } from '$lib/api-types';
	import AddMemberForm from './AddMemberForm.svelte';
	import { formDialogOutcome, nextFormDialog, nextInviteSecret, type DialogOutcome } from '$lib/dialog-open';
	import type { Column } from '$lib/table';
	import { actionUrlFrom } from '$lib/url';
	import { toastMemberAdded } from '$lib/success-toast';
	import Link from '@lucide/svelte/icons/link';
	import UserCog from '@lucide/svelte/icons/user-cog';
	import RowAction from '$lib/components/RowAction.svelte';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
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
		message,
		invites = [],
		invitesOmitted = 0,
		invitesTruncated = false,
		invitesMessage = null,
		inviteUrl = null,
		inviteRole = null,
		inviteMessage = null,
		addMemberMessage = null
	}: {
		members: Member[];
		omitted: number;
		truncated: boolean;
		canAdmin: boolean;
		canOwner: boolean;
		currentUserId: string | null;
		message: string | null;
		invites?: Invite[];
		invitesOmitted?: number;
		invitesTruncated?: boolean;
		invitesMessage?: string | null;
		inviteUrl?: string | null;
		inviteRole?: InviteRole | null;
		inviteMessage?: string | null;
		/** The addMember failure message, shown in the Add member dialog. */
		addMemberMessage?: string | null;
	} = $props();

	// An added email waits for the Add member dialog to finish closing, like the image and health toasts.
	let pendingAdded = $state<string | null>(null);

	function onAddMemberClosed() {
		const email = pendingAdded;
		pendingAdded = null;
		if (email) toastMemberAdded(email);
	}

	let open = $state(untrack(() => inviteMessage != null || inviteUrl != null));
	let sawFailure = $state(untrack(() => inviteMessage != null));
	let shownUrl = $state<string | null>(untrack(() => inviteUrl));
	let seenUrl = $state<string | null>(untrack(() => inviteUrl));

	$effect.pre(() => {
		const next = nextInviteSecret(untrack(() => ({ open, sawFailure, shownUrl, seenUrl })), {
			inviteUrl,
			failed: inviteMessage != null,
			open
		});
		if (next.open !== open) open = next.open;
		if (next.sawFailure !== sawFailure) sawFailure = next.sawFailure;
		if (next.shownUrl !== shownUrl) shownUrl = next.shownUrl;
		if (next.seenUrl !== seenUrl) seenUrl = next.seenUrl;
	});

	function settle(outcome: DialogOutcome) {
		const next = nextFormDialog({ open, sawFailure }, outcome);
		open = next.open;
		sawFailure = next.sawFailure;
	}

	/** Revoked wins, then expired, then used up. An unreadable expiry is not shown as active. */
	function inviteStatus(invite: Invite): 'active' | 'expired' | 'used up' | 'revoked' {
		if (invite.revoked_at) return 'revoked';
		const expires = Date.parse(invite.expires_at);
		if (Number.isNaN(expires) || expires <= Date.now()) return 'expired';
		if (invite.uses >= invite.max_uses) return 'used up';
		return 'active';
	}

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
	const inviteColumns = $derived<Column<Invite>[]>([
		{ key: 'role', label: 'Role' },
		{ key: 'created_by', label: 'Created by' },
		{ key: 'expires', label: 'Expires' },
		{ key: 'uses', label: 'Uses' },
		{ key: 'status', label: 'Status' },
		{ key: 'revoke', label: 'Revoke', srLabel: true }
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
			<td class="p-2 align-middle"><LocalTime iso={member.created_at} /></td>
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
	<div class="mt-6">
		<Dialog.Root bind:open>
			<Dialog.Trigger class={buttonVariants()}>
				<Link class="size-4" />
				Invite link
			</Dialog.Trigger>
			<Dialog.Content>
				<Dialog.Header>
					<Dialog.Title>Invite link</Dialog.Title>
					{#if shownUrl && inviteRole}
						<Dialog.Description>
							Anyone with this link can join as {inviteRole} until it expires. It won't be shown again.
						</Dialog.Description>
					{:else}
						<Dialog.Description>Create a link that lets someone join this project.</Dialog.Description>
					{/if}
				</Dialog.Header>
				{#if shownUrl && inviteRole}
					<div class="grid gap-3" translate="no">
						<p class="text-muted-foreground text-sm">Invite link</p>
						<p class="font-mono text-sm break-all">{shownUrl}</p>
						<div class="flex flex-wrap items-center gap-2">
							<CopyButton value={shownUrl} label="Copy invite link" />
							<Dialog.Close type="button" class={buttonVariants({ variant: 'outline' })}>Close</Dialog.Close>
						</div>
					</div>
				{:else}
					<form
						method="POST"
						action={actionUrlFrom(page.url, 'createInvite')}
						class="grid gap-3"
						use:enhance={() => {
							return async ({ result, update }) => {
								await update();
								if (result.type === 'success') {
									open = true;
									sawFailure = false;
									return;
								}
								settle(formDialogOutcome(result.type));
							};
						}}
					>
						{#if inviteMessage}
							<Notice kind="error">{inviteMessage}</Notice>
						{/if}
						<div class="grid gap-1.5">
							<Label for="invite-role">Role</Label>
							<Select.Root type="single" name="role" value="viewer">
								<Select.Trigger id="invite-role" class="w-full">
									<Select.Value />
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="viewer">viewer</Select.Item>
									<Select.Item value="admin">admin</Select.Item>
								</Select.Content>
							</Select.Root>
						</div>
						<div class="grid gap-1.5">
							<Label for="invite-expiry">Expiry</Label>
							<Select.Root type="single" name="expires_in_sec" value="604800">
								<Select.Trigger id="invite-expiry" class="w-full">
									<Select.Value />
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="86400">1 day</Select.Item>
									<Select.Item value="604800">7 days</Select.Item>
									<Select.Item value="2592000">30 days</Select.Item>
								</Select.Content>
							</Select.Root>
						</div>
						<div class="grid gap-1.5">
							<Label for="invite-uses">Uses</Label>
							<Select.Root type="single" name="max_uses" value="1">
								<Select.Trigger id="invite-uses" class="w-full">
									<Select.Value />
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="1">1</Select.Item>
									<Select.Item value="5">5</Select.Item>
									<Select.Item value="25">25</Select.Item>
								</Select.Content>
							</Select.Root>
						</div>
						<div class="flex flex-wrap items-center gap-2">
							<Button type="submit">Create invite link</Button>
							<Dialog.Close type="button" class={buttonVariants({ variant: 'outline' })}>Cancel</Dialog.Close>
						</div>
					</form>
				{/if}
			</Dialog.Content>
		</Dialog.Root>
	</div>

	{#if invitesMessage}
		<Notice kind="error">{invitesMessage}</Notice>
	{/if}
	{#if invitesOmitted > 0}
		<p class="text-muted-foreground mb-2 text-sm">{invitesOmitted} more {invitesOmitted === 1 ? 'row' : 'rows'} left out.</p>
	{/if}
	{#if invitesTruncated}
		<p class="text-muted-foreground mb-2 text-sm">More items not shown</p>
	{/if}
	<h2 id="invites-heading" class="mt-4 text-lg font-semibold tracking-tight">Pending invites</h2>
	<DataTable
		rows={invites}
		columns={inviteColumns}
		id="invites"
		labelledBy="invites-heading"
		empty="No pending invites."
		rowKey={(invite) => invite.id}
	>
		{#snippet row(invite)}
			<tr>
				<td class="p-2 align-middle">{invite.role}</td>
				<td class="p-2 align-middle">{invite.created_by}</td>
				<td class="p-2 align-middle"><LocalTime iso={invite.expires_at} /></td>
				<td class="p-2 align-middle">{invite.uses}/{invite.max_uses}</td>
				<td class="p-2 align-middle">{inviteStatus(invite)}</td>
				<td class="p-2 align-middle">
					{#if !invite.revoked_at}
						<ConfirmAction
							id="revoke-invite-{invite.id}"
							action={actionUrlFrom(page.url, 'revokeInvite')}
							label="Revoke"
							confirmLabel="Revoke"
							message="Revoke this invite link? It will stop working."
							hidden={[{ name: 'invite_id', value: invite.id }]}
							rowLabel="Revoke invite {invite.id}"
						/>
					{/if}
				</td>
			</tr>
		{/snippet}
	</DataTable>

	<div class="mt-4">
		<FormDialog id="add-member" label="Add member" title="Add member" description="Add a person to this project by email." failed={addMemberMessage != null} onCloseComplete={onAddMemberClosed}>
			{#snippet children(settle, cancel)}
				<AddMemberForm
					action={actionUrlFrom(page.url, 'addMember')}
					error={addMemberMessage}
					onAdded={(email) => (pendingAdded = email)}
					onSettled={settle}
					{cancel}
				/>
			{/snippet}
		</FormDialog>
	</div>
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
