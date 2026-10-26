import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import type { Member } from '../src/lib/api-types.ts';
import { restoreFocusTo } from '../src/lib/dialog-focus.ts';
import AddMemberForm from '../src/routes/projects/[id]/AddMemberForm.svelte';
import MembersSection from '../src/routes/projects/[id]/MembersSection.svelte';
import ProjectFileForm from '../src/routes/projects/[id]/ProjectFileForm.svelte';
import ProjectPage from '../src/routes/projects/[id]/+page.svelte';
import RegistryForm from '../src/routes/projects/[id]/RegistryForm.svelte';
import SettingsSection from '../src/routes/projects/[id]/SettingsSection.svelte';
import { PROJECT, USER } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

function strip(html: string): string {
	return html.replace(/<!--[\s\S]*?-->/g, '');
}

function trigger(html: string, id: string): string {
	return strip(html).match(new RegExp(`<button\\b[^>]*id="${id}"[^>]*>[\\s\\S]*?<\\/button>`))?.[0] ?? '';
}

function inputNames(html: string): string[] {
	return [...html.matchAll(/<(?:input|textarea)\b[^>]*\bname="([^"]+)"/g)].map((match) => match[1] ?? '');
}

/** Stands in for the FormDialog Cancel snippet, which needs the dialog context. */
const cancel = createRawSnippet(() => ({ render: () => '<button type="button" data-test="cancel">Cancel</button>' }));
const noop = () => {};

const MEMBERS: Member[] = [{ user_id: USER.id, email: USER.email, name: USER.name, role: 'owner', created_at: '2026-10-13T00:00:00Z' }];

function membersProps(extra: Record<string, unknown> = {}) {
	return { members: MEMBERS, omitted: 0, truncated: false, canAdmin: true, canOwner: true, currentUserId: USER.id, message: null, ...extra };
}

test('Settings: New env set, Add file and Add registry are matching dialog triggers', () => {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=settings`);
	const html = render(SettingsSection, { props: { project: PROJECT, canOwner: true, canAdmin: true, message: null } }).body;
	const classes: string[] = [];
	for (const [id, label] of [
		['new-env-set', 'New env set'],
		['add-file', 'Add file'],
		['add-registry', 'Add registry']
	] as const) {
		const button = trigger(html, id);
		assert.match(button, /aria-haspopup="dialog"/, id);
		assert.match(button, /aria-expanded="false"/, id);
		assert.match(button, /lucide-plus/, id);
		assert.match(button, new RegExp(`${label}\\s*</button>$`), id);
		classes.push(button.match(/class="([^"]*)"/)?.[1] ?? '');
	}
	assert.equal(new Set(classes).size, 1, 'same variant on all three');
	// The forms stay in the closed dialogs.
	for (const absent of ['saveProjectFile', 'saveRegistry', 'name="token"', 'name="content"']) assert.equal(html.includes(absent), false, absent);
});

test('Settings: a save failure forces only its own dialog open', () => {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=settings`);
	const props = { project: PROJECT, canOwner: true, canAdmin: true, message: 'Could not save. Paste the value again.' };
	const token = render(SettingsSection, { props: { ...props, settingsField: 'token' as const } }).body;
	assert.match(trigger(token, 'add-registry'), /aria-expanded="true"/);
	assert.match(trigger(token, 'add-file'), /aria-expanded="false"/);
	const file = render(SettingsSection, { props: { ...props, settingsField: 'file' as const } }).body;
	assert.match(trigger(file, 'add-file'), /aria-expanded="true"/);
	assert.match(trigger(file, 'add-registry'), /aria-expanded="false"/);
	const other = render(SettingsSection, { props: { ...props, settingsName: 'key.json' } }).body;
	assert.match(trigger(other, 'add-file'), /aria-expanded="false"/);
	assert.match(trigger(other, 'add-registry'), /aria-expanded="false"/);
});

