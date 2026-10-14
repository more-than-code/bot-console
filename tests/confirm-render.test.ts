import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render } from 'svelte/server';
import ConfirmAction from '../src/lib/components/ConfirmAction.svelte';
import SettingsSection from '../src/routes/projects/[id]/SettingsSection.svelte';
import { PROJECT } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

function decode(value: string): string {
	return value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
}

function hrefs(html: string): string[] {
	return [...html.matchAll(/\shref="([^"]*)"/g)].map((match) => decode(match[1] ?? ''));
}

function inputTags(html: string): string[] {
	return [...html.matchAll(/<input\b[^>]*>/g)].map((match) => match[0]);
}

function attr(tag: string, name: string): string | null {
	const found = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
	return found ? decode(found[1] ?? '') : null;
}

const hidden = [{ name: 'host_id', value: '00000000-0000-4000-8000-0000000000aa' }];

test('a closed confirm action is only the trigger link', () => {
	setPageUrl('http://console.example/projects/1?tab=hosts&hosts.q=pi');
	const { body } = render(ConfirmAction, {
		props: {
			id: 'revoke-host-1',
			action: '?tab=hosts&hosts.q=pi&/revokeCredential',
			label: 'Revoke credential',
			confirmLabel: 'Revoke credential',
			message: 'Revoke the credential?',
			hidden
		}
	});
	assert.equal(body.includes('<form'), false);
	assert.deepEqual(hrefs(body), ['/projects/1?tab=hosts&hosts.q=pi&confirm=revoke-host-1']);
	const link = new URL(hrefs(body)[0] ?? '', 'http://console.example');
	assert.equal(link.searchParams.get('tab'), 'hosts');
	assert.equal(link.searchParams.get('hosts.q'), 'pi');
	assert.equal(link.searchParams.get('confirm'), 'revoke-host-1');
});

test('an open confirm action posts the hidden fields', () => {
	setPageUrl('http://console.example/projects/1?tab=hosts&hosts.q=pi&confirm=revoke-host-1');
	const action = '?tab=hosts&hosts.q=pi&/revokeCredential';
	const { body } = render(ConfirmAction, {
		props: {
			id: 'revoke-host-1',
			action,
			label: 'Revoke credential',
			confirmLabel: 'Revoke credential',
			message: 'Revoke the credential?',
			hidden
		}
	});
	const form = body.match(/<form\b[^>]*>/);
	assert.ok(form);
	assert.equal(attr(form[0], 'method'), 'POST');
	assert.equal(attr(form[0], 'action'), action);
	const fields = inputTags(body);
	assert.equal(fields.length, 1);
	assert.equal(attr(fields[0] ?? '', 'type'), 'hidden');
	assert.equal(attr(fields[0] ?? '', 'name'), 'host_id');
	assert.equal(attr(fields[0] ?? '', 'value'), hidden[0]?.value);
	assert.equal(body.includes('class="button danger"'), false);
});

test('type-to-confirm renders an empty confirm input', () => {
	setPageUrl('http://console.example/projects/1?tab=settings&confirm=delete-project');
	const { body } = render(ConfirmAction, {
		props: {
			id: 'delete-project',
			action: '?tab=settings&/deleteProject',
			label: 'Delete project',
			confirmLabel: 'Delete project',
			message: 'Delete Lab?',
			typeToConfirm: { name: 'confirm', expected: 'Lab', label: 'Type Lab to confirm' }
		}
	});
	const confirm = inputTags(body).find((tag) => attr(tag, 'name') === 'confirm');
	assert.ok(confirm);
	assert.equal(attr(confirm, 'value'), '');
	assert.equal(confirm.includes('value="Lab"'), false);
	assert.equal(body.includes('type="hidden"'), false);
});

test('settings delete does not submit the project name', () => {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=settings&confirm=delete-project`);
	const { body } = render(SettingsSection, {
		props: { project: PROJECT, canOwner: true, message: null }
	});
	const inputs = inputTags(body);
	const confirm = inputs.find((tag) => attr(tag, 'name') === 'confirm');
	assert.ok(confirm);
	assert.equal(attr(confirm, 'value'), '');
	assert.equal(
		inputs.some((tag) => attr(tag, 'type') === 'hidden' && attr(tag, 'value') === PROJECT.name),
		false
	);
	// The rename field is the name being edited. Nothing else may carry it as a value.
	assert.deepEqual(
		inputs.filter((tag) => attr(tag, 'value') === PROJECT.name).map((tag) => attr(tag, 'name')),
		['name']
	);
});
