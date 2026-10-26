import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { render } from 'svelte/server';
import { parseCreatedJoin } from '../src/lib/server/shape.ts';
import CommandBlock from '../src/lib/components/CommandBlock.svelte';
import ProjectPage from '../src/routes/projects/[id]/+page.svelte';
import HostsSection from '../src/routes/projects/[id]/HostsSection.svelte';
import TokensSection from '../src/routes/projects/[id]/TokensSection.svelte';
import type { CreatedJoin, Host } from '../src/lib/api-types.ts';
import { JOIN, PROJECT, USER } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

const SERVER = 'wss://api.example/agent';
const TOKEN_ID = '00000000-0000-4000-8000-000000000070';
const RELEASES = 'https://github.com/more-than-code/bot-agent/releases/latest';
const GUIDE = 'https://github.com/more-than-code/bot-agent/blob/dev/docs/install.md';
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

const HOST: Host = {
	id: '00000000-0000-4000-8000-000000000080',
	project_id: PROJECT.id,
	name: 'pi5',
	node_type: 'pi',
	os: 'linux',
	arch: 'arm64',
	always_on: true,
	agent_version: '0.2.18',
	status: 'online',
	last_seen_at: '2026-10-26T10:01:00Z',
	enrolled_at: '2026-10-26T10:01:00Z',
	revoked_at: null,
	relation: 'owner',
	share_level: null,
	programs: null
};

/** The project page on the Hosts tab, as the server render shows it. */
function renderHosts(
	created: CreatedJoin | null,
	hasHosts: boolean,
	message: string | null = null,
	hostsMessage: string | null = null,
	canAdmin = true
): string {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=hosts`);
	const data = {
		project: { ...PROJECT, role: canAdmin ? 'admin' : 'viewer' },
		userId: USER.id,
		message: null,
		tab: 'hosts' as const,
		canAdmin,
		canOwner: false,
		hosts: hasHosts ? [HOST] : [],
		hostsOmitted: 0,
		hostsTruncated: false,
		hostsMessage,
		members: [],
		tokens: [],
		tokensOmitted: 0,
		tokensTruncated: false,
		tokensMessage: null
	};
	const form = created || message ? { scope: 'hosts', created: created ?? undefined, message: message ?? undefined } : null;
	return render(ProjectPage, { props: { data: data as never, form: form as never } }).body;
}

test('a created token is only in the token display and the Copy token value', () => {
	const html = renderHosts({ id: TOKEN_ID, token: JOIN, server: SERVER }, false);
	const display = html.match(/<p class="font-mono text-sm break-all">([^<]*)<\/p>/);
	assert.equal(display?.[1], JOIN);
	assert.equal(times(html, JOIN), 1);
	assert.equal(ENROL.includes(JOIN), false);
	assert.equal(html.includes('Copy install command'), false);
	assert.equal(html.includes('install_command'), false);
	assert.equal(html.includes(ENROL), true);
	assert.equal(html.includes(SERVER), true);
	assert.match(html, /Paste the join token at the hidden prompt\. Do not put it on the command line\./);

	const placeholder = renderHosts({ id: TOKEN_ID, token: JOIN, server: null }, true, 'Server URL not shown: unexpected format');
	assert.equal(decode(placeholder).includes(PLACEHOLDER), true);
	assert.equal(PLACEHOLDER.includes(JOIN), false);
	assert.equal(placeholder.includes('Server URL not shown: unexpected format'), true);
	assert.equal(times(placeholder, JOIN), 1);
	assert.equal(placeholder.includes('Copy install command'), false);

	const dev = decode(renderHosts({ id: TOKEN_ID, token: JOIN, server: 'ws://127.0.0.1:8090/agent/v1/ws' }, false));
	assert.equal(dev.includes("sudo ./install.sh enroll --server 'ws://127.0.0.1:8090/agent/v1/ws' --runner --insecure-dev"), true);
	assert.equal(decode(html).includes('--insecure-dev'), false);
	assert.equal(decode(placeholder).includes('--insecure-dev'), false);
	const remote = decode(renderHosts({ id: TOKEN_ID, token: JOIN, server: 'ws://evil.example/x' }, false));
	assert.equal(remote.includes("--server 'ws://evil.example/x' --runner"), true);
	assert.equal(remote.includes('--insecure-dev'), false);

	const source = readFileSync(new URL('../src/routes/projects/[id]/AddHostSection.svelte', import.meta.url), 'utf8');
	const copies = [...source.matchAll(/<CopyButton\b[\s\S]*?\/>/g)].map((match) => match[0]);
	assert.deepEqual(copies, ['<CopyButton value={created.token} label="Copy token" />']);
	// The created-token card sits above the guide, the form and the hosts list.
	const order = ['Copy this now.', 'Add a host</summary>', 'Create a join token', 'id="hosts-heading"'].map((needle) => html.indexOf(needle));
	assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])), String(order));
});

test('parseCreatedJoin keeps the server from a valid command and drops a hostile one', () => {
	assert.deepEqual(parseCreatedJoin({ id: TOKEN_ID, token: JOIN, install_command: command(JOIN, SERVER) }), {
		id: TOKEN_ID,
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
		assert.deepEqual(parseCreatedJoin({ id: TOKEN_ID, token: JOIN, install_command }), { id: TOKEN_ID, token: JOIN, server: null });
	}
	assert.deepEqual(parseCreatedJoin({ id: TOKEN_ID, token: JOIN }), { id: TOKEN_ID, token: JOIN, server: null });
	assert.deepEqual(parseCreatedJoin({ id: TOKEN_ID, token: JOIN, install_command: null }), { id: TOKEN_ID, token: JOIN, server: null });
	assert.equal(parseCreatedJoin({ id: TOKEN_ID, token: 'short', install_command: command('short', SERVER) }), null);
	assert.equal(parseCreatedJoin(null), null);
});

test('the add-a-host guide shows the slug and both links, and starts open with no hosts', () => {
	const open = renderHosts(null, false);
	assert.equal(detailsOpen(open), true);
	const guide = open.match(/<details\b[\s\S]*?<\/details>/)?.[0] ?? '';
	assert.equal(guide.match(/<li\b/g)?.length, 6);
	assert.match(open, /<\/summary>\s*<p>An AI agent can run these steps for you\.[^<]*<\/p>\s*<div>[\s\S]*?Copy instructions for your AI agent[\s\S]*?<\/div>\s*<p>Run the commands below on the host you are adding \(for example over ssh -t\)\.<\/p>\s*<ol\b/);
	assert.equal(open.includes('projects = ["lab"]'), true);
	assert.equal(open.includes('sudo ./install.sh check --runner'), true);
	assert.equal(open.includes('sudo ./install.sh install --runner'), true);
	assert.equal(open.includes('sha256sum -c'), true);
	assert.match(open, /The host appears in the list below as online\./);
	for (const href of [RELEASES, GUIDE]) {
		const tag = anchors(open).find((anchor) => anchor.includes(`href="${href}"`));
		assert.ok(tag, href);
		assert.match(tag, /rel="noopener noreferrer"/);
		assert.match(tag, /target="_blank"/);
	}
	assert.match(open, /latest bot-agent release<span class="sr-only"> \(opens in a new tab\)<\/span>/);
	assert.match(open, /Full guide, including troubleshooting<span class="sr-only"> \(opens in a new tab\)<\/span>/);

	const closed = renderHosts(null, true);
	assert.equal(detailsOpen(closed), false);
	assert.equal(closed.includes('projects = ["lab"]'), true);
});

test('an empty host list links an admin to the Add a host card and tells a viewer to ask', () => {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=hosts`);
	const admin = render(HostsSection, {
		props: { hosts: [], omitted: 0, truncated: false, canAdmin: true, message: null, hostsMessage: null }
	}).body.replace(/<!--[\s\S]*?-->/g, '');
	assert.match(admin, /No hosts enrolled\. <a\b[^>]*class="text-primary underline underline-offset-4"[^>]*href="#new-host"[^>]*>Add a host<\/a>/);
	assert.equal(admin.includes('hover:underline'), false);
	assert.equal(admin.includes('Ask a project admin'), false);

	const viewer = render(HostsSection, {
		props: { hosts: [], omitted: 0, truncated: false, canAdmin: false, message: null, hostsMessage: null }
	}).body.replace(/<!--[\s\S]*?-->/g, '');
	assert.match(viewer, /No hosts enrolled\. Ask a project admin to add one\./);
	assert.equal(viewer.includes('Add a host'), false);
	assert.equal(viewer.includes('tab=tokens'), false);
});

