import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { confirmAfterAction, formDialogOutcome, nextConfirmDialog, nextFormDialog, nextInviteSecret, type InviteSecretState } from '../src/lib/dialog-open.ts';

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

test('an invite url is shown once and closing the dialog clears it', () => {
	const url = 'https://console.example/invite/' + 'a'.repeat(43);
	const closed: InviteSecretState = { open: false, sawFailure: false, shownUrl: null, seenUrl: null };

	const revealed = nextInviteSecret(closed, { inviteUrl: url, failed: false, open: false });
	assert.deepEqual(revealed, { open: true, sawFailure: false, shownUrl: url, seenUrl: url });
	assert.deepEqual(nextInviteSecret(revealed, { inviteUrl: url, failed: false, open: true }), revealed);

	const dismissed = nextInviteSecret(revealed, { inviteUrl: url, failed: false, open: false });
	assert.deepEqual(dismissed, { open: false, sawFailure: false, shownUrl: null, seenUrl: url });

	const reopened = nextInviteSecret(dismissed, { inviteUrl: url, failed: false, open: true });
	assert.deepEqual(reopened, { open: true, sawFailure: false, shownUrl: null, seenUrl: url });

	const again = 'https://console.example/invite/' + 'b'.repeat(43);
	const next = nextInviteSecret(reopened, { inviteUrl: again, failed: false, open: true });
	assert.deepEqual(next, { open: true, sawFailure: false, shownUrl: again, seenUrl: again });

	const dropped = nextInviteSecret(next, { inviteUrl: null, failed: false, open: false });
	assert.equal(dropped.shownUrl, null);
	assert.equal(dropped.seenUrl, null);
	const sameAgain = nextInviteSecret(dropped, { inviteUrl: again, failed: false, open: false });
	assert.equal(sameAgain.shownUrl, again);
	assert.equal(sameAgain.open, true);

	const members = readFileSync(new URL('../src/routes/projects/[id]/MembersSection.svelte', import.meta.url), 'utf8');
	assert.match(members, /nextInviteSecret\(/);
	assert.match(members, /\{#if shownUrl && inviteRole\}/);
	assert.match(members, /<CopyButton value=\{shownUrl\} label="Copy invite link" \/>/);
	assert.equal(members.includes('{inviteUrl}'), false);
});

test('an invite failure still opens the empty form and a dismissed failure stays closed', () => {
	const closed: InviteSecretState = { open: false, sawFailure: false, shownUrl: null, seenUrl: null };
	const failed = nextInviteSecret(closed, { inviteUrl: null, failed: true, open: false });
	assert.deepEqual(failed, { open: true, sawFailure: true, shownUrl: null, seenUrl: null });
	const dismissed = nextInviteSecret(failed, { inviteUrl: null, failed: true, open: false });
	assert.deepEqual(dismissed, { open: false, sawFailure: true, shownUrl: null, seenUrl: null });
});

test('rename and confirm dialogs settle with the same rule', () => {
	const rename = readFileSync(new URL('../src/routes/projects/[id]/RenameService.svelte', import.meta.url), 'utf8');
	const confirm = readFileSync(new URL('../src/lib/components/ConfirmAction.svelte', import.meta.url), 'utf8');
	const renameForm = readFileSync(new URL('../src/lib/components/RenameForm.svelte', import.meta.url), 'utf8');
	const confirmForm = readFileSync(new URL('../src/lib/components/ConfirmForm.svelte', import.meta.url), 'utf8');
	assert.match(rename, /nextFormDialog/);
	assert.match(rename, /onSettled=\{settle\}/);
	assert.match(confirm, /confirmAfterAction\(\{ open, sawFailure \}, resultType, closeOnFailure\)/);
	assert.equal(confirm.includes('import { confirmAfterAction'), true);
	assert.deepEqual(confirmAfterAction({ open: true, sawFailure: false }, 'failure', true), {
		open: false,
		sawFailure: false,
		resetDraft: false
	});
	assert.deepEqual(confirmAfterAction({ open: true, sawFailure: false }, 'failure', false), {
		open: true,
		sawFailure: true,
		resetDraft: false
	});
	assert.deepEqual(nextConfirmDialog({ open: true, sawFailure: false }, 'failure', true), {
		open: false,
		sawFailure: false,
		resetDraft: false
	});
	assert.deepEqual(nextConfirmDialog({ open: true, sawFailure: false }, 'failure'), {
		open: true,
		sawFailure: true,
		resetDraft: false
	});
	assert.match(confirm, /bind:open/);
	assert.match(confirm, /bind:typed/);
	assert.match(confirm, /onSettled=\{settle\}/);
	assert.match(renameForm, /formDialogOutcome\(result\.type\)/);
	assert.match(confirmForm, /onSettled\?\.\(result\.type\)/);
});
