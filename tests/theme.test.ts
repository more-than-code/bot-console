import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isRedirect, type Handle } from '@sveltejs/kit';
import { render } from 'svelte/server';
import { handle } from '../src/hooks.server.ts';
import { isPublicPath } from '../src/lib/server/session.ts';
import { applyThemeClass, applyThemeMarker, parseTheme, THEME_COOKIE, THEME_MAX_AGE, themeCookieOptions } from '../src/lib/theme.ts';
import { actions as themeActions } from '../src/routes/theme/+page.server.ts';
import ThemeSwitch from '../src/lib/components/ThemeSwitch.svelte';
import { fakeEvent, useApi, restoreEnv } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

test('an invalid theme cookie counts as system and is never copied through', () => {
	assert.equal(parseTheme(undefined), 'system');
	assert.equal(parseTheme(''), 'system');
	assert.equal(parseTheme('blue'), 'system');
	assert.equal(parseTheme('Dark'), 'system');
	assert.equal(parseTheme('system'), 'system');
	assert.equal(parseTheme('light'), 'light');
	assert.equal(parseTheme('dark'), 'dark');
	const raw = '"><script>alert(1)</script>';
	const html = applyThemeMarker('<html lang="en"><body>ok</body></html>', parseTheme(raw));
	assert.equal(html, '<html data-theme="system" lang="en"><body>ok</body></html>');
	assert.equal(html.includes(raw), false);
	assert.equal(html.includes('class="dark"'), false);
});

test('theme cookie options are HttpOnly and Secure only over https', () => {
	const http = themeCookieOptions(new URL('http://console.example/projects'));
	assert.equal(http.httpOnly, true);
	assert.equal(http.sameSite, 'lax');
	assert.equal(http.path, '/');
	assert.equal(http.maxAge, THEME_MAX_AGE);
	assert.equal(http.secure, false);
	const https = themeCookieOptions(new URL('https://console.example/projects'));
	assert.equal(https.secure, true);
	assert.equal(THEME_MAX_AGE, 31536000);
});

test('the theme action stores the allowlisted value and redirects to a safe next', async () => {
	const unsafe = fakeEvent({
		url: 'http://console.example/theme',
		form: { theme: 'nope', next: '//evil.example/phish' }
	});
	await assert.rejects(
		async () => {
			await themeActions.default(unsafe.event as never);
		},
		(err: unknown) => isRedirect(err) && err.status === 303 && err.location === '/'
	);
	assert.equal(unsafe.jar.get(THEME_COOKIE), 'system');
	assert.equal(unsafe.sets[0]?.options.secure, false);
	assert.equal(unsafe.sets[0]?.options.httpOnly, true);
	assert.equal(unsafe.sets[0]?.options.path, '/');
	assert.equal(unsafe.sets[0]?.options.sameSite, 'lax');
	assert.equal(unsafe.sets[0]?.options.maxAge, THEME_MAX_AGE);
	assert.equal(JSON.stringify(unsafe.sets).includes('nope'), false);

	const safe = fakeEvent({
		url: 'https://console.example/theme',
		form: { theme: 'dark', next: '/projects/1?tab=hosts' }
	});
	await assert.rejects(
		async () => {
			await themeActions.default(safe.event as never);
		},
		(err: unknown) => isRedirect(err) && err.status === 303 && err.location === '/projects/1?tab=hosts'
	);
	assert.equal(safe.jar.get(THEME_COOKIE), 'dark');
	assert.equal(safe.sets[0]?.options.secure, true);
});

test('/theme is public and the hook writes one marker', async () => {
	assert.equal(isPublicPath('/theme'), true);
	assert.equal(isPublicPath('/theme/__data.json'), true);
	useApi('https://api.test');
	try {
		for (const [cookie, expected] of [
			[undefined, '<html data-theme="system" lang="en">'],
			['system', '<html data-theme="system" lang="en">'],
			['light', '<html lang="en">'],
			['dark', '<html class="dark" lang="en">'],
			['not-a-theme', '<html data-theme="system" lang="en">']
		] as const) {
			const { event, jar } = fakeEvent({ url: 'http://console.example/theme' });
			if (cookie) jar.set(THEME_COOKIE, cookie);
			let seen = '';
			const response = await handle({
				event,
				resolve: (async (_event: unknown, opts?: { transformPageChunk?: (chunk: { html: string }) => string }) => {
					const html = '<html lang="en"><body>theme</body></html>';
					seen = opts?.transformPageChunk ? opts.transformPageChunk({ html }) : html;
					return new Response(seen);
				}) as Parameters<Handle>[0]['resolve']
			} as Parameters<Handle>[0]);
			assert.equal(response.status, 200);
			assert.equal(seen.startsWith(expected), true);
			assert.equal((seen.match(/class="dark"/g) ?? []).length, cookie === 'dark' ? 1 : 0);
			assert.equal((seen.match(/data-theme="system"/g) ?? []).length, cookie === 'light' || cookie === 'dark' ? 0 : 1);
			if (cookie === 'not-a-theme') assert.equal(seen.includes('not-a-theme'), false);
		}
	} finally {
		restoreEnv();
	}
});

