import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { render } from 'svelte/server';
import NewProject from '../src/routes/projects/NewProject.svelte';

test('new project is a button that opens a dialog, not an inline form', () => {
	const body = render(NewProject, { props: { action: '?/create', failed: false } }).body;
	assert.match(body, /<button\b[^>]*>[\s\S]*New project[\s\S]*<\/button>/);
	assert.equal(body.includes('name="name"'), false, 'the form stays inside the closed dialog');
	const page = readFileSync(new URL('../src/routes/projects/+page.svelte', import.meta.url), 'utf8');
	assert.match(page, /<NewProject\b/);
	assert.equal(page.includes('Card.Root'), false);
});

test('a failed create opens the dialog', () => {
	const body = render(NewProject, {
		props: { action: '?/create', failed: true, message: 'Enter a project name (1–80 characters).' }
	}).body;
	// Dialog content renders in a portal on the client; the trigger's state shows it opened.
	assert.match(body, /aria-expanded="true"/);
	const closed = render(NewProject, { props: { action: '?/create', failed: false } }).body;
	assert.match(closed, /aria-expanded="false"/);
});
