import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { render } from 'svelte/server';
import DrawerResize from '../src/lib/components/DrawerResize.svelte';
import {
	DRAWER_DEFAULT_WIDTH,
	DRAWER_LABEL,
	DRAWER_TYPES,
	STORED_WIDTH_MAX,
	WIDE_QUERY,
	WIDTH_MIN,
	clampWidth,
	clearWidth,
	keyWidth,
	maxWidth,
	parseWidth,
	readWidth,
	saveWidth,
	widthKey,
	type DrawerType
} from '../src/lib/drawer-width.ts';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** An in-memory Storage, optionally throwing on every call like a blocked one. */
function memoryStorage(blocked = false) {
	const map = new Map<string, string>();
	const fail = () => {
		if (blocked) throw new DOMException('blocked', 'SecurityError');
	};
	return {
		map,
		getItem(key: string) {
			fail();
			return map.get(key) ?? null;
		},
		setItem(key: string, value: string) {
			fail();
			map.set(key, value);
		},
		removeItem(key: string) {
			fail();
			map.delete(key);
		}
	};
}

const DRAWERS: Record<DrawerType, string> = {
	logs: 'LogsDrawer.svelte',
	deploy: 'CatalogDeployDialog.svelte',
	program: 'CatalogEntryDialog.svelte',
	container: 'CatalogImageDialog.svelte',
	permissions: 'CatalogPermissions.svelte'
};

