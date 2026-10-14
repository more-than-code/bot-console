import { fail, isHttpError, isRedirect, redirect, type RequestEvent } from '@sveltejs/kit';
import { ApiError, apiFetch, loadFailure } from '$lib/server/api';
import { requireUser } from '$lib/server/guard';
import { present } from '$lib/server/redact';
import { parseInviteAccept, parseInviteLookup } from '$lib/server/shape';
import { isInviteToken } from '$lib/server/validate';
import type { Actions, PageServerLoad } from './$types';

const UNEXPECTED = 'The API returned an unexpected response.';

const INVITE_HEADERS = {
	'cache-control': 'no-store',
	'referrer-policy': 'no-referrer',
	'x-frame-options': 'DENY'
};

/**
 * A POST load runs only after the action, which already set these.
 * setHeaders throws if the same name is set twice on one request.
 */
function setInviteHeaders(event: RequestEvent): void {
	if (event.request.method === 'POST') return;
	event.setHeaders(INVITE_HEADERS);
}

function tokenFrom(params: { token?: string }): string | null {
	const token = params.token ?? '';
	return isInviteToken(token) ? token : null;
}

function withoutToken(message: string, token: string): string {
	return message.split(token).join('[redacted]');
}

function page(view: 'invalid' | 'error' | 'member' | 'join', extra: {
	message?: string | null;
	projectName?: string | null;
	projectId?: string | null;
	role?: 'admin' | 'viewer' | null;
} = {}) {
	return {
		view,
		message: extra.message ?? null,
		projectName: extra.projectName ?? null,
		projectId: extra.projectId ?? null,
		role: extra.role ?? null
	};
}

export const load: PageServerLoad = async (event) => {
	setInviteHeaders(event);
	requireUser(event);
	const token = tokenFrom(event.params);
	if (!token) return present(event, page('invalid'));
	try {
		// Lookup only. A GET must not call accept, or a prefetch could join.
		const payload = await apiFetch(event, '/v1/invites/lookup', {
			method: 'POST',
			body: JSON.stringify({ token })
		});
		const lookup = parseInviteLookup(payload);
		if (!lookup) return present(event, page('error', { message: UNEXPECTED }));
		if (lookup.already_member) {
			return present(event, page('member', { projectName: lookup.project_name, projectId: lookup.project_id }));
		}
		return present(event, page('join', { projectName: lookup.project_name, role: lookup.role }));
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		if (err instanceof ApiError && err.code === 'not_found') return present(event, page('invalid'));
		const failure = loadFailure(err);
		return present(event, page('error', { message: withoutToken(failure.message, token) }));
	}
};

export const actions: Actions = {
	accept: async (event) => {
		event.setHeaders(INVITE_HEADERS);
		requireUser(event);
		const token = tokenFrom(event.params);
		if (!token) return fail(400, present(event, page('invalid')));
		try {
			const payload = await apiFetch(event, '/v1/invites/accept', {
				method: 'POST',
				body: JSON.stringify({ token })
			});
			const accepted = parseInviteAccept(payload);
			if (!accepted) return fail(502, present(event, page('error', { message: UNEXPECTED })));
			redirect(303, `/projects/${accepted.project_id}`);
		} catch (err) {
			if (isRedirect(err) || isHttpError(err)) throw err;
			if (err instanceof ApiError && err.code === 'not_found') return fail(404, present(event, page('invalid')));
			if (!(err instanceof ApiError)) console.error('bot api request failed');
			const status = err instanceof ApiError && err.status >= 400 && err.status <= 599 ? err.status : 503;
			const message = err instanceof ApiError ? err.msg : 'The API is unavailable.';
			return fail(status, present(event, page('error', { message: withoutToken(message, token) })));
		}
	}
};
