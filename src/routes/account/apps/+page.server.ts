import { fail, redirect } from '@sveltejs/kit';
import { actionFailure, apiFetch, loadFailure } from '$lib/server/api';
import { formText } from '$lib/server/form';
import { requireUser } from '$lib/server/guard';
import { present } from '$lib/server/redact';
import { parseGrants } from '$lib/server/shape';
import { isUuid } from '$lib/server/validate';
import type { Actions, PageServerLoad } from './$types';

const UNEXPECTED = 'The API returned an unexpected response.';
const BAD_GRANT = 'That app could not be revoked.';

export const load: PageServerLoad = async (event) => {
	requireUser(event);
	try {
		const grants = parseGrants(await apiFetch(event, '/v1/me/grants'));
		if (!grants) return present(event, { grants: [], message: UNEXPECTED });
		return present(event, { grants, message: null });
	} catch (err) {
		return present(event, { grants: [], message: loadFailure(err).message });
	}
};

export const actions: Actions = {
	revoke: async (event) => {
		requireUser(event);
		const form = await event.request.formData();
		const id = formText(form, 'grant_id');
		if (!isUuid(id)) return fail(400, present(event, { message: BAD_GRANT }));
		try {
			await apiFetch(event, `/v1/me/grants/${encodeURIComponent(id)}`, { method: 'DELETE' });
			redirect(303, '/account/apps');
		} catch (err) {
			return actionFailure(event, err);
		}
	}
};
