<script lang="ts">
	// Head tags for a public site page: title, description, canonical, Open Graph and Twitter card.
	// The canonical is on the apex for every host, so the console's copies point to deploybot.dev.
	import { SITE_URL } from '$lib/site/links';

	let { title, description, path }: { title: string; description: string; path: string } =
		$props();

	const url = $derived(`${SITE_URL}${path}`);
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={url} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Deploybot" />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={url} />
	<meta property="og:image" content="{SITE_URL}/brand/og-image.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content="How Deploybot lets AI agents run your servers" />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>
