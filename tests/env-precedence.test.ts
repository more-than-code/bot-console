import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { render } from 'svelte/server';
import type { ImageEntry } from '../src/lib/api-types.ts';
import { envOverrideNote, envOverrides, secretOverrideNote, setConflictNotes, setOrderLine } from '../src/lib/env-precedence.ts';
import { blankImageDraft, imageDraftFromForm, imageSpecFromDraft } from '../src/lib/image-spec.ts';
import CatalogImageForm from '../src/routes/projects/[id]/CatalogImageForm.svelte';

const A = { name: 'daikou-a', keys: ['SHARED', 'ONLY_A'] };
const B = { name: 'daikou-b', keys: ['SHARED', 'ONLY_B'] };

describe('env precedence (api-v1 rule 12: env_sets in order < secret_env < env)', () => {
	/** A secret row reading `other.<key>`, so it never matches a selected set's own value. */
	const secret = (key: string) => ({ key, set: 'other', name: key });
	const cases: Array<{ name: string; env: string[]; secrets: Array<{ key: string; set: string; name: string }>; sets: Array<{ name: string; keys: string[] }>; envNote?: [string, string | null]; secretNote?: [string, string | null]; setNotes: string[] }> = [
		{
			name: 'inline over set',
			env: ['DAIKOU_API_ALLOWED_EMAILS'],
			secrets: [],
			sets: [{ name: 'daikou-api-secrets', keys: ['DAIKOU_API_ALLOWED_EMAILS'] }],
			envNote: ['DAIKOU_API_ALLOWED_EMAILS', 'Overrides the value from env set daikou-api-secrets. This value is used.'],
			setNotes: []
		},
		{
			name: 'inline over secret',
			env: ['TOKEN'],
			secrets: [secret('TOKEN')],
			sets: [],
			envNote: ['TOKEN', 'Overrides the value from the secret env. This value is used.'],
			secretNote: ['TOKEN', 'The inline env value with this key overrides this secret.'],
			setNotes: []
		},
		{
			name: 'inline over two sets and secret',
			env: ['SHARED'],
			secrets: [secret('SHARED')],
			sets: [A, B],
			envNote: ['SHARED', 'Overrides the value from env sets daikou-a, daikou-b and the secret env. This value is used.'],
			secretNote: ['SHARED', 'Overrides the value from env sets daikou-a and daikou-b. The inline env value with this key is used.'],
			setNotes: ['SHARED is in daikou-a and daikou-b; the inline env value is used.']
		},
		{
			name: 'secret over set',
			env: [],
			secrets: [secret('ONLY_A')],
			sets: [A],
			secretNote: ['ONLY_A', 'Overrides the value from env set daikou-a. This value is used.'],
			setNotes: []
		},
		{
			name: 'set over earlier set',
			env: [],
			secrets: [],
			sets: [A, B],
			setNotes: ['SHARED is in daikou-a and daikou-b; daikou-b is used because it comes later in that order.']
		},
		{
			name: 'set order follows the selection',
			env: [],
			secrets: [],
			sets: [B, A],
			setNotes: ['SHARED is in daikou-b and daikou-a; daikou-a is used because it comes later in that order.']
		},
		{
			name: 'no overlap',
			env: ['PORT'],
			secrets: [secret('ONLY_B')],
			sets: [A],
			envNote: ['PORT', null],
			secretNote: ['ONLY_B', null],
			setNotes: []
		},
		{
			name: 'trimmed keys, case-sensitive',
			env: ['  ONLY_A ', 'only_b'],
			secrets: [],
			sets: [A, B],
			envNote: ['ONLY_A ', 'Overrides the value from env set daikou-a. This value is used.'],
			setNotes: ['SHARED is in daikou-a and daikou-b; daikou-b is used because it comes later in that order.']
		}
	];
	for (const item of cases) {
		test(item.name, () => {
			const overrides = envOverrides(item.env, item.secrets, item.sets);
			if (item.envNote) assert.equal(envOverrideNote(overrides, item.envNote[0]), item.envNote[1]);
			if (item.secretNote) assert.equal(secretOverrideNote(overrides, item.secretNote[0]), item.secretNote[1]);
			assert.deepEqual(
				setConflictNotes(overrides).map((note) => note.text),
				item.setNotes
			);
		});
	}

	test('a lowercase inline key does not override an uppercase set key', () => {
		const overrides = envOverrides(['only_b'], [], [B]);
		assert.equal(envOverrideNote(overrides, 'only_b'), null);
	});

	test('three sets name the last one', () => {
		const C = { name: 'daikou-c', keys: ['SHARED'] };
		assert.deepEqual(
			setConflictNotes(envOverrides([], [], [A, B, C])).map((note) => note.text),
			['SHARED is in daikou-a, daikou-b and daikou-c; daikou-c is used because it comes later in that order.']
		);
	});

	test('a secret reading the same key from a selected set is not an override', () => {
		const same = envOverrides([], [{ key: 'ONLY_A', set: 'daikou-a', name: 'ONLY_A' }], [A, B]);
		assert.equal(secretOverrideNote(same, 'ONLY_A'), null);
		// The same set but another key, or another set, is still an override.
		const renamed = envOverrides([], [{ key: 'ONLY_A', set: 'daikou-a', name: 'OTHER' }], [A]);
		assert.equal(secretOverrideNote(renamed, 'ONLY_A'), 'Overrides the value from env set daikou-a. This value is used.');
		const shared = envOverrides([], [{ key: 'SHARED', set: 'daikou-a', name: 'SHARED' }], [A, B]);
		assert.equal(secretOverrideNote(shared, 'SHARED'), 'Overrides the value from env set daikou-b. This value is used.');
	});

	test('secret wins a set conflict', () => {
		assert.deepEqual(
			setConflictNotes(envOverrides([], [secret('SHARED')], [A, B])).map((note) => note.text),
			['SHARED is in daikou-a and daikou-b; the secret env value is used.']
		);
	});

	test('inline wins over a secret and a set conflict', () => {
		const overrides = envOverrides(['SHARED'], [secret('SHARED')], [A, B]);
		assert.deepEqual(setConflictNotes(overrides).map((note) => note.text), ['SHARED is in daikou-a and daikou-b; the inline env value is used.']);
		assert.equal(secretOverrideNote(overrides, 'SHARED'), 'Overrides the value from env sets daikou-a and daikou-b. The inline env value with this key is used.');
	});

	test('blank and whitespace keys never match', () => {
		const blank = { name: 'blank', keys: ['', '  '] };
		const overrides = envOverrides(['', '   '], [{ key: ' ', set: '', name: '' }], [blank, { name: 'blank-2', keys: [' '] }]);
		assert.equal(overrides.env.size, 0);
		assert.equal(overrides.secrets.size, 0);
		assert.equal(overrides.conflicts.length, 0);
	});

	test('the order line lists the selected sets in order', () => {
		assert.equal(setOrderLine(['daikou-a']), null);
		assert.equal(setOrderLine(['daikou-b', 'daikou-a']), 'Order used: daikou-b, daikou-a. A later set wins for keys in both.');
	});

	test('a secret key over a set shows its note', () => {
		assert.equal(secretOverrideNote(envOverrides([], [secret('ONLY_B')], [A, B]), 'ONLY_B'), 'Overrides the value from env set daikou-b. This value is used.');
	});
});

