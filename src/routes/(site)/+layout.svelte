<script lang="ts">
	// Public site layout. Self-contained: no app shell, API client or $lib/server imports.
	import { SIGN_IN_URL, SUPPORT_EMAIL } from '$lib/site/links';

	let { children } = $props();

	// Same link style as the app-shell footer and the sign-in line.
	const link =
		'rounded-sm underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
</script>

<a
	class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
	href="#content">Skip to content</a
>
<div class="mx-auto flex min-h-dvh w-full min-w-0 max-w-5xl flex-col px-4">
	<header class="flex items-center justify-between gap-3 py-4">
		<a
			class="flex min-w-0 items-center gap-2 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
			href="/"
			aria-label="Deploybot"
		>
			<img src="/brand/lockup-light.svg" alt="" class="h-6 w-auto dark:hidden" />
			<img src="/brand/lockup-dark.svg" alt="" class="hidden h-6 w-auto dark:block" />
		</a>
		<a
			class="bg-primary text-primary-foreground hover:bg-primary/80 inline-flex h-9 shrink-0 items-center rounded-lg px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
			href={SIGN_IN_URL}
			data-sveltekit-reload>Sign in</a
		>
	</header>
	<main id="content" class="min-w-0 flex-1 pb-12">
		{@render children()}
	</main>
	<footer class="text-muted-foreground border-t py-6 text-sm">
		<nav class="flex flex-wrap gap-x-5 gap-y-2" aria-label="Site">
			<a class={link} href="/privacy">Privacy</a>
			<a class={link} href="/terms">Terms</a>
			<a class={link} href="mailto:{SUPPORT_EMAIL}">{SUPPORT_EMAIL}</a>
		</nav>
	</footer>
</div>
