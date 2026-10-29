import type { Reroute } from '@sveltejs/kit';

/**
 * The homepage (umbrella docs/spec-seo-site.md §3.1): on deploybot.dev, / shows the About page.
 * Caddy rewrites / to /about on the server; this makes the client router (hydration and client
 * navigation) resolve / the same way. The server never sees the apex host (ORIGIN is the console),
 * so on the server this returns undefined and / stays the app route.
 */
export function homepageRoute(url: URL): string | undefined {
	return url.hostname === 'deploybot.dev' && url.pathname === '/' ? '/about' : undefined;
}

export const reroute: Reroute = ({ url }) => homepageRoute(url);