describe('CatalogImageForm override notes', () => {
	function renderForm() {
		const draft = {
			...blankImageDraft(),
			name: 'daikou-api',
			image: 'docker.io/library/nginx:1',
			env: [{ key: 'SHARED', value: 'kept-out-of-notes' }],
			envSets: ['daikou-a', 'daikou-b'],
			secrets: [
				{ key: 'ONLY_A', set: 'daikou-b', name: 'ONLY_B' },
				{ key: 'ONLY_B', set: 'daikou-b', name: 'ONLY_B' }
			]
		};
		return render(CatalogImageForm, {
			props: {
				mode: 'create',
				saveAction: '?/catalogCreate',
				sets: [A, B],
				setsStatus: 'ready',
				editor: { mode: 'create', name: null, draft, field: null, message: null }
			}
		}).body;
	}

	test('inline, secret and set notes render and describe their inputs', () => {
		const html = renderForm();
		const id = 'catalog-image-new';
		assert.match(html, new RegExp(`<p id="${id}-env-note-0"[^>]*>[\\s\\S]*?Overrides the value from env sets daikou-a and daikou-b\\. This value is used\\.`));
		assert.match(html, new RegExp(`id="${id}-env-key-0"[^>]*aria-describedby="${id}-env-note-0"|aria-describedby="${id}-env-note-0"[^>]*id="${id}-env-key-0"`));
		assert.match(html, new RegExp(`<p id="${id}-secret-note-0"[^>]*>[\\s\\S]*?Overrides the value from env set daikou-a\\. This value is used\\.`));
		assert.match(html, new RegExp(`aria-describedby="${id}-secret-note-0"`));
		// The second secret reads daikou-b.ONLY_B itself: same value, no note.
		assert.equal(html.includes(`${id}-secret-note-1`), false);
		assert.match(html, new RegExp(`<p id="${id}-set-note-0"[^>]*>[\\s\\S]*?SHARED is in daikou-a and daikou-b; the inline env value is used\\.`));
		assert.match(html, new RegExp(`<p id="${id}-set-order"[^>]*>Order used: daikou-a, daikou-b\. A later set wins for keys in both\.</p>`));
		const boxes = [...html.matchAll(/<button\b[^>]*role="checkbox"[^>]*>/g)].map((match) => match[0]);
		assert.equal(boxes.length, 2);
		for (const box of boxes) assert.match(box, new RegExp(`aria-describedby="${id}-set-order ${id}-set-note-0"`));
		// Notes are not errors and never show values.
		assert.equal(html.includes('role="alert"'), false);
		assert.equal((html.match(/kept-out-of-notes/g) ?? []).length, 1, 'the value appears only in its own input');
	});

	/** The env_set values the form posts, in document order. */
	function postedSets(html: string): string[] {
		return [...html.matchAll(/<input\b[^>]*>/g)]
			.map((match) => match[0])
			.filter((tag) => tag.includes('name="env_set"'))
			.map((tag) => /value="([^"]*)"/.exec(tag)?.[1] ?? '');
	}

	function savedOrder(posted: string[]): string[] {
		const form = new FormData();
		for (const name of posted) form.append('env_set', name);
		return imageDraftFromForm(form).draft.envSets;
	}

	// Before this fix the checkboxes carried name="env_set" and were listed alphabetically, so a draft of
	// [daikou-b, daikou-a] posted daikou-a then daikou-b (checked with a server render of the old form).
	test('sets ticked out of alphabetical order post in the order they were ticked', () => {
		const draft = { ...blankImageDraft(), name: 'daikou-api', image: 'docker.io/library/nginx:1', envSets: ['daikou-b', 'daikou-a'] };
		const html = render(CatalogImageForm, {
			props: { mode: 'create', saveAction: '?/catalogCreate', sets: [A, B], setsStatus: 'ready', editor: { mode: 'create', name: null, draft, field: null, message: null } }
		}).body;
		assert.deepEqual(postedSets(html), ['daikou-b', 'daikou-a']);
		assert.deepEqual(savedOrder(postedSets(html)), ['daikou-b', 'daikou-a']);
		assert.match(html, /Order used: daikou-b, daikou-a\./);
		assert.match(html, /SHARED is in daikou-b and daikou-a; daikou-a is used because it comes later in that order\./);
		const check = imageSpecFromDraft(draft, [A, B]);
		assert.equal(check.ok, true);
		if (check.ok) assert.deepEqual(check.spec.env_sets, ['daikou-b', 'daikou-a']);
	});

	test('an edit of a stored [b, a] posts [b, a] unchanged', () => {
		const entry = {
			id: '00000000-0000-4000-8000-000000000001',
			project_id: '00000000-0000-4000-8000-000000000002',
			name: 'daikou-api',
			kind: 'image',
			spec: {
				kind: 'service',
				image: 'docker.io/library/nginx:1',
				command: null,
				entrypoint: null,
				ports: [],
				env: {},
				env_sets: ['daikou-b', 'daikou-a'],
				secret_env: {},
				volumes: [],
				files: [],
				restart: 'unless-stopped',
				user: '',
				healthy_after_sec: 30,
				memory_mb: null,
				timeout_sec: 600,
				healthcheck: null,
				logging: null,
				health_policy: null
			},
			spec_hash: 'a'.repeat(64),
			command_display: 'docker.io/library/nginx:1',
			created_by: '00000000-0000-4000-8000-000000000003',
			created_at: '2026-10-27T00:00:00Z',
			updated_at: '2026-10-27T00:00:00Z',
			my_actions: []
		} as ImageEntry;
		const html = render(CatalogImageForm, {
			props: { mode: 'edit', entry, saveAction: '?/catalogUpdate', sets: [A, B], setsStatus: 'ready', editor: null }
		}).body;
		assert.deepEqual(postedSets(html), ['daikou-b', 'daikou-a']);
		assert.deepEqual(savedOrder(postedSets(html)), ['daikou-b', 'daikou-a']);
	});

	test('no overlap renders no note', () => {
		const html = render(CatalogImageForm, {
			props: { mode: 'create', saveAction: '?/catalogCreate', sets: [A], setsStatus: 'ready', editor: null }
		}).body;
		assert.equal(html.includes('-note-'), false);
		assert.equal(html.includes('-set-order'), false);
	});
});
