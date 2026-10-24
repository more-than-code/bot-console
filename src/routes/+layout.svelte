<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { onMount, untrack } from 'svelte';
	import AppWindow from '@lucide/svelte/icons/app-window';
	import FolderKanban from '@lucide/svelte/icons/folder-kanban';
	import LogOut from '@lucide/svelte/icons/log-out';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import ThemeSwitch from '$lib/components/ThemeSwitch.svelte';
	import { avatarInitial } from '$lib/avatar';
	import { browserTimeZone, provideTimeZone, rememberTimeZone } from '$lib/time-zone';
	import { cn } from '$lib/utils';
	import '../app.css';

	let { children, data } = $props();

	// A broken or blocked avatar image falls back to the initial.
	let avatarFailed = $state(false);

	// The server and the first client render share this value. After mount the
	// browser replaces it when the viewer is in a different zone.
	let timeZone = $state(untrack(() => data.timeZone));
	provideTimeZone({
		get current() {
			return timeZone;
		}
	});

	onMount(() => {
		const local = browserTimeZone();
		if (!local || local === timeZone) return;
		timeZone = local;
		rememberTimeZone(local);
	});

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
		<div class="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2 sm:contents">
			<a class="shrink-0" href="/projects" aria-label="Deploybot">
				<img src="/brand/lockup-light.svg" alt="" class="h-6 w-auto dark:hidden" />
				<img src="/brand/lockup-dark.svg" alt="" class="hidden h-6 w-auto dark:block" />
			</a>
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
				<div class="ml-auto flex min-w-0 max-w-full items-center gap-2 sm:order-2 sm:ml-0">
					<DropdownMenu.Root>
						<DropdownMenu.Trigger
							class={cn(
								buttonVariants({ variant: 'ghost', size: 'sm' }),
								'max-w-full min-w-0 shrink overflow-hidden'
							)}
						>
							{#if data.user.avatarUrl && !avatarFailed}
								<img
									src={data.user.avatarUrl}
									alt=""
									class="size-6 shrink-0 rounded-full"
									referrerpolicy="no-referrer"
									onerror={() => (avatarFailed = true)}
								/>
							{:else}
								<span
									aria-hidden="true"
									class="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
									>{avatarInitial(data.user.name)}</span
								>
							{/if}
							<span class="min-w-0 truncate">{data.user.name || 'Account'}</span>
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="end">
							<DropdownMenu.Item>
								{#snippet child({ props })}
									<a href="/account/apps" {...props}><AppWindow class="size-4" />Connected apps</a>
								{/snippet}
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
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