test('ThemeSwitch renders the three choices and marks the current one', () => {
	setPageUrl('http://console.example/projects');
	for (const current of ['system', 'light', 'dark'] as const) {
		const html = render(ThemeSwitch, { props: { value: current } }).body;
		assert.match(html, />System</);
		assert.match(html, />Light</);
		assert.match(html, />Dark</);
		const marked = [...html.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);
		const on = marked.filter((tag) => tag.includes('data-state="on"') || tag.includes('aria-checked="true"'));
		assert.equal(on.length, 1);
		assert.equal(on[0]?.includes(`value="${current}"`) || on[0]?.includes(`data-value="${current}"`), true);
	}
});

test('ThemeSwitch posts /theme with name=theme and the hidden next path', () => {
	setPageUrl('http://console.example/projects?tab=hosts');
	const html = render(ThemeSwitch, { props: { value: 'dark' } }).body;
	const form = html.match(/<form\b[^>]*>/);
	assert.ok(form);
	assert.match(form[0], /action="\/theme"/);
	const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);
	const named = buttons.filter((tag) => tag.includes('name="theme"'));
	assert.equal(named.length, 3);
	const inputs = [...html.matchAll(/<input\b[^>]*>/g)].map((match) => match[0]);
	const next = inputs.find((tag) => tag.includes('type="hidden"') && tag.includes('name="next"'));
	assert.ok(next);
	assert.match(next, /value="\/projects\?tab=hosts"/);
	const theme = inputs.find((tag) => tag.includes('type="hidden"') && tag.includes('name="theme"'));
	assert.ok(theme);
	assert.match(theme, /value="dark"/);
});

test('the layout mounts ThemeSwitch with the loaded theme', () => {
	const layout = readFileSync(new URL('../src/routes/+layout.svelte', import.meta.url), 'utf8');
	assert.match(layout, /<ThemeSwitch value=\{data\.theme\}/);
});

test('the app.html head script follows system and a dark OS preference', () => {
	const html = readFileSync(new URL('../src/app.html', import.meta.url), 'utf8');
	assert.match(html, /nonce="%sveltekit\.nonce%"/);
	assert.match(html, /getAttribute\('data-theme'\) === 'system'/);
	assert.match(html, /prefers-color-scheme:\s*dark/);
});

test('applyThemeClass sets dark, light, and system on the document', () => {
	const g = globalThis as { document?: unknown; window?: unknown };
	const previous = { document: g.document, window: g.window };
	g.document = undefined;
	g.window = undefined;
	assert.doesNotThrow(() => applyThemeClass('dark'));
	assert.doesNotThrow(() => applyThemeClass('system'));
	assert.doesNotThrow(() => applyThemeClass('light'));

	const classes = new Set<string>();
	const attrs = new Map<string, string>();
	const root = {
		classList: {
			toggle(name: string, on: boolean) {
				if (on) classes.add(name);
				else classes.delete(name);
				return on;
			}
		},
		setAttribute(name: string, value: string) {
			attrs.set(name, value);
		},
		removeAttribute(name: string) {
			attrs.delete(name);
		}
	};
	function install(prefersDark: boolean) {
		g.document = { documentElement: root };
		g.window = { matchMedia: (query: string) => ({ matches: prefersDark && query.includes('dark') }) };
	}
	try {
		install(true);
		applyThemeClass('dark');
		assert.equal(classes.has('dark'), true);
		assert.equal(attrs.has('data-theme'), false);

		applyThemeClass('light');
		assert.equal(classes.has('dark'), false);
		assert.equal(attrs.has('data-theme'), false);

		applyThemeClass('system');
		assert.equal(classes.has('dark'), true);
		assert.equal(attrs.get('data-theme'), 'system');

		install(false);
		applyThemeClass('system');
		assert.equal(classes.has('dark'), false);
		assert.equal(attrs.get('data-theme'), 'system');

		applyThemeClass('light');
		assert.equal(classes.has('dark'), false);
		assert.equal(attrs.has('data-theme'), false);
	} finally {
		g.document = previous.document;
		g.window = previous.window;
	}
});
