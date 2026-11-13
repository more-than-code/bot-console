// deploybot.dev indexing fixes (umbrella docs/spec-seo-indexing-fixes.md rev 1, approved by Joe 2026-11-12).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, afterEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isHttpError, type Handle, type RequestEvent, type ResolveOptions } from '@sveltejs/kit';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import RootLayout from '../src/routes/+layout.svelte';
import SiteLayout from '../src/routes/(site)/+layout.svelte';
import SiteError from '../src/routes/(site)/+error.svelte';
import SigninPage from '../src/routes/signin/+page.svelte';
import { load as notFoundLoad } from '../src/routes/(site)/not-found/+page.server.ts';
import { isPublicPath, isSitePath } from '../src/lib/server/session.ts';
import { SITE_URL } from '../src/lib/site/links.ts';
import { handle } from '../src/hooks.server.ts';
import { fakeEvent, installFetch, restoreEnv, TOKEN, useApi } from './harness.ts';
import { setPageStatus, setPageUrl, setRouteId } from './stubs/app-state.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const APP_HTML = readFileSync(join(root, 'src/app.html'), 'utf8');

function title(head: string): string | undefined {
	return head.match(/<title>([^<]*)<\/title>/)?.[1];
}

function hrefs(html: string): string[] {
	return [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((m) => m[1] ?? '');
}

function text(html: string): string {
	return html
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<[^>]+>/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

async function resolvePage(_event: RequestEvent, options?: ResolveOptions): Promise<Response> {
	const html = (await options?.transformPageChunk?.({ html: APP_HTML, done: true })) ?? APP_HTML;
	return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
}

const savedFetch = globalThis.fetch;

describe('SEO indexing fixes', () => {
	afterEach(() => {
		setPageStatus(200);
		setRouteId(null);
	});
	after(() => {
		globalThis.fetch = savedFetch;
		restoreEnv();
	});

	test('/not-found is a site path and public, with its data request', () => {
		for (const path of ['/not-found', '/not-found/__data.json']) {
			assert.equal(isSitePath(path), true, path);
			assert.equal(isPublicPath(path), true, path);
		}
		for (const path of ['/not-found/x', '/not-foundx', '/notfound']) {
			assert.equal(isSitePath(path), false, path);
		}
	});

	test('the /not-found load throws a 404', () => {
		assert.throws(
			() => notFoundLoad(),
			(err: unknown) => isHttpError(err) && err.status === 404
		);
	});

	test('/not-found takes the site shortcut: no session, no API call, no noindex', async () => {
		useApi('https://api.test');
		const calls = installFetch(() => {
			throw new Error('api called');
		});
		for (const session of [undefined, TOKEN]) {
			const { event } = fakeEvent({ url: 'http://pi.local/not-found', session });
			const response = await handle({ event, resolve: resolvePage } as Parameters<Handle>[0]);
			assert.equal(event.locals.user, null);
			assert.equal((await response.text()).includes('noindex'), false);
		}
		assert.equal(calls.length, 0);
	});

	test('the site error page for 404: heading, one h1, a link home, its title, no canonical', () => {
		setPageStatus(404, { message: 'Not found' });
		const { head, body } = render(SiteError);
		assert.equal(title(head), 'Page not found · Deploybot');
		assert.equal(head.includes('rel="canonical"'), false);
		assert.equal(body.match(/<h1\b/g)?.length, 1);
		assert.match(body, /<h1\b[^>]*>Page not found<\/h1>/);
		assert.deepEqual(hrefs(body), ['/']);
	});

	test('the site error page for 500: generic text with the status and its own title', () => {
		setPageStatus(500, { message: 'Internal Error' });
		const { head, body } = render(SiteError);
		assert.equal(title(head), 'Something went wrong · Deploybot');
		assert.match(body, /<h1\b[^>]*>Something went wrong<\/h1>/);
		assert.ok(text(body).includes('error 500'));
		assert.equal(text(body).includes('Page not found'), false);
		assert.deepEqual(hrefs(body), ['/']);
	});

	test('the 404 renders inside the site layout (header with Sign in, footer)', () => {
		setPageStatus(404, { message: 'Not found' });
		const children = createRawSnippet(() => ({ render: () => render(SiteError).body }));
		const { body } = render(SiteLayout, { props: { children } });
		for (const tag of ['<header', '<main', '<footer']) assert.ok(body.includes(tag), tag);
		assert.ok(body.includes('Page not found'));
		// The root layout hands a (site) route straight to the site layout, not the app shell.
		setRouteId('/(site)/not-found');
		const data = { user: null, theme: 'system' as const, timeZone: 'UTC' };
		const rootBody = render(RootLayout, { props: { children, data } }).body;
		assert.equal(rootBody.includes('aria-label="Primary"'), false);
	});

	test('the signed-in footer and the sign-in page link to the apex legal pages', () => {
		assert.equal(SITE_URL, 'https://deploybot.dev');
		const legal = ['https://deploybot.dev/privacy', 'https://deploybot.dev/terms'];
		const children = createRawSnippet(() => ({ render: () => '<p>child</p>' }));
		setPageUrl('http://console.example/projects');
		setRouteId('/projects');
		const app = render(RootLayout, {
			props: { children, data: { user: null, theme: 'system' as const, timeZone: 'UTC' } }
		}).body;
		assert.deepEqual(hrefs(app.slice(app.indexOf('</main>'))), legal);
		const signin = render(SigninPage, {
			props: {
				data: { user: null, theme: 'system' as const, timeZone: 'UTC', next: '/projects' },
				form: null
			}
		}).body;
		const links = hrefs(signin);
		for (const href of legal) assert.ok(links.includes(href), href);
	});
});
