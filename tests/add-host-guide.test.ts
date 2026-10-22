import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { render } from 'svelte/server';
import { parseCreatedJoin } from '../src/lib/server/shape.ts';
import CommandBlock from '../src/lib/components/CommandBlock.svelte';
import HostsSection from '../src/routes/projects/[id]/HostsSection.svelte';
import TokensSection from '../src/routes/projects/[id]/TokensSection.svelte';
import { JOIN, PROJECT } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

const SERVER = 'wss://api.example/agent';
const RELEASES = 'https://github.com/more-than-code/bot-agent/releases/latest';
const GUIDE = 'https://github.com/more-than-code/bot-agent/blob/main/docs/install.md';
const ENROL = `sudo ./install.sh enroll --server '${SERVER}' --runner`;
const PLACEHOLDER = "sudo ./install.sh enroll --server '<your server URL>' --runner";

function command(token: string, server: string): string {
	return `printf '%s' '${token}' | sudo -u bot-agent bot-agent init --server '${server}' --join-token-stdin`;
}

function times(html: string, needle: string): number {
	return html.split(needle).length - 1;
}

function decode(value: string): string {
	return value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>');
}

function detailsOpen(html: string): boolean {
	const tag = html.match(/<details\b[^>]*>/)?.[0] ?? '';
	return /\sopen(?:="[^"]*")?(?=[\s>])/.test(tag);
}

function anchors(html: string): string[] {
	return [...html.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]);
}

function renderTokens(
	created: { token: string; server: string | null } | null,
	hasHosts: boolean,
	message: string | null = null,
	hostsMessage: string | null = null
): string {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=tokens`);
	return render(TokensSection, {
		props: {
			tokens: [],
			omitted: 0,
			truncated: false,
			canAdmin: true,
			created,
			message,
			hostsMessage,
			slug: PROJECT.slug,
			hasHosts
		}
	}).body;
}

test('a created token is only in the token display and the Copy token value', () => {
	const html = renderTokens({ token: JOIN, server: SERVER }, false);
	const display = html.match(/<p class="font-mono text-sm break-all">([^<]*)<\/p>/);
	assert.equal(display?.[1], JOIN);
	assert.equal(times(html, JOIN), 1);
	assert.equal(ENROL.includes(JOIN), false);
	assert.equal(html.includes('Copy install command'), false);
	assert.equal(html.includes('install_command'), false);
	assert.equal(html.includes(ENROL), true);
	assert.equal(html.includes(SERVER), true);
	assert.match(html, /Paste the join token at the hidden prompt\. Do not put it on the command line\./);

	const placeholder = renderTokens({ token: JOIN, server: null }, true, 'Server URL not shown: unexpected format');
	assert.equal(decode(placeholder).includes(PLACEHOLDER), true);
	assert.equal(PLACEHOLDER.includes(JOIN), false);
	assert.equal(placeholder.includes('Server URL not shown: unexpected format'), true);
	assert.equal(times(placeholder, JOIN), 1);
	assert.equal(placeholder.includes('Copy install command'), false);

	const source = readFileSync(new URL('../src/routes/projects/[id]/TokensSection.svelte', import.meta.url), 'utf8');
	const copies = [...source.matchAll(/<CopyButton\b[^/]*\/>/g)].map((match) => match[0]);
	assert.deepEqual(copies, ['<CopyButton value={created.token} label="Copy token" />']);
});

test('parseCreatedJoin keeps the server from a valid command and drops a hostile one', () => {
	assert.deepEqual(parseCreatedJoin({ token: JOIN, install_command: command(JOIN, SERVER) }), {
		token: JOIN,
		server: SERVER
	});

	const hostile = [
		command(JOIN, "wss://api.example/a'b"),
		command(JOIN, 'wss://api.example/a b'),
		command(JOIN, 'wss://api.example/$(id)'),
		command('bbbbbbbbbbbbbbbb', SERVER),
		command(JOIN, `wss://api.example/${JOIN}`),
		''
	];
	for (const install_command of hostile) {
		assert.deepEqual(parseCreatedJoin({ token: JOIN, install_command }), { token: JOIN, server: null });
	}
	assert.deepEqual(parseCreatedJoin({ token: JOIN }), { token: JOIN, server: null });
	assert.deepEqual(parseCreatedJoin({ token: JOIN, install_command: null }), { token: JOIN, server: null });
	assert.equal(parseCreatedJoin({ token: 'short', install_command: command('short', SERVER) }), null);
	assert.equal(parseCreatedJoin(null), null);
});

