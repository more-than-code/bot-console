import assert from 'node:assert/strict';
import { test } from 'node:test';
import { updateInPlace } from '../src/lib/form-redirect.ts';

test('a redirect back to the page keeps scroll and focus instead of the default update', async () => {
	const calls: unknown[] = [];
	await updateInPlace({ type: 'redirect', location: '/projects/p?tab=settings' }, async () => void calls.push('update'), async (url, opts) => void calls.push([url, opts]));
	assert.deepEqual(calls, [['/projects/p?tab=settings', { invalidateAll: true, noScroll: true, keepFocus: true }]]);
});

test('other results use the normal update', async () => {
	for (const type of ['success', 'failure', 'error']) {
		const calls: string[] = [];
		await updateInPlace({ type }, async () => void calls.push('update'), async () => void calls.push('navigate'));
		assert.deepEqual(calls, ['update'], type);
	}
});
