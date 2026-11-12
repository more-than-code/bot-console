import { error } from '@sveltejs/kit';

// The apex's 404 page. Caddy rewrites every unknown deploybot.dev path here, so the visitor
// keeps their URL and gets a real 404 with the site header (umbrella docs/spec-seo-indexing-fixes.md §3.1).
export function load(): never {
	error(404, 'Not found');
}
