<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import FolderKanban from '@lucide/svelte/icons/folder-kanban';
	import LogOut from '@lucide/svelte/icons/log-out';
	import { Button } from '$lib/components/ui/button';
	import ThemeSwitch from '$lib/components/ThemeSwitch.svelte';
	import '../app.css';

	let { children, data } = $props();

	const path = $derived(page.url.pathname);
	const onProjects = $derived(
		path === '/projects' || path.startsWith('/projects/') || path.startsWith('/hosts/')
	);
</script>

<a
	class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
	href="#content">Skip to content</a
>
<div class="mx-auto w-full min-w-0 max-w-6xl px-4">
	<header class="flex flex-col gap-y-2 py-3 sm:flex-row sm:items-center sm:gap-x-3">
		<div class="flex min-w-0 items-center gap-x-3 sm:contents">
			<a class="shrink-0 text-sm font-semibold" href="/projects">deploybot</a>
			<nav class="flex shrink-0 items-center" aria-label="Primary">
				<a
					href="/projects"
					class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm {onProjects
						? 'bg-muted text-foreground'
						: 'text-muted-foreground'}"
					aria-current={onProjects ? 'page' : undefined}><FolderKanban class="size-4" />Projects</a
				>
			</nav>
			{#if data.user}
				<div class="ml-auto flex min-w-0 items-center gap-2 sm:order-2 sm:ml-0">
					<span class="min-w-0 max-w-28 truncate text-sm sm:max-w-none">{data.user.name || 'Account'}</span>
					<form class="shrink-0" method="POST" action="/signout" use:enhance>
						<Button type="submit" variant="outline" size="sm"><LogOut class="size-4" />Sign out</Button>
					</form>
				</div>
			{/if}
		</div>
		<div class="sm:order-1 sm:ml-auto">
			<ThemeSwitch value={data.theme} />
		</div>
	</header>
	<main id="content" class="min-w-0 pb-10">
		{@render children()}
	</main>
</div>
