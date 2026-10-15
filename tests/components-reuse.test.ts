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
	{ id: 'heading', pattern: /<h1\b/ },
	// The shared Input binds value, which Svelte forbids on a checkbox (it throws on mount). Use Checkbox.
	{ id: 'checkbox-input', pattern: /type="checkbox"/ }
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

const COLOUR = /(?<!\{)#[0-9a-fA-F]{3,8}\b|rgb\(|(?<![\w_])oklch\(|color-mix\(\s*in\s+oklch\b/;
const STYLE_COLOUR =
	/style\s*[:=]\s*(?:"[^"]*(?:\bcolor\b|background|fill|stroke|#[0-9a-fA-F]{3,8}\b|rgb\(|oklch\()[^"]*"|'[^']*(?:\bcolor\b|background|fill|stroke|#[0-9a-fA-F]{3,8}\b|rgb\(|oklch\()[^']*'|[A-Za-z-]+="#[0-9a-fA-F]{3,8}\b")/;
const RAW_CONTROL = /<(button|input)\b/;
const PORTAL_LOCK = /\bforceMount\b|\bportalProps\b/;
const TEXT_BUTTON = /<(Button|button)\b([^>]*)>([\s\S]*?)<\/\1>/g;

function scanLines(source: string, file: string, id: string, pattern: RegExp): Violation[] {
	const found: Violation[] = [];
	source.split('\n').forEach((line, index) => {
		if (pattern.test(line)) found.push({ file, rule: id, line: index + 1 });
	});
	return found;
}

function uiExempt(file: string): boolean {
	return file.split(path.sep).join('/').includes('src/lib/components/ui/');
}

/** Shared components and generated primitives may render the native controls. */
export function controlExempt(file: string): boolean {
	const norm = file.split(path.sep).join('/');
	if (norm.includes('src/lib/components/ui/')) return true;
	return /(?:^|\/)src\/lib\/components\/[^/]+\.svelte$/.test(norm);
}

export function scanColours(source: string, file = 'fixture.svelte'): Violation[] {
	if (uiExempt(file)) return [];
	return scanLines(source, file, 'colour', COLOUR);
}

export function scanStyleColours(source: string, file = 'fixture.svelte'): Violation[] {
	if (uiExempt(file)) return [];
	return scanLines(source, file, 'style-colour', STYLE_COLOUR);
}

export function scanPortalLock(source: string, file: string): Violation[] {
	if (uiExempt(file)) return [];
	return scanLines(source, file, 'portal-lock', PORTAL_LOCK);
}

function buttonInnerHasText(inner: string): boolean {
	const text = inner.replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '');
	return /[A-Za-z]/.test(text);
}

/** Text-labelled buttons inside a DataTable `{#snippet row}` fail. Icon-only buttons do not. */
export function scanRowActionLabels(source: string, file = 'fixture.svelte'): Violation[] {
	const found: Violation[] = [];
	const open = /\{#snippet\s+row\b[^}]*\}/g;
	for (const match of source.matchAll(open)) {
		const start = (match.index ?? 0) + match[0].length;
		const end = source.indexOf('{/snippet}', start);
		if (end < 0) continue;
		const body = source.slice(start, end);
		for (const button of body.matchAll(TEXT_BUTTON)) {
			if (!buttonInnerHasText(button[3] ?? '')) continue;
			const line = source.slice(0, start + (button.index ?? 0)).split('\n').length;
			found.push({ file, rule: 'row-action', line });
		}
	}
	return found;
}

export function scanRawControls(source: string, file: string): Violation[] {
	if (controlExempt(file)) return [];
	return scanLines(source, file, 'raw-control', RAW_CONTROL);
}

function svelteFiles(dir: string): string[] {
	return readdirSync(dir, { recursive: true })
		.map(String)
		.filter((name) => name.endsWith('.svelte'))
		.map((name) => path.join(dir, name));
}

test('svelte files do not use colour literals or inline colour styles', () => {
	const root = fileURLToPath(new URL('../src/', import.meta.url));
	const violations = svelteFiles(root).flatMap((file) => {
		const source = readFileSync(file, 'utf8');
		return [...scanColours(source, file), ...scanStyleColours(source, file), ...scanPortalLock(source, file), ...scanRowActionLabels(source, file)];
	});
	assert.deepEqual(
		violations,
		[],
		violations.map((item) => `${item.file}:${item.line} ${item.rule}`).join('\n')
	);
});

test('route pages do not use a raw button or input', () => {
	const violations = routeFiles().flatMap((file) => scanRawControls(readFileSync(file, 'utf8'), file));
	assert.deepEqual(
		violations,
		[],
		violations.map((item) => `${item.file}:${item.line} ${item.rule}`).join('\n')
	);
});

test('colour, style, and raw-control rules each flag a fixture', () => {
	const colour = ['{#each items as item}', 'const ok = "#fff";', 'fill="rgb(0, 0, 0)"', 'oklch(0.2 0 0)'].join('\n');
	const colourHits = scanColours(colour);
	assert.deepEqual(
		colourHits.map((item) => item.line),
		[2, 3, 4]
	);
	assert.equal(colourHits.some((item) => item.line === 1), false);

	const styled = ['<div style="left: 4px; top: 8px"></div>', '<span style="color: red"></span>', '<i style="background: #fff"></i>'].join(
		'\n'
	);
	assert.deepEqual(
		scanStyleColours(styled).map((item) => item.line),
		[2, 3]
	);

	const route = 'src/routes/fixture.svelte';
	assert.equal(scanRawControls('<Button />\n<input type="hidden" />', route).length, 1);
	assert.equal(scanRawControls('<button type="button">No</button>', route).length, 1);
	assert.deepEqual(scanRawControls('<button type="button">Ok</button>', 'src/lib/components/ui/button/button.svelte'), []);
	assert.deepEqual(scanRawControls('<input type="search" />', 'src/lib/components/SearchField.svelte'), []);

	assert.equal(scanColours('style:color="#fff"', 'src/routes/fixture.svelte').length, 1);
	assert.equal(scanStyleColours('style:color="#fff"', 'src/routes/fixture.svelte').length, 1);
	const mix = 'class="bg-[color-mix(in oklch, var(--a), white)]"';
	assert.equal(scanColours(mix, 'src/routes/fixture.svelte').length, 1);
	assert.deepEqual(scanColours(mix, 'src/lib/components/ui/button/button.svelte'), []);
	assert.deepEqual(
		scanColours('class="bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]"', 'src/lib/components/ui/button/button.svelte'),
		[]
	);

	assert.equal(scanPortalLock('<Dialog.Content forceMount>', 'src/routes/fixture.svelte').length, 1);
	assert.equal(scanPortalLock('<Select.Content portalProps={{ disabled: true }}>', 'src/lib/components/Foo.svelte').length, 1);
	assert.deepEqual(scanPortalLock('<Dialog.Content portalProps={portalProps}>', 'src/lib/components/ui/dialog/dialog-content.svelte'), []);

	const labelled = '{#snippet row(item)}\n<Button type="submit">Save</Button>\n<button>Remove</button>\n{/snippet}';
	assert.deepEqual(
		scanRowActionLabels(labelled).map((item) => item.line),
		[2, 3]
	);
	assert.deepEqual(
		scanRowActionLabels('{#snippet row(item)}\n<Button type="submit" aria-label="Save item"><Icon /></Button>\n{/snippet}'),
		[]
	);
	assert.deepEqual(scanRowActionLabels('<Button type="submit">Create project</Button>'), []);
});

test('a checkbox built from Input is flagged', () => {
	assert.deepEqual(
		scanSvelte('<Input type="checkbox" name="shell" />', 'src/routes/fixture.svelte').map((item) => item.rule),
		['checkbox-input']
	);
});
