// The /about page structure (umbrella docs/spec-about-page.md rev 1, approved by Joe 2026-10-29).
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { render } from 'svelte/server';
import AboutPage from '../src/routes/(site)/about/+page.svelte';
import { GITHUB_URL, INSTALL_GUIDE_URL, SIGN_IN_URL } from '../src/lib/site/links.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const body = render(AboutPage).body.replace(/<!--[\s\S]*?-->/g, '');

function text(html: string): string {
	return html
		.replace(/<[^>]+>/g, '')
		.replaceAll('&amp;', '&')
		.replaceAll('&quot;', '"')
		.replaceAll('&#39;', "'")
		.replace(/\s+/g, ' ')
		.trim();
}

/** The markup of the section labelled by `id`, up to the next section. */
function section(id: string): string {
	const start = body.indexOf(`aria-labelledby="${id}"`);
	assert.ok(start >= 0, id);
	const end = body.indexOf('<section', start);
	return body.slice(body.indexOf('>', start) + 1, end < 0 ? undefined : end);
}

function anchors(html: string): string[] {
	return [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
}

describe('About page', () => {
	test('one h1, then an h2 per section in the spec order', () => {
		assert.equal(body.match(/<h1\b/g)?.length, 1);
		const sections = [...body.matchAll(/<section\b[^>]*aria-labelledby="([^"]+)"/g)].map((m) => m[1]);
		assert.deepEqual(sections, [
			'hero-title',
			'visual-title',
			'flow-title',
			'compare-title',
			'features-title',
			'ai-title',
			'how-title',
			'source-title',
			'start-title'
		]);
		for (const id of sections.slice(1)) assert.match(body, new RegExp(`<h2 id="${id}"`), id);
		assert.ok(text(section('compare-title')).startsWith('Three ways to let AI run your servers'));
		assert.ok(text(section('ai-title')).startsWith("What the AI can and can't do"));
		assert.ok(text(section('start-title')).startsWith('Get started'));
	});

	test('the comparison table cells match the spec exactly', () => {
		const table = section('compare-title').match(/<table[\s\S]*?<\/table>/)?.[0] ?? '';
		const rows = [...table.matchAll(/<tr\b[\s\S]*?<\/tr>/g)].map((row) =>
			[...row[0].matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((cell) => text(cell[2] ?? ''))
		);
		assert.deepEqual(rows, [
			['Aspect', 'AI in a terminal (SSH)', 'AI with your cloud tokens', 'Deploybot'],
			['What the AI can do', 'Any shell command', 'Anything the token allows', 'Only your catalog'],
			['Safeguard', 'Approving each command', 'Hoping the agent behaves', 'Limited by design, acts as you, confirm step'],
			[
				'Ports and keys',
				'SSH open, keys on a laptop',
				'Long-lived token in a file',
				'Hosts dial out; no open ports; the AI never holds host keys'
			],
			[
				'When nobody is watching',
				'Nothing runs',
				'Nothing runs',
				'Health checks; a failed deploy rolls back (later failures: your policy)'
			],
			['Best for', 'Debugging one box', 'Throwaway projects', 'Running production, teams']
		]);
		assert.equal(table.match(/<th scope="col"/g)?.length, 4);
		assert.equal(table.match(/<th scope="row"/g)?.length, 5);
		assert.match(table, /^<table[^>]*aria-labelledby="compare-title"/);
		assert.match(table, /^<table[^>]*class="[^"]*\bmax-sm:hidden\b/);
	});

	test('on phones the comparison is one card per approach with the same text as the table', () => {
		const compare = section('compare-title');
		const table = compare.match(/<table[\s\S]*?<\/table>/)?.[0] ?? '';
		const tableRows = [...table.matchAll(/<tr\b[\s\S]*?<\/tr>/g)].map((row) =>
			[...row[0].matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((cell) => text(cell[2] ?? ''))
		);
		const [header = [], ...aspectRows] = tableRows;
		const list = compare.match(/<ul\b[^>]*>[\s\S]*?<\/ul>/)?.[0] ?? '';
		assert.match(list, /^<ul[^>]*class="[^"]*\bsm:hidden\b/);
		const cards = [...list.matchAll(/<li\b[\s\S]*?<\/li>/g)].map((m) => m[0]);
		assert.equal(cards.length, 3);
		cards.forEach((card, index) => {
			const column = index + 1;
			assert.equal(text(card.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/)?.[1] ?? ''), header[column]);
			const terms = [...card.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>/g)].map((m) => text(m[1] ?? ''));
			const values = [...card.matchAll(/<dd\b[^>]*>([\s\S]*?)<\/dd>/g)].map((m) => text(m[1] ?? ''));
			assert.deepEqual(terms, aspectRows.map((row) => row[0]));
			assert.deepEqual(values, aspectRows.map((row) => row[column]));
		});
	});

	test('no product names, production names or versions on the page', () => {
		const page = text(body);
		const names = ['Claude', 'Codex', 'Grok', 'Cursor', 'Hatoba', 'ChatGPT', 'Copilot', 'Kubernetes', 'AWS', 'Azure'];
		names.push('Hetzner', 'DigitalOcean', 'Terraform', 'Ansible', 'Portainer', 'Coolify', 'Vercel', 'Gemini', 'OpenAI');
		for (const name of names) {
			assert.equal(page.toLowerCase().includes(name.toLowerCase()), false, name);
		}
		assert.doesNotMatch(body, /\bus1\b|mohiguide|\bapi2\b|console2|\bv\d+\.\d+\.\d+/i);
	});

	test('every image has alt, width and height, and lives under static/brand (served on the apex) below 200 KB', () => {
		const images = [...body.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
		assert.ok(images.length >= 1);
		for (const img of images) {
			assert.match(img, /\balt="[^"]+"/, img);
			assert.match(img, /\bwidth="\d+"/, img);
			assert.match(img, /\bheight="\d+"/, img);
			const src = img.match(/\bsrc="([^"]+)"/)?.[1] ?? '';
			// The deploybot.dev Caddy apex block serves /brand/* but redirects other unknown paths to the console.
			assert.ok(src.startsWith('/brand/'), src);
			assert.ok(statSync(join(root, 'static', src)).size < 200 * 1024, src);
		}
	});

	test('both Get started links reload to sign in; View on GitHub opens the repo in a new tab', () => {
		for (const id of ['hero-title', 'start-title']) {
			const start = anchors(section(id)).filter((a) => a.includes(`href="${SIGN_IN_URL}"`));
			assert.equal(start.length, 1, id);
			assert.ok(start[0]?.includes('data-sveltekit-reload'), id);
		}
		assert.equal(GITHUB_URL, 'https://github.com/more-than-code/deploybot');
		const hero = section('hero-title');
		const github = anchors(hero).find((a) => a.includes(`href="${GITHUB_URL}"`)) ?? '';
		assert.match(github, /target="_blank"/);
		assert.match(github, /rel="noopener noreferrer"/);
		assert.ok(text(hero).includes('View on GitHub (opens in a new tab)'));
		assert.ok(text(hero).includes('Agent for Linux amd64 and arm64 · Open source'));
	});

	test('the MCP captures keep the dev plan and refusal strings, with shortened call and id labelled', () => {
		const visual = section('visual-title');
		const confirm = visual.match(/data-capture="confirm"[\s\S]*?<\/figure>/)?.[0] ?? '';
		const refusal = visual.match(/data-capture="refusal"[\s\S]*?<\/figure>/)?.[0] ?? '';
		assert.ok(text(confirm).includes('deploy_entry entry=web host=pi3-2'));
		assert.ok(text(confirm).includes('"plan": "will deploy web (docker.io/library/nginx:alpine) on pi3-2"'));
		assert.ok(text(confirm).includes('"confirmation_id": "…"'));
		assert.ok(text(refusal).includes('deploy_entry entry=root-shell host=pi3-2'));
		assert.ok(text(refusal).includes('not_found: not found'));
		assert.equal(confirm.match(/>Call \(arguments shortened\)</g)?.length, 1);
		assert.equal(confirm.match(/>Response \(id shortened\)</g)?.length, 1);
		assert.equal(refusal.match(/>Call \(arguments shortened\)</g)?.length, 1);
		assert.equal(refusal.match(/>Response</g)?.length, 1);
		assert.ok(text(refusal).includes("An entry that isn't in your catalog is refused."));
		assert.equal(visual.match(/<figcaption\b/g)?.length, 3);
	});

	test('What you get keeps the former panel facts; the AI section links to /llms.txt', () => {
		const features = text(section('features-title'));
		for (const fact of [
			"Each host's own allowlist of images and projects",
			'Secrets encrypted at rest (env sets, files and registry logins)',
			'Programs run as systemd units and survive reboot',
			'Container logs capped at 10 MB × 3',
			'One-time join tokens for adding hosts (admins)'
		]) {
			assert.ok(features.includes(fact), fact);
		}
		assert.equal(section('features-title').match(/<h3\b/g)?.length, 4);
		const ai = section('ai-title');
		assert.ok(anchors(ai).some((a) => a.includes('href="/llms.txt"')));
		assert.ok(
			text(ai).includes(
				'Deploy, roll back, run, stop and restart catalog entries; read logs, status and metrics; add or change image catalog entries and their health checks. Every change shows a plan first and waits for your confirm, within your role and per-entry rights.'
			)
		);
		assert.ok(text(ai).includes('Open a shell, see secret values, edit hosts, or act beyond your role.'));
	});

	test('every external link opens in a new tab, safely, and says so', () => {
		const external = [...body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].filter((m) =>
			/\bhref="http/.test(m[1] ?? '')
		);
		assert.ok(external.length >= 6, 'GitHub, install guide and the four repos');
		for (const [, attrs = '', inner = ''] of external) {
			assert.match(attrs, /\btarget="_blank"/, attrs);
			assert.match(attrs, /\brel="noopener noreferrer"/, attrs);
			assert.match(inner, /<span class="sr-only">\s*\(opens in a new tab\)<\/span>/, attrs);
		}
		const start = section('start-title');
		assert.ok(anchors(start).some((a) => a.includes(`href="${INSTALL_GUIDE_URL}"`)));
		assert.equal(INSTALL_GUIDE_URL, 'https://github.com/more-than-code/bot-agent/blob/main/docs/install.md');
	});

	test('the diagram is flow only: no panels in either SVG or its desc', () => {
		const diagram = readFileSync(join(root, 'src/lib/site/PitchDiagram.svelte'), 'utf8');
		for (const word of ['SECURITY', 'RESILIENCE', 'VISIBILITY', 'TEAMS']) {
			assert.equal(diagram.includes(word), false, word);
		}
		for (const word of ['Security:', 'Resilience:', 'Visibility:', 'Teams:']) {
			assert.equal(diagram.includes(word), false, word);
		}
		assert.ok(diagram.includes('Anything outside the catalog is refused'));
	});
});
