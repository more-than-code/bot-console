<script lang="ts">
	// The site's error content: "Page not found" for a 404, a generic text for any other status.
	// Rendered by src/routes/(site)/+error.svelte inside the site layout (umbrella
	// docs/spec-seo-indexing-fixes.md §3.1). No canonical: an error page is never indexed.
	let { status }: { status: number } = $props();

	const notFound = $derived(status === 404);
	const heading = $derived(notFound ? 'Page not found' : 'Something went wrong');
	const line = $derived(
		notFound
			? 'There is no page at this address. It may have moved, or the link may be wrong.'
			: `The page could not be shown (error ${status}). Try again in a moment.`
	);

	// Same link style as the site footer.
	const link =
		'rounded-sm underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
</script>

<svelte:head>
	<title>{heading} · Deploybot</title>
</svelte:head>

<section class="py-12" aria-labelledby="error-title">
	<h1 id="error-title" class="text-3xl font-semibold tracking-tight">{heading}</h1>
	<p class="text-muted-foreground mt-3">{line}</p>
	<p class="mt-6"><a class={link} href="/">Go to the Deploybot home page</a></p>
</section>
