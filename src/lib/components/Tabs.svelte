<script lang="ts">
	import Boxes from '@lucide/svelte/icons/boxes';
	import Cpu from '@lucide/svelte/icons/cpu';
	import FolderKanban from '@lucide/svelte/icons/folder-kanban';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Library from '@lucide/svelte/icons/library';
	import Server from '@lucide/svelte/icons/server';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import Users from '@lucide/svelte/icons/users';
	import type { Component } from 'svelte';

	let {
		items,
		current,
		label
	}: {
		items: Array<{ key: string; label: string; href: string }>;
		current: string;
		label: string;
	} = $props();

	const icons: Record<string, Component> = {
		Hosts: Server,
		Services: Boxes,
		Catalog: Library,
		Processes: Cpu,
		Members: Users,
		'Join tokens': KeyRound,
		Settings: SettingsIcon
	};
</script>

<nav class="bg-muted mb-4 inline-flex max-w-full flex-wrap gap-1 rounded-lg p-1" aria-label={label}>
	{#each items as item (item.key)}
		{@const Icon = icons[item.label]}
		<a
			href={item.href}
			class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium {item.key === current
				? 'bg-background text-foreground shadow-sm'
				: 'text-muted-foreground hover:text-foreground'}"
			aria-current={item.key === current ? 'page' : undefined}>{item.label}{#if Icon}<Icon class="size-4" />{/if}</a>
	{/each}
</nav>
