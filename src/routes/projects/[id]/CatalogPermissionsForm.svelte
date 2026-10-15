<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack, type Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import Notice from '$lib/components/Notice.svelte';
	import type { CatalogGrant, CatalogGrantAction, Member } from '$lib/api-types';
	import { GRANT_ACTIONS } from '$lib/catalog';

	type Boxes = Record<CatalogGrantAction, boolean>;

	type MemberRow = { user: string } & Boxes;

	let {
		action,
		name,
		grants,
		members,
		message = null,
		loaded,
		cancel
	}: {
		action: string;
		name: string;
		grants: CatalogGrant[];
		members: Member[];
		message?: string | null;
		loaded: boolean;
		cancel?: Snippet;
	} = $props();

	function boxesFor(subject: string): Boxes {
		const grant = grants.find((item) => item.subject === subject);
		return {
			run: grant?.actions.includes('run') ?? false,
			stop: grant?.actions.includes('stop') ?? false,
			restart: grant?.actions.includes('restart') ?? false,
			logs: grant?.actions.includes('logs') ?? false
		};
	}

	function memberRows(): MemberRow[] {
		return grants
			.filter((grant) => grant.subject.startsWith('user:'))
			.map((grant) => ({ user: grant.subject.slice('user:'.length), ...boxesFor(grant.subject) }));
	}

	let admin = $state(untrack(() => boxesFor('role:admin')));
	let viewer = $state(untrack(() => boxesFor('role:viewer')));
	let rows = $state<MemberRow[]>(untrack(memberRows));
	const choosable = $derived(members.filter((member) => member.role !== 'owner'));

	function addMember() {
		if (rows.length >= 100) return;
		rows = [...rows, { user: '', run: false, stop: false, restart: false, logs: false }];
	}

	function removeMember(index: number) {
		rows = rows.filter((_, item) => item !== index);
	}
</script>

<form method="POST" {action} class="grid gap-3" use:enhance>
	{#if message}
		<Notice kind="error">{message}</Notice>
	{/if}
	<Input type="hidden" name="name" value={name} />
	<div class="grid gap-2">
		<p class="text-sm font-medium">Admins</p>
		<div class="flex flex-wrap gap-3">
			{#each GRANT_ACTIONS as actionName (actionName)}
				<Label class="flex items-center gap-2">
					<Checkbox name="admin_{actionName}" value="1" checked={admin[actionName]} onCheckedChange={(value) => (admin[actionName] = value)} />
					{actionName}
				</Label>
			{/each}
		</div>
	</div>
	<div class="grid gap-2">
		<p class="text-sm font-medium">Viewers</p>
		<div class="flex flex-wrap gap-3">
			{#each GRANT_ACTIONS as actionName (actionName)}
				<Label class="flex items-center gap-2">
					<Checkbox name="viewer_{actionName}" value="1" checked={viewer[actionName]} onCheckedChange={(value) => (viewer[actionName] = value)} />
					{actionName}
				</Label>
			{/each}
		</div>
	</div>
	<div class="grid gap-2">
		<p class="text-sm font-medium">Members</p>
		{#each rows as row, index (index)}
			<div class="grid gap-2">
				<Label class="sr-only" for="catalog-member-{index}">Member {index + 1}</Label>
				<Select.Root type="single" name="member_{index}_user" bind:value={rows[index].user}>
					<Select.Trigger id="catalog-member-{index}" class="w-full">
						<Select.Value placeholder="Choose a member" />
					</Select.Trigger>
					<Select.Content>
						{#each choosable as member (member.user_id)}
							<Select.Item value={member.user_id} label={member.name}>{member.name}</Select.Item>
						{/each}
						{#if row.user !== '' && !choosable.some((member) => member.user_id === row.user)}
							<Select.Item value={row.user} label={row.user}>{row.user}</Select.Item>
						{/if}
					</Select.Content>
				</Select.Root>
				<div class="flex flex-wrap items-center gap-3">
					{#each GRANT_ACTIONS as actionName (actionName)}
						<Label class="flex items-center gap-2">
							<Checkbox name="member_{index}_{actionName}" value="1" checked={row[actionName]} onCheckedChange={(value) => (row[actionName] = value)} />
							{actionName}
						</Label>
					{/each}
					<Button type="button" variant="outline" onclick={() => removeMember(index)}>Remove</Button>
				</div>
			</div>
		{/each}
		<Button type="button" variant="outline" disabled={rows.length >= 100} onclick={addMember}>Add member</Button>
	</div>
	<div class="flex flex-wrap items-center gap-2">
		{#if loaded}
			<Button type="submit">Save</Button>
		{/if}
		{#if cancel}
			{@render cancel()}
		{/if}
	</div>
</form>