test('the registry, file and member forms keep their fields and actions and show Cancel', () => {
	const registry = render(RegistryForm, { props: { action: '?/saveRegistry', onSaved: noop, onSettled: noop, cancel } }).body;
	assert.match(registry, /<form\b[^>]*method="POST"[^>]*action="\?\/saveRegistry"/);
	assert.deepEqual(inputNames(registry), ['host', 'username', 'token']);
	assert.equal(registry.includes('id="registry-token-error"'), false);
	const registryFailed = render(RegistryForm, { props: { action: '?/saveRegistry', error: 'Enter a token.', onSaved: noop, onSettled: noop } }).body;
	assert.match(registryFailed, /id="registry-token-error"[^>]*tabindex="-1"/);
	assert.match(registryFailed, /Enter a token\./);

	const file = render(ProjectFileForm, { props: { action: '?/saveProjectFile', onSaved: noop, onSettled: noop, cancel } }).body;
	assert.match(file, /<form\b[^>]*method="POST"[^>]*action="\?\/saveProjectFile"/);
	assert.deepEqual(inputNames(file), ['name', 'content', 'secret']);

	const member = render(AddMemberForm, { props: { action: '?/addMember', onAdded: noop, onSettled: noop, cancel } }).body;
	assert.match(member, /<form\b[^>]*method="POST"[^>]*action="\?\/addMember"/);
	assert.deepEqual(inputNames(member), ['email', 'role']);
	assert.equal(member.includes('id="add-member-error"'), false);
	const memberFailed = render(AddMemberForm, { props: { action: '?/addMember', error: 'No such user.', onAdded: noop, onSettled: noop } }).body;
	assert.match(memberFailed, /id="add-member-error"[^>]*tabindex="-1"/);
	assert.match(memberFailed, /aria-describedby="add-member-error"/);

	// Cancel sits next to the submit button in every form.
	for (const [html, submit] of [
		[registry, 'Save registry'],
		[file, 'Save file'],
		[member, 'Add member']
	] as const) {
		const row = strip(html).match(/<div class="flex flex-wrap items-center gap-2">([\s\S]*?)<\/div>\s*<\/form>/)?.[1] ?? '';
		assert.match(row, new RegExp(`${submit}<\\/button>\\s*<button type="button" data-test="cancel">Cancel<\\/button>`), submit);
	}
});

test('Members: Add member is a dialog trigger; its failure opens the dialog and stays off the page notice', () => {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=members`);
	const html = render(MembersSection, { props: membersProps() }).body;
	const button = trigger(html, 'add-member');
	assert.match(button, /aria-haspopup="dialog"/);
	assert.match(button, /aria-expanded="false"/);
	assert.equal(html.includes('addMember'), false);
	assert.equal(html.includes('name="email"'), false);
	assert.equal(render(MembersSection, { props: membersProps({ canAdmin: false, canOwner: false }) }).body.includes('id="add-member"'), false);

	const failed = render(MembersSection, { props: membersProps({ addMemberMessage: 'No such user.' }) }).body;
	assert.match(trigger(failed, 'add-member'), /aria-expanded="true"/);
	assert.equal(failed.includes('No such user.'), false, 'the message is only in the dialog');

	// Through the page: an addMember failure goes to the dialog, a changeRole failure to the page notice.
	const data = {
		project: PROJECT,
		userId: USER.id,
		message: null,
		tab: 'members',
		canAdmin: true,
		canOwner: true,
		members: MEMBERS,
		membersOmitted: 0,
		membersTruncated: false,
		membersMessage: null,
		invites: []
	};
	const add = render(ProjectPage, { props: { data: data as never, form: { scope: 'members', field: 'addMember', message: 'No such user.' } as never } }).body;
	assert.equal(add.includes('No such user.'), false);
	assert.match(trigger(add, 'add-member'), /aria-expanded="true"/);
	const role = render(ProjectPage, { props: { data: data as never, form: { scope: 'members', message: 'Choose admin or viewer.' } as never } }).body;
	assert.match(role, /Choose admin or viewer\./);
	assert.match(trigger(role, 'add-member'), /aria-expanded="false"/);
});

test('Hosts: a createToken message is not repeated in the page notice', () => {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=hosts`);
	const data = {
		project: PROJECT,
		userId: USER.id,
		message: null,
		tab: 'hosts',
		canAdmin: true,
		canOwner: true,
		hosts: [],
		hostsOmitted: 0,
		hostsTruncated: false,
		hostsMessage: null,
		tokens: []
	};
	const page = (form: object) => render(ProjectPage, { props: { data: data as never, form: form as never } }).body;
	assert.equal(page({ scope: 'hosts', field: 'createToken', message: 'Expiry must be between 300 and 604800 seconds, or blank.' }).includes('Expiry must be'), false);
	const note = page({ scope: 'hosts', field: 'createToken', created: { id: '00000000-0000-4000-8000-000000000070', token: 'join-plain-0123456789abcdef', server: null }, message: 'Server URL not shown: unexpected format' });
	assert.equal(note.includes('Server URL not shown'), false);
	assert.match(page({ scope: 'hosts', message: 'That host is not valid.' }), /That host is not valid\./);
});

test('restoreFocusTo stops the default focus return and focuses the given id', () => {
	const focused: string[] = [];
	const saved = globalThis.document;
	(globalThis as { document?: unknown }).document = { getElementById: (id: string) => ({ focus: () => focused.push(id) }) };
	try {
		let prevented = false;
		restoreFocusTo('add-file')({ preventDefault: () => (prevented = true) } as unknown as Event);
		assert.equal(prevented, true);
		assert.deepEqual(focused, ['add-file']);
	} finally {
		(globalThis as { document?: unknown }).document = saved;
	}
});