describe('resizable drawers', () => {
	test('one key, default and label per drawer type', () => {
		assert.deepEqual([...DRAWER_TYPES], ['logs', 'deploy', 'program', 'container', 'permissions']);
		assert.deepEqual(
			DRAWER_TYPES.map(widthKey),
			[
				'deploybot.drawer.width.logs',
				'deploybot.drawer.width.deploy',
				'deploybot.drawer.width.program',
				'deploybot.drawer.width.container',
				'deploybot.drawer.width.permissions'
			]
		);
		assert.deepEqual(DRAWER_DEFAULT_WIDTH, { logs: 720, deploy: 672, program: 560, container: 560, permissions: 560 });
		assert.deepEqual(DRAWER_LABEL, { logs: 'Logs', deploy: 'Deploy', program: 'Program', container: 'Container', permissions: 'Permissions' });
		assert.equal(WIDTH_MIN, 360);
		assert.equal(WIDE_QUERY, '(min-width: 48rem)');
	});

	test('clamp keeps a whole width between 360 px and 90% of the window', () => {
		assert.equal(maxWidth(1000), 900);
		assert.equal(maxWidth(1366), 1229);
		assert.equal(maxWidth(300), WIDTH_MIN);
		assert.equal(clampWidth(720, 1440), 720);
		assert.equal(clampWidth(100, 1440), 360);
		assert.equal(clampWidth(-50, 1440), 360);
		assert.equal(clampWidth(3000, 1000), 900);
		assert.equal(clampWidth(500.6, 1440), 501);
		assert.equal(clampWidth(720, 768), 691);
		assert.equal(clampWidth(720, 300), 360);
	});

	test('a stored value is a whole number of px in range, anything else is null', () => {
		assert.equal(parseWidth('720'), 720);
		assert.equal(parseWidth('360'), 360);
		assert.equal(parseWidth(String(STORED_WIDTH_MAX)), STORED_WIDTH_MAX);
		for (const junk of [null, undefined, '', 'abc', '720px', ' 720', '720 ', '-720', '359', '0', '720.5', '7e2', '0x2d0', '99999999', String(STORED_WIDTH_MAX + 1), 'NaN', 'Infinity', '[720]']) {
			assert.equal(parseWidth(junk), null, String(junk));
		}
	});

	test('read gives the stored width (not clamped to the window) or the default', () => {
		const storage = memoryStorage();
		assert.equal(readWidth(storage, 'logs'), 720);
		assert.equal(readWidth(null, 'deploy'), 672);
		storage.map.set('deploybot.drawer.width.logs', '2400');
		assert.equal(readWidth(storage, 'logs'), 2400);
		assert.equal(readWidth(storage, 'program'), 560);
		storage.map.set('deploybot.drawer.width.program', 'junk');
		assert.equal(readWidth(storage, 'program'), 560);
		storage.map.set('deploybot.drawer.width.container', '-1');
		assert.equal(readWidth(storage, 'container'), 560);
		assert.equal(readWidth(memoryStorage(true), 'permissions'), 560);
	});

	test('save writes whole px for one type only, clear removes it, and blocked storage never throws', () => {
		const storage = memoryStorage();
		saveWidth(storage, 'logs', 800.4);
		assert.deepEqual([...storage.map], [['deploybot.drawer.width.logs', '800']]);
		saveWidth(storage, 'deploy', 100);
		assert.equal(storage.map.has('deploybot.drawer.width.deploy'), false);
		clearWidth(storage, 'logs');
		assert.equal(storage.map.size, 0);
		const blocked = memoryStorage(true);
		assert.doesNotThrow(() => saveWidth(blocked, 'logs', 800));
		assert.doesNotThrow(() => clearWidth(blocked, 'logs'));
		assert.doesNotThrow(() => saveWidth(null, 'logs', 800));
	});

	test('keys: Left widens, Right narrows, Shift steps 64, Home is the maximum, End the minimum', () => {
		assert.equal(keyWidth('ArrowLeft', false, 720, 1440), 736);
		assert.equal(keyWidth('ArrowRight', false, 720, 1440), 704);
		assert.equal(keyWidth('ArrowLeft', true, 720, 1440), 784);
		assert.equal(keyWidth('ArrowRight', true, 720, 1440), 656);
		assert.equal(keyWidth('ArrowRight', true, 380, 1440), 360);
		assert.equal(keyWidth('ArrowLeft', true, 1290, 1440), 1296);
		assert.equal(keyWidth('Home', false, 720, 1440), 1296);
		assert.equal(keyWidth('End', false, 720, 1440), 360);
		assert.equal(keyWidth('ArrowUp', false, 720, 1440), null);
		assert.equal(keyWidth('Enter', false, 720, 1440), null);
	});

	test('the handle is a labelled vertical separator, focusable, and hidden below md', () => {
		for (const type of DRAWER_TYPES) {
			const html = render(DrawerResize, { props: { type } }).body;
			const tag = /<div[^>]*data-slot="drawer-resize"[^>]*>/.exec(html)?.[0] ?? '';
			assert.notEqual(tag, '', type);
			assert.match(tag, /role="separator"/, type);
			assert.match(tag, /aria-orientation="vertical"/, type);
			assert.match(tag, new RegExp(`aria-label="Resize ${DRAWER_LABEL[type]} panel"`), type);
			assert.match(tag, new RegExp(`aria-valuenow="${DRAWER_DEFAULT_WIDTH[type]}"`), type);
			assert.match(tag, /aria-valuemin="360"/, type);
			assert.match(tag, /aria-valuemax="\d+"/, type);
			assert.match(tag, /tabindex="0"/, type);
			const classes = (/class="([^"]*)"/.exec(tag)?.[1] ?? '').split(/\s+/);
			for (const name of ['hidden', 'md:block', 'cursor-col-resize', 'w-1.5', 'touch-none', 'hover:after:bg-border', 'focus-visible:after:bg-border']) {
				assert.ok(classes.includes(name), `${type}: ${name}`);
			}
		}
		const source = readFileSync(resolve(root, 'src/lib/components/DrawerResize.svelte'), 'utf8');
		assert.match(source, /setPointerCapture/);
		assert.match(source, /userSelect = 'none'/);
		assert.match(source, /window\.matchMedia\(WIDE_QUERY\)/);
	});

	test('each of the five drawers renders its handle after the close button', () => {
		for (const [type, file] of Object.entries(DRAWERS)) {
			const source = readFileSync(resolve(root, 'src/routes/projects/[id]', file), 'utf8');
			assert.match(source, /import DrawerResize from '\$lib\/components\/DrawerResize\.svelte';/, file);
			const content = /<Sheet\.Content\b[^>]*>\s*\{#snippet after\(\)\}<DrawerResize type="([a-z]+)" \/>\{\/snippet\}/.exec(source);
			assert.ok(content, `${file}: handle is the after snippet of Sheet.Content`);
			assert.equal(content[1], type, file);
			assert.equal(source.split('<DrawerResize').length - 1, 1, `${file}: one handle`);
		}
		const sheet = readFileSync(resolve(root, 'src/lib/components/ui/sheet/sheet-content.svelte'), 'utf8');
		const close = sheet.indexOf('</SheetPrimitive.Close>');
		const after = sheet.indexOf('{@render after?.()}');
		assert.ok(close !== -1 && after > close && after < sheet.indexOf('</SheetPrimitive.Content>'), 'after renders last inside the content');
	});

	test('only the drawer width file uses localStorage', () => {
		const users: string[] = [];
		function walk(dir: string) {
			for (const name of readdirSync(dir)) {
				const path = resolve(dir, name);
				if (statSync(path).isDirectory()) walk(path);
				else if (/\.(ts|js|svelte)$/.test(path) && readFileSync(path, 'utf8').includes('localStorage')) users.push(path);
			}
		}
		walk(resolve(root, 'src'));
		assert.deepEqual(users, [resolve(root, 'src/lib/drawer-width.ts')]);
		const auth = readFileSync(resolve(root, 'tests/auth-session.test.ts'), 'utf8');
		assert.match(auth, /if \(!file\.endsWith\(resolve\(root, 'src\/lib\/drawer-width\.ts'\)\)\) assert\.equal\(text\.includes\('localStorage'\), false, file\);/);
	});
});
