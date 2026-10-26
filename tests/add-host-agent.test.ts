import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, mock, test } from 'node:test';
import { render } from 'svelte/server';
import { ENROL_WAIT_MS, agentPrompt, createEnrolPoller, enrolStatus, type EnrolStatus, type VisibilityDoc } from '../src/lib/add-host.ts';
import type { CreatedJoin, Host, JoinToken } from '../src/lib/api-types.ts';
import { parseCreatedJoin } from '../src/lib/server/shape.ts';
import AddHostGuide from '../src/routes/projects/[id]/AddHostGuide.svelte';
import AddHostSection from '../src/routes/projects/[id]/AddHostSection.svelte';
import { load as projectLoad } from '../src/routes/projects/[id]/+page.server.ts';
import { JOIN, PROJECT, USER, envelope, fakeEvent, installFetch, restoreEnv, useApi } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

const TOKEN_ID = '00000000-0000-4000-8000-000000000070';
const HOST_ID = '00000000-0000-4000-8000-000000000080';
const CREATED: CreatedJoin = { id: TOKEN_ID, token: JOIN, server: 'wss://api.example/agent' };
const START = Date.parse('2026-10-26T10:00:00Z');

const TOKEN: JoinToken = {
	id: TOKEN_ID,
	host_name_hint: 'pi5',
	created_by: USER.id,
	created_at: '2026-10-26T10:00:00Z',
	expires_at: '2026-10-27T10:00:00Z',
	used_at: null,
	used_by_host_id: null,
	revoked_at: null
};