test('the Hosts tab shows the Add a host card to an admin only, and the tokens tab links to it', () => {
	const admin = renderHosts(null, false);
	assert.match(admin, /id="new-host"/);
	assert.match(admin, /Create a join token/);
	assert.match(admin, /action="\?tab=hosts&amp;\/createToken"|action="[^"]*tab=hosts[^"]*createToken"/);

	const viewer = renderHosts(null, false, null, null, false);
	assert.equal(viewer.includes('id="new-host"'), false);
	assert.equal(viewer.includes('Create a join token'), false);
	assert.equal(viewer.includes('Copy instructions for your AI agent'), false);
	assert.match(viewer.replace(/<!--[\s\S]*?-->/g, ''), /No hosts enrolled\. Ask a project admin to add one\./);

	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=tokens`);
	const tokens = render(TokensSection, { props: { tokens: [], omitted: 0, truncated: false, canAdmin: true, message: null } }).body;
	assert.match(tokens, /Create join tokens from <a\b[^>]*href="\?tab=hosts#new-host"[^>]*>Hosts → Add a host<\/a>\./);
	assert.equal(tokens.includes('Create a join token'), false);
	assert.equal(tokens.includes('<form'), false);
	assert.equal(tokens.includes('Add a host</summary>'), false);
	assert.match(tokens, /No join tokens\./);

	const server = readFileSync(new URL('../src/routes/projects/[id]/+page.server.ts', import.meta.url), 'utf8');
	assert.match(server, /tab === 'hosts' \|\| tab === 'services' \|\| tab === 'catalog'\n/);
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
	const html = renderHosts(null, false, null, 'Could not load hosts.');
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
