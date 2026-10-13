import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRedirect, type Handle } from '@sveltejs/kit';
import { ApiError, apiBaseUrl, apiFetch, apiList, BODY_LIMIT } from '../src/lib/server/api.ts';
import { parseProject } from '../src/lib/server/shape.ts';
import { roleAtLeast, uiRole } from '../src/lib/server/roles.ts';
import { isPublicPath, needsNoStore, safeNext, sessionCookieOptions } from '../src/lib/server/session.ts';
import { handle } from '../src/hooks.server.ts';
import { env } from '$env/dynamic/private';
import { envelope, fakeEvent, installFetch, restoreEnv, TOKEN, useApi, type FetchCall } from './harness.ts';

const originalFetch = globalThis.fetch;
const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

describe('auth session', { concurrency: false }, () => {
	before(() => {
		useApi(null);
	});

	after(() => {
		globalThis.fetch = originalFetch;
		restoreEnv();
	});

	test('safeNext keeps a same-origin path and drops open redirects', () => {
		assert.equal(safeNext('/services?host=pi1'), '/services?host=pi1');
		assert.equal(safeNext('/foo/../../etc'), '/etc');
		assert.equal(safeNext('/@evil.com'), '/@evil.com');
		assert.equal(safeNext('//evil.com'), '/projects');
		assert.equal(safeNext('/\\evil.com'), '/projects');
		assert.equal(safeNext('/\\/evil.com'), '/projects');
		assert.equal(safeNext('/%2f%2fevil.com'), '/projects');
		assert.equal(safeNext('https://evil.com'), '/projects');
		assert.equal(safeNext('javascript:alert(1)'), '/projects');
		assert.equal(safeNext('/\t/evil'), '/projects');
		assert.equal(safeNext('/signin'), '/projects');
		assert.equal(safeNext('/signin?next=/'), '/projects');
		assert.equal(safeNext('/signout'), '/projects');
		assert.equal(safeNext('/auth/google/callback'), '/projects');
		assert.equal(safeNext(''), '/projects');
		assert.equal(safeNext(null), '/projects');
	});

	test('session cookie is Secure only on https', () => {
		const http = sessionCookieOptions(new URL('http://pi.tailnet/projects'));
		const https = sessionCookieOptions(new URL('https://pi.tailnet/projects'));
		for (const options of [http, https]) {
			assert.equal(options.httpOnly, true);
			assert.equal(options.sameSite, 'lax');
			assert.equal(options.path, '/');
			assert.equal(options.maxAge, 604800);
		}
		assert.equal(http.secure, false);
		assert.equal(https.secure, true);
	});

	test('role helpers hide a control unless every source agrees', () => {
		assert.equal(roleAtLeast('owner', 'admin'), true);
		assert.equal(roleAtLeast('admin', 'admin'), true);
		assert.equal(roleAtLeast('viewer', 'admin'), false);
		assert.equal(roleAtLeast('admin', 'owner'), false);
		assert.equal(roleAtLeast(null, 'viewer'), false);
		assert.equal(uiRole('owner', 'viewer'), 'viewer');
		assert.equal(uiRole('viewer', 'owner'), 'viewer');
		assert.equal(uiRole('admin', 'admin'), 'admin');
		assert.equal(uiRole(null, 'owner'), 'owner');
		assert.equal(uiRole('owner', null), 'owner');
	});

	test('public paths and the original no-store set', () => {
		assert.equal(isPublicPath('/signin'), true);
		assert.equal(isPublicPath('/auth/google/callback'), true);
		assert.equal(isPublicPath('/favicon.ico'), true);
		assert.equal(isPublicPath('/_app/immutable/chunk.js'), true);
		assert.equal(isPublicPath('/.well-known/x'), true);
		assert.equal(isPublicPath('/signin/__data.json'), true);
		assert.equal(isPublicPath('/auth/google/callback/__data.json'), true);
		assert.equal(isPublicPath('/favicon.ico/__data.json'), true);
		assert.equal(isPublicPath('/__data.json'), false);
		assert.equal(isPublicPath('/projects/__data.json'), false);
		assert.equal(isPublicPath('/projects'), false);
		assert.equal(isPublicPath('/api/overview'), false);
		assert.equal(needsNoStore('/services', false), true);
		assert.equal(needsNoStore('/', false), true);
		assert.equal(needsNoStore('/projects', false), false);
		assert.equal(needsNoStore('/projects', true), true);
	});

	test('switch off does not call the API and leaves an existing page alone', async () => {
		useApi(null);
		let called = false;
		globalThis.fetch = (() => {
			called = true;
			throw new Error('api called');
		}) as typeof fetch;
		const { event } = fakeEvent({ url: 'http://pi.local/services', session: TOKEN });
		let body = '';
		const response = await handle({
			event,
			resolve: async () => {
				body = 'services-page';
				return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
			}
		} as Parameters<Handle>[0]);
		assert.equal(called, false);
		assert.equal(await response.text(), 'services-page');
		assert.equal(event.locals.authEnabled, false);
		assert.equal(event.locals.user, null);
		assert.equal(response.headers.get('cache-control'), 'no-store');
	});

	test('switch off does not mark new routes no-store', async () => {
		useApi(null);
		const { event } = fakeEvent({ url: 'http://pi.local/projects' });
		const response = await handle({
			event,
			resolve: async () => new Response('missing', { status: 404 })
		} as Parameters<Handle>[0]);
		assert.equal(response.headers.get('cache-control'), null);
	});

	test('a page without a session redirects to a safe next path', async () => {
		useApi('https://api.test');
		let called = false;
		globalThis.fetch = (() => {
			called = true;
			throw new Error('api called');
		}) as typeof fetch;
		const { event } = fakeEvent({ url: 'http://pi.local/services?host=pi1' });
		await assert.rejects(
			async () => {
				await handle({ event, resolve: async () => new Response('no') } as Parameters<Handle>[0]);
			},
			(err: unknown) => {
				assert.equal(isRedirect(err), true);
				if (!isRedirect(err)) return false;
				assert.equal(err.status, 303);
				assert.equal(err.location, `/signin?next=${encodeURIComponent('/services?host=pi1')}`);
				return true;
			}
		);
		assert.equal(called, false);
	});

	test('401 from /v1/me clears the cookie and an API route returns 401 JSON', async () => {
		useApi('https://api.test');
		installFetch(() => new Response('nope', { status: 401 }));
		const { event, jar } = fakeEvent({ url: 'http://pi.local/api/overview', session: TOKEN });
		const response = await handle({
			event,
			resolve: async () => new Response('should-not-run')
		} as Parameters<Handle>[0]);
		assert.equal(response.status, 401);
		assert.equal(jar.has('bot_session'), false);
		const setCookie = response.headers.get('set-cookie') ?? '';
		assert.match(setCookie, /bot_session=/);
		assert.equal(setCookie.includes(TOKEN), false);
		const body = await response.json();
		assert.equal(body.message, 'Sign in required.');
		assert.equal(JSON.stringify(body).includes(TOKEN), false);
	});

	test('apiFetch clears the cookie when the API returns 401 without an envelope', async () => {
		useApi('https://api.test');
		installFetch(() => new Response('nope', { status: 401 }));
		const { event, jar, sets } = fakeEvent({ url: 'http://pi.local/projects', session: TOKEN });
		await assert.rejects(apiFetch(event, '/v1/projects'), (err: unknown) => {
			assert.equal(isRedirect(err), true);
			if (!isRedirect(err)) return false;
			assert.equal(err.status, 303);
			assert.equal(err.location, `/signin?next=${encodeURIComponent('/projects')}`);
			return true;
		});
		assert.equal(jar.has('bot_session'), false);
		const deleted = sets.find((entry) => entry.op === 'delete' && entry.name === 'bot_session');
		assert.equal(deleted?.options.path, '/');
	});

	test('a ready session is loaded once and does not leak the token into locals', async () => {
		useApi('https://api.test');
		const calls = installFetch((call) => {
			assert.equal(call.url.pathname, '/v1/me');
			assert.equal(call.authorization, `Bearer ${TOKEN}`);
			return envelope({
				user: { id: '00000000-0000-4000-8000-000000000001', email: 'ada@example.com', name: 'Ada', avatar_url: null },
				identities: [],
				projects: [
					{
						id: '00000000-0000-4000-8000-000000000010',
						name: 'Lab',
						slug: 'lab',
						role: 'owner',
						created_at: '2026-10-13T00:00:00Z'
					}
				]
			});
		});
		const { event } = fakeEvent({ url: 'http://pi.local/', session: TOKEN });
		const response = await handle({
			event,
			resolve: async () => new Response('overview')
		} as Parameters<Handle>[0]);
		assert.equal(response.status, 200);
		assert.equal(calls.length, 1);
		assert.equal(event.locals.user?.name, 'Ada');
		assert.equal(JSON.stringify(event.locals).includes(TOKEN), false);
	});

	test('apiList counts items past the 500 row page cap', async () => {
		useApi('https://api.test');
		const page = Array.from({ length: 600 }, (_, index) => ({
			id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
			name: `p${index}`,
			slug: `p${index}`,
			role: 'viewer',
			created_at: '2026-10-13T00:00:00Z'
		}));
		installFetch((call: FetchCall) => {
			if (call.url.searchParams.get('cursor') === 'next-1') return envelope({ items: [], next_cursor: null });
			return envelope({ items: page, next_cursor: 'next-1' });
		});
		const { event } = fakeEvent({ url: 'http://pi.local/projects', session: TOKEN });
		const list = await apiList(event, '/v1/projects', parseProject);
		assert.equal(list.items.length, 500);
		assert.equal(list.omitted, 100);
		assert.equal(list.truncated, false);
	});

	test('apiFetch sends a timeout signal and does not follow redirects', async () => {
		useApi('https://api.test');
		const calls = installFetch(() => envelope({ items: [], next_cursor: null }));
		const { event } = fakeEvent({ url: 'http://pi.local/projects', session: TOKEN });
		await apiFetch(event, '/v1/projects');
		assert.equal(calls.length, 1);
		assert.ok(calls[0]?.signal instanceof AbortSignal);
		assert.equal(calls[0]?.signal?.aborted, false);
		assert.equal(calls[0]?.redirect, 'error');
	});

	test('apiList sets truncated when the page cap, item cap, or a repeated cursor stops the list', async () => {
		useApi('https://api.test');
		function project(index: number) {
			return {
				id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
				name: `p${index}`,
				slug: `p${index}`,
				role: 'viewer' as const,
				created_at: '2026-10-13T00:00:00Z'
			};
		}

		let pages = 0;
		installFetch(() => {
			pages += 1;
			return envelope({ items: [project(pages)], next_cursor: `c${pages}` });
		});
		const capped = await apiList(fakeEvent({ url: 'http://pi.local/projects', session: TOKEN }).event, '/v1/projects', parseProject);
		assert.equal(pages, 20);
		assert.equal(capped.items.length, 20);
		assert.equal(capped.truncated, true);

		pages = 0;
		installFetch(() => {
			pages += 1;
			return envelope({ items: [project(pages)], next_cursor: 'again' });
		});
		const repeated = await apiList(fakeEvent({ url: 'http://pi.local/projects', session: TOKEN }).event, '/v1/projects', parseProject);
		assert.equal(pages, 2);
		assert.equal(repeated.truncated, true);

		const batch = Array.from({ length: 500 }, (_, index) => project(index));
		pages = 0;
		installFetch(() => {
			pages += 1;
			return envelope({ items: batch, next_cursor: `more-${pages}` });
		});
		const full = await apiList(fakeEvent({ url: 'http://pi.local/projects', session: TOKEN }).event, '/v1/projects', parseProject);
		assert.equal(pages, 8);
		assert.equal(full.items.length, 4000);
		assert.equal(full.truncated, true);

		for (const file of [
			'src/routes/projects/+page.svelte',
			'src/routes/projects/[id]/HostsSection.svelte',
			'src/routes/projects/[id]/MembersSection.svelte',
			'src/routes/projects/[id]/TokensSection.svelte'
		]) {
			const text = readFileSync(resolve(root, file), 'utf8');
			assert.equal(text.includes('More items not shown'), true, file);
			assert.equal(text.includes('truncated'), true, file);
		}
	});

	test('the body cap cancels a streamed body and a declared Content-Length over the limit', async () => {
		useApi('https://api.test');
		const { event } = fakeEvent({ url: 'http://pi.local/projects', session: TOKEN });
		let pulls = 0;
		let cancelled = false;
		const chunk = new Uint8Array(64 * 1024);
		installFetch(() => {
			const stream = new ReadableStream<Uint8Array>({
				pull(controller) {
					pulls += 1;
					if (pulls > 100) {
						controller.close();
						return;
					}
					controller.enqueue(chunk);
				},
				cancel() {
					cancelled = true;
				}
			});
			return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
		});
		await assert.rejects(apiFetch(event, '/v1/projects'), (err: unknown) => {
			assert.ok(err instanceof ApiError);
			if (!(err instanceof ApiError)) return false;
			assert.equal(err.status, 502);
			return true;
		});
		assert.equal(cancelled, true);
		assert.ok(pulls < 40);

		let earlyPulls = 0;
		let earlyCancelled = false;
		installFetch(() => {
			const stream = new ReadableStream<Uint8Array>({
				pull(controller) {
					earlyPulls += 1;
					controller.enqueue(new Uint8Array(8));
				},
				cancel() {
					earlyCancelled = true;
				}
			});
			return new Response(stream, {
				status: 200,
				headers: { 'content-type': 'application/json', 'content-length': String(BODY_LIMIT + 1) }
			});
		});
		await assert.rejects(apiFetch(event, '/v1/projects'), (err: unknown) => err instanceof ApiError && err.status === 502);
		assert.ok(earlyPulls < 5);
		assert.equal(earlyCancelled, true);
	});

	test('http API URLs are rejected unless the host is loopback or insecure HTTP is opted in', () => {
		for (const blocked of ['http://api.test', 'http://example.com', 'http://10.1.2.3']) {
			useApi(blocked);
			assert.equal(apiBaseUrl(), null, blocked);
		}
		for (const allowed of ['https://api.test', 'http://localhost:9', 'http://127.0.0.1:9', 'http://[::1]:9']) {
			useApi(allowed);
			assert.ok(apiBaseUrl(), allowed);
		}
		useApi('http://example.com');
		env.BOT_API_ALLOW_INSECURE_HTTP = '1';
		process.env.BOT_API_ALLOW_INSECURE_HTTP = '1';
		assert.equal(apiBaseUrl()?.origin, 'http://example.com');
		env.BOT_API_ALLOW_INSECURE_HTTP = 'true';
		process.env.BOT_API_ALLOW_INSECURE_HTTP = 'true';
		assert.equal(apiBaseUrl(), null);
	});

	test('a BOT_API_URL that is not an origin makes a protected route return 503', async () => {
		useApi('https://api.test/v1');
		let called = false;
		globalThis.fetch = (() => {
			called = true;
			throw new Error('api called');
		}) as typeof fetch;
		const { event } = fakeEvent({ url: 'http://pi.local/projects', session: TOKEN });
		const response = await handle({
			event,
			resolve: async () => new Response('should-not-run')
		} as Parameters<Handle>[0]);
		assert.equal(response.status, 503);
		assert.equal(called, false);
		assert.equal(apiBaseUrl(), null);
	});

	test('source does not store tokens in the browser', () => {
		const files: string[] = [];
		function walk(dir: string) {
			for (const name of readdirSync(dir)) {
				const path = resolve(dir, name);
				if (statSync(path).isDirectory()) walk(path);
				else files.push(path);
			}
		}
		walk(resolve(root, 'src'));
		for (const file of files) {
			if (!/\.(ts|js|svelte)$/.test(file)) continue;
			const text = readFileSync(file, 'utf8');
			assert.equal(text.includes('localStorage'), false, file);
			assert.equal(text.includes('sessionStorage'), false, file);
			if (file.endsWith('+page.server.ts') && !file.includes(`${resolve(root, 'src/routes/signout')}`)) {
				assert.equal(text.includes('bot_session'), false, file);
				assert.equal(text.includes('SESSION_COOKIE'), false, file);
			}
		}
	});
});
