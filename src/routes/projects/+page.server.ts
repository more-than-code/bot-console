import { fail, redirect } from '@sveltejs/kit';
import { actionFailure, apiFetch, apiList, loadFailure } from '$lib/server/api';
import { formText } from '$lib/server/form';
import { requireUser } from '$lib/server/guard';
import { present } from '$lib/server/redact';
import { parseProject } from '$lib/server/shape';
import { cleanName } from '$lib/server/validate';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	requireUser(event);
	try {
		const list = await apiList(event, '/v1/projects', parseProject);
		return present(event, { projects: list.items, omitted: list.omitted, truncated: list.truncated, message: null });
	} catch (err) {
		const failure = loadFailure(err);
		return present(event, { projects: [], omitted: 0, truncated: false, message: failure.message });
	}
};

export const actions: Actions = {
	create: async (event) => {
		requireUser(event);
		const form = await event.request.formData();
		const name = cleanName(formText(form, 'name'));
		if (!name) return fail(400, present(event, { message: 'Enter a project name (1–80 characters).' }));
		try {
			const project = parseProject(await apiFetch(event, '/v1/projects', { method: 'POST', body: JSON.stringify({ name }) }));
			if (!project) return fail(502, present(event, { message: 'The API returned an unexpected response.' }));
			redirect(303, `/projects/${project.id}`);
		} catch (err) {
			return actionFailure(event, err);
		}
	}
};
