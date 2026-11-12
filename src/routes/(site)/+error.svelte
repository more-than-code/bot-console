<script lang="ts">
	// Errors on the public site pages, inside the site layout. The apex's unknown paths land here
	// as a 404 through /not-found (umbrella docs/spec-seo-indexing-fixes.md §3.1).
	import { page } from '$app/state';
	import SiteError from '$lib/site/SiteError.svelte';
</script>

<SiteError status={page.status} />
