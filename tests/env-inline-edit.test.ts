import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { isActionFailure, isRedirect } from '@sveltejs/kit';
import { render } from 'svelte/server';
import type { EnvSet } from '../src/lib/api-types.ts';
import EnvSetTable from '../src/routes/projects/[id]/EnvSetTable.svelte';
import EnvValueEditor from '../src/routes/projects/[id]/EnvValueEditor.svelte';
import {
	ADD_KEY_MESSAGE,
	addErrorText,
	addFailed,
	addKeyError,
	addKeyRefused,
	addValueTyped,
	initialAddDraft,
	settleAdd
} from '../src/routes/projects/[id]/env-add-variable.ts';
import {
	EMPTY_SECRET_MESSAGE,
	RETYPE_VALUE,
	editValueField,
	envDomId,
	failureMessage,
	focusAfterEditSave,
	focusIsFree,
	isCancelKey,
	rowEditErrorText,
	rowEditFailed,
	secretEditRefusal
} from '../src/routes/projects/[id]/env-set-panel.ts';
import { actions as projectActions } from '../src/routes/projects/[id]/+page.server.ts';
import { envelope, fakeEvent, installFetch, PROJECT, restoreEnv, TOKEN, useApi, USER } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

const SECRET = 'stored-secret-value-42';
const TYPED = 'typed-secret-value-43';
const PLAIN = 'visible-plain-value-44';

const SET: EnvSet = {
	name: 'app',
	keys: [
		{ key: 'API_TOKEN', is_secret: true, value: null, preview: 'api.…' },
		{ key: 'DB_URL', is_secret: false, value: PLAIN, preview: null }
	],
	updated_at: '2026-10-25T10:00:00Z',
	updated_by: USER.id
};

const TABLE_PROPS = {
	putAction: '?/putEnvKey',
	deleteAction: '?/deleteEnvKey',
	deleteSetAction: '?/deleteEnvSet',
	makeSecretAction: '?/makeEnvKeysSecret'
};

function source(name: string): string {
	return readFileSync(new URL(`../src/routes/projects/[id]/${name}`, import.meta.url), 'utf8');
}

function editor(item: EnvSet['keys'][number], error = '', draft = '') {
	return render(EnvValueEditor, {
		props: {
			item,
			inputId: envDomId('app', 'value', item.key),
			errorId: envDomId('app', 'value-error', item.key),
			formId: envDomId('app', 'edit-form', item.key),
			error,
			draft,
			onInput: () => {}
		}
	}).body;
}

function inputTag(html: string): string {
	return html.match(/<input\b[^>]*>/)?.[0] ?? '';
}

/** The Actions cell markup while the row is in edit state. */
function editBlock(table: string): string {
	const at = table.indexOf('{#if editingRow}\n\t\t\t\t\t\t\t<form');
	assert.ok(at > 0, 'no edit block in the Actions cell');
	return table.slice(at, table.indexOf('{:else}', at));
}

