import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render } from 'svelte/server';
import {
	JOIN_DIALOG_CLOSED,
	PLACEHOLDER_SERVER,
	agentPrompt,
	closeNeedsConfirm,
	enrolCommand,
	joinPollId,
	loopbackWs,
	nextJoinDialog,
	type EnrolStatus,
	type JoinDialogEvent,
	type JoinDialogFocus,
	type JoinDialogState
} from '../src/lib/add-host.ts';
import type { CreatedJoin } from '../src/lib/api-types.ts';
import { acceptedInstallServer, acceptedServerUrl } from '../src/lib/server/validate.ts';
import AddHostGuide from '../src/routes/projects/[id]/AddHostGuide.svelte';
import AddHostSection from '../src/routes/projects/[id]/AddHostSection.svelte';
import JoinTokenResult from '../src/routes/projects/[id]/JoinTokenResult.svelte';
import { JOIN, PROJECT } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

const ID = '00000000-0000-4000-8000-000000000070';
const OTHER_ID = '00000000-0000-4000-8000-000000000071';
const SERVER = 'wss://api.example/agent/v1/ws';
const CREATED: CreatedJoin = { id: ID, token: JOIN, server: SERVER };

const WAITING: EnrolStatus = { kind: 'waiting' };
const TIMEOUT: EnrolStatus = { kind: 'timeout', expiresAt: null };
const ENROLLED: EnrolStatus = { kind: 'enrolled', name: 'pi5', status: 'online' };
const REVOKED: EnrolStatus = { kind: 'ended', reason: 'revoked' };
const EXPIRED: EnrolStatus = { kind: 'ended', reason: 'expired' };

function strip(html: string): string {
	return html.replace(/<!--[\s\S]*?-->/g, '');
}

function command(server: string): string {
	return `printf '%s' '${JOIN}' | sudo -u bot-agent bot-agent init --server '${server}' --join-token-stdin`;
}

test('a server URL is accepted only as plain wss://, or ws:// on loopback, with nothing a shell or a reader could misread', () => {
	for (const ok of [SERVER, 'wss://api.deploybot.dev/agent/v1/ws', 'wss://10.0.0.5:8443/agent', 'ws://127.0.0.1:8090/agent/v1/ws', 'ws://localhost:8090/x', 'ws://[::1]:8090/x', 'wss://[2001:db8::1]/agent']) {
		assert.equal(acceptedServerUrl(ok), ok, ok);
		assert.equal(acceptedInstallServer(command(ok), JOIN), ok, ok);
	}
	const rejected = [
		'wss://api.example/a`id`',
		'wss://api.example/$HOME',
		'wss://api.example/$(id)',
		"wss://api.example/a'b",
		'wss://api.example/a"b',
		'wss://api.example/a b',
		'wss://api.example/‮evil',
		'wss://api.example/​x',
		'wss://ap​i.example/x',
		'wss://user:pass@api.example/x',
		'wss://user@api.example/x',
		'wss://api.example/x?a=1',
		'wss://api.example/x#frag',
		'wss://api.example/%2e%2e',
		'http://api.example/x',
		'https://api.example/x',
		'javascript:alert(1)',
		'ws://api.example/x',
		'ws://evil.example/x',
		'ws://127.0.0.1.evil.example/x',
		'wss://',
		'',
		'api.example/x'
	];
	for (const bad of rejected) {
		assert.equal(acceptedServerUrl(bad), null, JSON.stringify(bad));
		// The fixed command form already refuses quotes and spaces; everything else falls to the URL check.
		assert.equal(acceptedInstallServer(command(bad), JOIN), null, JSON.stringify(bad));
	}
	// The server must not contain the token.
	assert.equal(acceptedInstallServer(command(`wss://api.example/${JOIN}`), JOIN), null);
});

test('with a server the prompt puts the URL on its own line and never carries the token', () => {
	const prompt = agentPrompt(PROJECT.slug, SERVER);
	const lines = prompt.split('\n');
	assert.equal(lines.length, 6);
	assert.equal(
		lines[3],
		'Stop before enrolment. Give me the enrol command from the "next:" line of the install output with <server URL> replaced by the URL on the next line. I will run it myself and type the join token.'
	);
	assert.equal(lines[4], SERVER);
	assert.equal(lines[5], 'Never ask for, read, or handle the join token.');
	assert.match(lines[0] ?? '', /Deploybot project "lab"/);
	assert.equal(prompt.includes(JOIN), false);
	assert.doesNotMatch(prompt, /join-plain|--join-token/);
	// The other lines match the prompt without a server.
	const plain = agentPrompt(PROJECT.slug).split('\n');
	assert.deepEqual([...lines.slice(0, 3), lines[5]], [...plain.slice(0, 3), plain[4]]);
	assert.equal(plain.length, 5);
	assert.match(plain[3] ?? '', /<server URL> left as is/);
	assert.equal(agentPrompt(PROJECT.slug, null), agentPrompt(PROJECT.slug));
	assert.equal(agentPrompt(PROJECT.slug, ''), agentPrompt(PROJECT.slug));
});

