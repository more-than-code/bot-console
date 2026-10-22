import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('app.html links the brand icons and manifest, and each file ships in static/', () => {
	const html = read('src/app.html');
	const refs = [...html.matchAll(/%sveltekit\.assets%\/([^"]+)"/g)].map((m) => m[1]);
	assert.deepEqual(refs, [
		'brand/favicon.svg',
		'brand/favicon-32.png',
		'brand/favicon-16.png',
		'brand/apple-touch-icon.png',
		'manifest.webmanifest'
	]);
	for (const ref of refs) assert.ok(existsSync(new URL(`../static/${ref}`, import.meta.url)), ref);
	const manifest = JSON.parse(read('static/manifest.webmanifest'));
	assert.equal(manifest.name, 'Deploybot');
	for (const icon of manifest.icons) assert.ok(existsSync(new URL(`../static${icon.src}`, import.meta.url)), icon.src);
});

test('the header shows the lockup for each theme and names the link Deploybot', () => {
	const layout = read('src/routes/+layout.svelte');
	assert.match(layout, /<a class="shrink-0" href="\/projects" aria-label="Deploybot">/);
	assert.match(layout, /src="\/brand\/lockup-light\.svg" alt="" class="h-6 w-auto dark:hidden"/);
	assert.match(layout, /src="\/brand\/lockup-dark\.svg" alt="" class="hidden h-6 w-auto dark:block"/);
	for (const file of ['lockup-light.svg', 'lockup-dark.svg'])
		assert.ok(existsSync(new URL(`../static/brand/${file}`, import.meta.url)), file);
});
