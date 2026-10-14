import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { isActionFailure, isRedirect, type Handle, type RequestEvent } from '@sveltejs/kit';
import { render } from 'svelte/server';
import { handle } from '../src/hooks.server.ts';
import { parseGrants, parseOauthRedirect, parseOauthRequest } from '../src/lib/server/shape.ts';
import { isPublicPath, safeNext } from '../src/lib/server/session.ts';
import { consentRedirect } from '../src/lib/server/validate.ts';
import { actions as appActions, load as appLoad } from '../src/routes/account/apps/+page.server.ts';
import AppsPage from '../src/routes/account/apps/+page.svelte';
import { actions as consentActions, load as consentLoad } from '../src/routes/oauth/consent/+page.server.ts';
import ConsentPage from '../src/routes/oauth/consent/+page.svelte';
import { envelope, fakeEvent, installFetch, PROJECT, restoreEnv, TOKEN, useApi, USER } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

const REQUEST = '0123456789abcdef0123456789abcdef';
const GRANT_ID = '00000000-0000-4000-8000-0000000000aa';
const REDIRECT = 'https://client.example/cb?code=abc&state=xyz';
const LOOPBACK = 'http://127.0.0.1:8080/cb?code=abc&state=xyz';
const EXPIRED = 'This sign-in request has expired or was already used.';
const REFUSED = 'This console will not open that address.';
const UNEXPECTED = 'The API returned an unexpected response.';
const originalFetch = globalThis.fetch;

function pageData<T>(value: T): Exclude<T, void | undefined | null> {
	if (value == null) assert.fail('missing page data');
	return value as Exclude<T, void | undefined | null>;
}

function decode(value: string): string {
	return value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>');
}

function failureMessage(value: unknown): string | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const message = (value as { message?: unknown }).message;
	return typeof message === 'string' ? message : undefined;
}

function captureHeaders(event: RequestEvent): Headers {
	const headers = new Headers();
	event.setHeaders = (value: Record<string, string>) => {
		for (const [key, item] of Object.entries(value)) headers.set(key, item);
	};
	return headers;
}

function oauthBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: REQUEST,
		client: { id: 'client-0123456789abcdef', name: 'Sketch', verified: false },
		redirect_host: '127.0.0.1:9876',
		resource: 'https://mcp.example',
		remembered: false,
		projects_count: 3,
		expires_at: '2026-10-14T00:05:00Z',
		...overrides
	};
}

function grantBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: GRANT_ID,
		client_name: 'Sketch',
		redirect_host: '127.0.0.1:9876',
		created_at: '2026-10-14T01:02:03Z',
		last_used_at: '2026-10-14T04:05:06Z',
		kind: 'device',
		...overrides
	};
}

function consentEvent(input: { request?: string | null; user?: boolean; form?: Record<string, string>; method?: string }) {
	const request = input.request === undefined ? REQUEST : input.request;
	const url = request
		? `http://console.example/oauth/consent?request=${encodeURIComponent(request)}`
		: 'http://console.example/oauth/consent';
	const built = fakeEvent({
		url,
		method: input.method,
		session: input.user === false ? undefined : TOKEN,
		user: input.user === false ? null : USER,
		projects: [PROJECT],
		form: input.form
	});
	const headers = captureHeaders(built.event);
	return { ...built, headers };
}