test('the enrol command quotes the server, adds --insecure-dev only for loopback ws, and falls back to a placeholder', () => {
	assert.equal(enrolCommand(SERVER), `sudo ./install.sh enroll --server '${SERVER}' --runner`);
	assert.equal(enrolCommand(null), `sudo ./install.sh enroll --server '${PLACEHOLDER_SERVER}' --runner`);
	for (const local of ['ws://127.0.0.1:8090/agent/v1/ws', 'ws://localhost:8090/x', 'ws://[::1]:8090/x']) {
		assert.equal(loopbackWs(local), true, local);
		assert.equal(enrolCommand(local), `sudo ./install.sh enroll --server '${local}' --runner --insecure-dev`);
	}
	for (const remote of [SERVER, 'wss://127.0.0.1/x', 'ws://evil.example/x', 'ws://user:p@127.0.0.1/x', 'not a url', null]) {
		assert.equal(loopbackWs(remote), false, String(remote));
	}
	assert.equal(enrolCommand(SERVER).includes(JOIN), false);
});

test('closing asks first only while the host may still enrol', () => {
	assert.equal(closeNeedsConfirm(WAITING), true);
	assert.equal(closeNeedsConfirm(TIMEOUT), true);
	for (const status of [ENROLLED, REVOKED, EXPIRED, null]) assert.equal(closeNeedsConfirm(status), false);
});

test('the join dialog reducer', () => {
	const form: JoinDialogState = { open: true, confirming: false, shownId: null, sent: false };
	const result: JoinDialogState = { open: true, confirming: false, shownId: ID, sent: false };
	const confirm: JoinDialogState = { ...result, confirming: true };
	const closed = { open: false, confirming: false, shownId: null, sent: false };
	const rows: Array<[string, JoinDialogState, JoinDialogEvent, JoinDialogState, JoinDialogFocus]> = [
		['the trigger opens an empty form', JOIN_DIALOG_CLOSED, { type: 'open-request' }, form, null],
		['submit marks the form sent', form, { type: 'submit' }, { ...form, sent: true }, null],
		['a failure reopens the form with its message', JOIN_DIALOG_CLOSED, { type: 'failed' }, { ...form, sent: true }, 'error'],
		['a created token shows the result', { ...form, sent: true }, { type: 'created', id: ID }, result, 'copy-instructions'],
		['a created token after Escape opens again', JOIN_DIALOG_CLOSED, { type: 'created', id: ID }, result, 'copy-instructions'],
		['a new token resets the confirm', confirm, { type: 'created', id: OTHER_ID }, { ...result, shownId: OTHER_ID }, 'copy-instructions'],
		['closing the empty form closes', { ...form, sent: true }, { type: 'close-request', status: null }, closed, null],
		['closing while waiting asks', result, { type: 'close-request', status: WAITING }, confirm, 'keep-open'],
		['closing after the timeout asks', result, { type: 'close-request', status: TIMEOUT }, confirm, 'keep-open'],
		['closing after enrolled closes and drops the token', result, { type: 'close-request', status: ENROLLED }, closed, null],
		['closing after revoked closes', result, { type: 'close-request', status: REVOKED }, closed, null],
		['closing after expired closes', result, { type: 'close-request', status: EXPIRED }, closed, null],
		['Escape on the confirm goes back to the result', confirm, { type: 'close-request', status: WAITING }, result, 'close'],
		['Keep open goes back to the result', confirm, { type: 'keep-open' }, result, 'close'],
		// The confirm stays up through the close animation; the token and sent flag are gone at once.
		['Close anyway closes and drops the token', { ...confirm, sent: true }, { type: 'close-anyway' }, { open: false, confirming: true, shownId: null, sent: false }, null],
		['enrolled during the confirm goes back to the result', confirm, { type: 'enrolment', status: ENROLLED }, result, 'close'],
		['ended during the confirm goes back to the result', confirm, { type: 'enrolment', status: REVOKED }, result, 'close'],
		['still waiting keeps the confirm', confirm, { type: 'enrolment', status: WAITING }, confirm, null],
		['an enrolment update without the confirm changes nothing', result, { type: 'enrolment', status: ENROLLED }, result, null],
		['the end of the close animation resets everything', { open: false, confirming: true, shownId: null, sent: false }, { type: 'closed' }, closed, null],
		['a close animation that ends after reopening is ignored', form, { type: 'closed' }, form, null]
	];
	for (const [name, state, event, expected, focus] of rows) {
		const next = nextJoinDialog(state, event);
		assert.deepEqual(next.state, expected, name);
		assert.equal(next.focus, focus, name);
	}
	// Reopening during the close animation shows the form, not the old token.
	const reopened = nextJoinDialog(nextJoinDialog(confirm, { type: 'close-anyway' }).state, { type: 'open-request' }).state;
	assert.deepEqual(reopened, form);
});

