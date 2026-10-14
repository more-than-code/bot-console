<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import '../app.css';

	let { children, data } = $props();

	const path = $derived(page.url.pathname);
	const onProjects = $derived(
		path === '/projects' || path.startsWith('/projects/') || path.startsWith('/hosts/')
	);
</script>

<a class="skip" href="#content">Skip to content</a>
<div class="app">
	<header class="top">
		<a class="brand" href="/projects">deploybot</a>
		<nav class="nav" aria-label="Primary">
			<a href="/projects" aria-current={onProjects ? 'page' : undefined}>Projects</a>
		</nav>
		{#if data.user}
			<div class="user-menu">
				<span>{data.user.name || 'Account'}</span>
				<form method="POST" action="/signout" use:enhance>
					<button type="submit">Sign out</button>
				</form>
			</div>
		{/if}
	</header>
	<main id="content">
		{@render children()}
	</main>
</div>
