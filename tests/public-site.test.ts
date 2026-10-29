import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { after, afterEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isRedirect, type Handle, type RequestEvent, type ResolveOptions } from '@sveltejs/kit';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import RootLayout from '../src/routes/+layout.svelte';
import { load as rootLoad } from '../src/routes/+layout.server.ts';
import SiteLayout from '../src/routes/(site)/+layout.svelte';
import AboutPage from '../src/routes/(site)/about/+page.svelte';
import PrivacyPage from '../src/routes/(site)/privacy/+page.svelte';
import TermsPage from '../src/routes/(site)/terms/+page.svelte';
import SigninPage from '../src/routes/signin/+page.svelte';
import { LAST_UPDATED } from '../src/lib/legal/last-updated.ts';
import { SIGN_IN_URL, SUPPORT_EMAIL } from '../src/lib/site/links.ts';
import { isPublicPath, isSitePath } from '../src/lib/server/session.ts';
import { handle } from '../src/hooks.server.ts';
import { fakeEvent, installFetch, restoreEnv, TOKEN, useApi, type FetchCall } from './harness.ts';
import { setPageUrl, setRouteId } from './stubs/app-state.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(root, path), 'utf8');

function filesUnder(dir: string): string[] {
	return readdirSync(join(root, dir)).flatMap((name) => {
		const rel = `${dir}/${name}`;
		return statSync(join(root, rel)).isDirectory() ? filesUnder(rel) : [rel];
	});
}

/** Every source file the public pages are built from. */
const PUBLIC_SOURCES = [
	...filesUnder('src/routes/(site)'),
	...filesUnder('src/lib/site'),
	...filesUnder('src/lib/legal')
];
/** Derived from the route tree: every `src/routes/(site)/<dir>/+page.svelte` is a site page. */
const SITE_PAGES = readdirSync(join(root, 'src/routes/(site)'))
	.filter((name) => statSync(join(root, 'src/routes/(site)', name)).isDirectory())
	.filter((name) =>
		filesUnder(`src/routes/(site)/${name}`).includes(`src/routes/(site)/${name}/+page.svelte`)
	)
	.map((name) => `/${name}`)
	.sort();
const APP_HTML = read('src/app.html');
const NOINDEX = '<meta name="robots" content="noindex" />';

function title(head: string): string | undefined {
	return head.match(/<title>([^<]*)<\/title>/)?.[1];
}

function hrefs(html: string): string[] {
	return [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((m) => m[1] ?? '');
}

/** Text of the first anchor whose href is exactly `href`. */
function anchorText(html: string, href: string): string | undefined {
	const match = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].find((m) =>
		(m[1] ?? '').includes(`href="${href}"`)
	);
	return match ? text(match[2] ?? '') : undefined;
}

/** Code that can import: `<script>` bodies of .svelte files, whole .ts files. */
function importableCode(file: string, source: string): string {
	if (!file.endsWith('.svelte')) return source;
	return [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
		.map((m) => m[1] ?? '')
		.join('\n');
}

/** Visible text: tags and Svelte hydration comments removed, entities decoded, spaces collapsed. */
function text(html: string): string {
	return html
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<[^>]+>/g, '')
		.replaceAll('&amp;', '&')
		.replaceAll('&quot;', '"')
		.replaceAll('&#39;', "'")
		.replace(/\s+/g, ' ')
		.trim();
}

/** Counts API calls; any call fails, as when the API is down. */
function apiDown(): FetchCall[] {
	return installFetch(() => {
		throw new Error('api called');
	});
}

/** A resolve that runs transformPageChunk over the real app.html, like SvelteKit does. */
async function resolvePage(_event: RequestEvent, options?: ResolveOptions): Promise<Response> {
	const html = (await options?.transformPageChunk?.({ html: APP_HTML, done: true })) ?? APP_HTML;
	return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
}

async function run(event: RequestEvent): Promise<Response> {
	return handle({ event, resolve: resolvePage } as Parameters<Handle>[0]);
}

async function expectSigninRedirect(event: RequestEvent, location: string): Promise<void> {
	await assert.rejects(run(event), (err: unknown) => {
		assert.equal(isRedirect(err), true, location);
		if (!isRedirect(err)) return false;
		assert.equal(err.status, 303);
		assert.equal(err.location, location);
		return true;
	});
}

const savedFetch = globalThis.fetch;

