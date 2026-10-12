<script lang="ts">
	import { page } from '$app/state';
	import '../app.css';

	let { children } = $props();

	const path = $derived(page.url.pathname);
</script>

<a class="skip" href="#content">Skip to content</a>
<div class="app">
	<header class="top">
		<a class="brand" href="/">deploybot</a>
		<nav class="nav" aria-label="Primary">
			<a href="/" aria-current={path === '/' ? 'page' : undefined}>Overview</a>
			<a href="/services" aria-current={path === '/services' ? 'page' : undefined}>Services</a>
			<a href="/processes" aria-current={path === '/processes' ? 'page' : undefined}>Processes</a>
			<a href="/databases" aria-current={path === '/databases' ? 'page' : undefined}>
				Databases <span class="soon">soon</span>
			</a>
			<a href="/ops" aria-current={path === '/ops' ? 'page' : undefined}>
				Ops <span class="soon">soon</span>
			</a>
		</nav>
	</header>
	<main id="content">
		{@render children()}
	</main>
</div>
