import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { isActionFailure, isRedirect } from '@sveltejs/kit';
import { render } from 'svelte/server';
import type { EnvSet } from '../src/lib/api-types.ts';
import { confirmSettle, failureFocusTiming } from '../src/lib/dialog-open.ts';
import EnvSetTable from '../src/routes/projects/[id]/EnvSetTable.svelte';
import SettingsSection from '../src/routes/projects/[id]/SettingsSection.svelte';
import { MAKE_SECRET_MESSAGE, madeSecretNote } from '../src/routes/projects/[id]/env-set-panel.ts';
import { actions as projectActions } from '../src/routes/projects/[id]/+page.server.ts';
import { envelope, fakeEvent, installFetch, PROJECT, restoreEnv, TOKEN, useApi, USER } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

const PLAIN = 'visible-plain-value-17';

const SET: EnvSet = {
	name: 'app',
	keys: [
		{ key: 'API_TOKEN', is_secret: true, value: null, preview: 'supe…' },
		{ key: 'DB_URL', is_secret: false, value: PLAIN, preview: null },
		{ key: 'LOG_LEVEL', is_secret: false, value: 'debug', preview: null }
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

function decode(value: string): string {
	return value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
}

function buttonTag(html: string, text: string): string {
	const found = [...html.matchAll(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<\/button>/g)].find((match) => match[0].includes(text));
	assert.ok(found, `no button with ${text}`);
	return found[0].slice(0, found[0].indexOf('>') + 1);
}

function disabled(tag: string): boolean {
	return /(?:^|\s)disabled(?:="[^"]*"|=""|[\s>]|$)/.test(tag);
}

describe('Make secret row action (api-v1 v1.17)', () => {
	before(() => useApi('https://api.example'));
	after(() => restoreEnv());

	const base = { session: TOKEN, user: USER, projects: [PROJECT], params: { id: PROJECT.id } };
	const url = `http://console.example/projects/${PROJECT.id}?tab=settings&/makeEnvKeysSecret`;

	test('a plain row has a Make {KEY} secret row action and a secret row has none', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=settings`);
		const html = decode(render(EnvSetTable, { props: { set: SET, ...TABLE_PROPS } }).body);
		const db = buttonTag(html, 'aria-label="Make DB_URL secret"');
		assert.equal(disabled(db), false);
		// A ghost icon button like the other row actions, not the destructive colour.
		assert.equal(db.includes('text-destructive'), false);
		assert.equal(html.includes('aria-label="Make LOG_LEVEL secret"'), true);
		assert.equal(html.includes('aria-label="Make API_TOKEN secret"'), false);
		assert.equal(html.match(/aria-label="Make [A-Z_]+ secret"/g)?.length, 2);
		// No bulk design left: no checkboxes in the rows, no set-level button, four columns.
		assert.equal(html.includes('aria-label="Select '), false);
		assert.equal(html.includes('Make secret…'), false);
		assert.equal(html.match(/<th\b/g)?.length, 4);
		// A key name that reads like a delete still gets the lock, not the destructive style.
		const odd: EnvSet = { ...SET, keys: [{ key: 'DELETE_ME', is_secret: false, value: 'x', preview: null }] };
		const oddTag = buttonTag(decode(render(EnvSetTable, { props: { set: odd, ...TABLE_PROPS } }).body), 'aria-label="Make DELETE_ME secret"');
		assert.equal(oddTag.includes('text-destructive'), false);
	});

	test('the button is shown only with the env-set edit controls (admin or owner)', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=settings`);
		const viewer = render(SettingsSection, {
			props: { project: { ...PROJECT, role: 'viewer' }, canOwner: false, canAdmin: false, message: null, envSets: [SET], registries: [] }
		}).body;
		assert.equal(viewer.includes('secret"'), false);
		assert.equal(viewer.includes('Add variable'), false);
		const admin = render(SettingsSection, {
			props: { project: { ...PROJECT, role: 'admin' }, canOwner: false, canAdmin: true, message: null, envSets: [SET], registries: [] }
		}).body;
		assert.equal(admin.includes('aria-label="Make DB_URL secret"'), true);
	});

	test('the confirm names the key with the exact text and posts set and keys', () => {
		assert.equal(
			MAKE_SECRET_MESSAGE,
			"This value will be encrypted and hidden. This can't be undone; to make a key plain again, delete it and add it again."
		);
		assert.equal(madeSecretNote('DB_URL'), 'Made DB_URL secret.');
		// The dialog body is portalled and not server-rendered; check the one row ConfirmAction element.
		const table = readFileSync(new URL('../src/routes/projects/[id]/EnvSetTable.svelte', import.meta.url), 'utf8');
		const element = table.match(/<ConfirmAction\s+id=\{domId\('make-secret', item\.key\)\}[^]*?\/>/)?.[0] ?? '';
		assert.match(element, /rowLabel="Make \{item\.key\} secret"/);
		assert.match(element, /confirmLabel="Make secret"/);
		assert.match(element, /message="Make \{item\.key\} secret\? \{MAKE_SECRET_MESSAGE\}"/);
		assert.match(element, /icon=\{Lock\}/);
		assert.match(element, /\scloseOnFailure\s/);
		assert.match(element, /failureFocusId="settings-error"/);
		assert.match(element, /onSuccess=\{afterMakeSecret\}/);
		assert.equal(element.includes('successFocusIds'), false);
		// The table, which outlives the row, moves focus to its status line after the reload.
		const after = table.slice(table.indexOf('async function afterMakeSecret'), table.indexOf('// Collapse hides the table.'));
		assert.match(after, /await tick\(\)/);
		assert.match(after, /getElementById\(domId\('status'\)\)\?\.focus\(\)/);
		// The per-key Delete also closes on failure and focuses the notice.
		const keyDelete = table.match(/<ConfirmAction\s+id=\{domId\('delete', item\.key\)\}[^]*?\/>/)?.[0] ?? '';
		assert.match(keyDelete, /\scloseOnFailure\s/);
		assert.match(keyDelete, /failureFocusId="settings-error"/);
		assert.match(element, /\{ name: 'set', value: set\.name \},\s*\{ name: 'keys', value: item\.key \}/);
		const before = table.slice(0, table.indexOf("id={domId('make-secret', item.key)}"));
		assert.match(before, /\{#if !item\.is_secret\}\s*<!--[^>]*-->\s*<ConfirmAction\s*$/);
	});

	test('the action posts the path and keys, then redirects', async () => {
		const calls = installFetch(() => envelope({ name: 'app', keys: [] }));
		await assert.rejects(
			async () => {
				await projectActions.makeEnvKeysSecret(fakeEvent({ ...base, url, form: { set: 'app', keys: 'DB_URL' } }).event as never);
			},
			(err: unknown) => isRedirect(err) && err.status === 303 && err.location === `/projects/${PROJECT.id}?tab=settings`
		);
		assert.equal(calls.length, 1);
		assert.equal(calls[0]?.method, 'POST');
		assert.equal(calls[0]?.url.pathname, `/v1/projects/${PROJECT.id}/env-sets/app/secret`);
		assert.deepEqual(JSON.parse(calls[0]?.body ?? '{}'), { keys: ['DB_URL'] });
	});

	test('bad input is refused before the API, and an API error shows its message', async () => {
		const calls = installFetch(() => envelope({}));
		for (const form of [{ set: 'app' }, { set: 'Bad Set', keys: 'DB_URL' }] as Array<Record<string, string>>) {
			const result = await projectActions.makeEnvKeysSecret(fakeEvent({ ...base, url, form }).event as never);
			assert.equal(isActionFailure(result), true);
			if (isActionFailure(result)) {
				assert.equal(result.status, 400);
				assert.equal((result.data as unknown as { message?: string }).message, 'Choose a plain key to make secret.');
				assert.equal((result.data as unknown as { scope?: string }).scope, 'settings');
			}
		}
		assert.equal(calls.length, 0);

		installFetch(() => envelope(null, 404, 'not_found', 'env set key not found: GONE'));
		const missing = await projectActions.makeEnvKeysSecret(fakeEvent({ ...base, url, form: { set: 'app', keys: 'GONE' } }).event as never);
		assert.equal(isActionFailure(missing), true);
		if (!isActionFailure(missing)) return;
		assert.equal(missing.status, 404);
		const data = missing.data as unknown as { scope?: string; message?: string; settingsField?: string | null };
		assert.equal(data.scope, 'settings');
		assert.equal(data.message, 'env set key not found: GONE');
		assert.equal(data.settingsField ?? null, null);

		installFetch(() => envelope(null, 403, 'delegated.denied', 'not allowed with a delegated token'));
		const denied = await projectActions.makeEnvKeysSecret(fakeEvent({ ...base, url, form: { set: 'app', keys: 'DB_URL' } }).event as never);
		assert.equal(isActionFailure(denied) && denied.status, 403);

		// The message is shown in the settings notice, which the closed dialog focuses.
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=settings`);
		const html = render(SettingsSection, {
			props: { project: PROJECT, canOwner: false, canAdmin: true, message: data.message ?? null, envSets: [SET], registries: [] }
		}).body;
		assert.match(html, /<div id="settings-error" tabindex="-1"/);
		assert.equal(html.includes('env set key not found: GONE'), true);
	});

	test('a failure focuses the notice on close, or at once when the dialog was already closed', () => {
		const id = 'settings-error';
		assert.equal(failureFocusTiming(true, true, id, 'failure'), 'on-close');
		// Escape while the request ran: the dialog is gone, so focus moves straight away.
		assert.equal(failureFocusTiming(false, true, id, 'failure'), 'now');
		// File delete names no notice: nothing to do.
		assert.equal(failureFocusTiming(true, true, null, 'failure'), 'none');
		assert.equal(failureFocusTiming(false, true, null, 'failure'), 'none');
		// Without closeOnFailure the dialog stays open on the error, as before.
		assert.equal(failureFocusTiming(true, false, id, 'failure'), 'none');
		assert.equal(failureFocusTiming(true, true, id, 'success'), 'none');
		assert.equal(failureFocusTiming(true, true, id, 'idle'), 'none');
	});

	test('confirmSettle combines the dialog rule, the outcome and the notice focus', () => {
		const open = { open: true, sawFailure: false };
		assert.deepEqual(confirmSettle(open, 'redirect', true, 'settings-error'), {
			open: false,
			sawFailure: false,
			resetDraft: true,
			outcome: 'success',
			focusNotice: 'none'
		});
		assert.deepEqual(confirmSettle(open, 'failure', true, 'settings-error'), {
			open: false,
			sawFailure: false,
			resetDraft: false,
			outcome: 'failure',
			focusNotice: 'on-close'
		});
		assert.deepEqual(confirmSettle({ open: false, sawFailure: false }, 'failure', true, 'settings-error').focusNotice, 'now');
		assert.deepEqual(confirmSettle(open, 'failure', false, 'settings-error'), {
			open: true,
			sawFailure: true,
			resetDraft: false,
			outcome: 'failure',
			focusNotice: 'none'
		});
	});

	test('the status line is one stable element whose text changes', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=settings`);
		const html = render(EnvSetTable, { props: { set: SET, ...TABLE_PROPS } }).body;
		// Empty, it stays in the accessibility tree (sr-only, not display: none), so the live region exists first.
		assert.equal(html.match(/<p id="env-status-app" role="status" tabindex="-1" class="sr-only"><\/p>/g)?.length, 1);
		const table = readFileSync(new URL('../src/routes/projects/[id]/EnvSetTable.svelte', import.meta.url), 'utf8');
		assert.equal(table.includes('{#if statusNote}'), false);
		// Make secret, Add variable and an inline save share this one line per set panel.
		assert.equal(table.match(/role="status"/g)?.length, 1);
	});
});