const HOST: Host = {
	id: HOST_ID,
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

const originalFetch = globalThis.fetch;
after(() => {
	globalThis.fetch = originalFetch;
	restoreEnv();
});

const used: JoinToken = { ...TOKEN, used_at: '2026-10-26T10:01:00Z', used_by_host_id: HOST_ID };

test('the agent prompt names the slug, the guide and the stop rules, and carries no token or server', () => {
	const prompt = agentPrompt(PROJECT.slug);
	assert.match(prompt, /Deploybot project "lab"/);
	assert.equal(prompt.includes('--project lab'), true);
	assert.equal(prompt.includes('https://deploybot.dev/llms.txt'), true);
	assert.equal(prompt.includes('"Enrol with an AI agent"'), true);
	assert.match(prompt, /show me the install command and stop until I agree\. If this host only runs catalog images, it uses the policy flags \(--project lab, the --image patterns, --enable\)/);
	assert.match(prompt, /Stop before enrolment\. Give me the enrol command from the "next:" line[^\n]*<server URL> left as is[^\n]*run it myself\./);
	assert.match(prompt, /Never ask for, read, or handle the join token\./);
	assert.equal(prompt.includes(JOIN), false);
	assert.doesNotMatch(prompt, /join-plain|[A-Za-z0-9_-]{24,}/);
	assert.doesNotMatch(prompt, /wss?:\/\/|api\.deploybot|api2\.|--server|127\.0\.0\.1|localhost/);
	const urls = [...prompt.matchAll(/https?:\/\/\S+/g)].map((match) => match[0]);
	assert.deepEqual(urls, ['https://deploybot.dev/llms.txt']);
});

test('parseCreatedJoin keeps a valid id and rejects a bad or missing one', () => {
	assert.deepEqual(parseCreatedJoin({ id: TOKEN_ID, token: JOIN }), { id: TOKEN_ID, token: JOIN, server: null });
	for (const id of ['not-a-uuid', `${TOKEN_ID}0`, '', 7, null, undefined]) {
		assert.equal(parseCreatedJoin({ id, token: JOIN }), null, String(id));
	}
});

test('enrolStatus waits, reports the enrolled host, ends, and times out', () => {
	assert.deepEqual(enrolStatus(CREATED, [], [], START, START), { kind: 'waiting' });
	assert.deepEqual(enrolStatus(CREATED, [TOKEN], [HOST], START + 5000, START), { kind: 'waiting' });
	// Used, but the host list has not caught up yet.
	assert.deepEqual(enrolStatus(CREATED, [used], [], START + 5000, START), { kind: 'waiting' });
	// Another token's host does not count.
	assert.deepEqual(enrolStatus(CREATED, [{ ...used, id: HOST_ID }], [HOST], START + 5000, START), { kind: 'waiting' });
	assert.deepEqual(enrolStatus(CREATED, [used], [HOST], START + 5000, START), { kind: 'enrolled', name: 'pi5', status: 'online' });
	assert.deepEqual(enrolStatus(CREATED, [used], [{ ...HOST, status: 'offline' }], START + ENROL_WAIT_MS + 1, START), {
		kind: 'enrolled',
		name: 'pi5',
		status: 'offline'
	});
	assert.deepEqual(enrolStatus(CREATED, [TOKEN], [], START + ENROL_WAIT_MS - 1, START), { kind: 'waiting' });
	assert.deepEqual(enrolStatus(CREATED, [TOKEN], [], START + ENROL_WAIT_MS, START), { kind: 'timeout', expiresAt: TOKEN.expires_at });
	assert.deepEqual(enrolStatus(CREATED, [], [], START + ENROL_WAIT_MS, START), { kind: 'timeout', expiresAt: null });

	const revoked = { ...TOKEN, revoked_at: '2026-10-26T10:02:00Z' };
	assert.deepEqual(enrolStatus(CREATED, [revoked], [], START + 5000, START), { kind: 'ended', reason: 'revoked' });
	const soon = { ...TOKEN, expires_at: '2026-10-26T10:05:00Z' };
	const expiry = Date.parse(soon.expires_at);
	assert.deepEqual(enrolStatus(CREATED, [soon], [], expiry - 1, START), { kind: 'waiting' });
	assert.deepEqual(enrolStatus(CREATED, [soon], [], expiry, START), { kind: 'ended', reason: 'expired' });
	assert.deepEqual(enrolStatus(CREATED, [soon], [], START + ENROL_WAIT_MS, START), { kind: 'ended', reason: 'expired' });
	// The host is listed: enrolled wins over a later revoke or expiry.
	assert.deepEqual(enrolStatus(CREATED, [{ ...used, revoked_at: '2026-10-26T10:02:00Z', expires_at: soon.expires_at }], [HOST], expiry + 1, START), {
		kind: 'enrolled',
		name: 'pi5',
		status: 'online'
	});
});

class FakeDoc implements VisibilityDoc {
	visibilityState: DocumentVisibilityState = 'visible';
	listeners = new Set<() => void>();
	addEventListener(_type: 'visibilitychange', listener: () => void) {
		this.listeners.add(listener);
	}
	removeEventListener(_type: 'visibilitychange', listener: () => void) {
		this.listeners.delete(listener);
	}
	set(state: DocumentVisibilityState) {
		this.visibilityState = state;
		for (const listener of this.listeners) listener();
	}
}

/** Lets resolved refresh promises run their callbacks. */
async function settle() {
	for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

test('the poller refreshes while waiting and visible, and stops on hide, dispose, and a final status', async (t) => {
	t.mock.timers.enable({ apis: ['setInterval'] });
	const doc = new FakeDoc();
	let waiting = true;
	let refreshes = 0;
	const poller = createEnrolPoller({
		isWaiting: () => waiting,
		refresh: async () => {
			refreshes += 1;
		},
		doc,
		intervalMs: 5000
	});
	poller.start();
	assert.equal(refreshes, 0);
	t.mock.timers.tick(5000);
	await settle();
	assert.equal(refreshes, 1);
	t.mock.timers.tick(5000);
	await settle();
	assert.equal(refreshes, 2);

	doc.set('hidden');
	t.mock.timers.tick(60_000);
	await settle();
	assert.equal(refreshes, 2);

	doc.set('visible');
	await settle();
	assert.equal(refreshes, 3, 'visible refreshes at once');
	t.mock.timers.tick(5000);
	await settle();
	assert.equal(refreshes, 4, 'and restarts the timer');

	// Enrolled, ended or timed out: no further refresh, and coming back visible does not restart it.
	waiting = false;
	t.mock.timers.tick(5000);
	await settle();
	doc.set('hidden');
	doc.set('visible');
	t.mock.timers.tick(30_000);
	await settle();
	assert.equal(refreshes, 4);

	waiting = true;
	poller.dispose();
	assert.equal(doc.listeners.size, 0);
	doc.set('visible');
	t.mock.timers.tick(30_000);
	await settle();
	assert.equal(refreshes, 4);
});

test('the poller does not start when not waiting or hidden', async (t) => {
	t.mock.timers.enable({ apis: ['setInterval'] });
	let refreshes = 0;
	const refresh = async () => {
		refreshes += 1;
	};
	const idle = createEnrolPoller({ isWaiting: () => false, refresh, doc: new FakeDoc(), intervalMs: 5000 });
	idle.start();
	t.mock.timers.tick(30_000);
	await settle();
	assert.equal(refreshes, 0);
	idle.dispose();

	const doc = new FakeDoc();
	doc.visibilityState = 'hidden';
	const hidden = createEnrolPoller({ isWaiting: () => true, refresh, doc, intervalMs: 5000 });
	hidden.start();
	t.mock.timers.tick(30_000);
	await settle();
	assert.equal(refreshes, 0);
	hidden.dispose();
});

test('the poller never overlaps refreshes and survives a rejected one', async (t) => {
	t.mock.timers.enable({ apis: ['setInterval'] });
	const unhandled: unknown[] = [];
	const onUnhandled = (reason: unknown) => unhandled.push(reason);
	process.on('unhandledRejection', onUnhandled);
	t.after(() => process.off('unhandledRejection', onUnhandled));

	let calls = 0;
	let release: (() => void) | undefined;
	let fail = false;
	const poller = createEnrolPoller({
		isWaiting: () => true,
		refresh: () => {
			calls += 1;
			if (fail) return Promise.reject(new Error('load failed'));
			return new Promise<void>((resolve) => {
				release = resolve;
			});
		},
		doc: new FakeDoc(),
		intervalMs: 5000
	});
	poller.start();
	t.mock.timers.tick(5000);
	t.mock.timers.tick(5000);
	t.mock.timers.tick(5000);
	await settle();
	assert.equal(calls, 1, 'one refresh in flight at a time');
	release?.();
	await settle();
	t.mock.timers.tick(5000);
	await settle();
	assert.equal(calls, 2);

	release?.();
	await settle();
	fail = true;
	t.mock.timers.tick(5000);
	await settle();
	t.mock.timers.tick(5000);
	await settle();
	assert.equal(calls, 4, 'a failed refresh does not stop the next one');
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(unhandled, []);
	poller.dispose();
});

test('hidden for 16 minutes with the host enrolled at minute 10 settles on enrolled, not timeout', async (t) => {
	t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: START });
	const doc = new FakeDoc();
	// The component's state: data and `now` move together when a refresh lands.
	let tokens: JoinToken[] = [TOKEN];
	let hosts: Host[] = [];
	let now = Date.now();
	const status = (): EnrolStatus => enrolStatus(CREATED, tokens, hosts, now, START);
	// The server: the host enrols at minute 10.
	const enrolledAt = START + 10 * 60 * 1000;
	const poller = createEnrolPoller({
		isWaiting: () => status().kind === 'waiting',
		refresh: async () => {
			const at = Date.now();
			tokens = [at >= enrolledAt ? used : TOKEN];
			hosts = at >= enrolledAt ? [HOST] : [];
			now = at;
		},
		doc,
		intervalMs: 5000
	});
	poller.start();
	t.mock.timers.tick(5000);
	await settle();
	assert.equal(status().kind, 'waiting');

	doc.set('hidden');
	t.mock.timers.tick(16 * 60 * 1000);
	await settle();
	// Hidden: nothing refreshed, so the status is still read from the old data and old time.
	assert.equal(status().kind, 'waiting');

	doc.set('visible');
	await settle();
	assert.deepEqual(status(), { kind: 'enrolled', name: 'pi5', status: 'online' });
	poller.dispose();
});

