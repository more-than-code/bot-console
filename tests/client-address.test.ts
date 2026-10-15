import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { isRedirect } from '@sveltejs/kit';
import { apiFetch, apiFetchPublic, loadSession } from '../src/lib/server/api.ts';
import { actions as signInActions } from '../src/routes/signin/+page.server.ts';
import { envelope, fakeEvent, installFetch, PROJECT, restoreEnv, TOKEN, useApi, USER, type FetchCall } from './harness.ts';

const originalFetch = globalThis.fetch;
const IPV4 = '203.0.113.8';
const IPV6 = '2001:db8::1';
const STATE = 'oauth-state-0123456789abcdef';
const SPOOF_ADDRESS = '198.51.100.9';

const SPOOF: Record<string, string> = {
	'x-forwarded-for': `${SPOOF_ADDRESS}, 203.0.113.1`,
	forwarded: `for=${SPOOF_ADDRESS}`,
	'x-real-ip': SPOOF_ADDRESS,
	'x-client-ip': SPOOF_ADDRESS,
	'client-ip': SPOOF_ADDRESS,
	'cf-connecting-ip': SPOOF_ADDRESS,
	'true-client-ip': SPOOF_ADDRESS,
	'fastly-client-ip': SPOOF_ADDRESS,
	'x-cluster-client-ip': SPOOF_ADDRESS,
	'forwarded-for': SPOOF_ADDRESS,
	'x-originating-ip': SPOOF_ADDRESS
};

const BLOCKED = Object.keys(SPOOF).filter((name) => name !== 'x-forwarded-for');

function assertForwarded(call: FetchCall | undefined, address: string | null): void {
	assert.ok(call);
	const values: string[] = [];
	call.headers.forEach((value, name) => {
		if (name === 'x-forwarded-for') values.push(value);
	});
	assert.deepEqual(values, address ? [address] : []);
	for (const name of BLOCKED) assert.equal(call.headers.get(name), null, name);
	assert.equal(call.headers.get('x-forwarded-for')?.includes(SPOOF_ADDRESS) ?? false, false);
}

describe('client address forwarding', { concurrency: false }, () => {
	before(() => {
		useApi('https://api.test');
	});

	after(() => {
		globalThis.fetch = originalFetch;
		restoreEnv();
	});

	test('a session call sets X-Forwarded-For to the client address', async () => {
		for (const address of [IPV4, IPV6]) {
			const calls = installFetch((call) => {
				assert.equal(call.url.pathname, '/v1/projects');
				assert.equal(call.authorization, `Bearer ${TOKEN}`);
				return envelope({ ok: true });
			});
			const { event } = fakeEvent({
				url: 'http://console.example/projects',
				session: TOKEN,
				clientAddress: address,
				requestHeaders: SPOOF
			});
			const payload = await apiFetch(event, '/v1/projects', { headers: SPOOF });
			assert.deepEqual(payload, { ok: true });
			assert.equal(calls.length, 1);
			assertForwarded(calls[0], address);
		}
	});

	test('loadSession forwards the client address on the session read', async () => {
		for (const address of [IPV4, IPV6]) {
			const calls = installFetch((call) => {
				assert.equal(call.url.pathname, '/v1/me');
				assert.equal(call.authorization, `Bearer ${TOKEN}`);
				return envelope({ user: USER, projects: [PROJECT] });
			});
			const { event } = fakeEvent({
				url: 'http://console.example/projects',
				session: TOKEN,
				clientAddress: address,
				requestHeaders: SPOOF
			});
			const session = await loadSession(event);
			assert.equal(session.kind, 'ready');
			assert.equal(calls.length, 1);
			assertForwarded(calls[0], address);
		}
	});

	test('sign-in start sets X-Forwarded-For and drops spoofed request headers', async () => {
		for (const address of [IPV4, IPV6]) {
			const calls = installFetch((call) => {
				assert.equal(call.method, 'GET');
				assert.equal(call.url.pathname, '/v1/auth/google/start');
				assert.equal(call.authorization, null);
				return envelope({ authorize_url: 'https://accounts.google.com/o/oauth2/v2/auth', state: STATE });
			});
			const { event } = fakeEvent({
				url: 'http://console.example/signin',
				form: { next: '/projects' },
				clientAddress: address,
				requestHeaders: SPOOF
			});
			await assert.rejects(
				async () => {
					await signInActions.default(event as never);
				},
				(err: unknown) => {
					assert.equal(isRedirect(err), true);
					if (!isRedirect(err)) return false;
					assert.equal(err.status, 303);
					assert.equal(err.location, 'https://accounts.google.com/o/oauth2/v2/auth');
					return true;
				}
			);
			assert.equal(calls.length, 1);
			assertForwarded(calls[0], address);
		}
	});

	test('a public call replaces spoofed init headers with the client address', async () => {
		for (const address of [IPV4, IPV6]) {
			const calls = installFetch((call) => {
				assert.equal(call.url.pathname, '/v1/auth/google/start');
				assert.equal(call.authorization, null);
				return envelope({ ok: true });
			});
			const { event } = fakeEvent({
				url: 'http://console.example/signin',
				clientAddress: address,
				requestHeaders: SPOOF
			});
			const payload = await apiFetchPublic(event, '/v1/auth/google/start?redirect_uri=http%3A%2F%2Fconsole.example%2Fcb', {
				headers: SPOOF
			});
			assert.deepEqual(payload, { ok: true });
			assert.equal(calls.length, 1);
			assertForwarded(calls[0], address);
		}
	});

	test('an unusable client address sends no X-Forwarded-For and the call still succeeds', async () => {
		const unusable: Array<() => string> = [
			() => {
				throw new Error('Cannot read clientAddress during prerender');
			},
			() => '',
			() => '   ',
			() => 'not-an-ip',
			() => `${IPV4}, ${SPOOF_ADDRESS}`,
			() => `[${IPV6}]`
		];
		for (const clientAddress of unusable) {
			const sessionCalls = installFetch(() => envelope({ ok: true }));
			const session = fakeEvent({
				url: 'http://console.example/projects',
				session: TOKEN,
				clientAddress,
				requestHeaders: SPOOF
			});
			const sessionPayload = await apiFetch(session.event, '/v1/projects', { headers: SPOOF });
			assert.deepEqual(sessionPayload, { ok: true });
			assert.equal(sessionCalls.length, 1);
			assertForwarded(sessionCalls[0], null);

			const publicCalls = installFetch(() => envelope({ ok: true }));
			const pub = fakeEvent({
				url: 'http://console.example/signin',
				clientAddress,
				requestHeaders: SPOOF
			});
			const publicPayload = await apiFetchPublic(pub.event, '/v1/auth/google/start?redirect_uri=http%3A%2F%2Fconsole.example%2Fcb', {
				headers: SPOOF
			});
			assert.deepEqual(publicPayload, { ok: true });
			assert.equal(publicCalls.length, 1);
			assertForwarded(publicCalls[0], null);
		}

		const calls = installFetch(() => envelope({ authorize_url: 'https://accounts.google.com/o/oauth2/v2/auth', state: STATE }));
		const { event } = fakeEvent({
			url: 'http://console.example/signin',
			form: { next: '/projects' },
			clientAddress: () => {
				throw new Error('Cannot read clientAddress during prerender');
			},
			requestHeaders: SPOOF
		});
		await assert.rejects(
			async () => {
				await signInActions.default(event as never);
			},
			(err: unknown) => isRedirect(err) && err.status === 303 && err.location === 'https://accounts.google.com/o/oauth2/v2/auth'
		);
		assert.equal(calls.length, 1);
		assertForwarded(calls[0], null);
	});
});
