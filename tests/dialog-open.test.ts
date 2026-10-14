import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { formDialogOutcome, nextFormDialog } from '../src/lib/dialog-open.ts';

test('a form dialog opens from the trigger, forces open on a new failure, and closes on success', () => {
	assert.deepEqual(nextFormDialog({ open: true, sawFailure: false }, 'idle'), {
		open: true,
		sawFailure: false,
		resetDraft: false
	});
	assert.deepEqual(nextFormDialog({ open: false, sawFailure: false }, 'idle'), {
		open: false,
		sawFailure: false,
		resetDraft: false
	});
	assert.deepEqual(nextFormDialog({ open: false, sawFailure: false }, 'failure'), {
		open: true,
		sawFailure: true,
		resetDraft: false
	});
	assert.deepEqual(nextFormDialog({ open: true, sawFailure: true }, 'failure'), {
		open: true,
		sawFailure: true,
		resetDraft: false
	});
	assert.deepEqual(nextFormDialog({ open: false, sawFailure: true }, 'failure'), {
		open: false,
		sawFailure: true,
		resetDraft: false
	});
	assert.deepEqual(nextFormDialog({ open: true, sawFailure: true }, 'idle'), {
		open: false,
		sawFailure: false,
		resetDraft: false
	});
	assert.deepEqual(nextFormDialog({ open: true, sawFailure: false }, 'success'), {
		open: false,
		sawFailure: false,
		resetDraft: true
	});
	assert.deepEqual(nextFormDialog({ open: true, sawFailure: true }, 'success'), {
		open: false,
		sawFailure: false,
		resetDraft: true
	});
	assert.deepEqual(nextFormDialog({ open: false, sawFailure: false }, 'success'), {
		open: false,
		sawFailure: false,
		resetDraft: true
	});
});

test('action success and a backTo redirect both count as success', () => {
	assert.equal(formDialogOutcome('success'), 'success');
	assert.equal(formDialogOutcome('redirect'), 'success');
	assert.equal(formDialogOutcome('failure'), 'failure');
	assert.equal(formDialogOutcome('error'), 'failure');
	assert.equal(formDialogOutcome(''), 'idle');
});

test('rename and confirm dialogs settle with the same rule', () => {
	const rename = readFileSync(new URL('../src/routes/projects/[id]/RenameService.svelte', import.meta.url), 'utf8');
	const confirm = readFileSync(new URL('../src/lib/components/ConfirmAction.svelte', import.meta.url), 'utf8');
	const renameForm = readFileSync(new URL('../src/lib/components/RenameForm.svelte', import.meta.url), 'utf8');
	const confirmForm = readFileSync(new URL('../src/lib/components/ConfirmForm.svelte', import.meta.url), 'utf8');
	assert.match(rename, /nextFormDialog/);
	assert.match(rename, /onSettled=\{settle\}/);
	assert.match(confirm, /nextFormDialog/);
	assert.match(confirm, /bind:open/);
	assert.match(confirm, /bind:typed/);
	assert.match(confirm, /onSettled=\{settle\}/);
	assert.match(renameForm, /formDialogOutcome\(result\.type\)/);
	assert.match(confirmForm, /formDialogOutcome\(result\.type\)/);
});
