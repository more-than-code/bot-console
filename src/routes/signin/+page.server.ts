import { fail, redirect } from '@sveltejs/kit';
import { actionFailure, apiFetchPublic, readPrivate } from '$lib/server/api';
import { formText } from '$lib/server/form';
import { requireApi } from '$lib/server/guard';
import { present } from '$lib/server/redact';
import { isRecord } from '$lib/server/shape';
import { OAUTH_COOKIE, oauthCookieOptions, safeNext } from '$lib/server/session';
import { isHttpsUrl } from '$lib/server/validate';
import type { Actions, PageServerLoad } from './$types';

const STATE = /^[\x21-\x7E]+$/;

function isOauthState(value: unknown): value is string {
	return typeof value === 'string' && value.length >= 16 && value.length <= 512 && STATE.test(value) && !value.includes(';') && !value.includes('\\');
}

function authorizeHosts(): Set<string> {
	const configured = readPrivate('BOT_API_OAUTH_AUTHORIZE_HOSTS');
	const source = configured || 'accounts.google.com';
	const hosts = source.split(',').map((host) => host.trim()).filter((host) => host.length > 0);
	return new Set(hosts);
}

/** https only, hostname exactly in the allowlist, then the parsed URL rather than the raw string. */
function authorizeLocation(value: unknown): string | null {
	if (!isHttpsUrl(value)) return null;
	const url = new URL(value);
	if (!authorizeHosts().has(url.hostname)) return null;
	return url.href;
}

export const load: PageServerLoad = (event) => {
	requireApi();
	return present(event, {
		next: safeNext(event.url.searchParams.get('next')),
		signedInName: event.locals.user?.name ?? null
	});
};

export const actions: Actions = {
	default: async (event) => {
		requireApi();
		const form = await event.request.formData();
		const next = safeNext(formText(form, 'next') || event.url.searchParams.get('next'));
		const redirectUri = `${event.url.origin}/auth/google/callback`;
		try {
			const payload = await apiFetchPublic(event, `/v1/auth/google/start?redirect_uri=${encodeURIComponent(redirectUri)}`);
			const location = isRecord(payload) ? authorizeLocation(payload.authorize_url) : null;
			if (!isRecord(payload) || !location || !isOauthState(payload.state)) {
				return fail(502, present(event, { message: 'Sign-in could not start.', next }));
			}
			event.cookies.set(OAUTH_COOKIE, JSON.stringify({ state: payload.state, next }), oauthCookieOptions(event.url));
			redirect(303, location);
		} catch (err) {
			const failure = actionFailure(event, err);
			const message = typeof failure.data?.message === 'string' ? failure.data.message : 'Sign-in could not start.';
			return fail(failure.status, present(event, { message, next }));
		}
	}
};
