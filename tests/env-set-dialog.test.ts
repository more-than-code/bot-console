import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { render } from 'svelte/server';
import SettingsSection from '../src/routes/projects/[id]/SettingsSection.svelte';
import { ENV_SET_STATUS_ID, savedEnvSetNote, settleEnvSetSave } from '../src/routes/projects/[id]/env-set-panel.ts';
import { PROJECT } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

function source(name: string): string {
	return readFileSync(new URL(`../src/routes/projects/[id]/${name}`, import.meta.url), 'utf8');
}

describe('Add env set dialog', () => {
	test('settleEnvSetSave: a success closes, waits for the reload, then focuses the status line', async () => {
		const run = async (open: boolean, type: string) => {
			const calls: string[] = [];
			const outcome = await settleEnvSetSave(open, type, {
				clearPaste: () => void calls.push('clear'),
				saved: () => void calls.push('saved'),
				close: () => void calls.push('close'),
				update: async () => void calls.push('update'),
				tick: async () => void calls.push('tick'),
				focusStatus: () => void calls.push('focus-status'),
				focusError: () => void calls.push('focus-error')
			});
			return { outcome, calls };
		};
		assert.deepEqual(await run(true, 'redirect'), {
			outcome: 'saved',
			calls: ['clear', 'saved', 'close', 'update', 'tick', 'focus-status']
		});
		// Dismissed while the request ran: the note is set and the page reloads, but focus stays where it is.
		assert.deepEqual(await run(false, 'redirect'), { outcome: 'saved', calls: ['clear', 'saved', 'close', 'update'] });
		// A failure keeps the dialog open: the form result is applied, then its error is focused.
		assert.deepEqual(await run(true, 'failure'), { outcome: 'failed', calls: ['clear', 'update', 'focus-error'] });
		assert.deepEqual(await run(true, 'error'), { outcome: 'other', calls: ['clear', 'update'] });
		assert.equal(savedEnvSetNote('app'), 'Saved env set app.');
		assert.equal(ENV_SET_STATUS_ID, 'env-set-status');
	});

	test('the dialog closes on success and returns focus to Add env set on Cancel or Escape', () => {
		const dialog = source('EnvSetDialog.svelte');
		assert.match(dialog, /await settleEnvSetSave\(open, result\.type,/);
		assert.match(dialog, /close: \(\) => \{\s*if \(!open\) return;\s*closingAfterSave = true;\s*open = false;\s*\}/);
		assert.match(dialog, /focusStatus: \(\) => focusById\(ENV_SET_STATUS_ID\)/);
		assert.match(dialog, /focusError: \(\) => focusById\('env-set-error'\)/);
		// The paste is cleared on every result, before the reload.
		assert.match(dialog, /clearPaste: \(\) => \{\s*dotenv = '';\s*\}/);
		assert.match(dialog, /<Dialog\.Content [^>]*\{onCloseAutoFocus\}>/);
		const close = dialog.slice(dialog.indexOf('function onCloseAutoFocus'), dialog.indexOf('function submit'));
		assert.match(close, /event\.preventDefault\(\);\s*if \(closingAfterSave\) \{\s*closingAfterSave = false;\s*return;\s*\}\s*focusById\('new-env-set'\)/);
		// The failure path is unchanged: the error notice stays inside the dialog.
		assert.match(dialog, /<div id="env-set-error" tabindex="-1"/);
	});

	test('the Env sets card has one stable status line the dialog writes to', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=settings`);
		const html = render(SettingsSection, {
			props: { project: PROJECT, canOwner: true, canAdmin: true, message: null, envSets: [], registries: [] }
		}).body;
		assert.equal(html.match(/<p id="env-set-status" role="status" tabindex="-1" class="sr-only"><\/p>/g)?.length, 1);
		// It comes after the Add env set trigger, inside the card.
		assert.ok(html.indexOf('id="new-env-set"') < html.indexOf('id="env-set-status"'));
		const section = source('SettingsSection.svelte');
		assert.match(section, /onStatus=\{\(text\) => \(envSetNote = text\)\}/);
		assert.match(section, /<p id=\{ENV_SET_STATUS_ID\} role="status" tabindex="-1" class=\{envSetNote \? '[^']*' : 'sr-only'\}>\{envSetNote\}<\/p>/);
	});
});
