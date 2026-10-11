import type { Handle } from '@sveltejs/kit';

const PRIVATE_PAGES = new Set(['/', '/services', '/databases', '/ops']);

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	response.headers.set('x-content-type-options', 'nosniff');
	response.headers.set('x-frame-options', 'DENY');
	response.headers.set('referrer-policy', 'no-referrer');
	const path = event.url.pathname;
	if (PRIVATE_PAGES.has(path) || path.startsWith('/pi/') || path.startsWith('/api/')) {
		response.headers.set('cache-control', 'no-store');
	}
	return response;
};
