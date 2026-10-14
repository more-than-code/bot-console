import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmHref, confirmIsOpen, typeToConfirmMatches } from '../src/lib/confirm.ts';

test('the confirm link keeps the other params and names this id', () => {
	const url = new URL('http://console.example/projects/1?tab=settings&hosts.q=pi&confirm=other');
	assert.equal(confirmHref(url, 'delete-project'), '/projects/1?tab=settings&hosts.q=pi&confirm=delete-project');
	const opened = new URL(`http://console.example${confirmHref(url, 'delete-project')}`);
	assert.equal(opened.searchParams.get('tab'), 'settings');
	assert.equal(opened.searchParams.get('hosts.q'), 'pi');
	assert.equal(opened.searchParams.get('confirm'), 'delete-project');
});

test('confirm is open from javascript or from the matching URL param', () => {
	assert.equal(confirmIsOpen(false, 'delete-project', 'delete-project', false), true);
	assert.equal(confirmIsOpen(false, 'delete-project', 'delete-project', true), false);
	assert.equal(confirmIsOpen(true, null, 'delete-project', false), true);
	assert.equal(confirmIsOpen(false, 'revoke-host-1', 'delete-project', false), false);
	assert.equal(confirmIsOpen(false, null, 'delete-project', false), false);
});

test('type-to-confirm matches the expected text exactly', () => {
	assert.equal(typeToConfirmMatches('Lab', 'Lab'), true);
	assert.equal(typeToConfirmMatches('lab', 'Lab'), false);
	assert.equal(typeToConfirmMatches('Lab ', 'Lab'), false);
	assert.equal(typeToConfirmMatches('', 'Lab'), false);
});