test('the poller runs only for the shown token while the dialog is open', () => {
	const result: JoinDialogState = { open: true, confirming: false, shownId: ID, sent: false };
	assert.equal(joinPollId(result, ID), ID);
	assert.equal(joinPollId({ ...result, confirming: true }, ID), ID, 'it keeps running during the confirm');
	assert.equal(joinPollId({ ...result, open: false }, ID), null, 'closing disposes it');
	assert.equal(joinPollId(nextJoinDialog(result, { type: 'close-request', status: ENROLLED }).state, ID), null);
	assert.equal(joinPollId(result, OTHER_ID), null);
	assert.equal(joinPollId(result, null), null);
	assert.equal(joinPollId(JOIN_DIALOG_CLOSED, ID), null);
});

test('the result view: copy instructions, the token once under its notice, the manual path, and the live status', () => {
	const view = (enrolment: EnrolStatus | null, message: string | null = null, created = CREATED) =>
		strip(render(JoinTokenResult, { props: { created, slug: PROJECT.slug, enrolment, message, copyId: 'join-token-copy-instructions' } }).body);
	const live = (html: string) => html.match(/<p[^>]*aria-live="polite"[^>]*>([\s\S]*?)<\/p>/)?.[1]?.trim() ?? '';

	const html = view(WAITING);
	const order = ['Copy instructions for your AI agent', 'Copy this now.', JOIN, 'Copy token', 'Or enrol the host yourself:', 'Enrol command', '<p class="text-sm" aria-live="polite"'].map((needle) =>
		html.indexOf(needle)
	);
	assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])), String(order));
	assert.equal(html.split(JOIN).length - 1, 1, 'the token appears once');
	assert.equal(html.includes('shown once'), false);
	// The copy button carries its focus id and wraps at phone width.
	const copy = html.match(/<button\b[^>]*id="join-token-copy-instructions"[^>]*>/)?.[0] ?? '';
	assert.match(copy, /whitespace-normal/);
	assert.match(copy, /h-auto/);
	assert.doesNotMatch(copy, /whitespace-nowrap/);

	assert.equal(live(html), 'Waiting for the host to enrol…');
	assert.equal(live(view(ENROLLED)), 'Enrolled: pi5 is online.');
	assert.equal(live(view(REVOKED)), 'This token was revoked.');
	assert.equal(live(view(EXPIRED)), 'This token has expired. Create a new one.');
	assert.match(live(view(TIMEOUT)), /^Stopped checking after 15 minutes\./);
	for (const status of [WAITING, ENROLLED, REVOKED, EXPIRED, TIMEOUT]) assert.equal(live(view(status)).includes(JOIN), false);

	const note = view(WAITING, 'Server URL not shown: unexpected format', { ...CREATED, server: null });
	assert.match(note, /<div class="max-w-full min-w-0 break-words">[\s\S]*?Server URL not shown: unexpected format/);
	assert.equal(note.includes(PLACEHOLDER_SERVER.replace('<', '&lt;')), true);
});

test('the Hosts tab: the token is only ever inside the dialog, and the guide has no copy button', () => {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=hosts`);
	const props = { tokens: [], hosts: [], slug: PROJECT.slug, open: false };
	// Dialog content is portaled on the client, so the server render has the trigger and its state only.
	const shown = strip(render(AddHostSection, { props: { ...props, created: CREATED } }).body);
	assert.match(shown, /<button\b[^>]*id="create-join-token"[^>]*aria-expanded="true"/);
	assert.equal(shown.includes(JOIN), false);
	assert.doesNotMatch(shown, /<p[^>]*aria-live="polite"/);
	const none = strip(render(AddHostSection, { props: { ...props, created: null, message: 'Expiry must be between 300 and 604800 seconds, or blank.' } }).body);
	assert.match(none, /<button\b[^>]*id="create-join-token"[^>]*aria-expanded="false"/);
	assert.match(none, /id="new-host"/);
	assert.equal(none.includes('Expiry must be'), false, 'the create message is only in the dialog');

	const guide = strip(render(AddHostGuide, { props: { slug: PROJECT.slug, open: true } }).body);
	assert.equal(guide.includes('Copy instructions for your AI agent'), false);
	assert.match(guide, /Create a join token to get instructions for your AI agent\./);
});
