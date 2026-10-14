import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

type Violation = { file: string; rule: string; line: number };

const RULES: Array<{ id: string; pattern: RegExp }> = [
	{ id: 'table', pattern: /<table\b/ },
	{ id: 'tabs', pattern: /role="tablist"|class="nav tabs"/ },
	{ id: 'alert', pattern: /role="alert"/ },
	{ id: 'confirm', pattern: /confirm\(/ },
	{ id: 'status-text', pattern: /StatusText/ },
	{ id: 'heading', pattern: /<h1\b/ }
];

/** Line scan so a violation names the file and line that reintroduced it. */
export function scanSvelte(source: string, file = 'fixture.svelte'): Violation[] {
	const lines = source.split('\n');
	const found: Violation[] = [];
	for (const rule of RULES) {
		lines.forEach((line, index) => {
			if (rule.pattern.test(line)) found.push({ file, rule: rule.id, line: index + 1 });
		});
	}
	return found;
}

function routeFiles(): string[] {
	const root = fileURLToPath(new URL('../src/routes/', import.meta.url));
	return readdirSync(root, { recursive: true })
		.map(String)
		.filter((name) => name.endsWith('.svelte'))
		.map((name) => path.join(root, name));
}

test('route pages do not reimplement shared console pieces', () => {
	const violations = routeFiles().flatMap((file) => scanSvelte(readFileSync(file, 'utf8'), file));
	assert.deepEqual(
		violations,
		[],
		violations.map((item) => `${item.file}:${item.line} ${item.rule}`).join('\n')
	);
});

test('the scanner flags each banned pattern in a fixture', () => {
	const fixture = [
		'<table class="data">',
		'<nav role="tablist">',
		'<nav class="nav tabs">',
		'<p role="alert">no</p>',
		'<script>if (confirm("drop")) {}</script>',
		"import StatusText from '$lib/components/StatusText.svelte';",
		'const confirmHostId = "ok";',
		'<p role="status">kept</p>',
		'<h1>Title</h1>',
		'<h2>Section</h2>'
	].join('\n');
	const found = scanSvelte(fixture);
	const rules = found.map((item) => item.rule);
	assert.deepEqual(rules, ['table', 'tabs', 'tabs', 'alert', 'confirm', 'status-text', 'heading']);
	assert.equal(found.some((item) => item.line === 7 || item.line === 8 || item.line === 10), false);
	assert.deepEqual(scanSvelte('<p class="sub">No hosts enrolled.</p>'), []);
});
