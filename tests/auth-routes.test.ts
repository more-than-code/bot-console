import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { isActionFailure, isHttpError, isRedirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { GET } from '../src/routes/auth/google/callback/+server.ts';
import { load as layoutLoad } from '../src/routes/+layout.server.ts';
import { actions as signInActions, load as signInLoad } from '../src/routes/signin/+page.server.ts';
import { actions as signOutActions } from '../src/routes/signout/+page.server.ts';
import { actions as deviceActions, load as deviceLoad } from '../src/routes/device/+page.server.ts';
import { load as projectsLoad } from '../src/routes/projects/+page.server.ts';
import { actions as projectActions, load as projectLoad } from '../src/routes/projects/[id]/+page.server.ts';
import { buttonVariants } from '../src/lib/components/ui/button/index.ts';
import { cn } from '../src/lib/utils.ts';
import { actions as hostActions } from '../src/routes/hosts/[id]/+page.server.ts';
import {
	containsToken,
	envelope,
	fakeEvent,
	installFetch,
	JOIN,
	PROJECT,
	restoreEnv,
	TOKEN,
	useApi,
	USER,
	type FetchCall
} from './harness.ts';

const originalFetch = globalThis.fetch;

function pageData<T>(value: T): Exclude<T, void | undefined | null> {
	if (value == null) assert.fail('missing page data');
	return value as Exclude<T, void | undefined | null>;
}
const STATE = 'oauth-state-0123456789abcdef';
const HOST_ID = '00000000-0000-4000-8000-0000000000aa';
const SERVICE_ID = '00000000-0000-4000-8000-0000000000bb';
const CHECK_ID = '00000000-0000-4000-8000-0000000000cc';

describe('auth routes', { concurrency: false }, () => {
	before(() => {
		useApi(null);
	});

	after(() => {
		globalThis.fetch = originalFetch;
		restoreEnv();
	});

	test('callback rejects a state mismatch and does not call the API', async () => {
		useApi('https://api.test');
		const calls = installFetch(() => {
			throw new Error('api called');
		});
		const { event, jar, sets } = fakeEvent({
			url: 'http://console.example/auth/google/callback?code=abc&state=other-state-0123456789',
			oauth: JSON.stringify({ state: STATE, next: '/projects' })
		});
		await assert.rejects(async () => {
			await GET(event as never);
		}, (err: unknown) => {
			assert.equal(isHttpError(err), true);
			if (!isHttpError(err)) return false;
			assert.equal(err.status, 400);
			return true;
		});
		assert.equal(calls.length, 0);
		assert.equal(jar.has('bot_oauth'), false);
		assert.equal(sets.some((entry) => entry.op === 'delete' && entry.name === 'bot_oauth'), true);
		assert.equal(jar.has('bot_session'), false);
	});

	test('callback sets the session cookie without putting the token in the redirect', async () => {
		for (const [origin, secure] of [
			['http://console.example', false],
			['https://console.example', true]
		] as const) {
			useApi('https://api.test');
			const issued = 'console-token-0123456789abcdef';
			installFetch((call) => {
				assert.equal(call.method, 'POST');
				assert.equal(call.url.pathname, '/v1/auth/google/callback');
				assert.equal(call.authorization, null);
				assert.deepEqual(JSON.parse(call.body ?? ''), {
					code: '4/abc',
					state: STATE,
					redirect_uri: `${origin}/auth/google/callback`
				});
				return envelope({ token: issued, expires_at: '2026-10-20T00:00:00Z', user: USER });
			});
			const { event, jar, sets } = fakeEvent({
				url: `${origin}/auth/google/callback?code=4%2Fabc&state=${STATE}`,
				oauth: JSON.stringify({ state: STATE, next: '/device?code=BCDF-GHJK' })
			});
			await assert.rejects(async () => {
				await GET(event as never);
			}, (err: unknown) => {
				assert.equal(isRedirect(err), true);
				if (!isRedirect(err)) return false;
				assert.equal(err.status, 303);
				assert.equal(err.location, '/device?code=BCDF-GHJK');
				assert.equal(err.location.includes(issued), false);
				return true;
			});
			assert.equal(jar.get('bot_session'), issued);
			const set = sets.find((entry) => entry.op === 'set' && entry.name === 'bot_session');
			assert.ok(set);
			assert.equal(set.options.httpOnly, true);
			assert.equal(set.options.sameSite, 'lax');
			assert.equal(set.options.path, '/');
			assert.equal(set.options.maxAge, 604800);
			assert.equal(set.options.secure, secure);
		}
	});

	test('sign-in stores a safe next path and rejects a non-https authorize URL', async () => {
		useApi('https://api.test');
		installFetch((call) => {
			assert.equal(call.authorization, null);
			return envelope({ authorize_url: 'https://accounts.google.com/o/oauth2/v2/auth', state: STATE });
		});
		const { event, jar } = fakeEvent({
			url: 'http://console.example/signin',
			session: TOKEN,
			form: { next: 'https://evil.example/phish' }
		});
		await assert.rejects(async () => {
			await signInActions.default(event as never);
		}, (err: unknown) => {
			assert.equal(isRedirect(err), true);
			if (!isRedirect(err)) return false;
			assert.equal(err.location, 'https://accounts.google.com/o/oauth2/v2/auth');
			return true;
		});
		const oauth = JSON.parse(jar.get('bot_oauth') ?? '{}') as { state?: string; next?: string };
		assert.equal(oauth.state, STATE);
		assert.equal(oauth.next, '/projects');
		assert.equal(jar.get('bot_session'), TOKEN);

		installFetch(() => envelope({ authorize_url: 'http://evil.example/auth', state: STATE }));
		const again = fakeEvent({ url: 'http://console.example/signin', form: { next: '/projects' } });
		const failure = await signInActions.default(again.event as never);
		assert.equal(isActionFailure(failure), true);
		if (!isActionFailure(failure)) return;
		assert.equal(failure.status, 502);
		assert.equal(containsToken(failure.data), false);
		assert.equal(again.jar.has('bot_oauth'), false);
	});

	test('a public 401 does not clear an existing console session', async () => {
		useApi('https://api.test');
		installFetch(() => new Response('nope', { status: 401 }));
		const { event, jar, sets } = fakeEvent({
			url: 'http://console.example/signin',
			session: TOKEN,
			form: { next: '/projects' }
		});
		const failure = await signInActions.default(event as never);
		assert.equal(isActionFailure(failure), true);
		assert.equal(jar.get('bot_session'), TOKEN);
		assert.equal(sets.some((entry) => entry.name === 'bot_session'), false);
	});

	test('sign-out calls the API with the bearer and then clears the cookie', async () => {
		useApi('https://api.test');
		const calls = installFetch((call) => {
			assert.equal(call.method, 'POST');
			assert.equal(call.url.pathname, '/v1/auth/signout');
			assert.equal(call.authorization, `Bearer ${TOKEN}`);
			return envelope(null);
		});
		const { event, jar, sets } = fakeEvent({
			url: 'http://console.example/signout',
			method: 'POST',
			session: TOKEN,
			user: USER
		});
		await assert.rejects(async () => {
			await signOutActions.default(event as never);
		}, (err: unknown) => {
			assert.equal(isRedirect(err), true);
			if (!isRedirect(err)) return false;
			assert.equal(err.location, '/signin');
			return true;
		});
		assert.equal(calls.length, 1);
		assert.equal(jar.has('bot_session'), false);
		const deleted = sets.find((entry) => entry.op === 'delete' && entry.name === 'bot_session');
		assert.equal(deleted?.options.path, '/');

		installFetch(() => new Response('nope', { status: 401 }));
		const again = fakeEvent({
			url: 'http://console.example/signout',
			method: 'POST',
			session: TOKEN,
			user: USER
		});
		await assert.rejects(async () => {
			await signOutActions.default(again.event as never);
		}, (err: unknown) => isRedirect(err) && err.location === '/signin');
		assert.equal(again.jar.has('bot_session'), false);
	});

	test('page data never includes the session token', async () => {
		useApi('https://api.test');
		const layout = fakeEvent({
			url: 'http://console.example/',
			session: TOKEN,
			user: { ...USER, name: 'Ada' },
			projects: [PROJECT]
		});
		const layoutData = pageData(await layoutLoad(layout.event as never));
		assert.equal(layoutData.user?.name, 'Ada');
		assert.equal('email' in (layoutData.user ?? {}), false);
		assert.equal(containsToken(layoutData), false);

		const signIn = fakeEvent({ url: 'http://console.example/signin?next=//evil.com', session: TOKEN, user: USER });
		const signInData = pageData(await signInLoad(signIn.event as never));
		assert.equal(signInData.next, '/projects');
		assert.equal(containsToken(signInData), false);

		installFetch((call) => {
			if (call.url.pathname === '/v1/projects') {
				return envelope({
					items: [{ ...PROJECT, name: 'Lab', token: TOKEN, install_command: `sudo ${TOKEN}` }],
					next_cursor: null
				});
			}
			return envelope(null, 500, 'error', 'unexpected');
		});
		const listed = pageData(await projectsLoad(
			fakeEvent({ url: 'http://console.example/projects', session: TOKEN, user: USER, projects: [PROJECT] }).event as never
		));
		assert.equal(listed.projects[0]?.name, 'Lab');
		assert.equal(containsToken(listed), false);

		installFetch((call: FetchCall) => {
			if (call.method === 'POST' && call.url.pathname.endsWith('/join-tokens')) {
				return envelope({
					id: '00000000-0000-4000-8000-0000000000d2',
					token: JOIN,
					install_command: `printf '%s' '${JOIN}' | sudo -u bot-agent bot-agent init --server 'wss://api.example/${TOKEN}' --join-token-stdin`
				});
			}
			return envelope(null, 500, 'error', 'unexpected');
		});
		const created = await projectActions.createToken(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=hosts`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: { host_name_hint: '', expires_in_sec: '' }
			}).event as never
		);
		assert.equal(isRedirect(created), false);
		assert.equal(isActionFailure(created), false);
		if (!created || isRedirect(created) || isActionFailure(created)) {
			assert.fail('expected the join token result');
		}
		assert.equal(created.created?.token, JOIN);
		assert.equal(created.created?.server, 'wss://api.example/[redacted]');
		assert.equal(created.message, null);
		assert.equal(JSON.stringify(created).includes('install_command'), false);
		assert.equal(containsToken(created), false);
		assert.equal(containsToken(created, JOIN), true);
	});

	test('a lower payload role hides admin fetches, and a row without health checks does not crash the services page', async () => {
		useApi('https://api.test');
		const calls = installFetch((call) => {
			if (call.url.pathname === `/v1/projects/${PROJECT.id}`) return envelope({ ...PROJECT, role: 'viewer' });
			if (call.url.pathname.endsWith('/hosts')) return envelope({ items: [], next_cursor: null });
			if (call.url.pathname.endsWith('/members')) return envelope({ items: [], next_cursor: null });
			if (call.url.pathname.endsWith('/join-tokens')) return envelope({ items: [], next_cursor: null });
			return envelope(null, 404, 'not_found', 'missing');
		});
		const detail = pageData(await projectLoad(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=tokens`,
				session: TOKEN,
				user: USER,
				projects: [{ ...PROJECT, role: 'owner' }],
				params: { id: PROJECT.id }
			}).event as never
		));
		assert.equal(detail.canAdmin, false);
		assert.equal(detail.tab, 'hosts');
		assert.equal(calls.some((call) => call.url.pathname.endsWith('/join-tokens')), false);
		assert.equal(containsToken(detail), false);

		installFetch((call) => {
			if (call.url.pathname === `/v1/projects/${PROJECT.id}/services`) {
				return envelope({
					items: [
						{
							id: SERVICE_ID,
							host_id: HOST_ID,
							name: 'api',
							source: 'discovered',
							kind: 'process',
							ports: [8080],
							health: null,
							display_name: null,
							owner_user: null,
							project_id: PROJECT.id,
							host_name: 'pi1',
							host_status: 'online',
							project_name: 'Lab',
							token: TOKEN
						}
					],
					next_cursor: null,
					prev_cursor: null,
					total: 1
				});
			}
			if (call.url.pathname === `/v1/projects/${PROJECT.id}/hosts`) return envelope({ items: [], next_cursor: null });
			if (call.url.pathname === `/v1/projects/${PROJECT.id}/members`) return envelope({ items: [], next_cursor: null });
			if (call.url.pathname === `/v1/projects/${PROJECT.id}/join-tokens`) return envelope({ items: [], next_cursor: null });
			if (call.url.pathname === `/v1/projects/${PROJECT.id}`) return envelope(PROJECT);
			return envelope(null, 500, 'error', 'unexpected');
		});
		const services = pageData(await projectLoad(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=services`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id }
			}).event as never
		));
		assert.equal(services.project?.name, 'Lab');
		assert.equal(services.services[0]?.name, 'api');
		assert.equal(services.services[0]?.checksMessage, 'Health checks need API v1.18 or later.');
		assert.equal(containsToken(services), false);
	});

	test('join-token create sends only the fields that were filled in', async () => {
		useApi('https://api.test');
		const calls = installFetch(() => envelope({ token: JOIN, install_command: 'sudo init' }));
		await projectActions.createToken(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}`,
				session: TOKEN,
				user: USER,
				params: { id: PROJECT.id },
				form: { host_name_hint: 'pi1', expires_in_sec: '3600' }
			}).event as never
		);
		assert.equal(calls[0]?.body, JSON.stringify({ host_name_hint: 'pi1', expires_in_sec: 3600 }));
	});

	test('delete requires the freshly loaded project name', async () => {
		useApi('https://api.test');
		const calls = installFetch((call) => {
			if (call.method === 'DELETE') return envelope(null);
			return envelope(PROJECT);
		});
		const wrong = await projectActions.deleteProject(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}`,
				session: TOKEN,
				user: USER,
				params: { id: PROJECT.id },
				form: { confirm: 'not-the-name' }
			}).event as never
		);
		assert.equal(isActionFailure(wrong), true);
		assert.equal(calls.some((call) => call.method === 'DELETE'), false);

		await assert.rejects(
			async () => {
				await projectActions.deleteProject(
				fakeEvent({
					url: `http://console.example/projects/${PROJECT.id}`,
					session: TOKEN,
					user: USER,
					params: { id: PROJECT.id },
					form: { confirm: 'Lab' }
				}).event as never);
			},
			(err: unknown) => isRedirect(err) && err.location === '/projects'
		);
		assert.equal(calls.some((call) => call.method === 'DELETE' && call.url.pathname === `/v1/projects/${PROJECT.id}`), true);
	});

	test('delete without the typed project name does not call the API', async () => {
		useApi('https://api.test');
		const calls = installFetch(() => envelope(PROJECT));
		const missing = await projectActions.deleteProject(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}`,
				session: TOKEN,
				user: USER,
				params: { id: PROJECT.id },
				form: {}
			}).event as never
		);
		assert.equal(isActionFailure(missing), true);
		if (!isActionFailure(missing)) assert.fail('expected the invalid result');
		assert.equal((missing.data as { message?: string } | undefined)?.message, 'Type the project name exactly to delete it.');

		const wrong = await projectActions.deleteProject(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}`,
				session: TOKEN,
				user: USER,
				params: { id: PROJECT.id },
				form: { confirm: 'lab' }
			}).event as never
		);
		assert.equal(isActionFailure(wrong), true);
		if (!isActionFailure(wrong)) assert.fail('expected the invalid result');
		assert.equal((wrong.data as { message?: string } | undefined)?.message, 'Type the project name exactly to delete it.');
		assert.equal(calls.some((call) => call.method === 'DELETE'), false);

		const settings = readFileSync(new URL('../src/routes/projects/[id]/SettingsSection.svelte', import.meta.url), 'utf8');
		assert.match(settings, /typeToConfirm=\{\{ name: 'confirm', expected: project\.name/);
		assert.doesNotMatch(settings, /type="hidden"[\s\S]{0,120}project\.name/);
		assert.doesNotMatch(settings, /hidden=\{[\s\S]*?project\.name/);
	});

	test('remove member keeps the members table query', async () => {
		useApi('https://api.test');
		installFetch(() => envelope(null));
		const userId = '00000000-0000-4000-8000-0000000000aa';
		await assert.rejects(
			async () => {
				await projectActions.removeMember(
					fakeEvent({
						url: `http://console.example/projects/${PROJECT.id}?tab=members&members.q=ada&members.page=2&confirm=remove-member-${userId}&/removeMember`,
						session: TOKEN,
						user: USER,
						params: { id: PROJECT.id },
						form: { user_id: userId }
					}).event as never
				);
			},
			(err: unknown) =>
				isRedirect(err) &&
				err.location === `/projects/${PROJECT.id}?tab=members&members.q=ada&members.page=2`
		);
	});

	test('probe posts only check_id and a snapshot result drops the session token', async () => {
		useApi('https://api.test');
		const calls = installFetch((call) => {
			if (call.url.pathname.endsWith('/probe')) return envelope({ service: 'api', protocol: 'http', port: 8080, path: '/health', result: 'up', http_status: 200, latency_ms: 3, checked_at: '2026-10-13T00:00:00Z' });
			return envelope({
				sampled_at: '2026-10-13T00:00:00Z',
				cpu_percent: 1,
				mem: null,
				disks: [],
				load: null,
				temp_celsius: null,
				uptime_sec: null,
				top: [{ pid: 1, process_name: 'bot', user: 'bot', cmdline: TOKEN, cpu_usage: 1.5, memory_rss: 1024 }]
			});
		});
		const probe = await projectActions.probe(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=services`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: { service_id: SERVICE_ID, check_id: CHECK_ID }
			}).event as never
		);
		assert.equal(isActionFailure(probe), false);
		if (!probe || isActionFailure(probe)) assert.fail('expected a probe result');
		assert.equal(probe.probe?.result, 'up');
		assert.equal(calls[0]?.body, JSON.stringify({ check_id: CHECK_ID }));
		assert.equal(containsToken(probe), false);

		const snapshot = await hostActions.snapshot(
			fakeEvent({
				url: `http://console.example/hosts/${HOST_ID}`,
				session: TOKEN,
				user: USER,
				params: { id: HOST_ID }
			}).event as never
		);
		if (!snapshot || isActionFailure(snapshot)) assert.fail('expected a snapshot');
		assert.equal(snapshot.snapshot?.top[0]?.cmdline, '[redacted]');
		assert.equal(containsToken(snapshot), false);
	});

	test('layout returns the signed-in name and the primary nav is Projects plus the user menu', async () => {
		useApi('https://api.test');
		const data = pageData(await layoutLoad(fakeEvent({ url: 'http://pi.local/projects', user: USER }).event as never));
		assert.equal(data.user?.name, 'Ada');
		assert.equal(Object.hasOwn(data, 'authEnabled'), false);
		const layout = readFileSync(new URL('../src/routes/+layout.svelte', import.meta.url), 'utf8');
		const navStart = layout.indexOf('aria-label="Primary"');
		const navEnd = layout.indexOf('</nav>');
		assert.ok(navStart >= 0 && navEnd > navStart);
		const nav = layout.slice(navStart, navEnd);
		assert.match(nav, />Projects</);
		assert.equal(/\b(Overview|Services|Processes|Databases|Ops)\b/.test(nav), false);
		assert.match(layout, /Sign out/);
		assert.match(layout, /data\.user\.name/);
	});

	test('the signed-in header wraps and the account name can shrink', () => {
		const layout = readFileSync(new URL('../src/routes/+layout.svelte', import.meta.url), 'utf8');
		const row = layout.match(/<div class="([^"]*sm:contents[^"]*)">/);
		assert.ok(row, 'signed-in header row');
		assert.match(row[1], /\bflex-wrap\b/);
		assert.match(row[1], /\bmin-w-0\b/);
		const account = layout.match(/<div class="([^"]*ml-auto[^"]*)">/);
		assert.ok(account, 'account cluster');
		assert.match(account[1], /\bmin-w-0\b/);
		assert.match(account[1], /\bmax-w-full\b/);
		const trigger = layout.match(
			/class=\{cn\(\s*buttonVariants\(\{ variant: 'ghost', size: 'sm' \}\),\s*'([^']+)'\s*\)\}/
		);
		assert.ok(trigger, 'account trigger overrides button shrink-0');
		assert.match(trigger[1], /\bshrink\b/);
		assert.equal(trigger[1].includes('shrink-0'), false);
		assert.match(trigger[1], /\bmin-w-0\b/);
		assert.match(trigger[1], /\bmax-w-full\b/);
		assert.match(trigger[1], /\boverflow-hidden\b/);
		assert.match(layout, /<span class="min-w-0 truncate">\{data\.user\.name \|\| 'Account'\}<\/span>/);
		const merged = cn(buttonVariants({ variant: 'ghost', size: 'sm' }), trigger[1]).split(/\s+/);
		assert.equal(merged.includes('shrink'), true);
		assert.equal(merged.includes('shrink-0'), false);
		assert.equal(merged.includes('overflow-hidden'), true);
		assert.equal(merged.includes('min-w-0'), true);
	});

	test('sign-in start sends redirect_uri and sets a 600 second Secure cookie on https', async () => {
		useApi('https://api.test');
		const calls = installFetch((call) => {
			assert.equal(call.url.pathname, '/v1/auth/google/start');
			assert.equal(call.url.searchParams.get('redirect_uri'), 'https://console.example/auth/google/callback');
			assert.equal(call.authorization, null);
			return envelope({ authorize_url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1', state: STATE });
		});
		const { event, sets } = fakeEvent({
			url: 'https://console.example/signin',
			form: { next: '/projects' }
		});
		await assert.rejects(async () => {
			await signInActions.default(event as never);
		}, (err: unknown) => {
			assert.equal(isRedirect(err), true);
			if (!isRedirect(err)) return false;
			assert.equal(err.location, 'https://accounts.google.com/o/oauth2/v2/auth?x=1');
			return true;
		});
		assert.equal(calls.length, 1);
		const cookie = sets.find((entry) => entry.op === 'set' && entry.name === 'bot_oauth');
		assert.ok(cookie);
		assert.equal(cookie.options.secure, true);
		assert.equal(cookie.options.maxAge, 600);
		assert.equal(cookie.options.httpOnly, true);
		assert.equal(cookie.options.path, '/');
		assert.equal(cookie.options.sameSite, 'lax');
	});

	test('sign-in refuses a non-allowlisted host and redirects to the re-serialised URL', async () => {
		useApi('https://api.test');
		installFetch(() => envelope({ authorize_url: 'https://evil.example/o/oauth2/v2/auth', state: STATE }));
		const refused = fakeEvent({
			url: 'https://console.example/signin',
			form: { next: '/projects' }
		});
		const failure = await signInActions.default(refused.event as never);
		assert.equal(isActionFailure(failure), true);
		if (!isActionFailure(failure)) return;
		assert.equal(failure.status, 502);
		assert.equal(refused.jar.has('bot_oauth'), false);
		assert.equal(refused.sets.some((entry) => entry.name === 'bot_oauth'), false);

		const raw = 'https://EVIL.example/o/oauth2/v2/auth?x=1';
		useApi('https://api.test');
		env.BOT_API_OAUTH_AUTHORIZE_HOSTS = 'evil.example';
		process.env.BOT_API_OAUTH_AUTHORIZE_HOSTS = 'evil.example';
		installFetch(() => envelope({ authorize_url: raw, state: STATE }));
		const allowed = fakeEvent({
			url: 'https://console.example/signin',
			form: { next: '/projects' }
		});
		await assert.rejects(async () => {
			await signInActions.default(allowed.event as never);
		}, (err: unknown) => {
			assert.equal(isRedirect(err), true);
			if (!isRedirect(err)) return false;
			assert.equal(err.location, 'https://evil.example/o/oauth2/v2/auth?x=1');
			assert.notEqual(err.location, raw);
			return true;
		});
	});

	test('admin tokens and hosts tabs list tokens, and create on Hosts shows a token once', async () => {
		useApi('https://api.test');
		const admin = { ...PROJECT, role: 'admin' as const };
		const row = {
			id: '00000000-0000-4000-8000-0000000000d1',
			host_name_hint: 'pi1',
			created_by: USER.id,
			created_at: '2026-10-13T00:00:00Z',
			expires_at: null,
			used_at: null,
			used_by_host_id: null,
			revoked_at: null,
			token: JOIN
		};
		const calls = installFetch((call) => {
			if (call.url.pathname === `/v1/projects/${PROJECT.id}`) return envelope(admin);
			if (call.url.pathname.endsWith('/hosts')) return envelope({ items: [], next_cursor: null });
			if (call.url.pathname.endsWith('/members')) return envelope({ items: [], next_cursor: null });
			if (call.url.pathname.endsWith('/join-tokens')) return envelope({ items: [row], next_cursor: null });
			return envelope(null, 500, 'error', 'unexpected');
		});
		const loaded = pageData(await projectLoad(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=tokens`,
				session: TOKEN,
				user: USER,
				projects: [admin],
				params: { id: PROJECT.id }
			}).event as never
		));
		assert.equal(loaded.tab, 'tokens');
		assert.equal(loaded.canAdmin, true);
		assert.equal(loaded.tokens.length, 1);
		assert.equal(loaded.tokens[0]?.host_name_hint, 'pi1');
		assert.equal(calls.some((call) => call.url.pathname.endsWith('/join-tokens')), true);
		assert.equal(containsToken(loaded, JOIN), false);

		// The Hosts tab also lists join tokens for an admin, to see when the created one is used.
		const hostsCalls = installFetch((call) => {
			if (call.url.pathname === `/v1/projects/${PROJECT.id}`) return envelope(admin);
			if (call.url.pathname.endsWith('/hosts')) return envelope({ items: [], next_cursor: null });
			if (call.url.pathname.endsWith('/join-tokens')) return envelope({ items: [row], next_cursor: null });
			return envelope(null, 500, 'error', 'unexpected');
		});
		const hostsTab = pageData(await projectLoad(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=hosts`,
				session: TOKEN,
				user: USER,
				projects: [admin],
				params: { id: PROJECT.id }
			}).event as never
		));
		assert.equal(hostsTab.tab, 'hosts');
		assert.equal(hostsTab.tokens.length, 1);
		assert.equal(hostsCalls.some((call) => call.url.pathname.endsWith('/join-tokens')), true);
		assert.equal(containsToken(hostsTab, JOIN), false);

		const command = `printf '%s' '${JOIN}' | sudo -u bot-agent bot-agent init --server 'wss://api.example/agent' --join-token-stdin`;
		const hostile = `${command}; rm -rf / ${TOKEN}`;
		const other = 'bbbbbbbbbbbbbbbb';
		const mismatched = `printf '%s' '${other}' | sudo -u bot-agent bot-agent init --server 'wss://api.example/agent' --join-token-stdin`;
		const substitution = `printf '%s' '${JOIN}' | sudo -u bot-agent bot-agent init --server 'wss://api.example/$(id)' --join-token-stdin`;
		const oldStyle = `sudo -u bot-agent bot-agent init --server 'wss://api.example/agent' --join-token '${JOIN}'`;
		const issued = [
			{ id: row.id, token: JOIN, install_command: command },
			{ id: row.id, token: JOIN, install_command: hostile },
			{ id: row.id, token: JOIN, install_command: mismatched },
			{ id: row.id, token: JOIN, install_command: substitution },
			{ id: row.id, token: JOIN, install_command: oldStyle },
			{ id: row.id, token: 'aaaaaaaaaaaaaaa', install_command: command }
		];
		let step = 0;
		installFetch((call) => {
			assert.equal(call.method, 'POST');
			const body = issued[step];
			step += 1;
			return envelope(body);
		});
		async function create() {
			return projectActions.createToken(
				fakeEvent({
					url: `http://console.example/projects/${PROJECT.id}?tab=hosts`,
					session: TOKEN,
					user: USER,
					projects: [admin],
					params: { id: PROJECT.id },
					form: { host_name_hint: '', expires_in_sec: '' }
				}).event as never
			);
		}
		const shown = await create();
		assert.equal(isRedirect(shown), false);
		assert.equal(isActionFailure(shown), false);
		if (!shown || isRedirect(shown) || isActionFailure(shown)) assert.fail('expected the join token');
		assert.equal(shown.scope, 'hosts');
		assert.equal(shown.created?.token, JOIN);
		assert.equal(shown.created?.id, row.id);
		assert.equal(shown.created?.server, 'wss://api.example/agent');
		assert.equal(shown.message, null);
		assert.equal(JSON.stringify(shown).includes('install_command'), false);
		assert.equal(JSON.stringify(shown).split(JOIN).length - 1, 1);

		const hidden = await create();
		if (!hidden || isRedirect(hidden) || isActionFailure(hidden)) assert.fail('expected the join token');
		assert.equal(hidden.created?.token, JOIN);
		assert.equal(hidden.created?.server, null);
		assert.equal(hidden.message, 'Server URL not shown: unexpected format');
		assert.equal(JSON.stringify(hidden).includes('rm -rf'), false);
		assert.equal(containsToken(hidden), false);

		const mismatch = await create();
		if (!mismatch || isRedirect(mismatch) || isActionFailure(mismatch)) assert.fail('expected the join token');
		assert.equal(mismatch.created?.server, null);
		assert.equal(mismatch.message, 'Server URL not shown: unexpected format');
		assert.equal(JSON.stringify(mismatch).includes(other), false);

		const substituted = await create();
		if (!substituted || isRedirect(substituted) || isActionFailure(substituted)) assert.fail('expected the join token');
		assert.equal(substituted.created?.server, null);
		assert.equal(substituted.message, 'Server URL not shown: unexpected format');
		assert.equal(JSON.stringify(substituted).includes('$('), false);

		const legacy = await create();
		if (!legacy || isRedirect(legacy) || isActionFailure(legacy)) assert.fail('expected the join token');
		assert.equal(legacy.created?.server, null);
		assert.equal(legacy.message, 'Server URL not shown: unexpected format');
		assert.equal(JSON.stringify(legacy).includes('--join-token '), false);

		const rejected = await create();
		assert.equal(isActionFailure(rejected), true);
		if (!isActionFailure(rejected)) return;
		assert.equal(rejected.status, 502);
		assert.equal(JSON.stringify(rejected.data).includes('aaaaaaaaaaaaaaa'), false);

		installFetch((call) => {
			if (call.url.pathname === `/v1/projects/${PROJECT.id}`) return envelope(admin);
			if (call.url.pathname.endsWith('/join-tokens')) return envelope({ items: [row], next_cursor: null });
			return envelope({ items: [], next_cursor: null });
		});
		const again = pageData(await projectLoad(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=tokens`,
				session: TOKEN,
				user: USER,
				projects: [admin],
				params: { id: PROJECT.id }
			}).event as never
		));
		assert.equal(containsToken(again, JOIN), false);
		const addHost = readFileSync(new URL('../src/routes/projects/[id]/AddHostSection.svelte', import.meta.url), 'utf8');
		assert.equal(addHost.includes('install_command'), false);
		assert.equal(addHost.includes('Copy install command'), false);
		assert.match(addHost, /Copy token/);
		assert.match(addHost, /Copy enrol command/);
		const tokensPage = readFileSync(new URL('../src/routes/projects/[id]/TokensSection.svelte', import.meta.url), 'utf8');
		assert.equal(tokensPage.includes('created.token'), false);
		assert.equal(tokensPage.includes('createToken'), false);
	});

	test('device load, approve, deny, a mismatched code, and an expired status', async () => {
		useApi('https://api.test');
		const pending = {
			user_code: 'BCDF-GHJK',
			client_name: 'laptop',
			expires_at: '2026-10-13T01:00:00Z',
			status: 'pending'
		};
		const calls = installFetch((call) => {
			assert.equal(call.url.pathname, '/v1/auth/device/BCDF-GHJK');
			assert.equal(call.method, 'GET');
			return envelope(pending);
		});
		const loaded = pageData(await deviceLoad(
			fakeEvent({
				url: 'http://console.example/device?code=bcdf-ghjk',
				session: TOKEN,
				user: USER
			}).event as never
		));
		assert.equal(calls.length, 1);
		assert.equal(loaded.device?.client_name, 'laptop');
		assert.equal(loaded.device?.status, 'pending');
		assert.equal(loaded.code, 'BCDF-GHJK');

		const approved = installFetch((call) => {
			assert.equal(call.method, 'POST');
			assert.equal(call.url.pathname, '/v1/auth/device/BCDF-GHJK/approve');
			return envelope(null);
		});
		await assert.rejects(async () => {
			await deviceActions.approve(
				fakeEvent({
					url: 'http://console.example/device?code=BCDF-GHJK',
					session: TOKEN,
					user: USER,
					form: { code: 'bcdf-ghjk' }
				}).event as never
			);
		}, (err: unknown) => isRedirect(err) && err.location === '/device?code=BCDF-GHJK');
		assert.equal(approved.length, 1);

		const denied = installFetch((call) => {
			assert.equal(call.method, 'POST');
			assert.equal(call.url.pathname, '/v1/auth/device/BCDF-GHJK/deny');
			return envelope(null);
		});
		await assert.rejects(async () => {
			await deviceActions.deny(
				fakeEvent({
					url: 'http://console.example/device?code=BCDF-GHJK',
					session: TOKEN,
					user: USER,
					form: { code: 'BCDFGHJK' }
				}).event as never
			);
		}, (err: unknown) => isRedirect(err) && err.location === '/device?code=BCDF-GHJK');
		assert.equal(denied.length, 1);

		const skipped = installFetch(() => {
			throw new Error('api called');
		});
		const mismatch = await deviceActions.approve(
			fakeEvent({
				url: 'http://console.example/device?code=BCDF-GHJK',
				session: TOKEN,
				user: USER,
				form: { code: 'LMNP-QRST' }
			}).event as never
		);
		assert.equal(isActionFailure(mismatch), true);
		if (!isActionFailure(mismatch)) return;
		assert.equal(mismatch.status, 400);
		assert.equal(skipped.length, 0);

		installFetch(() => envelope({ ...pending, status: 'expired' }));
		const expired = pageData(await deviceLoad(
			fakeEvent({
				url: 'http://console.example/device?code=BCDF-GHJK',
				session: TOKEN,
				user: USER
			}).event as never
		));
		assert.equal(expired.device?.status, 'expired');
		const page = readFileSync(new URL('../src/routes/device/+page.svelte', import.meta.url), 'utf8');
		assert.match(page, /This code has expired\. Start sign-in on the device again\./);
		assert.match(page, /data\.device\.status === 'pending'/);
	});

	test('the services load reads health checks with the list in one call (api-v1 v1.18)', async () => {
		useApi('https://api.test');
		const row = (index: number, healthChecks: unknown) => ({
			id: `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`,
			host_id: HOST_ID,
			name: `s${index}`,
			source: 'discovered',
			kind: 'process',
			ports: [],
			health: null,
			display_name: null,
			owner_user: null,
			project_id: PROJECT.id,
			host_name: 'pi1',
			host_status: 'online',
			project_name: 'Lab',
			...(healthChecks === undefined ? {} : { health_checks: healthChecks })
		});
		const check = { id: CHECK_ID, protocol: 'http', port: 80, path: '/health', enabled: true };
		const services = [row(0, [check]), row(1, []), row(2, [{ ...check, protocol: 'udp' }]), row(3, undefined), ...Array.from({ length: 51 }, (_, index) => row(index + 4, []))];
		const calls = installFetch((call) => {
			if (call.url.pathname === `/v1/projects/${PROJECT.id}/services`) {
				return envelope({ items: services, next_cursor: null, prev_cursor: null, total: services.length });
			}
			if (call.url.pathname === `/v1/projects/${PROJECT.id}/hosts`) return envelope({ items: [], next_cursor: null });
			if (call.url.pathname === `/v1/projects/${PROJECT.id}/members`) return envelope({ items: [], next_cursor: null });
			if (call.url.pathname === `/v1/projects/${PROJECT.id}/join-tokens`) return envelope({ items: [], next_cursor: null });
			if (call.url.pathname === `/v1/projects/${PROJECT.id}`) return envelope(PROJECT);
			return envelope(null, 500, 'error', 'unexpected');
		});
		const page = pageData(await projectLoad(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=services`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id }
			}).event as never
		));
		const lists = calls.filter((call) => call.url.pathname === `/v1/projects/${PROJECT.id}/services`);
		assert.equal(lists.length, 1);
		assert.equal(lists[0]?.url.searchParams.get('include'), 'health_checks');
		assert.equal(calls.filter((call) => call.url.pathname.startsWith('/v1/services/')).length, 0);
		assert.equal(page.services.length, 55);
		assert.equal(page.servicesOmitted, 0);
		assert.deepEqual(page.services[0]?.checks, [
			{ id: CHECK_ID, protocol: 'http', port: 80, path: '/health', enabled: true, interval_sec: 60, expect_status_min: 200, expect_status_max: 399 }
		]);
		assert.equal(page.services[0]?.checksMessage, null);
		assert.deepEqual(page.services[1]?.checks, []);
		assert.equal(page.services[1]?.checksMessage, null);
		assert.deepEqual(page.services[2]?.checks, []);
		assert.equal(page.services[2]?.checksMessage, 'Health checks could not be read.');
		assert.deepEqual(page.services[3]?.checks, []);
		assert.equal(page.services[3]?.checksMessage, 'Health checks need API v1.18 or later.');
		assert.equal(page.services[54]?.checksMessage, null);
		assert.equal(page.services[54]?.name, 's54');
	});
});