describe('public site pages', () => {
	afterEach(() => {
		setRouteId(null);
	});
	after(() => {
		globalThis.fetch = savedFetch;
		restoreEnv();
	});

	test('the site pages come from the route tree and are all site paths', () => {
		assert.deepEqual(SITE_PAGES, ['/about', '/privacy', '/terms']);
		for (const path of SITE_PAGES) assert.equal(isSitePath(path), true, path);
	});

	test('src/routes/(site) holds only +page.svelte and +layout.svelte files (no loads, no endpoints)', () => {
		for (const file of filesUnder('src/routes/(site)')) {
			assert.ok(['+page.svelte', '+layout.svelte'].includes(basename(file)), file);
		}
	});

	test('site paths are public and other paths are not', () => {
		for (const path of [...SITE_PAGES, '/about/__data.json']) {
			assert.equal(isSitePath(path), true, path);
			assert.equal(isPublicPath(path), true, path);
		}
		for (const path of [
			'/about/x',
			'/aboutx',
			'/privacy/x',
			'/About',
			'/projects',
			'/account',
			'/hosts/x',
			'/'
		]) {
			assert.equal(isSitePath(path), false, path);
		}
		for (const path of [
			'/projects',
			'/account',
			'/account/apps',
			'/hosts/x',
			'/aboutx',
			'/about/x'
		]) {
			assert.equal(isPublicPath(path), false, path);
		}
	});

	test('trailing slash: SvelteKit 308s /about/ to /about before the hook, so isSitePath stays exact', () => {
		// Built server (trailingSlash default "never"): GET /about/ → 308 Location /about.
		assert.equal(isSitePath('/about/'), false);
		assert.equal(read('svelte.config.js').includes('trailingSlash'), false);
	});

	test('site pages take the shortcut: no API call, no session, 200, with or without a cookie', async () => {
		useApi('https://api.test');
		const calls = apiDown();
		for (const path of SITE_PAGES) {
			for (const session of [undefined, TOKEN]) {
				const { event } = fakeEvent({ url: `http://pi.local${path}`, session });
				const response = await run(event);
				assert.equal(response.status, 200, path);
				assert.equal(event.locals.user, null);
				assert.equal(event.locals.sessionUnavailable, false);
			}
		}
		assert.equal(calls.length, 0);
	});

	test('positive control: the same cookie on /projects makes exactly one /v1/me call', async () => {
		useApi('https://api.test');
		const calls = apiDown();
		const { event } = fakeEvent({ url: 'http://pi.local/projects', session: TOKEN });
		const response = await run(event);
		assert.equal(response.status, 503);
		assert.equal(calls.length, 1);
		assert.equal(calls[0]?.url.pathname, '/v1/me');
		assert.equal(event.locals.sessionUnavailable, true);
	});

	test('with BOT_API_URL unset, site pages still render', async () => {
		useApi(null);
		const calls = apiDown();
		const { event } = fakeEvent({ url: 'http://pi.local/privacy', session: TOKEN });
		assert.equal((await run(event)).status, 200);
		assert.equal(calls.length, 0);
	});

	test('data requests, POST and query strings on site pages take the shortcut', async () => {
		useApi('https://api.test');
		const calls = apiDown();
		const data = fakeEvent({ url: 'http://pi.local/about/__data.json' }).event;
		(data as { isDataRequest: boolean }).isDataRequest = true;
		assert.equal((await run(data)).status, 200);

		const post = await run(fakeEvent({ url: 'http://pi.local/about', method: 'POST' }).event);
		assert.equal(post.status, 200);
		assert.equal(post.headers.get('x-frame-options'), 'DENY');
		assert.equal(post.headers.get('cache-control'), 'no-store');

		assert.equal((await run(fakeEvent({ url: 'http://pi.local/about?x=1' }).event)).status, 200);
		assert.equal(calls.length, 0);
	});

	test('a data request SvelteKit hands over as /about/ (trailing-slash flag) takes the shortcut', async () => {
		// On deploybot.dev the client asks /__data.json?x-sveltekit-trailing-slash=1 for /, Caddy rewrites
		// it to /about/__data.json, and the hook sees pathname /about/ with isDataRequest (spec-seo-site §3.1).
		useApi('https://api.test');
		const calls = apiDown();
		const data = fakeEvent({ url: 'http://pi.local/about/?x-sveltekit-trailing-slash=1&x-sveltekit-invalidated=01' }).event;
		(data as { isDataRequest: boolean }).isDataRequest = true;
		assert.equal(data.url.pathname, '/about/');
		const response = await run(data);
		assert.equal(response.status, 200);
		assert.equal(response.headers.get('location'), null);
		assert.equal(calls.length, 0);

		// A document request to /about/ is not a site path: SvelteKit 308s it before the hook.
		await expectSigninRedirect(fakeEvent({ url: 'http://pi.local/about/' }).event, '/signin?next=%2Fabout%2F');
	});

	test('signed out, near-miss and private paths redirect to /signin with no API call; / goes to /projects', async () => {
		useApi('https://api.test');
		const calls = apiDown();
		for (const path of [
			'/about/x',
			'/aboutx',
			'/privacy/x',
			'/About',
			'/projects',
			'/account',
			'/hosts/x'
		]) {
			await expectSigninRedirect(
				fakeEvent({ url: `http://pi.local${path}` }).event,
				`/signin?next=${encodeURIComponent(path)}`
			);
		}
		await expectSigninRedirect(fakeEvent({ url: 'http://pi.local/' }).event, '/projects');
		assert.equal(calls.length, 0);
	});

	test('site pages get the security headers, the theme marker, and drop noindex', async () => {
		useApi('https://api.test');
		apiDown();
		assert.ok(APP_HTML.includes(NOINDEX), 'app.html marks pages noindex');
		for (const path of SITE_PAGES) {
			const { event, jar } = fakeEvent({ url: `http://pi.local${path}` });
			jar.set('bot_theme', 'dark');
			const response = await run(event);
			assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
			assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
			assert.equal(response.headers.get('cache-control'), 'no-store');
			const html = await response.text();
			assert.ok(html.includes('<html class="dark" lang="en">'), path);
			assert.equal(html.includes('noindex'), false, path);
		}
	});

	test('app routes keep noindex', async () => {
		useApi('https://api.test');
		apiDown();
		const html = await (await run(fakeEvent({ url: 'http://pi.local/signin' }).event)).text();
		assert.ok(html.includes(NOINDEX));
		assert.ok(html.includes('<html data-theme="system" lang="en">'));
	});

	test('after the hook, the root layout load on /about sees no user and makes no API call', async () => {
		useApi('https://api.test');
		const calls = apiDown();
		const { event } = fakeEvent({ url: 'http://pi.local/about', session: TOKEN });
		assert.equal((await run(event)).status, 200);
		const data = (await rootLoad(event as Parameters<typeof rootLoad>[0])) as { user: unknown };
		assert.equal(data.user, null);
		assert.equal(calls.length, 0);
	});

	test('the root layout renders only the child for site routes', () => {
		const children = createRawSnippet(() => ({ render: () => '<p>child</p>' }));
		const data = { user: null, theme: 'system' as const, timeZone: 'UTC' };
		setPageUrl('http://console.example/about');
		setRouteId('/(site)/about');
		const site = render(RootLayout, { props: { children, data } }).body;
		assert.ok(site.includes('<p>child</p>'));
		assert.equal(site.includes('Skip to content'), false);
		assert.equal(site.includes('aria-label="Primary"'), false);
		assert.equal(site.includes('aria-label="Legal"'), false);

		setPageUrl('http://console.example/projects');
		setRouteId('/projects');
		const app = render(RootLayout, { props: { children, data } }).body;
		assert.ok(app.includes('Skip to content'));
		assert.ok(app.includes('aria-label="Primary"'));
		const footer = app.slice(app.indexOf('</main>'));
		assert.ok(footer.includes('aria-label="Legal"'), 'legal footer after main');
		assert.deepEqual(hrefs(footer), ['/privacy', '/terms']);
	});

	test('page titles are exact', () => {
		assert.equal(title(render(AboutPage).head), 'Deploybot: Let AI run your servers, without the keys');
		assert.equal(title(render(PrivacyPage).head), 'Privacy Policy · Deploybot');
		assert.equal(title(render(TermsPage).head), 'Terms of Service · Deploybot');
	});

	test('the About hero carries the pitch; How it works has the short summary; the panels live only in What you get', () => {
		// Joe 2026-10-26: the pitch is the hero subtitle on deploybot.dev, naming agents generically.
		const PITCH =
			'Let any AI agent that speaks MCP run your own servers, without handing it SSH keys or a cloud token. It can only deploy what your catalog allows, as you, after a confirm step.';
		const body = render(AboutPage).body.replace(/<!--[^]*?-->/g, '').replace(/\s+/g, ' ');
		const hero = body.slice(body.indexOf('id="hero-title"'), body.indexOf('aria-labelledby="flow-title"'));
		assert.ok(hero.includes(PITCH), 'pitch in the hero');
		// Joe 2026-10-29: the header already shows the Deploybot lockup, so the h1 is the headline, not the name again.
		assert.match(hero, /^id="hero-title"[^>]*>\s*Let AI run your servers, without the keys\.\s*<\/h1>/);
		const how = body.slice(body.indexOf('id="how-title"'));
		assert.ok(how.includes('Three steps from a new host to a running service.'));
		// Spec about-page §3.3/§3.5 (Joe 2026-10-29): the diagram shows only the flow; its four panels
		// became the What you get section, so each panel heading appears there once and nowhere else.
		for (const panel of ['Security', 'Resilience', 'Visibility', 'Teams']) {
			assert.equal(body.match(new RegExp(`>${panel}<`, 'g'))?.length, 1, panel);
		}
	});

	test('the pitch diagrams (landscape and portrait) sit in the flow section with accessible names and generic agents', () => {
		// Joe 2026-10-26: docs/brand/pitch-diagram.svg on the About page; since spec about-page §3.3 its own section.
		const body = render(AboutPage).body.replace(/<!--[^]*?-->/g, '');
		const hero = body.slice(body.indexOf('id="flow-title"'), body.indexOf('aria-labelledby="visual-title"'));
		assert.match(hero, /<svg[^>]*role="img"[^>]*aria-labelledby="pitch-title" aria-describedby="pitch-desc"/);
		assert.match(hero, /<svg[^>]*role="img"[^>]*aria-labelledby="pitch-portrait-title" aria-describedby="pitch-portrait-desc"/);
		for (const id of ['pitch-title', 'pitch-portrait-title']) {
			assert.ok(hero.includes(`<title id="${id}">How Deploybot lets AI agents run your servers</title>`), id);
		}
		assert.ok(hero.includes('id="pitch-desc"') && hero.includes('id="pitch-portrait-desc"'));
		for (const word of ['Claude', 'Codex', 'Grok']) assert.equal(hero.includes(word), false, `no ${word} in the hero`);
		// Joe 2026-10-26: an icon per box, at least 9 in each diagram (the flow only since spec about-page §3.3).
		for (const id of ['pitch-title', 'pitch-portrait-title']) {
			const svg = hero.slice(hero.indexOf(`aria-labelledby="${id}"`)).split('</svg>')[0] ?? '';
			assert.ok((svg.match(/<g class="line[^"]*" transform="translate\(/g)?.length ?? 0) >= 9, id);
		}
		assert.equal(hero.match(/hosted or self-hosted/gi)?.length, 4, 'subtitle in both diagrams and both descs');
		assert.equal(hero.includes('Hosts dial out, so no open ports'), false);
		assert.equal(body.includes('prefers-color-scheme'), false, 'dark mode follows the theme switch, not the OS');
	});

	test('the About page ends with Open source: four repos on dev, SPDX licences, self-hosting needs', () => {
		// Joe 2026-10-26: an Open source section below How it works, no versions or production details.
		const body = render(AboutPage).body.replace(/<!--[^]*?-->/g, '').replace(/\s+/g, ' ');
		assert.ok(body.indexOf('id="source-title"') > body.indexOf('id="how-title"'), 'after How it works');
		const source = body.slice(body.indexOf('id="source-title"'));
		for (const repo of ['bot-agent', 'bot-api-server', 'bot-mcp-server', 'bot-console']) {
			assert.ok(source.includes(`href="https://github.com/more-than-code/${repo}/tree/main"`), repo);
		}
		assert.equal(source.match(/AGPL-3\.0-only/g)?.length, 3);
		assert.ok(source.includes('Apache-2.0'));
		assert.ok(source.includes('PostgreSQL 18 with TimescaleDB, a Google OAuth client, a TLS reverse proxy'));
		assert.ok(source.includes('secrets key file'));
		assert.doesNotMatch(source, /\bv\d+\.\d+|us1|caddy/i);
	});

	test('each page has one h1 and the legal pages carry LAST_UPDATED', () => {
		for (const page of [AboutPage, PrivacyPage, TermsPage]) {
			assert.equal(render(page).body.match(/<h1\b/g)?.length, 1);
		}
		assert.match(LAST_UPDATED, /^\d{1,2} [A-Z][a-z]+ \d{4}$/);
		for (const page of [PrivacyPage, TermsPage]) {
			assert.ok(text(render(page).body).includes(`Last updated: ${LAST_UPDATED}`));
		}
	});

	test('the site layout has header, main and footer with the sign-in and footer links', () => {
		const children = createRawSnippet(() => ({ render: () => '<p>child</p>' }));
		const { body } = render(SiteLayout, { props: { children } });
		for (const tag of ['<header', '<main', '<footer']) assert.ok(body.includes(tag), tag);
		assert.ok(body.includes('<p>child</p>'));
		const links = hrefs(body);
		// The logo links to the homepage, / (umbrella docs/spec-seo-site.md §3.1).
		for (const href of ['/', SIGN_IN_URL, '/privacy', '/terms', `mailto:${SUPPORT_EMAIL}`]) {
			assert.ok(links.includes(href), href);
		}
		assert.ok(body.includes('/brand/lockup-light.svg') && body.includes('/brand/lockup-dark.svg'));
	});

	test('every Sign in link uses the one constant and reloads the page', () => {
		// Joe 2026-10-26: relative, so a local console's Sign in stays local; the apex Caddy redirects it to the console.
		assert.equal(SIGN_IN_URL, '/signin');
		assert.equal(SUPPORT_EMAIL, 'support@deploybot.dev');
		const children = createRawSnippet(() => ({ render: () => '<p>child</p>' }));
		const layout = render(SiteLayout, { props: { children } }).body;
		const pages = [AboutPage, PrivacyPage, TermsPage].map((page) => render(page).body);
		for (const html of [layout, ...pages]) {
			const tags = [...html.matchAll(/<[^>]+>/g)]
				.map((m) => m[0])
				.filter((tag) => tag.includes(SIGN_IN_URL));
			for (const tag of tags) assert.ok(tag.includes('data-sveltekit-reload'), tag);
		}
		// The layout has one Sign in; About has Get started in the hero and in the closing section (spec about-page §3).
		assert.equal(hrefs(layout).filter((href) => href === SIGN_IN_URL).length, 1);
		assert.equal(hrefs(pages[0] ?? '').filter((href) => href === SIGN_IN_URL).length, 2);
		for (const file of PUBLIC_SOURCES.filter((f) => f !== 'src/lib/site/links.ts')) {
			assert.equal(read(file).includes('console.deploybot.dev/signin'), false, file);
		}
	});

	test('no source file names the temporary hosts api2 or console2', () => {
		// The production names are api.deploybot.dev and console.deploybot.dev (umbrella
		// docs/spec-rename-public-origins.md); no web UI may show the old ones (Joe 2026-10-26).
		const walk = (dir: string): string[] =>
			readdirSync(dir).flatMap((name) => {
				const path = join(dir, name);
				return statSync(path).isDirectory() ? walk(path) : [path];
			});
		const files = walk(join(root, 'src'));
		assert.ok(files.length > 50, 'the src walk found files');
		for (const file of files) {
			const text = readFileSync(file, 'utf8');
			assert.equal(/\b(api2|console2)\.deploybot\.dev/.test(text), false, file);
		}
	});

	test('public pages import only site and legal modules, and use no {@html}', () => {
		const denied = ['$lib/server', '$lib/api', '$env', '$app/'];
		const allowed = (spec: string) =>
			spec === 'svelte' ||
			/^@lucide\/svelte\/icons\/[a-z0-9-]+$/.test(spec) ||
			spec.startsWith('$lib/site/') ||
			spec.startsWith('$lib/legal/') ||
			spec.startsWith('./');
		assert.ok(PUBLIC_SOURCES.length >= 8);
		let scanned = 0;
		for (const file of PUBLIC_SOURCES) {
			const source = read(file);
			assert.equal(source.includes('{@html'), false, `${file} uses {@html}`);
			// `from '…'`, side-effect `import '…'` and dynamic `import('…')`.
			const imports = [
				...importableCode(file, source).matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g)
			].map((m) => m[1] ?? '');
			scanned += imports.length;
			for (const spec of imports) {
				for (const prefix of denied) {
					assert.equal(
						spec.startsWith(prefix),
						false,
						`${file} imports ${spec}: public pages must not use ${prefix}`
					);
				}
				assert.equal(spec.includes('..'), false, `${file} imports ${spec}: no .. in public-page imports`);
				assert.ok(allowed(spec), `${file} imports ${spec}: not on the public-page allowlist`);
			}
		}
		assert.ok(scanned >= 8, 'the scan sees the imports in the script blocks');
	});

	test('sign-in shows the terms sentence with links, signed out, signed in and with an error', () => {
		const sentence =
			'By continuing you agree to the Terms of Service and acknowledge the Privacy Policy.';
		const layout = { user: null, theme: 'system' as const, timeZone: 'UTC', next: '/projects' };
		const cases = [
			{ data: { ...layout, signedInName: null }, form: null },
			{ data: { ...layout, signedInName: 'Ada' }, form: null },
			{
				data: { ...layout, signedInName: null },
				form: { message: 'Sign-in failed.', next: '/projects' }
			}
		];
		for (const props of cases) {
			const { body } = render(SigninPage, { props });
			assert.ok(text(body).includes(sentence));
			assert.equal(anchorText(body, '/terms'), 'Terms of Service');
			assert.equal(anchorText(body, '/privacy'), 'Privacy Policy');
		}
	});
});
