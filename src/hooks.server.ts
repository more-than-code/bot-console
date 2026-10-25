import { redirect, type Handle, type RequestEvent } from '@sveltejs/kit';
import { apiBaseUrl, loadSession, NOT_CONFIGURED_MESSAGE } from '$lib/server/api';
import {
	clearSessionCookieHeader,
	isApiPath,
	isPublicPath,
	isSitePath,
	isStaticAsset,
	logicalPath,
	needsNoStore,
	signinLocation
} from '$lib/server/session';
import { applyThemeMarker, parseTheme, THEME_COOKIE } from '$lib/theme';

function applyHeaders(pathname: string, response: Response): Response {
	response.headers.set('x-content-type-options', 'nosniff');
	response.headers.set('x-frame-options', 'DENY');
	response.headers.set('referrer-policy', 'no-referrer');
	if (needsNoStore(pathname)) response.headers.set('cache-control', 'no-store');
	return response;
}

function notConfigured(): Response {
	const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Unavailable · Deploybot</title><p>${NOT_CONFIGURED_MESSAGE}</p></html>`;
	return new Response(html, {
		status: 503,
		headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
	});
}

/** Document navigations are 303. Client data requests keep SvelteKit's JSON redirect. */
function inviteSignInRedirect(pathname: string, location: string, dataRequest: boolean): Response {
	if (dataRequest) {
		return applyHeaders(
			pathname,
			new Response(JSON.stringify({ type: 'redirect', location }), {
				status: 200,
				headers: { 'content-type': 'application/json', location }
			})
		);
	}
	return applyHeaders(pathname, new Response(null, { status: 303, headers: { location } }));
}

function unavailable(pathname: string): Response {
	if (isApiPath(pathname)) {
		return new Response(JSON.stringify({ message: 'Sign-in is temporarily unavailable.' }), {
			status: 503,
			headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
		});
	}
	const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Unavailable · Deploybot</title><p>Sign-in is temporarily unavailable.</p><form method="post" action="/signout"><button type="submit">Sign out</button></form></html>`;
	return new Response(html, {
		status: 503,
		headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
	});
}

/** app.html marks every page noindex. Only the public site pages drop it. */
const NOINDEX_META = '<meta name="robots" content="noindex" />';

/** Resolves a page with the theme marker and the shared headers. */
async function renderPage(
	event: RequestEvent,
	resolve: Parameters<Handle>[0]['resolve'],
	path: string,
	options: { indexable?: boolean } = {}
): Promise<Response> {
	const theme = parseTheme(event.cookies.get(THEME_COOKIE));
	const response = await resolve(event, {
		transformPageChunk: ({ html }) => {
			const marked = applyThemeMarker(html, theme);
			return options.indexable ? marked.replace(NOINDEX_META, '') : marked;
		}
	});
	return applyHeaders(path, response);
}

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = null;
	event.locals.projects = [];
	event.locals.sessionUnavailable = false;

	const path = logicalPath(event.url.pathname);
	// The public site pages need no session, so they render even when the API is down or unset.
	if (isSitePath(path)) return renderPage(event, resolve, path, { indexable: true });
	if (!apiBaseUrl()) {
		if (isStaticAsset(path)) {
			const response = await resolve(event);
			return applyHeaders(path, response);
		}
		return applyHeaders(path, notConfigured());
	}

	if (path === '/') redirect(303, '/projects');

	const session = await loadSession(event);
	if (session.kind === 'ready') {
		event.locals.user = session.user;
		event.locals.projects = session.projects;
	} else if (session.kind === 'unavailable') {
		event.locals.sessionUnavailable = true;
	}

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
		// redirect() is handled outside this hook, so an invite URL would be a 303 with no
		// Referrer-Policy. Return the response here so the token-bearing URL cannot leak.
		if (path.startsWith('/invite/')) return inviteSignInRedirect(path, signinLocation(event.url), event.isDataRequest);
		redirect(303, signinLocation(event.url));
	}

	return renderPage(event, resolve, path);
};
