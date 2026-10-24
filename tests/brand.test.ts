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

test('static/favicon.ico is an ICO that embeds the brand PNGs', () => {
	const ico = readFileSync(new URL('../static/favicon.ico', import.meta.url));
	// ICONDIR: reserved 0, type 1 (icon), then the image count.
	assert.deepEqual([...ico.subarray(0, 4)], [0x00, 0x00, 0x01, 0x00]);
	const count = ico.readUInt16LE(4);
	assert.equal(count, 2);
	const sizes: number[] = [];
	for (let i = 0; i < count; i++) {
		const entry = 6 + 16 * i;
		sizes.push(ico[entry] ?? -1);
		// Square, one plane, 32 bits per pixel.
		assert.equal(ico[entry + 1], ico[entry]);
		assert.equal(ico.readUInt16LE(entry + 4), 1);
		assert.equal(ico.readUInt16LE(entry + 6), 32);
		const length = ico.readUInt32LE(entry + 8);
		const offset = ico.readUInt32LE(entry + 12);
		const png = ico.subarray(offset, offset + length);
		assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		const brand = readFileSync(new URL(`../static/brand/favicon-${ico[entry]}.png`, import.meta.url));
		assert.ok(png.equals(brand), `favicon-${ico[entry]}.png`);
	}
	assert.deepEqual(sizes, [16, 32]);
});
