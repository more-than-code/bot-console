import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { isActionFailure, isRedirect } from '@sveltejs/kit';
import { render } from 'svelte/server';
import type { EnvSet } from '../src/lib/api-types.ts';
import SettingsSection from '../src/routes/projects/[id]/SettingsSection.svelte';
import { failureMessage, savedVariablesNote } from '../src/routes/projects/[id]/env-set-panel.ts';
import { addTabFailed, closeAddVariables, initialAddDraft, initialAddVariables, pasteTabFailed, settleMerge, switchAddTab } from '../src/routes/projects/[id]/env-add-variable.ts';
import { actions as projectActions } from '../src/routes/projects/[id]/+page.server.ts';
import { envelope, fakeEvent, installFetch, PROJECT, restoreEnv, TOKEN, useApi, USER } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

const SECRET = 'merge-secret-value-41';
const PLAIN = 'merge-plain-value-41';

type SettingsData = { scope?: string; message?: string; settingsField?: string | null; settingsName?: string | null };

function actionData(result: unknown): SettingsData {
	assert.equal(isActionFailure(result), true);
	if (!isActionFailure(result)) return {};
	return result.data as unknown as SettingsData;
}

async function expectRedirect(run: () => unknown) {
	await assert.rejects(
		async () => {
			await run();
		},
		(err: unknown) => isRedirect(err) && err.status === 303
	);
}

function source(name: string): string {
	return readFileSync(new URL(`../src/routes/projects/[id]/${name}`, import.meta.url), 'utf8');
}

function decode(value: string): string {
	return value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
}

const SETS: EnvSet[] = ['app', 'web'].map((name) => ({
	name,
	keys: [{ key: 'LOG_LEVEL', is_secret: false, value: 'info', preview: null }],
	updated_at: '2026-10-26T10:00:00Z',
	updated_by: USER.id
}));

