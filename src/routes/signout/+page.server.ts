import { isRedirect, redirect } from '@sveltejs/kit';
import { ApiError, apiFetch } from '$lib/server/api';
import { requireApi } from '$lib/server/guard';
import { clearSession, SESSION_COOKIE } from '$lib/server/session';
import { isSessionToken } from '$lib/server/validate';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	requireApi();
	return {};
};

export const actions: Actions = {
	default: async (event) => {
		requireApi();
		const token = event.cookies.get(SESSION_COOKIE);
		if (isSessionToken(token)) {
			try {
				await apiFetch(event, '/v1/auth/signout', { method: 'POST' });
			} catch (err) {
				// A dead session makes apiFetch redirect to /signin?next=/signout. Drop that and finish locally.
				if (!isRedirect(err) && !(err instanceof ApiError)) throw err;
			}
		}
		clearSession(event);
		redirect(303, '/signin');
	}
};
