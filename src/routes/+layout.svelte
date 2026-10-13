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
		<a class="brand" href="/">deploybot</a>
		<nav class="nav" aria-label="Primary">
			<a href="/" aria-current={path === '/' ? 'page' : undefined}>Overview</a>
			<a href="/services" aria-current={path === '/services' ? 'page' : undefined}>Services</a>
			<a href="/processes" aria-current={path === '/processes' ? 'page' : undefined}>Processes</a>
			{#if data.authEnabled}
				<a href="/projects" aria-current={onProjects ? 'page' : undefined}>Projects</a>
			{/if}
			<a href="/databases" aria-current={path === '/databases' ? 'page' : undefined}>
				Databases <span class="soon">soon</span>
			</a>
			<a href="/ops" aria-current={path === '/ops' ? 'page' : undefined}>
				Ops <span class="soon">soon</span>
			</a>
		</nav>
		{#if data.authEnabled && data.user}
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
