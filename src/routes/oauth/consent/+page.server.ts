import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { actionFailure, ApiError, apiFetch, loadFailure } from '$lib/server/api';
import { formText } from '$lib/server/form';
import { requireUser } from '$lib/server/guard';
import { present } from '$lib/server/redact';
import { parseOauthRedirect, parseOauthRequest } from '$lib/server/shape';
import { isOauthRequestId } from '$lib/server/validate';
import type { Actions, PageServerLoad } from './$types';

const EXPIRED = 'This sign-in request has expired or was already used.';
const REFUSED = 'This console will not open that address.';
const UNEXPECTED = 'The API returned an unexpected response.';

const CONSENT_HEADERS = {
	'cache-control': 'no-store',
	'x-frame-options': 'DENY',
	'content-security-policy': "frame-ancestors 'none'"
};

/**
 * Clickjacking and replay protection for the consent document.
 * A POST load runs only after the action, which already set these.
 * setHeaders throws if the same name is set twice on one request.
 */
function setConsentHeaders(event: RequestEvent): void {
	if (event.request.method === 'POST') return;
	event.setHeaders(CONSENT_HEADERS);
}

function refusalMessage(reason: 'malformed' | 'refused'): string {
	return reason === 'refused' ? REFUSED : UNEXPECTED;
}

function requestId(event: RequestEvent, form: FormData): string | null {
	const posted = formText(form, 'request');
	const query = event.url.searchParams.get('request') ?? '';
	if (posted && query && posted !== query) return null;
	const id = posted || query;
	return isOauthRequestId(id) ? id : null;
}

export const load: PageServerLoad = async (event) => {
	setConsentHeaders(event);
	requireUser(event);
	const id = event.url.searchParams.get('request');
	if (!isOauthRequestId(id)) return present(event, { request: null, message: EXPIRED });
	try {
		const payload = await apiFetch(event, `/v1/oauth/requests/${encodeURIComponent(id)}`);
		const request = parseOauthRequest(payload);
		if (!request || request.id !== id) return present(event, { request: null, message: UNEXPECTED });
		// A grant remembered for this user, client, and resource skips the page. The API still records the allow.
		if (request.remembered) {
			const decision = await apiFetch(event, `/v1/oauth/requests/${encodeURIComponent(id)}/approve`, { method: 'POST' });
			const parsed = parseOauthRedirect(decision);
			if (!parsed.ok) return present(event, { request: null, message: refusalMessage(parsed.reason) });
			redirect(303, parsed.redirect_to);
		}
		return present(event, { request, message: null });
	} catch (err) {
		if (err instanceof ApiError && err.code === 'not_found') return present(event, { request: null, message: EXPIRED });
		return present(event, { request: null, message: loadFailure(err).message });
	}
};

async function decide(event: RequestEvent, action: 'approve' | 'deny') {
	event.setHeaders(CONSENT_HEADERS);
	requireUser(event);
	const form = await event.request.formData();
	const id = requestId(event, form);
	if (!id) return fail(400, present(event, { message: EXPIRED }));
	try {
		const payload = await apiFetch(event, `/v1/oauth/requests/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
		const parsed = parseOauthRedirect(payload);
		if (!parsed.ok) return fail(502, present(event, { message: refusalMessage(parsed.reason) }));
		redirect(303, parsed.redirect_to);
	} catch (err) {
		if (err instanceof ApiError && err.code === 'not_found') return fail(404, present(event, { message: EXPIRED }));
		return actionFailure(event, err);
	}
}

export const actions: Actions = {
	approve: (event) => decide(event, 'approve'),
	deny: (event) => decide(event, 'deny')
};
