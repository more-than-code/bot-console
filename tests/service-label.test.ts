import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canRenameService, processServiceHref, serviceEditCancelHref, serviceEditHref, serviceLabel } from '../src/lib/service-label.ts';

const PROJECT = '00000000-0000-4000-8000-000000000010';
const OTHER = '00000000-0000-4000-8000-000000000099';

test('serviceLabel prefers display_name, then name, then a port label', () => {
	assert.equal(serviceLabel({ name: 'api', display_name: 'API', owner_user: 'ada' }), 'API');
	assert.equal(serviceLabel({ name: 'port-80', display_name: 'Web' }), 'Web');
	assert.equal(serviceLabel({ name: 'api', display_name: '   ' }), 'api');
	assert.equal(serviceLabel({ name: 'api', display_name: null }), 'api');
	assert.equal(serviceLabel({ name: 'port-80' }), 'port 80');
	assert.equal(serviceLabel({ name: 'port-8080', owner_user: 'ada' }), 'port 8080 \u00b7 ada');
	assert.equal(serviceLabel({ name: 'port-8080', owner_user: '   ' }), 'port 8080');
	assert.equal(serviceLabel({ name: 'port-x', owner_user: 'ada' }), 'port-x');
	assert.equal(serviceLabel({ name: 'port-', owner_user: 'ada' }), 'port-');
});

test('rename is offered to an admin of this project when the host owner is unknown or local', () => {
	assert.equal(
		canRenameService({ canAdmin: false, projectId: PROJECT, serviceProjectId: PROJECT, hostOwnerProjectId: PROJECT }),
		false
	);
	assert.equal(
		canRenameService({ canAdmin: true, projectId: PROJECT, serviceProjectId: OTHER, hostOwnerProjectId: null }),
		true
	);
	assert.equal(
		canRenameService({ canAdmin: true, projectId: PROJECT, serviceProjectId: OTHER, hostOwnerProjectId: PROJECT }),
		true
	);
	assert.equal(
		canRenameService({ canAdmin: true, projectId: PROJECT, serviceProjectId: OTHER, hostOwnerProjectId: OTHER }),
		false
	);
	assert.equal(
		canRenameService({ canAdmin: true, projectId: PROJECT, serviceProjectId: PROJECT, hostOwnerProjectId: OTHER }),
		true
	);
});

test('a process service link caps services.q at 100 code points', () => {
	const host = '00000000-0000-4000-8000-0000000000aa';
	const exact = 'a'.repeat(100);
	const exactHref = new URL(processServiceHref(PROJECT, host, exact), 'http://console.example');
	assert.equal(exactHref.searchParams.get('services.q'), exact);
	const over = new URL(processServiceHref(PROJECT, host, 'a'.repeat(101)), 'http://console.example');
	assert.equal(over.searchParams.get('services.q'), exact);
	const emoji = '😀'.repeat(100);
	const emojiHref = new URL(processServiceHref(PROJECT, host, `${emoji}z`), 'http://console.example');
	assert.equal(emojiHref.searchParams.get('services.q'), emoji);
	assert.equal([...(emojiHref.searchParams.get('services.q') ?? '')].length, 100);
});

test('service edit links set and clear services.edit', () => {
	const url = new URL(
		`http://console.example/projects/${PROJECT}?tab=services&services.q=api&confirm=rename&/rename`
	);
	const href = serviceEditHref(url, '00000000-0000-4000-8000-0000000000bb');
	assert.equal(
		href,
		`/projects/${PROJECT}?tab=services&services.q=api&services.edit=00000000-0000-4000-8000-0000000000bb`
	);
	const cancel = serviceEditCancelHref(new URL(href, 'http://console.example'));
	assert.equal(cancel, `/projects/${PROJECT}?tab=services&services.q=api`);
});
