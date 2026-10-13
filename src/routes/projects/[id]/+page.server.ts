import { error, fail, redirect } from '@sveltejs/kit';
import type { Host, JoinToken, Member } from '$lib/api-types';
import type { ProjectScope } from '$lib/project-action';
import { actionFailure, apiFetch, apiList, loadFailure } from '$lib/server/api';
import { formText } from '$lib/server/form';
import { requireUser } from '$lib/server/guard';
import { present } from '$lib/server/redact';
import { roleAtLeast, uiRole } from '$lib/server/roles';
import { parseHost, parseJoinToken, parseMember, parseCreatedJoin, parseProject } from '$lib/server/shape';
import { cleanEmail, cleanExpiry, cleanHint, cleanName, cleanRole, isUuid } from '$lib/server/validate';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

function projectId(params: { id?: string }): string {
	if (!params.id || !isUuid(params.id)) error(404, 'Not found');
	return params.id;
}

function invalid(event: RequestEvent, scope: ProjectScope, message: string) {
	return fail(400, present(event, { scope, message }));
}

function tabOf(value: string | null, canAdmin: boolean, canOwner: boolean): ProjectScope {
	if (value === 'settings') return canOwner ? 'settings' : 'hosts';
	if (value === 'tokens') return canAdmin ? 'tokens' : 'hosts';
	if (value === 'members') return 'members';
	return 'hosts';
}

const empty = {
	project: null,
	message: null as string | null,
	tab: 'hosts' as ProjectScope,
	canAdmin: false,
	canOwner: false,
	hosts: [],
	hostsOmitted: 0,
	hostsTruncated: false,
	hostsMessage: null as string | null,
	members: [],
	membersOmitted: 0,
	membersTruncated: false,
	membersMessage: null as string | null,
	tokens: [],
	tokensOmitted: 0,
	tokensTruncated: false,
	tokensMessage: null as string | null
};

export const load: PageServerLoad = async (event) => {
	requireUser(event);
	const id = projectId(event.params);
	let project;
	try {
		project = parseProject(await apiFetch(event, `/v1/projects/${id}`));
	} catch (err) {
		return present(event, { ...empty, userId: event.locals.user?.id ?? null, message: loadFailure(err).message });
	}
	const userId = event.locals.user?.id ?? null;
	if (!project) return present(event, { ...empty, userId, message: 'The API returned an unexpected response.' });

	const localsRole = event.locals.projects.find((item) => item.id === project.id)?.role ?? null;
	const role = uiRole(localsRole, project.role);
	const canAdmin = roleAtLeast(role, 'admin');
	const canOwner = roleAtLeast(role, 'owner');
	const tab = tabOf(event.url.searchParams.get('tab'), canAdmin, canOwner);

	let hosts: Host[] = [];
	let hostsOmitted = 0;
	let hostsTruncated = false;
	let hostsMessage: string | null = null;
	try {
		const list = await apiList(event, `/v1/projects/${id}/hosts`, parseHost);
		hosts = list.items;
		hostsOmitted = list.omitted;
		hostsTruncated = list.truncated;
	} catch (err) {
		hostsMessage = loadFailure(err).message;
	}

	let members: Member[] = [];
	let membersOmitted = 0;
	let membersTruncated = false;
	let membersMessage: string | null = null;
	try {
		const list = await apiList(event, `/v1/projects/${id}/members`, parseMember);
		members = list.items;
		membersOmitted = list.omitted;
		membersTruncated = list.truncated;
	} catch (err) {
		membersMessage = loadFailure(err).message;
	}

	let tokens: JoinToken[] = [];
	let tokensOmitted = 0;
	let tokensTruncated = false;
	let tokensMessage: string | null = null;
	if (canAdmin) {
		try {
			const list = await apiList(event, `/v1/projects/${id}/join-tokens`, parseJoinToken);
			tokens = list.items;
			tokensOmitted = list.omitted;
			tokensTruncated = list.truncated;
		} catch (err) {
			tokensMessage = loadFailure(err).message;
		}
	}

	return present(event, {
		project,
		userId,
		message: null,
		tab,
		canAdmin,
		canOwner,
		hosts,
		hostsOmitted,
		hostsTruncated,
		hostsMessage,
		members,
		membersOmitted,
		membersTruncated,
		membersMessage,
		tokens,
		tokensOmitted,
		tokensTruncated,
		tokensMessage
	});
};