describe('oauth consent and connected apps', { concurrency: false }, () => {
	before(() => {
		useApi('https://api.test');
	});

	after(() => {
		globalThis.fetch = originalFetch;
		restoreEnv();
	});

	test('safeNext keeps the consent and account paths', () => {
		assert.equal(safeNext(`/oauth/consent?request=${REQUEST}`), `/oauth/consent?request=${REQUEST}`);
		assert.equal(safeNext('/account/apps'), '/account/apps');
		assert.equal(isPublicPath('/oauth/consent'), false);
		assert.equal(isPublicPath('/account/apps'), false);
	});

	test('consent redirect allows https and loopback http only', () => {
		assert.equal(consentRedirect(REDIRECT), REDIRECT);
		assert.equal(consentRedirect(LOOPBACK), LOOPBACK);
		assert.equal(consentRedirect('http://localhost:9/cb?code=a&state=b'), 'http://localhost:9/cb?code=a&state=b');
		assert.equal(consentRedirect('http://[::1]:9/cb?code=a&state=b'), 'http://[::1]:9/cb?code=a&state=b');
		for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'http://evil.example/cb', 'not a url', 'https://user:pass@client.example/cb', '']) {
			assert.equal(consentRedirect(bad), null, bad);
		}
	});

	test('oauth shapes fail closed', () => {
		assert.equal(parseOauthRequest(oauthBody())?.client.name, 'Sketch');
		assert.equal(parseOauthRequest(oauthBody({ client: { id: 'c', name: 'x'.repeat(65), verified: false } })), null);
		assert.equal(parseOauthRequest(oauthBody({ remembered: 'yes' })), null);
		assert.equal(parseOauthRequest(oauthBody({ projects_count: 1.5 })), null);
		assert.equal(parseOauthRequest(oauthBody({ client: { id: 'c', name: 'Sketch', verified: 'false' } })), null);
		assert.equal(parseOauthRequest(oauthBody({ id: 'short' })), null);
		assert.deepEqual(parseOauthRedirect({ redirect_to: REDIRECT }), { ok: true, redirect_to: REDIRECT });
		assert.deepEqual(parseOauthRedirect({ redirect_to: 'javascript:alert(1)' }), { ok: false, reason: 'refused' });
		assert.deepEqual(parseOauthRedirect({}), { ok: false, reason: 'malformed' });

		const grants = parseGrants({ items: [grantBody(), grantBody({ id: '00000000-0000-4000-8000-0000000000bb', kind: 'oauth', client_name: 'Other' })] });
		assert.equal(grants?.length, 2);
		assert.equal(parseGrants({ items: [grantBody({ kind: 'password' })] }), null);
		assert.equal(parseGrants({ items: [grantBody(), grantBody()] }), null);
		const missingUsed = grantBody();
		delete missingUsed.last_used_at;
		assert.equal(parseGrants({ items: [missingUsed] }), null);
		assert.equal(parseGrants({ items: [grantBody({ client_name: 'ok' }), { id: GRANT_ID }] }), null);
		assert.deepEqual(parseGrants({ items: [] }), []);
		assert.equal(parseGrants([]), null);
	});

	test('a signed-out consent load redirects to sign-in with next', async () => {
		const calls = installFetch(() => {
			throw new Error('api called');
		});
		const next = `/oauth/consent?request=${REQUEST}`;
		const location = `/signin?next=${encodeURIComponent(next)}`;
		const { event } = consentEvent({ user: false });
		await assert.rejects(
			async () => {
				await handle({ event, resolve: async () => new Response('no') } as Parameters<Handle>[0]);
			},
			(err: unknown) => isRedirect(err) && err.status === 303 && err.location === location
		);
		await assert.rejects(
			async () => {
				await consentLoad(consentEvent({ user: false }).event as never);
			},
			(err: unknown) => isRedirect(err) && err.status === 303 && err.location === location
		);
		assert.equal(calls.length, 0);
	});

	test('not_found renders the expired notice and no buttons', async () => {
		installFetch((call) => {
			assert.equal(call.url.pathname, `/v1/oauth/requests/${REQUEST}`);
			assert.equal(call.method, 'GET');
			return envelope(null, 404, 'not_found', 'gone');
		});
		const loaded = pageData(await consentLoad(consentEvent({}).event as never));
		assert.equal(loaded.request, null);
		assert.equal(loaded.message, EXPIRED);
		const html = render(ConsentPage, { props: { data: loaded, form: null } as never }).body;
		assert.match(html, new RegExp(EXPIRED));
		assert.equal(html.includes('>Allow<'), false);
		assert.equal(html.includes('>Deny<'), false);
	});

	test('a remembered grant approves and redirects without rendering', async () => {
		const calls = installFetch((call) => {
			assert.equal(call.authorization, `Bearer ${TOKEN}`);
			if (call.method === 'GET') return envelope(oauthBody({ remembered: true }));
			return envelope({ redirect_to: REDIRECT });
		});
		const { event, headers } = consentEvent({});
		await assert.rejects(
			async () => {
				await consentLoad(event as never);
			},
			(err: unknown) => isRedirect(err) && err.status === 303 && err.location === REDIRECT
		);
		assert.deepEqual(
			calls.map((call) => `${call.method} ${call.url.pathname}`),
			[`GET /v1/oauth/requests/${REQUEST}`, `POST /v1/oauth/requests/${REQUEST}/approve`]
		);
		assert.equal(headers.get('cache-control'), 'no-store');
		assert.equal(headers.get('x-frame-options'), 'DENY');
		assert.match(headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
	});

	test('the consent page shows the client, unverified badge, host, and both buttons', async () => {
		installFetch((call) => {
			assert.equal(call.method, 'GET');
			assert.equal(call.url.pathname, `/v1/oauth/requests/${REQUEST}`);
			return envelope(oauthBody());
		});
		const { event, headers } = consentEvent({});
		const loaded = pageData(await consentLoad(event as never));
		assert.equal(loaded.request?.client.name, 'Sketch');
		assert.equal(loaded.message, null);
		const html = render(ConsentPage, { props: { data: loaded, form: null } as never }).body;
		assert.match(html, /Allow access\?/);
		assert.match(html, /Sketch/);
		assert.match(html, /Unverified app/);
		assert.match(html, /127\.0\.0\.1:9876/);
		assert.match(html, /font-mono/);
		assert.match(html, /acts as you, with your role in each of your 3 projects/);
		const forms = html.match(/<form\b/g) ?? [];
		assert.equal(forms.length, 1);
		assert.match(html, /formaction="[^"]*\/approve"/);
		assert.match(html, /formaction="[^"]*\/deny"/);
		assert.match(html, />Allow</);
		assert.match(html, />Deny</);
		assert.equal(headers.get('cache-control'), 'no-store');
		assert.equal(headers.get('x-frame-options'), 'DENY');

		const hostile = oauthBody({ client: { id: 'client-0123456789abcdef', name: 'Sketch <lab>', verified: false } });
		const escaped = render(ConsentPage, {
			props: {
				data: { request: parseOauthRequest(hostile), message: null },
				form: null
			} as never
		}).body;
		assert.equal(escaped.includes('<lab>'), false);
		assert.match(escaped, /Sketch &lt;lab>/);
		const consentSource = readFileSync(new URL('../src/routes/oauth/consent/+page.svelte', import.meta.url), 'utf8');
		assert.match(consentSource, /use:enhance/);
	});

	test('approve and deny follow the API redirect and refuse a bad address', async () => {
		for (const action of ['approve', 'deny'] as const) {
			const calls = installFetch((call) => {
				assert.equal(call.method, 'POST');
				assert.equal(call.url.pathname, `/v1/oauth/requests/${REQUEST}/${action}`);
				assert.equal(call.authorization, `Bearer ${TOKEN}`);
				return envelope({ redirect_to: action === 'approve' ? REDIRECT : LOOPBACK });
			});
			const { event, headers } = consentEvent({ form: { request: REQUEST } });
			await assert.rejects(
				async () => {
					await consentActions[action](event as never);
				},
				(err: unknown) => isRedirect(err) && err.status === 303 && err.location === (action === 'approve' ? REDIRECT : LOOPBACK)
			);
			assert.equal(calls.length, 1);
			assert.equal(headers.get('cache-control'), 'no-store');
			assert.equal(headers.get('x-frame-options'), 'DENY');
		}

		for (const redirect_to of ['javascript:alert(1)', 'data:text/html,hi', 'http://evil.example/cb', 'not a url']) {
			installFetch(() => envelope({ redirect_to }));
			const { event } = consentEvent({ form: { request: REQUEST } });
			const failure = await consentActions.approve(event as never);
			assert.equal(isActionFailure(failure), true);
			if (!isActionFailure(failure)) return;
			assert.equal(failureMessage(failure.data), REFUSED);
			assert.equal(JSON.stringify(failure.data).includes(redirect_to), false);
			const html = render(ConsentPage, {
				props: { data: { request: null, message: null }, form: { message: failureMessage(failure.data) } } as never
			}).body;
			assert.match(html, new RegExp(REFUSED));
			assert.equal(html.includes('>Allow<'), false);
		}

		installFetch(() => envelope({ nope: true }));
		const malformed = await consentActions.deny(consentEvent({ form: { request: REQUEST } }).event as never);
		assert.equal(isActionFailure(malformed), true);
		if (!isActionFailure(malformed)) return;
		assert.equal(failureMessage(malformed.data), UNEXPECTED);
	});

	test('the consent response from the hook is not stored and cannot be framed', async () => {
		installFetch((call) => {
			assert.equal(call.url.pathname, '/v1/me');
			return envelope({ user: USER, projects: [PROJECT] });
		});
		const { event } = fakeEvent({
			url: `http://console.example/oauth/consent?request=${REQUEST}`,
			session: TOKEN
		});
		const response = await handle({
			event,
			resolve: async () => new Response('consent', { status: 200, headers: { 'content-type': 'text/html' } })
		} as Parameters<Handle>[0]);
		assert.equal(response.status, 200);
		assert.equal(response.headers.get('cache-control'), 'no-store');
		assert.equal(response.headers.get('x-frame-options'), 'DENY');
	});

	test('connected apps lists grants and an empty list is a notice', async () => {
		installFetch((call) => {
			assert.equal(call.method, 'GET');
			assert.equal(call.url.pathname, '/v1/me/grants');
			assert.equal(call.authorization, `Bearer ${TOKEN}`);
			return envelope({ items: [grantBody()] });
		});
		setPageUrl('http://console.example/account/apps');
		const loaded = pageData(await appLoad(fakeEvent({ url: 'http://console.example/account/apps', session: TOKEN, user: USER }).event as never));
		const html = decode(render(AppsPage, { props: { data: loaded, form: null } as never }).body);
		assert.match(html, /Connected apps/);
		assert.match(html, />App</);
		assert.match(html, /Redirect host/);
		assert.match(html, />Kind</);
		assert.match(html, />Created</);
		assert.match(html, /Last used/);
		assert.match(html, /Sketch/);
		assert.match(html, /127\.0\.0\.1:9876/);
		assert.match(html, />device</);
		assert.match(html, /aria-label="Revoke Sketch"/);
		assert.match(html, /lucide-ban/);
		const appsSource = readFileSync(new URL('../src/routes/account/apps/+page.svelte', import.meta.url), 'utf8');
		assert.match(appsSource, /name: 'grant_id'/);
		assert.match(appsSource, /actionUrlFrom\(page\.url, 'revoke'\)/);
		assert.match(appsSource, /value: grant\.id/);

		installFetch(() => envelope({ items: [] }));
		const empty = pageData(await appLoad(fakeEvent({ url: 'http://console.example/account/apps', session: TOKEN, user: USER }).event as never));
		const emptyHtml = render(AppsPage, { props: { data: empty, form: null } as never }).body;
		assert.match(emptyHtml, /No connected apps\./);
		assert.equal(emptyHtml.includes('Sketch'), false);

		installFetch(() => envelope({ items: [{ id: 'nope' }] }));
		const bad = pageData(await appLoad(fakeEvent({ url: 'http://console.example/account/apps', session: TOKEN, user: USER }).event as never));
		assert.equal(bad.message, UNEXPECTED);
		const badHtml = render(AppsPage, { props: { data: bad, form: null } as never }).body;
		assert.match(badHtml, new RegExp(UNEXPECTED));
		assert.equal(badHtml.includes('No connected apps.'), false);
	});

	test('revoke deletes the grant, and another error shows a notice', async () => {
		const calls = installFetch((call) => {
			assert.equal(call.method, 'DELETE');
			assert.equal(call.url.pathname, `/v1/me/grants/${GRANT_ID}`);
			assert.equal(call.authorization, `Bearer ${TOKEN}`);
			return envelope(null);
		});
		const { event } = fakeEvent({
			url: 'http://console.example/account/apps',
			session: TOKEN,
			user: USER,
			form: { grant_id: GRANT_ID }
		});
		await assert.rejects(
			async () => {
				await appActions.revoke(event as never);
			},
			(err: unknown) => isRedirect(err) && err.status === 303 && err.location === '/account/apps'
		);
		assert.equal(calls.length, 1);

		const skipped = installFetch(() => {
			throw new Error('api called');
		});
		const rejected = await appActions.revoke(
			fakeEvent({
				url: 'http://console.example/account/apps',
				session: TOKEN,
				user: USER,
				form: { grant_id: '../not-a-grant' }
			}).event as never
		);
		assert.equal(isActionFailure(rejected), true);
		assert.equal(skipped.length, 0);

		installFetch(() => envelope(null, 500, 'error', 'Revoke failed.'));
		const failure = await appActions.revoke(
			fakeEvent({
				url: 'http://console.example/account/apps',
				session: TOKEN,
				user: USER,
				form: { grant_id: GRANT_ID }
			}).event as never
		);
		assert.equal(isActionFailure(failure), true);
		if (!isActionFailure(failure)) return;
		assert.equal(failureMessage(failure.data), 'Revoke failed.');
		setPageUrl('http://console.example/account/apps');
		const listed = parseGrants({ items: [grantBody()] });
		assert.ok(listed?.[0]);
		const html = render(AppsPage, {
			props: {
				data: { grants: listed, message: null },
				form: { message: failureMessage(failure.data) }
			} as never
		}).body;
		assert.match(html, /Revoke failed\./);
		assert.match(html, /role="alert"/);
	});

	test('the account menu links to connected apps', () => {
		const layout = readFileSync(new URL('../src/routes/+layout.svelte', import.meta.url), 'utf8');
		assert.match(layout, /href="\/account\/apps"/);
		assert.match(layout, /Connected apps/);
		assert.match(layout, /DropdownMenu/);
	});
});
