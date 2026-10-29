// SEO for deploybot.dev (umbrella docs/spec-seo-site.md rev 1, approved by Joe 2026-10-30).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { render } from 'svelte/server';
import AboutPage from '../src/routes/(site)/about/+page.svelte';
import PrivacyPage from '../src/routes/(site)/privacy/+page.svelte';
import TermsPage from '../src/routes/(site)/terms/+page.svelte';
import { homepageRoute, reroute } from '../src/hooks.ts';
import { SITE_URL } from '../src/lib/site/links.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** Content of the first `<meta>` whose name or property is `key`. */
function meta(head: string, key: string): string | undefined {
	const tag = [...head.matchAll(/<meta\b[^>]*>/g)]
		.map((m) => m[0])
		.find((t) => t.includes(`name="${key}"`) || t.includes(`property="${key}"`));
	return tag?.match(/\bcontent="([^"]*)"/)?.[1];
}

function canonical(head: string): string[] {
	return [...head.matchAll(/<link\b[^>]*rel="canonical"[^>]*>/g)].map(
		(m) => m[0].match(/\bhref="([^"]*)"/)?.[1] ?? ''
	);
}

function title(head: string): string | undefined {
	return head.match(/<title>([^<]*)<\/title>/)?.[1];
}

describe('SEO site', () => {
	test('reroute: only / on the apex resolves to /about', () => {
		const cases: [string, string | undefined][] = [
			['https://deploybot.dev/', '/about'],
			['https://console.deploybot.dev/', undefined],
			['https://deploybot.dev/privacy', undefined],
			['https://deploybot.dev/about', undefined],
			['https://deploybot.dev.evil.com/', undefined],
			['http://localhost:5180/', undefined],
			['https://DEPLOYBOT.DEV/', '/about'],
			['https://deploybot.dev/?x=1', '/about'],
			['https://deploybot.dev:8443/', '/about'],
			['https://notdeploybot.dev/', undefined],
			['https://www.deploybot.dev/', undefined],
			['https://deploybot.dev@evil.com/', undefined],
			['https://deploybot.dev//', undefined]
		];
		for (const [url, expected] of cases) {
			assert.equal(homepageRoute(new URL(url)), expected, url);
			assert.equal(reroute({ url: new URL(url), fetch }), expected, url);
		}
	});

	test('each site page has its title, description, canonical and Open Graph and Twitter tags', () => {
		assert.equal(SITE_URL, 'https://deploybot.dev');
		const pages = [
			{
				page: AboutPage,
				title: 'Deploybot: Let AI run your servers, without the keys',
				description:
					'Let any AI agent that speaks MCP run your own servers, without SSH keys or cloud tokens. Catalog only, as you, after a confirm step. Open source; hosted or self-hosted.',
				url: 'https://deploybot.dev/'
			},
			{
				page: PrivacyPage,
				title: 'Privacy Policy · Deploybot',
				description:
					'How Deploybot handles your data: what we collect, why, who processes it and how long we keep it.',
				url: 'https://deploybot.dev/privacy'
			},
			{
				page: TermsPage,
				title: 'Terms of Service · Deploybot',
				description: 'The terms for using the hosted Deploybot service.',
				url: 'https://deploybot.dev/terms'
			}
		];
		for (const expected of pages) {
			const { head } = render(expected.page);
			assert.equal(title(head), expected.title);
			assert.equal(head.match(/<title>/g)?.length, 1, `${expected.url}: one title`);
			assert.equal(meta(head, 'description'), expected.description);
			assert.deepEqual(canonical(head), [expected.url]);
			assert.equal(meta(head, 'og:type'), 'website');
			assert.equal(meta(head, 'og:site_name'), 'Deploybot');
			assert.equal(meta(head, 'og:title'), expected.title);
			assert.equal(meta(head, 'og:description'), expected.description);
			assert.equal(meta(head, 'og:url'), expected.url);
			assert.equal(meta(head, 'og:image'), 'https://deploybot.dev/brand/og-image.png');
			assert.equal(meta(head, 'og:image:width'), '1200');
			assert.equal(meta(head, 'og:image:height'), '630');
			assert.ok(meta(head, 'og:image:alt'), `${expected.url}: og:image:alt`);
			assert.equal(meta(head, 'twitter:card'), 'summary_large_image');
		}
	});

	test('the head tags name no dev or production project or host', () => {
		const heads = [AboutPage, PrivacyPage, TermsPage].map((page) => render(page).head).join(' ');
		for (const name of ['mohiguide', 'mo-services', 'mo-webadmin', 'joe-and-his-friends', 'grok-bot-box', 'pi3-2', 'home-lab', 'us1']) {
			assert.equal(heads.toLowerCase().includes(name), false, name);
		}
		assert.doesNotMatch(heads, /\bpi[1-4]\b/i);
		assert.equal(heads.includes('Home Lab'), false);
	});

	test('static/brand/og-image.png is a PNG whose size matches the og:image tags', () => {
		const png = readFileSync(join(root, 'static/brand/og-image.png'));
		assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
		const { head } = render(AboutPage);
		assert.equal(png.readUInt32BE(16), 1200);
		assert.equal(png.readUInt32BE(20), 630);
		assert.equal(meta(head, 'og:image:width'), String(png.readUInt32BE(16)));
		assert.equal(meta(head, 'og:image:height'), String(png.readUInt32BE(20)));
	});

	test('sitemap.xml lists exactly the three apex pages, with no lastmod', () => {
		const xml = read('static/sitemap.xml');
		assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
		assert.ok(xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'));
		const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
		assert.deepEqual(locs, [
			'https://deploybot.dev/',
			'https://deploybot.dev/privacy',
			'https://deploybot.dev/terms'
		]);
		assert.equal(xml.includes('lastmod'), false);
	});

	test('robots.txt names the apex sitemap', () => {
		assert.ok(read('static/robots.txt').split('\n').includes('Sitemap: https://deploybot.dev/sitemap.xml'));
	});
});
