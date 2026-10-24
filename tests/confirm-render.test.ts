import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render } from 'svelte/server';
import ConfirmForm from '../src/lib/components/ConfirmForm.svelte';
import SettingsSection from '../src/routes/projects/[id]/SettingsSection.svelte';
import { confirmIsDestructive, confirmSubmitDisabled, typeToConfirmMatches } from '../src/lib/confirm.ts';
import { readFileSync } from 'node:fs';
import { PROJECT } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

function decode(value: string): string {
	return value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
}

function inputTags(html: string): string[] {
	return [...html.matchAll(/<input\b[^>]*>/g)].map((match) => match[0]);
}

function buttonTags(html: string): string[] {
	return [...html.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);
}

function attr(tag: string, name: string): string | null {
	const found = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
	return found ? decode(found[1] ?? '') : null;
}

function disabled(tag: string): boolean {
	return /(?:^|\s)disabled(?:="[^"]*"|=""|[\s>]|$)/.test(tag);
}

const hidden = [{ name: 'host_id', value: '00000000-0000-4000-8000-0000000000aa' }];

test('the confirm dialog posts the hidden fields', () => {
	setPageUrl('http://console.example/projects/1?tab=hosts&hosts.q=pi');
	const action = '?tab=hosts&hosts.q=pi&/revokeCredential';
	const body = decode(
		render(ConfirmForm, {
			props: {
				id: 'revoke-host-1',
				action,
				confirmLabel: 'Revoke credential',
				hidden
			}
		}).body
	);
	assert.equal(body.includes('confirm='), false);
	assert.match(body, />Revoke credential</);
	const form = body.match(/<form\b[^>]*>/);
	assert.ok(form);
	assert.equal(attr(form[0], 'method'), 'POST');
	assert.equal(attr(form[0], 'action'), action);
	const fields = inputTags(body);
	assert.equal(fields.length, 1);
	assert.equal(attr(fields[0] ?? '', 'type'), 'hidden');
	assert.equal(attr(fields[0] ?? '', 'name'), 'host_id');
	assert.equal(attr(fields[0] ?? '', 'value'), hidden[0]?.value);
});

test('type-to-confirm stays disabled until the text matches', () => {
	assert.equal(typeToConfirmMatches('', 'Lab'), false);
	assert.equal(typeToConfirmMatches('Lab', 'Lab'), true);
	assert.equal(typeToConfirmMatches('lab', 'Lab'), false);
	const cases = [
		{ typed: '', disabled: true },
		{ typed: 'nope', disabled: true },
		{ typed: 'lab', disabled: true },
		{ typed: 'Lab', disabled: false }
	] as const;
	for (const item of cases) {
		assert.equal(confirmSubmitDisabled(item.typed, 'Lab'), item.disabled);
		assert.equal(confirmSubmitDisabled(item.typed, null), false);
		setPageUrl('http://console.example/projects/1?tab=settings');
		const body = decode(
			render(ConfirmForm, {
				props: {
					id: 'delete-project',
					action: '?tab=settings&/deleteProject',
					confirmLabel: 'Delete project',
					typeToConfirm: { name: 'confirm', expected: 'Lab', label: 'Type Lab to confirm' },
					typed: item.typed
				}
			}).body
		);
		const confirm = inputTags(body).find((tag) => attr(tag, 'name') === 'confirm');
		assert.ok(confirm);
		assert.equal(attr(confirm, 'value'), item.typed);
		assert.equal(confirm.includes('value="Lab"') && item.typed !== 'Lab', false);
		assert.equal(body.includes('type="hidden"'), false);
		const submit = buttonTags(body).find((tag) => attr(tag, 'type') === 'submit');
		assert.ok(submit);
		assert.equal(disabled(submit), item.disabled);
	}
});

test('settings delete does not submit the project name', () => {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=settings`);
	const page = decode(
		render(SettingsSection, {
			props: { project: PROJECT, canOwner: true, message: null }
		}).body
	);
	assert.equal(
		inputTags(page).some((tag) => attr(tag, 'type') === 'hidden' && attr(tag, 'value') === PROJECT.name),
		false
	);
	assert.deepEqual(
		inputTags(page)
			.filter((tag) => attr(tag, 'value') === PROJECT.name)
			.map((tag) => attr(tag, 'name')),
		['name']
	);

	const body = decode(
		render(ConfirmForm, {
			props: {
				id: 'delete-project',
				action: '?tab=settings&/deleteProject',
				confirmLabel: 'Delete project',
				typeToConfirm: { name: 'confirm', expected: PROJECT.name, label: `Type ${PROJECT.name} to confirm` }
			}
		}).body
	);
	const inputs = inputTags(body);
	const confirm = inputs.find((tag) => attr(tag, 'name') === 'confirm');
	assert.ok(confirm);
	assert.equal(attr(confirm, 'value'), '');
	assert.equal(
		inputs.some((tag) => attr(tag, 'type') === 'hidden' && attr(tag, 'value') === PROJECT.name),
		false
	);
});

test('Make secret confirms with the default button; Delete, Remove and Revoke stay destructive', () => {
	for (const label of ['Delete', 'Delete DB_URL', 'Delete project', 'Remove', 'Revoke', 'Revoke credential']) {
		assert.equal(confirmIsDestructive(label), true, label);
	}
	assert.equal(confirmIsDestructive('Make secret'), false);
	setPageUrl('http://console.example/projects/1?tab=settings');
	const submitOf = (destructive: boolean | undefined) => {
		const body = decode(
			render(ConfirmForm, {
				props: { id: 'x', action: '?/makeEnvKeysSecret', confirmLabel: 'Make secret', ...(destructive === undefined ? {} : { destructive }) }
			}).body
		);
		const submit = buttonTags(body).find((tag) => attr(tag, 'type') === 'submit');
		assert.ok(submit);
		return attr(submit, 'class') ?? '';
	};
	const neutral = submitOf(false);
	assert.equal(neutral.includes('destructive/10'), false);
	assert.equal(neutral.includes('text-destructive'), false);
	assert.match(neutral, /\bbg-primary\b/);
	// Without the prop (and with true) the confirm stays destructive, as for Delete.
	for (const value of [undefined, true]) {
		const red = submitOf(value);
		assert.match(red, /bg-destructive\/10/);
		assert.match(red, /\btext-destructive\b/);
	}
	// ConfirmAction derives it from its label and passes it to the form.
	const action = readFileSync(new URL('../src/lib/components/ConfirmAction.svelte', import.meta.url), 'utf8');
	assert.match(action, /const destructive = \$derived\(confirmIsDestructive\(label\)\);/);
	assert.match(action, /<ConfirmForm [^>]*\{destructive\}/);
	// The Make secret row action's label is the fixed "Make secret"; key Delete is "Delete {key}".
	const table = readFileSync(new URL('../src/routes/projects/[id]/EnvSetTable.svelte', import.meta.url), 'utf8');
	const makeSecret = table.match(/<ConfirmAction\s+id=\{domId\('make-secret', item\.key\)\}[^]*?\/>/)?.[0] ?? '';
	assert.match(makeSecret, /\slabel="Make secret"\s/);
	const keyDelete = table.match(/<ConfirmAction\s+id=\{domId\('delete', item\.key\)\}[^]*?\/>/)?.[0] ?? '';
	assert.match(keyDelete, /\slabel="Delete \{item\.key\}"\s/);
});
