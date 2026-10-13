import { redirect, type Handle } from '@sveltejs/kit';
import { authEnabled, loadSession } from '$lib/server/api';
import {
	clearSessionCookieHeader,
	isApiPath,
	isPublicPath,
	logicalPath,
	needsNoStore,
	signinLocation
} from '$lib/server/session';

function applyHeaders(pathname: string, response: Response): Response {
	response.headers.set('x-content-type-options', 'nosniff');
	response.headers.set('x-frame-options', 'DENY');
	response.headers.set('referrer-policy', 'no-referrer');
	if (needsNoStore(pathname, authEnabled())) response.headers.set('cache-control', 'no-store');
	return response;
}

function unavailable(pathname: string): Response {
	if (isApiPath(pathname)) {
		return new Response(JSON.stringify({ message: 'Sign-in is temporarily unavailable.' }), {
			status: 503,
			headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
		});
	}
	const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Unavailable · deploybot</title><p>Sign-in is temporarily unavailable.</p><form method="post" action="/signout"><button type="submit">Sign out</button></form></html>`;
	return new Response(html, {
		status: 503,
		headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
	});
}

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.authEnabled = false;
	event.locals.user = null;
	event.locals.projects = [];
	event.locals.sessionUnavailable = false;

	if (authEnabled()) {
		event.locals.authEnabled = true;
		const session = await loadSession(event);
		if (session.kind === 'ready') {
			event.locals.user = session.user;
			event.locals.projects = session.projects;
		} else if (session.kind === 'unavailable') {
			event.locals.sessionUnavailable = true;
		}

		const path = logicalPath(event.url.pathname);
		const signOutPost = path === '/signout' && event.request.method === 'POST';
		// POST /signout stays reachable when /v1/me is down so the browser can drop the cookie.
		if (!event.locals.user && !isPublicPath(path) && !signOutPost) {
			if (event.locals.sessionUnavailable) return applyHeaders(path, unavailable(path));
			if (isApiPath(path)) {
				const response = new Response(JSON.stringify({ message: 'Sign in required.' }), {
					status: 401,
					headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
				});
				if (session.kind === 'unauthorized') response.headers.append('set-cookie', clearSessionCookieHeader(event.url));
				return applyHeaders(path, response);
			}
			redirect(303, signinLocation(event.url));
		}
	}

	const response = await resolve(event);
	return applyHeaders(event.url.pathname, response);
};