describe('env-set inline edit and Add variable dialog', () => {
	before(() => useApi('https://api.example'));
	after(() => restoreEnv());

	test('the panel has no New value bar and no inline add form', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=settings`);
		const html = render(EnvSetTable, { props: { set: SET, ...TABLE_PROPS } }).body;
		assert.equal(html.includes('New value'), false);
		assert.equal(html.includes('name="op"'), false);
		assert.equal(html.includes('<form'), false);
		assert.equal(html.includes('<input'), false);
		assert.equal(source('EnvSetTable.svelte').includes('New value'), false);
	});

	test('a secret value injected into a secret row never reaches the table HTML', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=settings`);
		const leaky: EnvSet = { ...SET, keys: [{ ...SET.keys[0]!, value: SECRET }, SET.keys[1]!] };
		const html = render(EnvSetTable, { props: { set: leaky, ...TABLE_PROPS } }).body;
		assert.equal(html.includes(SECRET), false);
		assert.equal(html.includes('api.…'), true);
		assert.equal(html.includes(PLAIN), true);
	});

	test('Add variable is a dialog trigger titled for the set', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=settings`);
		const html = render(EnvSetTable, { props: { set: SET, ...TABLE_PROPS } }).body;
		const tag = html.match(/<button\b[^>]*id="env-add-variable-app"[^>]*>/)?.[0] ?? '';
		assert.match(tag, /aria-haspopup="dialog"/);
		assert.match(tag, /aria-expanded="false"/);
		assert.match(tag, /aria-label="Add variable to app"/);
		const dialog = source('EnvAddVariableDialog.svelte');
		assert.match(dialog, /<Dialog\.Title[^>]*>Add variable to \{setName\}<\/Dialog\.Title>/);
		assert.match(dialog, /name="key"[\s\S]*?required[\s\S]*?maxlength=\{64\}[\s\S]*?autocomplete="off"[\s\S]*?spellcheck="false"/);
		assert.match(dialog, /<Button type="submit">Add<\/Button>/);
		assert.match(dialog, /<Dialog\.Close [^>]*>Cancel<\/Dialog\.Close>/);
	});

	test('the dialog resets its draft on close, shows the paste-again hint, and links its fields', () => {
		const dialog = source('EnvAddVariableDialog.svelte');
		assert.match(dialog, /function onOpenChange\(next: boolean\) \{\s*if \(!next\) draft = initialAddDraft\(\);\s*\}/);
		assert.match(dialog, /<Notice kind="error">\{addErrorText\(draft\)\}<\/Notice>/);
		// Key is marked invalid only for a key error; Value always points at the error.
		assert.match(dialog, /aria-invalid=\{keyError \? true : undefined\}\s*aria-describedby=\{keyError \? id\('add-error'\) : undefined\}/);
		assert.match(dialog, /aria-describedby=\{draft\.error \? id\('add-error'\) : undefined\}/);
		assert.match(dialog, /oninput=\{\(\) => \(draft = addValueTyped\(draft\)\)\}/);
		// Close focus: preventDefault always; the trigger is focused explicitly unless a success is closing it.
		const close = dialog.slice(dialog.indexOf('function onCloseAutoFocus'), dialog.indexOf('async function showError'));
		assert.match(close, /event\.preventDefault\(\);\s*if \(closingAfterAdd\) \{\s*closingAfterAdd = false;\s*return;\s*\}\s*focusById\(id\('add-variable'\)\)/);

		const failed = addFailed({ ...initialAddDraft(), key: 'TOKEN', value: TYPED }, 'refused [redacted]');
		assert.equal(addErrorText(failed), `refused [redacted] ${RETYPE_VALUE}`);
		assert.equal(addErrorText(addValueTyped(failed)), 'refused [redacted]');
		assert.equal(addErrorText(initialAddDraft()), '');
	});

	test('a failed add keeps the key, clears a secret value and asks for it again', () => {
		const secret = addFailed({ ...initialAddDraft(), key: 'TOKEN', value: TYPED }, 'refused [redacted]');
		assert.deepEqual(secret, { key: 'TOKEN', value: '', secret: true, error: 'refused [redacted]', errorField: 'form', retype: true });
		const plain = addFailed({ ...initialAddDraft(), key: 'LOG', value: 'debug', secret: false }, 'refused');
		assert.deepEqual(plain, { key: 'LOG', value: 'debug', secret: false, error: 'refused', errorField: 'form', retype: false });
		assert.equal(addFailed({ ...initialAddDraft(), key: 'TOKEN' }, 'bad key').retype, false);
		assert.equal(addKeyError('API_TOKEN'), null);
		assert.equal(addKeyError('bad key'), ADD_KEY_MESSAGE);
		assert.equal(addKeyError(''), ADD_KEY_MESSAGE);
		// A Key refused before sending keeps the typed secret value: nothing was sent.
		const typed = { ...initialAddDraft(), key: 'bad key', value: TYPED, retype: true };
		assert.deepEqual(addKeyRefused(typed, ADD_KEY_MESSAGE), {
			key: 'bad key',
			value: TYPED,
			secret: true,
			error: ADD_KEY_MESSAGE,
			errorField: 'key',
			retype: false
		});
		const dialog = source('EnvAddVariableDialog.svelte');
		assert.match(dialog, /draft = addKeyRefused\(draft, invalid\)/);
		assert.equal(dialog.includes("addFailed(draft, invalid"), false);
		assert.equal(failureMessage({ type: 'failure', data: { message: 'bad key' } }), 'bad key');
		assert.equal(failureMessage({ type: 'failure', data: {} }), 'The value could not be saved.');
		assert.equal(failureMessage({ type: 'failure' }), 'The value could not be saved.');
	});

	test('settleAdd closes, waits for the reload, then focuses the status line; a late failure is ignored', async () => {
		const run = async (open: boolean, type: string) => {
			const calls: string[] = [];
			const outcome = await settleAdd(open, type, {
				added: () => void calls.push('added'),
				close: () => void calls.push('close'),
				failed: () => void calls.push('failed'),
				update: async () => void calls.push('update'),
				tick: async () => void calls.push('tick'),
				focusStatus: () => void calls.push('focus')
			});
			return { outcome, calls };
		};
		assert.deepEqual(await run(true, 'redirect'), { outcome: 'added', calls: ['added', 'close', 'update', 'tick', 'focus'] });
		// Dismissed while the request ran: the note is set and the page reloads, but focus stays where it is.
		assert.deepEqual(await run(false, 'redirect'), { outcome: 'added', calls: ['added', 'close', 'update'] });
		assert.deepEqual(await run(true, 'failure'), { outcome: 'failed', calls: ['failed'] });
		assert.deepEqual(await run(false, 'failure'), { outcome: 'ignored', calls: [] });
		assert.deepEqual(await run(true, 'error'), { outcome: 'other', calls: ['update'] });
		const dialog = source('EnvAddVariableDialog.svelte');
		assert.match(dialog, /await settleAdd\(open, result\.type,/);
	});

	test('a plain row in edit state renders a pre-filled, wide text input', () => {
		const item = SET.keys[1]!;
		const input = inputTag(editor(item, '', editValueField(item).value));
		assert.match(input, /type="text"/);
		assert.match(input, new RegExp(`value="${PLAIN}"`));
		assert.match(input, /id="env-value-app-DB_URL"/);
		assert.match(input, /form="env-edit-form-app-DB_URL"/);
		assert.match(input, /name="value"/);
		assert.match(input, /class="[^"]*\bmin-w-48\b[^"]*"/);
		assert.equal(input.includes('aria-describedby'), false);
	});

	test('a secret row in edit state renders an empty password input with the preview placeholder', () => {
		const item = SET.keys[0]!;
		// Even a value that slipped into the item is never rendered.
		const html = editor({ ...item, value: SECRET });
		const input = inputTag(html);
		assert.match(input, /type="password"/);
		assert.match(input, /placeholder="api\.…"/);
		assert.match(input, /autocomplete="new-password"/);
		assert.match(input, /class="[^"]*\bmin-w-48\b[^"]*"/);
		assert.equal(/\svalue="[^"]+"/.test(input), false);
		assert.equal(html.includes(SECRET), false);
		assert.deepEqual(editValueField({ ...item, value: SECRET }), { value: '', placeholder: 'api.…' });
	});

	test('a row error is an alert (Notice) under the input, linked by aria-describedby', () => {
		const edit = rowEditFailed({ key: 'API_TOKEN', error: '', retype: false }, 'API_TOKEN', 'too long', true);
		const html = editor(SET.keys[0]!, rowEditErrorText(edit));
		const input = inputTag(html);
		assert.match(input, /aria-describedby="env-value-error-app-API_TOKEN"/);
		assert.match(input, /aria-invalid="true"/);
		assert.match(html, /<div id="env-value-error-app-API_TOKEN"[^>]*><div data-slot="alert" role="alert"[\s\S]*?too long Paste the value again\./);
		// The editor clears the error on input; the table wires that to clearRowError.
		assert.equal(source('EnvValueEditor.svelte').match(/oninput=\{onInput\}/g)?.length, 2);
		assert.match(source('EnvSetTable.svelte'), /onInput=\{clearRowError\}/);
	});

	test('row edit state: one row, stale results ignored, retype as a flag', () => {
		const second = { key: 'API_TOKEN', error: '', retype: false };
		assert.deepEqual(rowEditFailed(second, 'API_TOKEN', 'refused', true), { key: 'API_TOKEN', error: 'refused', retype: true });
		// A late result for a row no longer in edit state changes nothing.
		assert.deepEqual(rowEditFailed(second, 'DB_URL', 'refused', false), second);
		assert.equal(rowEditFailed(null, 'DB_URL', 'refused', false), null);
		assert.equal(rowEditErrorText(null), '');
		assert.equal(rowEditErrorText({ key: 'A', error: 'refused', retype: false }), 'refused');
		assert.equal(rowEditErrorText({ key: 'A', error: 'refused', retype: true }), `refused ${RETYPE_VALUE}`);

		const table = source('EnvSetTable.svelte');
		// T3: one edit state for the table.
		assert.equal(table.match(/\$state<RowEdit>/g)?.length, 1);
		assert.match(table, /let edit = \$state<RowEdit>\(null\)/);
		assert.match(table, /\{@const editingRow = edit\?\.key === item\.key\}/);
		// T2: Edit replaces any other row and seeds the plain draft from the item.
		const start = table.slice(table.indexOf('async function startEdit'), table.indexOf('async function cancelEdit'));
		assert.match(start, /edit = \{ key: item\.key, error: '', retype: false \}/);
		assert.match(start, /plainDraft = editValueField\(item\)\.value/);
		assert.match(start, /focusById\(domId\('value', item\.key\)\)/);
	});

	test('Escape anywhere in the editing row cancels; focus returns to Edit, and a save focuses after the reload', () => {
		assert.equal(isCancelKey({ key: 'Escape' }), true);
		assert.equal(isCancelKey({ key: 'Enter' }), false);
		assert.equal(isCancelKey({ key: 'Esc' }), false);
		const table = source('EnvSetTable.svelte');
		assert.match(table, /<Table\.Row onkeydown=\{editingRow \? onRowKeydown\(item\.key\) : undefined\}>/);
		assert.equal(source('EnvValueEditor.svelte').includes('onkeydown'), false);
		// T1: cancel focuses the row's Edit button.
		const cancel = table.slice(table.indexOf('async function cancelEdit'), table.indexOf('function onRowKeydown'));
		assert.match(cancel, /edit = null;[\s\S]*await tick\(\);\s*focusById\(domId\('edit', key\)\)/);
		// Save: the edit state ends only after the reload (no flash of the old value), then focus moves.
		const save = table.slice(table.indexOf('function saveEdit'));
		const updateAt = save.indexOf('// Leave edit state');
		assert.ok(updateAt > 0);
		assert.match(save.slice(updateAt), /await update\(\);[\s\S]*?const free = [^\n]*\n\s*if \(edit\?\.key === item\.key\) \{\s*edit = null;/);
		assert.match(save.slice(updateAt), /await tick\(\);\s*if \(free\) focusById\(focusAfterEditSave\(set\.name, set\.keys\.map\(\(row\) => row\.key\), item\.key\)\)/);
		assert.match(save, /statusNote = `Saved \$\{item\.key\}\.`/);
		assert.equal(focusAfterEditSave('app', ['API_TOKEN', 'DB_URL'], 'DB_URL'), 'env-edit-app-DB_URL');
		assert.equal(focusAfterEditSave('app', ['API_TOKEN'], 'DB_URL'), 'env-status-app');
	});

	test('a late save result moves focus only from body or from inside the saved row', () => {
		const body = { name: 'body' };
		const inRow = { name: 'save' };
		const elsewhere = { name: 'other' };
		const row = { contains: (node: never) => (node as unknown) === inRow };
		assert.equal(focusIsFree(null, body, row), true);
		assert.equal(focusIsFree(body, body, row), true);
		assert.equal(focusIsFree(inRow, body, row), true);
		assert.equal(focusIsFree(elsewhere, body, row), false);
		assert.equal(focusIsFree(elsewhere, body, null), false);
		const table = source('EnvSetTable.svelte');
		const save = table.slice(table.indexOf('// Leave edit state'));
		assert.match(save, /const savedRow = formElement\.closest\('tr'\);\s*await update\(\);/);
		assert.match(save, /const free = focusIsFree\(document\.activeElement, document\.body, savedRow\);/);
		assert.match(save, /if \(free\) focusById\(focusAfterEditSave\(/);
	});

	test('while a row is edited its Actions cell has only Save and Cancel', () => {
		const block = editBlock(source('EnvSetTable.svelte'));
		assert.match(block, /<form\s+id=\{domId\('edit-form', item\.key\)\}/);
		assert.match(block, /<Button type="submit" size="sm" aria-label="Save \{item\.key\}">Save<\/Button>/);
		assert.match(block, /aria-label="Cancel editing \{item\.key\}" onclick=\{\(\) => cancelEdit\(item\.key\)\}>Cancel<\/Button>/);
		assert.equal(block.includes('CopyButton'), false);
		assert.equal(block.includes('ConfirmAction'), false);
		assert.equal(block.includes('Make'), false);
		assert.equal(block.includes('Delete'), false);
		assert.equal(block.match(/<Button\b/g)?.length, 2);
	});

	test('an empty secret inline save is refused locally; a plain key may be saved empty', () => {
		const secret = SET.keys[0]!;
		const plain = SET.keys[1]!;
		assert.equal(secretEditRefusal(secret, ''), EMPTY_SECRET_MESSAGE);
		assert.equal(EMPTY_SECRET_MESSAGE, 'Enter a new value, or Cancel to keep the current one.');
		assert.equal(secretEditRefusal(secret, TYPED), null);
		assert.equal(secretEditRefusal(plain, ''), null);
		// The refusal is not followed by the retype hint.
		const refused = rowEditFailed({ key: secret.key, error: '', retype: false }, secret.key, EMPTY_SECRET_MESSAGE, false);
		const html = editor(secret, rowEditErrorText(refused));
		assert.match(inputTag(html), /aria-describedby="env-value-error-app-API_TOKEN"/);
		assert.match(html, /<div id="env-value-error-app-API_TOKEN"[^>]*><div data-slot="alert" role="alert"[\s\S]*?Enter a new value, or Cancel to keep the current one\./);
		assert.equal(html.includes(RETYPE_VALUE), false);
		// The table cancels the submit before putEnvKey is called and keeps the row in edit state.
		const table = source('EnvSetTable.svelte');
		const guard = table.slice(table.indexOf('function saveEdit'), table.indexOf("statusNote = '';", table.indexOf('function saveEdit')));
		assert.match(guard, /secretEditRefusal\(item, String\(formData\.get\('value'\) \?\? ''\)\)/);
		assert.match(guard, /cancel\(\);\s*void showRowError\(item\.key, refused, false\)/);
	});

	test('putEnvKey add and edit paths are unchanged, and failures never include the value', async () => {
		const base = { session: TOKEN, user: USER, projects: [PROJECT], params: { id: PROJECT.id } };
		const url = `http://console.example/projects/${PROJECT.id}?tab=settings&/putEnvKey`;
		const calls = installFetch(() => envelope({}));
		await assert.rejects(
			async () => {
				await projectActions.putEnvKey(fakeEvent({ ...base, url, form: { set: 'app', key: 'NEW_KEY', value: TYPED, op: 'add', is_secret: '1' } }).event as never);
			},
			(err: unknown) => isRedirect(err) && err.status === 303
		);
		assert.deepEqual(JSON.parse(calls[0]?.body ?? '{}'), { value: TYPED, is_secret: true });
		await assert.rejects(
			async () => {
				await projectActions.putEnvKey(fakeEvent({ ...base, url, form: { set: 'app', key: 'API_TOKEN', value: TYPED } }).event as never);
			},
			(err: unknown) => isRedirect(err) && err.status === 303
		);
		assert.deepEqual(JSON.parse(calls[1]?.body ?? '{}'), { value: TYPED });

		installFetch(() => envelope(null, 409, 'conflict', `key exists: ${TYPED}`));
		for (const form of [
			{ set: 'app', key: 'NEW_KEY', value: TYPED, op: 'add', is_secret: '1' },
			{ set: 'app', key: 'API_TOKEN', value: TYPED }
		] as Array<Record<string, string>>) {
			const failed = await projectActions.putEnvKey(fakeEvent({ ...base, url, form }).event as never);
			assert.equal(isActionFailure(failed), true);
			assert.equal(JSON.stringify(failed).includes(TYPED), false);
			if (isActionFailure(failed)) assert.equal((failed.data as unknown as { message?: string }).message?.includes('[redacted]'), true);
		}
		const local = await projectActions.putEnvKey(fakeEvent({ ...base, url, form: { set: 'app', key: 'NEW_KEY', value: `a\n${TYPED}`, op: 'add' } }).event as never);
		assert.equal(isActionFailure(local), true);
		assert.equal(JSON.stringify(local).includes(TYPED), false);
		const badKey = await projectActions.putEnvKey(fakeEvent({ ...base, url, form: { set: 'app', key: 'bad key', value: TYPED, op: 'add' } }).event as never);
		assert.equal(isActionFailure(badKey) && (badKey.data as unknown as { message?: string }).message, 'That env set key is not valid.');
	});
});