test('the guide copies agentPrompt(slug)', () => {
	const html = render(AddHostGuide, { props: { slug: PROJECT.slug, open: true } }).body;
	assert.match(html, /Copy instructions for your AI agent/);
	const source = readFileSync(new URL('../src/routes/projects/[id]/AddHostGuide.svelte', import.meta.url), 'utf8');
	// No DOM in these tests, and CopyButton does not render its value; check the wiring in the source.
	assert.match(source, /const prompt = \$derived\(agentPrompt\(slug\)\);/);
	const copies = [...source.matchAll(/<CopyButton\b[\s\S]*?\/>/g)].map((match) => match[0]);
	assert.deepEqual(copies, ['<CopyButton value={prompt} label="Copy instructions for your AI agent" />']);
});

test('the created-token card shows the enrol status in a polite live region without the token', () => {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=hosts`);
	const props = { created: CREATED, slug: PROJECT.slug, open: false };
	const body = (extra: object) => render(AddHostSection, { props: { ...props, tokens: [TOKEN], hosts: [], ...extra } }).body.replace(/<!--[\s\S]*?-->/g, '');
	const live = (html: string) => html.match(/<p[^>]*aria-live="polite"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '';

	const waiting = body({});
	assert.match(live(waiting), /^\s*Waiting for the host to enrol…\s*$/);
	assert.equal(waiting.split(JOIN).length - 1, 1);
	assert.equal(live(waiting).includes(JOIN), false);

	const enrolled = body({ tokens: [used], hosts: [HOST] });
	assert.match(live(enrolled), /^\s*Enrolled: pi5 is online\.\s*$/);
	assert.equal(enrolled.split(JOIN).length - 1, 1);

	const revoked = body({ tokens: [{ ...TOKEN, revoked_at: '2026-10-26T10:02:00Z' }] });
	assert.match(live(revoked), /^\s*This token was revoked\.\s*$/);
	const expired = body({ tokens: [{ ...TOKEN, expires_at: '2020-01-01T00:00:00Z' }] });
	assert.match(live(expired), /^\s*This token has expired\. Create a new one\.\s*$/);

	const none = body({ created: null });
	assert.equal(none.includes('Waiting for the host to enrol'), false);
	assert.doesNotMatch(none, /<p[^>]*aria-live="polite"[^>]*>/);

	const section = readFileSync(new URL('../src/routes/projects/[id]/AddHostSection.svelte', import.meta.url), 'utf8');
	assert.match(section, /createEnrolPoller\(\{[\s\S]*?await invalidate\('project:enrol'\);\s*now = Date\.now\(\);/);
});

test('the Hosts tab load depends on project:enrol before any early return', async () => {
	useApi('https://api.test');
	installFetch(() => envelope(null, 500, 'error', 'unexpected'));
	for (const [query, expected] of [
		['?tab=hosts', ['project:enrol']],
		['', ['project:enrol']],
		['?tab=tokens', []],
		['?tab=services', []]
	] as const) {
		const { event } = fakeEvent({
			url: `http://console.example/projects/${PROJECT.id}${query}`,
			session: 'session-token-0123456789abcdef',
			user: USER,
			projects: [PROJECT],
			params: { id: PROJECT.id }
		});
		const keys: string[] = [];
		(event as unknown as { depends: (...deps: string[]) => void }).depends = (...deps) => keys.push(...deps);
		// The project GET fails, so the load returns early.
		await projectLoad(event as never);
		assert.deepEqual(keys, expected, query);
	}
});