export const actions: Actions = {
	askRevoke: async (event) => {
		requireUser(event);
		projectId(event.params);
		const hostId = formText(await event.request.formData(), 'host_id');
		if (!isUuid(hostId)) return invalid(event, 'hosts', 'That host is not valid.');
		return present(event, { scope: 'hosts', confirmHostId: hostId });
	},

	revokeCredential: async (event) => {
		requireUser(event);
		const id = projectId(event.params);
		const hostId = formText(await event.request.formData(), 'host_id');
		if (!isUuid(hostId)) return invalid(event, 'hosts', 'That host is not valid.');
		try {
			await apiFetch(event, `/v1/hosts/${hostId}/credential`, { method: 'DELETE' });
			redirect(303, `/projects/${id}?tab=hosts`);
		} catch (err) {
			return actionFailure(event, err, 'hosts');
		}
	},

	addMember: async (event) => {
		requireUser(event);
		const id = projectId(event.params);
		const form = await event.request.formData();
		const email = cleanEmail(formText(form, 'email'));
		const role = cleanRole(formText(form, 'role'));
		if (!email) return invalid(event, 'members', 'Enter an email address.');
		if (!role) return invalid(event, 'members', 'Choose admin or viewer.');
		try {
			await apiFetch(event, `/v1/projects/${id}/members`, {
				method: 'POST',
				body: JSON.stringify({ email, role })
			});
			redirect(303, `/projects/${id}?tab=members`);
		} catch (err) {
			return actionFailure(event, err, 'members');
		}
	},

	changeRole: async (event) => {
		requireUser(event);
		const id = projectId(event.params);
		const form = await event.request.formData();
		const userId = formText(form, 'user_id');
		const role = cleanRole(formText(form, 'role'));
		if (!isUuid(userId)) return invalid(event, 'members', 'That member is not valid.');
		if (!role) return invalid(event, 'members', 'Choose admin or viewer.');
		try {
			await apiFetch(event, `/v1/projects/${id}/members/${userId}`, {
				method: 'PATCH',
				body: JSON.stringify({ role })
			});
			redirect(303, `/projects/${id}?tab=members`);
		} catch (err) {
			return actionFailure(event, err, 'members');
		}
	},

	removeMember: async (event) => {
		requireUser(event);
		const id = projectId(event.params);
		const userId = formText(await event.request.formData(), 'user_id');
		if (!isUuid(userId)) return invalid(event, 'members', 'That member is not valid.');
		try {
			await apiFetch(event, `/v1/projects/${id}/members/${userId}`, { method: 'DELETE' });
			redirect(303, `/projects/${id}?tab=members`);
		} catch (err) {
			return actionFailure(event, err, 'members');
		}
	},

	transfer: async (event) => {
		requireUser(event);
		const id = projectId(event.params);
		const userId = formText(await event.request.formData(), 'user_id');
		if (!isUuid(userId)) return invalid(event, 'members', 'Choose a member.');
		try {
			await apiFetch(event, `/v1/projects/${id}/transfer-ownership`, {
				method: 'POST',
				body: JSON.stringify({ user_id: userId })
			});
			redirect(303, `/projects/${id}?tab=members`);
		} catch (err) {
			return actionFailure(event, err, 'members');
		}
	},

	createToken: async (event) => {
		requireUser(event);
		const id = projectId(event.params);
		const form = await event.request.formData();
		const hintText = formText(form, 'host_name_hint');
		const hint = hintText.trim() ? cleanHint(hintText) : null;
		if (hintText.trim() && !hint) return invalid(event, 'tokens', 'Host name hint must be 1–80 characters.');
		const expiry = cleanExpiry(formText(form, 'expires_in_sec'));
		if (!expiry.ok) return invalid(event, 'tokens', 'Expiry must be between 300 and 604800 seconds, or blank.');
		const body: { host_name_hint?: string; expires_in_sec?: number } = {};
		if (hint) body.host_name_hint = hint;
		if (expiry.seconds != null) body.expires_in_sec = expiry.seconds;
		try {
			const created = parseCreatedJoin(
				await apiFetch(event, `/v1/projects/${id}/join-tokens`, {
					method: 'POST',
					body: JSON.stringify(body)
				})
			);
			if (!created) return fail(502, present(event, { scope: 'tokens', message: 'The API returned an unexpected response.' }));
			// Stay on this response so the plaintext token is shown once. A reload is a GET and drops it.
			return present(event, {
				scope: 'tokens' as const,
				created,
				message: created.install_command ? null : 'Install command not shown: unexpected format'
			});
		} catch (err) {
			return actionFailure(event, err, 'tokens');
		}
	},

	revokeToken: async (event) => {
		requireUser(event);
		const id = projectId(event.params);
		const tokenId = formText(await event.request.formData(), 'token_id');
		if (!isUuid(tokenId)) return invalid(event, 'tokens', 'That join token is not valid.');
		try {
			await apiFetch(event, `/v1/projects/${id}/join-tokens/${tokenId}`, { method: 'DELETE' });
			redirect(303, `/projects/${id}?tab=tokens`);
		} catch (err) {
			return actionFailure(event, err, 'tokens');
		}
	},

	rename: async (event) => {
		requireUser(event);
		const id = projectId(event.params);
		const name = cleanName(formText(await event.request.formData(), 'name'));
		if (!name) return invalid(event, 'settings', 'Enter a project name (1–80 characters).');
		try {
			await apiFetch(event, `/v1/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
			redirect(303, `/projects/${id}?tab=settings`);
		} catch (err) {
			return actionFailure(event, err, 'settings');
		}
	},

	deleteProject: async (event) => {
		requireUser(event);
		const id = projectId(event.params);
		const typed = formText(await event.request.formData(), 'confirm');
		try {
			const current = parseProject(await apiFetch(event, `/v1/projects/${id}`));
			if (!current || typed !== current.name) {
				return invalid(event, 'settings', 'Type the project name exactly to delete it.');
			}
			await apiFetch(event, `/v1/projects/${id}`, { method: 'DELETE' });
			redirect(303, '/projects');
		} catch (err) {
			return actionFailure(event, err, 'settings');
		}
	}
};
