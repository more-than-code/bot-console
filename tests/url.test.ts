import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionUrl, actionUrlFrom, backTo } from '../src/lib/url.ts';

test('actionUrl keeps defined query values and drops undefined ones', () => {
	assert.equal(actionUrl('probe', { tab: 'services', range: '6h' }), '?tab=services&range=6h&/probe');
	assert.equal(actionUrl('snapshot', { tab: 'overview', range: '7d' }), '?tab=overview&range=7d&/snapshot');
	assert.equal(actionUrl('revokeCredential', { tab: 'hosts' }), '?tab=hosts&/revokeCredential');
	assert.equal(actionUrl('snapshot', { tab: 'overview', range: undefined }), '?tab=overview&/snapshot');
	assert.equal(actionUrl('create', {}), '?/create');
	assert.equal(actionUrl('approve', { code: 'ABCD-EFGH' }), '?code=ABCD-EFGH&/approve');
	const encoded = actionUrl('rename', { tab: 'a&b' });
	assert.equal(encoded, '?tab=a%26b&/rename');
	assert.equal(new URL(`http://console.example/projects/1${encoded}`).searchParams.get('tab'), 'a&b');
	assert.equal(new URL(`http://console.example/projects/1${encoded}`).searchParams.has('/rename'), true);
});

test('actionUrlFrom keeps the current query and drops confirm and action keys', () => {
	const current = new URL(
		'http://console.example/hosts/1?tab=services&range=6h&services.q=api&services.sort=ports&services.dir=desc&services.page=2&confirm=delete-project&/probe'
	);
	const action = actionUrlFrom(current, 'probe');
	assert.equal(
		action,
		'?tab=services&range=6h&services.q=api&services.sort=ports&services.dir=desc&services.page=2&/probe'
	);
	const parsed = new URL(`http://console.example/hosts/1${action}`);
	assert.equal(parsed.searchParams.has('confirm'), false);
	assert.deepEqual(parsed.searchParams.getAll('/probe'), ['']);
	assert.equal(parsed.searchParams.has('/x'), false);

	const replaced = actionUrlFrom(
		new URL('http://console.example/projects/1?tab=settings&confirm=delete-project&/x&/probe'),
		'deleteProject'
	);
	assert.equal(replaced, '?tab=settings&/deleteProject');
	const replacedUrl = new URL(`http://console.example/projects/1${replaced}`);
	assert.equal(replacedUrl.searchParams.has('/x'), false);
	assert.equal(replacedUrl.searchParams.has('/probe'), false);
	assert.deepEqual(replacedUrl.searchParams.getAll('/deleteProject'), ['']);

	assert.equal(actionUrlFrom(new URL('http://console.example/projects'), 'create'), '?/create');
	assert.equal(
		actionUrlFrom(new URL('http://console.example/hosts/1?tab=services&noise=1'), 'probe', ['noise']),
		'?tab=services&/probe'
	);
});

test('backTo keeps the path and table query and drops confirm and the action key', () => {
	const url = new URL(
		'http://console.example/projects/1?tab=members&members.q=ada&members.page=2&confirm=remove-member-1&/removeMember'
	);
	assert.equal(backTo(url), '/projects/1?tab=members&members.q=ada&members.page=2');
	assert.equal(backTo(new URL('http://console.example/projects/1?confirm=x&/rename')), '/projects/1');
	const replaced = new URL(`http://console.example${backTo(url)}`);
	assert.equal(replaced.searchParams.has('confirm'), false);
	assert.equal(replaced.searchParams.has('/removeMember'), false);
	assert.equal(replaced.searchParams.has('/x'), false);
});
