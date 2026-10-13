import { error, redirect } from '@sveltejs/kit';
import { ApiError, apiFetchPublic } from '$lib/server/api';
import { requireApi } from '$lib/server/guard';
import { isRecord } from '$lib/server/shape';
import { OAUTH_COOKIE, oauthCookieOptions, parseOauthCookie, SESSION_COOKIE, sessionCookieOptions } from '$lib/server/session';
import { isSessionToken, secretEqual } from '$lib/server/validate';
import type { RequestHandler } from './$types';

const OAUTH_CODE = /^[\x21-\x7E]+$/;

function reject(): never {
	error(400, 'Sign-in could not be completed. Start again from the sign-in page.');
}

export const GET: RequestHandler = async (event) => {
	requireApi();
	const stored = parseOauthCookie(event.cookies.get(OAUTH_COOKIE));
	event.cookies.delete(OAUTH_COOKIE, oauthCookieOptions(event.url));

	const returned = event.url.searchParams.get('state') ?? '';
	const code = event.url.searchParams.get('code') ?? '';
	if (event.url.searchParams.get('error') || !stored || !secretEqual(stored.state, returned)) reject();
	if (!code || code.length > 2048 || !OAUTH_CODE.test(code)) reject();

	const redirectUri = `${event.url.origin}/auth/google/callback`;
	let payload: unknown;
	try {
		payload = await apiFetchPublic(event, '/v1/auth/google/callback', {
			method: 'POST',
			body: JSON.stringify({ code, state: returned, redirect_uri: redirectUri })
		});
	} catch (err) {
		if (err instanceof ApiError) error(err.status === 401 ? 400 : err.status, err.msg);
		error(503, 'Sign-in could not be completed.');
	}
	if (!isRecord(payload) || !isSessionToken(payload.token)) {
		error(502, 'Sign-in could not be completed.');
	}
	event.cookies.set(SESSION_COOKIE, payload.token, sessionCookieOptions(event.url));
	redirect(303, stored.next);
};