describe('Env set paste modes (api-v1 v1.19)', () => {
	before(() => useApi('https://api.example'));
	after(() => restoreEnv());

	const base = { session: TOKEN, user: USER, projects: [PROJECT], params: { id: PROJECT.id } };
	const run = (action: 'saveEnvSet' | 'mergeEnvSet', form: Record<string, string>) =>
		projectActions[action](
			fakeEvent({ ...base, url: `http://console.example/projects/${PROJECT.id}?tab=settings&/${action}`, form }).event as never
		);
	const paste = `LOG_LEVEL=${PLAIN}\nAPI_TOKEN=${SECRET}`;

	test('Add env set sends mode create', async () => {
		const calls = installFetch(() => envelope({}));
		await expectRedirect(() => run('saveEnvSet', { set: 'app', dotenv: paste, new_keys_secret: '0' }));
		assert.equal(calls[0]?.method, 'PUT');
		assert.equal(calls[0]?.url.pathname, `/v1/projects/${PROJECT.id}/env-sets/app`);
		assert.deepEqual(JSON.parse(calls[0]?.body ?? '{}'), { dotenv: paste, new_keys_secret: false, mode: 'create' });
	});

	test('Add env set on an existing name shows the conflict in its dialog', async () => {
		installFetch(() => envelope(null, 409, 'conflict', `env set app already exists ${SECRET}`));
		const result = await run('saveEnvSet', { set: 'app', dotenv: paste });
		const data = actionData(result);
		assert.equal(isActionFailure(result) && result.status, 409);
		assert.equal(data.message, 'An env set named app already exists. Use Add variables on that set.');
		assert.equal(data.settingsField, 'dotenv');
		assert.equal(JSON.stringify(result).includes(SECRET), false);
		assert.equal(JSON.stringify(result).includes(PLAIN), false);
	});

	test('Add variables sends mode merge and new_keys_secret, then redirects back', async () => {
		const calls = installFetch(() => envelope({}));
		await expectRedirect(() => run('mergeEnvSet', { set: 'app', dotenv: paste, new_keys_secret: '1' }));
		assert.equal(calls.length, 1);
		assert.equal(calls[0]?.method, 'PUT');
		assert.equal(calls[0]?.url.pathname, `/v1/projects/${PROJECT.id}/env-sets/app`);
		assert.equal(calls[0]?.url.search, '');
		assert.deepEqual(JSON.parse(calls[0]?.body ?? '{}'), { dotenv: paste, new_keys_secret: true, mode: 'merge' });
		const plain = installFetch(() => envelope({}));
		await expectRedirect(() => run('mergeEnvSet', { set: 'app', dotenv: 'A=1', new_keys_secret: '0' }));
		assert.deepEqual(JSON.parse(plain[0]?.body ?? '{}'), { dotenv: 'A=1', new_keys_secret: false, mode: 'merge' });
	});

	test('an Add variables failure goes to that set\'s dialog only and never carries a submitted value', async () => {
		for (const [status, code, msg] of [
			[400, 'bad_request', `a secret value cannot be empty; delete the key instead ${SECRET} ${PLAIN}`],
			[404, 'not_found', 'no env set app'],
			[403, 'forbidden', `forbidden ${paste}`]
		] as const) {
			installFetch(() => envelope(null, status, code, msg));
			const result = await run('mergeEnvSet', { set: 'app', dotenv: paste });
			const data = actionData(result);
			assert.equal(isActionFailure(result) && result.status, status);
			assert.equal(data.scope, 'settings');
			assert.equal(data.settingsField, 'merge');
			assert.equal(data.settingsName, 'app');
			assert.equal(data.message?.endsWith('Paste the value again.'), true);
			assert.equal(JSON.stringify(result).includes(SECRET), false);
			assert.equal(JSON.stringify(result).includes(PLAIN), false);
		}
	});

	test('Add variables checks the set name and the paste before calling the API', async () => {
		const calls = installFetch(() => envelope({}));
		const empty = actionData(await run('mergeEnvSet', { set: 'app', dotenv: '' }));
		assert.equal(empty.settingsField, 'merge');
		assert.equal(empty.settingsName, 'app');
		assert.equal(empty.message?.includes('dotenv'), false);
		const big = actionData(await run('mergeEnvSet', { set: 'app', dotenv: `A=${'x'.repeat(256 * 1024)}` }));
		assert.equal(big.settingsField, 'merge');
		const badName = actionData(await run('mergeEnvSet', { set: 'Bad Name', dotenv: 'A=1' }));
		assert.equal(badName.settingsField ?? null, null);
		assert.equal(calls.length, 0);
	});

	test('each set header has one Add variables trigger; a merge failure opens only that set\'s dialog', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=settings`);
		const props = { project: PROJECT, canOwner: true, canAdmin: true, envSets: SETS, registries: [] };
		const idle = decode(render(SettingsSection, { props: { ...props, message: null } }).body);
		for (const name of ['app', 'web']) {
			const triggers = idle.match(new RegExp(`<button\\b[^>]*id="env-add-variables-${name}"[^>]*>`, 'g')) ?? [];
			assert.equal(triggers.length, 1);
			assert.equal(triggers[0]!.includes(`aria-label="Add variables to ${name}"`), true);
			assert.equal(triggers[0]!.includes('aria-expanded="false"'), true);
			// No separate Add variable trigger any more.
			assert.equal(idle.includes(`id="env-add-variable-${name}"`), false);
			assert.equal(idle.includes(`aria-label="Add variable to ${name}"`), false);
			// In the set header, before the set's status line.
			assert.ok(idle.indexOf(`id="env-add-variables-${name}"`) < idle.indexOf(`id="env-status-${name}"`));
		}
		assert.equal(idle.match(/aria-label="Add variables to [a-z]+"/g)?.length, 2);
		assert.match(idle, /id="env-add-variables-app"[^>]*>(?:<!--[^>]*-->|\s)*Add variables(?:<!--[^>]*-->|\s)*<\/button>/);

		const message = 'no env set app Paste the value again.';
		const failed = decode(
			render(SettingsSection, { props: { ...props, message, settingsField: 'merge' as const, settingsName: 'app' } }).body
		);
		const open = (id: string) => (failed.match(new RegExp(`<button\\b[^>]*id="${id}"[^>]*>`))?.[0] ?? '').includes('aria-expanded="true"');
		assert.equal(open('env-add-variables-app'), true);
		assert.equal(open('env-add-variables-web'), false);
		assert.equal(open('new-env-set'), false);
		// Not in the page banner either.
		assert.equal(failed.includes('id="settings-error"'), false);
	});

	test('a viewer sees no Add variables', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=settings`);
		const html = render(SettingsSection, {
			props: { project: { ...PROJECT, role: 'viewer' }, canOwner: false, canAdmin: false, message: null, envSets: SETS, registries: [] }
		}).body;
		assert.equal(html.includes('Add variables'), false);
	});

	test('One variable is the default tab on every open, and close resets the key, the value, the paste and the tab', () => {
		const start = initialAddVariables();
		assert.deepEqual(start, { tab: 'one', draft: initialAddDraft(), paste: '', pasteSecret: false, pasteError: '' });
		const dirty = {
			tab: 'paste' as const,
			draft: { ...initialAddDraft(), key: 'API_TOKEN', value: SECRET, secret: true, error: 'refused', errorField: 'form' as const, retype: true },
			paste,
			pasteSecret: true,
			pasteError: 'no env set app'
		};
		assert.deepEqual(closeAddVariables(dirty), start);
		assert.equal(JSON.stringify(closeAddVariables(dirty)).includes(SECRET), false);
		// Wiring only: opens, closes and a save's close go through closeAddVariables; the tabs follow view.tab.
		const dialog = source('EnvAddVariablesDialog.svelte');
		assert.equal(dialog.match(/view = closeAddVariables\(view\)/g)?.length, 2);
		assert.match(dialog, /<Tabs\.Root bind:value=\{\(\) => view\.tab, \(tab\) => \(view = switchAddTab\(view, tab as AddTab\)\)\}>/);
		assert.match(dialog, /<Tabs\.Trigger value="one"[^>]*>One variable<\/Tabs\.Trigger>/);
		assert.match(dialog, /<Tabs\.Trigger value="paste"[^>]*>Paste several<\/Tabs\.Trigger>/);
	});

	test('a failure lands on its tab, and switching tabs drops both errors but keeps the input', () => {
		const typed = { ...initialAddVariables(), draft: { ...initialAddDraft(), key: 'API_TOKEN', value: SECRET, secret: true }, paste };
		const addFailedView = addTabFailed({ ...typed, tab: 'paste', pasteError: 'old' }, 'key refused');
		assert.equal(addFailedView.tab, 'one');
		assert.equal(addFailedView.draft.error, 'key refused');
		assert.equal(addFailedView.draft.key, 'API_TOKEN');
		// A secret value is asked for again.
		assert.equal(addFailedView.draft.value, '');
		assert.equal(addFailedView.draft.retype, true);
		assert.equal(addFailedView.pasteError, '');
		const pasteFailedView = pasteTabFailed({ ...typed, draft: { ...typed.draft, error: 'old', errorField: 'form' } }, 'no env set app');
		assert.equal(pasteFailedView.tab, 'paste');
		assert.equal(pasteFailedView.pasteError, 'no env set app');
		assert.equal(pasteFailedView.paste, '');
		assert.equal(pasteFailedView.draft.error, '');
		assert.equal(pasteFailedView.draft.key, 'API_TOKEN');

		const toOne = switchAddTab(pasteFailedView, 'one');
		assert.deepEqual(toOne, { ...pasteFailedView, tab: 'one', pasteError: '' });
		const toPaste = switchAddTab({ ...addFailedView, paste: 'A=1' }, 'paste');
		assert.equal(toPaste.tab, 'paste');
		assert.deepEqual(toPaste.draft, { ...addFailedView.draft, error: '', errorField: null, retype: false });
		assert.equal(toPaste.paste, 'A=1');
	});

	test('settleMerge blanks the paste first, closes on a save, and keeps a failure on Paste several', async () => {
		const run = async (open: boolean, type: string) => {
			const calls: string[] = [];
			const outcome = await settleMerge(open, type, {
				clearPaste: () => void calls.push('clear'),
				merged: () => void calls.push('merged'),
				close: () => void calls.push('close'),
				failed: () => void calls.push('failed'),
				update: async () => void calls.push('update'),
				tick: async () => void calls.push('tick'),
				focusStatus: () => void calls.push('focus')
			});
			return { outcome, calls };
		};
		assert.deepEqual(await run(true, 'redirect'), { outcome: 'merged', calls: ['clear', 'merged', 'close', 'update', 'tick', 'focus'] });
		// Dismissed while the request ran: the note is set and the page reloads, but focus stays where it is.
		assert.deepEqual(await run(false, 'redirect'), { outcome: 'merged', calls: ['clear', 'merged', 'close', 'update'] });
		assert.deepEqual(await run(true, 'failure'), { outcome: 'failed', calls: ['clear', 'failed'] });
		assert.deepEqual(await run(false, 'failure'), { outcome: 'ignored', calls: ['clear'] });
		assert.deepEqual(await run(true, 'error'), { outcome: 'other', calls: ['clear', 'update'] });

		// The dialog's failed effect is the Paste several failure with the action's message.
		const failed = pasteTabFailed(initialAddVariables(), failureMessage({ type: 'failure', data: { message: 'no env set app' } }));
		assert.equal(failed.tab, 'paste');
		assert.equal(failed.pasteError, 'no env set app');
		const dialog = source('EnvAddVariablesDialog.svelte');
		assert.match(dialog, /await settleMerge\(open, result\.type,/);
		assert.match(dialog, /view = pasteTabFailed\(view, failureMessage\(result\)\)/);
		assert.match(dialog, /view = addTabFailed\(view, failureMessage\(result\)\)/);
		// A failure in the page's form result (a post without JS) opens the dialog on Paste several.
		assert.match(dialog, /serverFailed \? pasteTabFailed\(initialAddVariables\(\), mergeError \?\? ''\)/);
	});

	test('mergeEnvSet without a session redirects to sign-in and calls no API', async () => {
		const calls = installFetch(() => envelope({}));
		await assert.rejects(
			async () =>
				projectActions.mergeEnvSet(
					fakeEvent({
						url: `http://console.example/projects/${PROJECT.id}?tab=settings&/mergeEnvSet`,
						user: null,
						params: { id: PROJECT.id },
						form: { set: 'app', dotenv: paste }
					}).event as never
				),
			(err: unknown) => isRedirect(err) && err.status === 303 && err.location.includes('signin')
		);
		assert.equal(calls.length, 0);
	});

	test('a CRLF or CR paste, an export prefix and a trailing comment are all redacted', async () => {
		const quoted = 'quoted-secret # not a comment';
		const pasteCr = `export API_TOKEN=${SECRET} # rotate monthly\r\nLOG_LEVEL=${PLAIN}\rQUOTED="${quoted}"`;
		installFetch(() => envelope(null, 400, 'bad_request', `bad line: ${SECRET} then ${PLAIN} then ${quoted}`));
		const result = await run('mergeEnvSet', { set: 'app', dotenv: pasteCr });
		const json = JSON.stringify(result);
		assert.equal(json.includes(SECRET), false);
		assert.equal(json.includes(PLAIN), false);
		assert.equal(json.includes(quoted), false);
		assert.equal(json.includes('[redacted]'), true);
	});

	test('the dialog labels, one submit per tab, and the status lines', () => {
		const dialog = source('EnvAddVariablesDialog.svelte');
		assert.match(dialog, /<Dialog\.Title[^>]*>Add variables to \{setName\}<\/Dialog\.Title>/);
		assert.match(dialog, /Variables \(one KEY=value per line\)/);
		assert.match(
			dialog,
			/Paste the variables, one KEY=value per line, like a \.env file\. Existing keys keep the secret flag they already have; other keys in the set are kept\./
		);
		assert.match(dialog, /aria-label="New keys are secret"/);
		assert.match(dialog, /<Button type="submit" form=\{id\('add-form'\)\}>Add variable<\/Button>/);
		assert.match(dialog, /<Button type="submit" form=\{id\('merge-form'\)\}>Add variables<\/Button>/);
		assert.equal(dialog.match(/>Cancel<\/Dialog\.Close>/g)?.length, 1);
		assert.equal(dialog.match(/update: \(\) => updateInPlace\(result, update\)/g)?.length, 2);
		// No "dotenv" in visible text: drop the attributes, then the word must be gone from the markup.
		const markup = dialog.slice(dialog.indexOf('</script>')).replace(/\s[\w:-]+=(?:"[^"]*"|\{[^}]*\})/g, '');
		assert.equal(/dotenv/i.test(markup), false);

		assert.equal(savedVariablesNote('app'), 'Saved variables in app.');
		const table = source('EnvSetTable.svelte');
		assert.match(table, /onMerged=\{\(\) => \{\s*onAction\(\);\s*statusNote = savedVariablesNote\(set\.name\);/);
		assert.match(table, /onAdded=\{\(key\) => \{\s*onAction\(\);\s*statusNote = `Added \$\{key\}\.`;/);
	});

	test('the tab panel shows a focus ring and the tab list is a taller touch target', () => {
		const content = readFileSync(new URL('../src/lib/components/ui/tabs/tabs-content.svelte', import.meta.url), 'utf8');
		assert.match(content, /focus-visible:ring-3 focus-visible:ring-ring/);
		assert.match(source('EnvAddVariablesDialog.svelte'), /<Tabs\.List [^>]*class="group-data-\[orientation=horizontal\]\/tabs:h-10"/);
	});
});
