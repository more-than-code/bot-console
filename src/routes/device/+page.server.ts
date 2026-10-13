import { fail, redirect } from '@sveltejs/kit';
import { actionFailure, apiFetch, loadFailure } from '$lib/server/api';
import { formText } from '$lib/server/form';
import { requireUser } from '$lib/server/guard';
import { present } from '$lib/server/redact';
import { parseDevice } from '$lib/server/shape';
import { normalizeUserCode } from '$lib/server/validate';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

export const load: PageServerLoad = async (event) => {
	requireUser(event);
	const raw = event.url.searchParams.get('code');
	if (!raw) return present(event, { device: null, code: '', message: null });
	const code = normalizeUserCode(raw);
	if (!code) {
		return present(event, { device: null, code: '', message: 'That device code is not valid. Check the code and try again.' });
	}
	try {
		const device = parseDevice(await apiFetch(event, `/v1/auth/device/${encodeURIComponent(code)}`));
		if (!device) {
			return present(event, { device: null, code, message: 'The API returned an unexpected response.' });
		}
		return present(event, { device, code, message: null });
	} catch (err) {
		const failure = loadFailure(err);
		return present(event, { device: null, code, message: failure.message });
	}
};

async function decide(event: RequestEvent, action: 'approve' | 'deny') {
	requireUser(event);
	const form = await event.request.formData();
	const code = normalizeUserCode(formText(form, 'code'));
	const query = event.url.searchParams.get('code');
	const queryCode = query ? normalizeUserCode(query) : null;
	if (!code || (query && queryCode !== code)) {
		return fail(400, present(event, { message: 'That device code is not valid. Check the code and try again.' }));
	}
	try {
		await apiFetch(event, `/v1/auth/device/${encodeURIComponent(code)}/${action}`, { method: 'POST' });
		redirect(303, `/device?code=${encodeURIComponent(code)}`);
	} catch (err) {
		return actionFailure(event, err);
	}
}

export const actions: Actions = {
	approve: (event) => decide(event, 'approve'),
	deny: (event) => decide(event, 'deny')
};