test('the add-a-host guide shows the slug and both links, and starts open with no hosts', () => {
	const open = renderTokens(null, false);
	assert.equal(detailsOpen(open), true);
	assert.equal(open.match(/<li\b/g)?.length, 6);
	assert.equal(open.includes('projects = ["lab"]'), true);
	assert.equal(open.includes('sudo ./install.sh check --runner'), true);
	assert.equal(open.includes('sudo ./install.sh install --runner'), true);
	assert.equal(open.includes('sha256sum -c'), true);
	assert.match(open, /The host appears on the Hosts tab as online\./);
	for (const href of [RELEASES, GUIDE]) {
		const tag = anchors(open).find((anchor) => anchor.includes(`href="${href}"`));
		assert.ok(tag, href);
		assert.match(tag, /rel="noopener noreferrer"/);
		assert.match(tag, /target="_blank"/);
	}
	assert.match(open, /latest bot-agent release<span class="sr-only"> \(opens in a new tab\)<\/span>/);
	assert.match(open, /Full guide, including troubleshooting<span class="sr-only"> \(opens in a new tab\)<\/span>/);

	const closed = renderTokens(null, true);
	assert.equal(detailsOpen(closed), false);
	assert.equal(closed.includes('projects = ["lab"]'), true);
});

test('an empty host list links an admin to join tokens and tells a viewer to ask', () => {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=hosts`);
	const admin = render(HostsSection, {
		props: { hosts: [], omitted: 0, truncated: false, canAdmin: true, message: null, hostsMessage: null }
	}).body.replace(/<!--[\s\S]*?-->/g, '');
	assert.match(admin, /No hosts enrolled\. <a\b[^>]*class="text-primary underline underline-offset-4"[^>]*href="\?tab=tokens"[^>]*>Add a host<\/a>/);
	assert.equal(admin.includes('hover:underline'), false);
	assert.equal(admin.includes('Ask a project admin'), false);

	const viewer = render(HostsSection, {
		props: { hosts: [], omitted: 0, truncated: false, canAdmin: false, message: null, hostsMessage: null }
	}).body.replace(/<!--[\s\S]*?-->/g, '');
	assert.match(viewer, /No hosts enrolled\. Ask a project admin to add one\./);
	assert.equal(viewer.includes('Add a host'), false);
	assert.equal(viewer.includes('tab=tokens'), false);
});

test('the tokens tab loads hosts and passes the slug into the guide', () => {
	const page = readFileSync(new URL('../src/routes/projects/[id]/+page.svelte', import.meta.url), 'utf8');
	const server = readFileSync(new URL('../src/routes/projects/[id]/+page.server.ts', import.meta.url), 'utf8');
	assert.match(page, /slug=\{data\.project\.slug\}/);
	assert.match(page, /hostsMessage=\{data\.hostsMessage\}/);
	assert.match(page, /hasHosts=\{data\.hosts\.length > 0\}/);
	assert.match(server, /tab === 'hosts' \|\| tab === 'services' \|\| tab === 'catalog' \|\| tab === 'tokens'/);
});

test('CommandBlock copies the command and wraps a long line', () => {
	const command = `sudo ./install.sh enroll --server 'wss://api.example/${'a'.repeat(180)}' --runner`;
	const html = render(CommandBlock, {
		props: { command, label: 'Copy enrol command', ariaLabel: 'Enrol command' }
	}).body;
	const pre = html.match(/<pre\b[^>]*>/)?.[0] ?? '';
	assert.match(pre, /\bmin-w-0\b/);
	assert.match(pre, /\bbreak-all\b/);
	assert.match(pre, /\bwhitespace-pre-wrap\b/);
	assert.match(html, /class="grid min-w-0 max-w-full gap-2"/);
	assert.equal(html.includes(command), true);

	const source = readFileSync(new URL('../src/lib/components/CommandBlock.svelte', import.meta.url), 'utf8');
	assert.match(source, /<CopyButton value=\{command\} \{label\} \/>/);
});

test('a failed host list keeps the guide closed and omits the empty-host prompt', () => {
	const html = renderTokens(null, false, null, 'Could not load hosts.');
	assert.equal(detailsOpen(html), false);
	assert.match(html, /role="alert"/);
	assert.match(html, /Could not load hosts\./);

	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=hosts`);
	for (const canAdmin of [true, false]) {
		const body = render(HostsSection, {
			props: { hosts: [], omitted: 0, truncated: false, canAdmin, message: 'Could not load hosts.', hostsMessage: 'Could not load hosts.' }
		}).body;
		assert.match(body, /Could not load hosts\./);
		assert.equal(body.includes('Add a host'), false);
		assert.equal(body.includes('Ask a project admin'), false);
	}
});
