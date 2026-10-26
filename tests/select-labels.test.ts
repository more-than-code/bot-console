import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render } from 'svelte/server';
import type { Member } from '../src/lib/api-types.ts';
import MembersSection from '../src/routes/projects/[id]/MembersSection.svelte';
import AddMemberForm from '../src/routes/projects/[id]/AddMemberForm.svelte';
import ServicesSection from '../src/routes/projects/[id]/ServicesSection.svelte';
import { PROJECT, USER } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

function decode(value: string): string {
	return value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
}

function attr(tag: string, name: string): string | null {
	const found = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
	return found ? decode(found[1] ?? '') : null;
}

function textContent(html: string): string {
	return decode(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

/** Accname for a button: aria-labelledby, then aria-label, then the label's text. */
function accessibleName(html: string, id: string): string {
	const button = html.match(new RegExp(`<button\\b(?=[^>]*\\bid="${id}")[^>]*>`));
	assert.ok(button, `missing control ${id}`);
	const tag = button[0];
	const labelledBy = attr(tag, 'aria-labelledby');
	if (labelledBy) {
		return labelledBy
			.split(/\s+/)
			.map((labelId) => {
				const node = html.match(new RegExp(`\\bid="${labelId}"[^>]*>([\\s\\S]*?)</`));
				assert.ok(node, labelId);
				return textContent(node[1] ?? '');
			})
			.join(' ')
			.trim();
	}
	const aria = attr(tag, 'aria-label');
	if (aria) return aria;
	const label = html.match(new RegExp(`<label\\b(?=[^>]*\\bfor="${id}")[^>]*>([\\s\\S]*?)</label>`));
	assert.ok(label, `missing label for ${id}`);
	return textContent(label[1] ?? '');
}

const BEA = '00000000-0000-4000-8000-000000000002';

test('the host filter select is named Host', () => {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=services`);
	const html = decode(
		render(ServicesSection, {
			props: {
				projectId: PROJECT.id,
				projectName: 'Lab',
				hosts: [],
				canAdmin: false,
				rows: [],
				total: 0,
				prevCursor: null,
				nextCursor: null,
				omitted: 0,
				message: null,
				probe: null,
				probeServiceId: null,
				renameServiceId: null,
				typedName: null
			}
		}).body
	);
	assert.equal(accessibleName(html, 'services-host'), 'Host');
});

test('member selects expose their visible labels', () => {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=members`);
	const members: Member[] = [
		{ user_id: USER.id, email: USER.email, name: USER.name, role: 'owner', created_at: '2026-10-13T00:00:00Z' },
		{ user_id: BEA, email: 'bea@example.com', name: 'Bea', role: 'admin', created_at: '2026-10-13T00:00:00Z' }
	];
	const html = decode(
		render(MembersSection, {
			props: {
				members,
				omitted: 0,
				truncated: false,
				canAdmin: true,
				canOwner: true,
				currentUserId: USER.id,
				message: null
			}
		}).body
	);
	assert.equal(accessibleName(html, `member-role-${BEA}`), 'Role for bea@example.com');
	// The add form is in the closed Add member dialog; its select is checked on the form itself.
	assert.equal(html.includes('id="member-role"'), false);
	const addForm = decode(render(AddMemberForm, { props: { action: '?/addMember', onAdded: () => {}, onSettled: () => {} } }).body);
	assert.equal(accessibleName(addForm, 'member-role'), 'Role');
	assert.equal(accessibleName(html, 'new-owner'), 'New owner');
});
