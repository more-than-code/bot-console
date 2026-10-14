import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { isActionFailure, isRedirect, type Handle, type RequestEvent } from '@sveltejs/kit';
import { render } from 'svelte/server';
import type { Invite } from '../src/lib/api-types.ts';
import { handle } from '../src/hooks.server.ts';
import { parseCreatedInvite, parseInvite, parseInviteAccept, parseInviteLookup } from '../src/lib/server/shape.ts';
import { safeNext } from '../src/lib/server/session.ts';
import { acceptedInviteUrl } from '../src/lib/server/validate.ts';
import { actions as inviteActions, load as inviteLoad } from '../src/routes/invite/[token]/+page.server.ts';
import InvitePage from '../src/routes/invite/[token]/+page.svelte';
import { actions as projectActions, load as projectLoad } from '../src/routes/projects/[id]/+page.server.ts';
import MembersSection from '../src/routes/projects/[id]/MembersSection.svelte';
import ProjectPage from '../src/routes/projects/[id]/+page.svelte';
import { containsToken, envelope, fakeEvent, installFetch, PROJECT, restoreEnv, TOKEN, useApi, USER } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

const INVITE = 'a'.repeat(43);
const ORIGIN = 'https://console.example';
const INVITE_URL = `${ORIGIN}/invite/${INVITE}`;
const INVITE_ID = '00000000-0000-4000-8000-0000000000c1';
const OTHER_PROJECT = '00000000-0000-4000-8000-000000000099';
const INVALID_NOTICE = 'This invite link is invalid, expired or already used.';
const originalFetch = globalThis.fetch;

function pageData<T>(value: T): Exclude<T, void | undefined | null> {
	if (value == null) assert.fail('missing page data');
	return value as Exclude<T, void | undefined | null>;
}

function decode(value: string): string {
	return value
		.replaceAll('&amp;', '&')
		.replaceAll('&quot;', '"')
		.replaceAll('&#39;', "'")
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>');
}

function textOf(html: string): string {
	return decode(html)
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function captureHeaders(event: RequestEvent): Headers {
	const headers = new Headers();
	event.setHeaders = (value: Record<string, string>) => {
		for (const [key, item] of Object.entries(value)) headers.set(key, item);
	};
	return headers;
}

function assertInviteHeaders(headers: Headers): void {
	assert.equal(headers.get('cache-control'), 'no-store');
	assert.equal(headers.get('referrer-policy'), 'no-referrer');
	assert.equal(headers.get('x-frame-options'), 'DENY');
}

async function withLogs(run: () => Promise<void>): Promise<string[]> {
	const lines: string[] = [];
	const write = (...args: unknown[]) => {
		lines.push(args.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join(' '));
	};
	const log = console.log;
	const error = console.error;
	const info = console.info;
	console.log = write;
	console.error = write;
	console.info = write;
	try {
		await run();
	} finally {
		console.log = log;
		console.error = error;
		console.info = info;
	}
	return lines;
}

function inviteRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: INVITE_ID,
		role: 'viewer',
		created_by: USER.id,
		created_at: '2026-10-13T00:00:00Z',
		expires_at: '2099-01-01T00:00:00Z',
		max_uses: 1,
		uses: 0,
		revoked_at: null,
		...overrides
	};
}

function createdBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return { ...inviteRow(), token: INVITE, url: INVITE_URL, ...overrides };
}

function lookupBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		project_id: PROJECT.id,
		project_name: 'Lab',
		role: 'viewer',
		already_member: false,
		...overrides
	};
}

function memberProps(extra: Record<string, unknown> = {}) {
	return {
		members: [],
		omitted: 0,
		truncated: false,
		canAdmin: true,
		canOwner: false,
		currentUserId: USER.id,
		message: null,
		invites: [] as Invite[],
		invitesOmitted: 0,
		invitesTruncated: false,
		invitesMessage: null,
		inviteUrl: null,
		inviteRole: null,
		inviteMessage: null,
		...extra
	};
}

describe('project invite links', { concurrency: false }, () => {
	before(() => {
		useApi('https://api.test');
	});

	after(() => {
		globalThis.fetch = originalFetch;
		restoreEnv();
	});

	test('safeNext accepts an invite token path and still rejects hostile targets', () => {
		const path = `/invite/${INVITE}`;
		assert.equal(safeNext(path), path);
		assert.equal(safeNext('/services?host=pi1'), '/services?host=pi1');
		assert.equal(safeNext('/account/apps'), '/account/apps');
		for (const hostile of [
			`/invite/${'a'.repeat(42)}`,
			`/invite/${'a'.repeat(44)}`,
			`${path}?next=/projects`,
			`${path}#fragment`,
			`${path}/extra`,
			`/invite/${'a'.repeat(42)}+`,
			`//evil.com/invite/${INVITE}`,
			'//evil.com',
			'/\\evil.com',
			'/%2f%2fevil.com',
			'https://evil.com',
			'javascript:alert(1)',
			'/\t/evil',
			'/signin',
			'/signin?next=/',
			'/signout',
			'/auth/google/callback',
			'',
			null
		]) {
			assert.equal(safeNext(hostile), '/projects', String(hostile));
		}
	});

	test('invite shapes fail closed and a list row drops the token', () => {
		const parsed = parseInvite({ ...inviteRow(), token: INVITE, url: INVITE_URL });
		assert.equal(parsed?.role, 'viewer');
		assert.equal(JSON.stringify(parsed).includes(INVITE), false);
		assert.equal(JSON.stringify(parsed).includes('url'), false);
		assert.equal(parseInvite(inviteRow({ role: 'owner' })), null);
		assert.equal(parseInvite(inviteRow({ max_uses: 51 })), null);
		assert.equal(parseInvite(inviteRow({ max_uses: 0 })), null);
		assert.equal(parseInvite(inviteRow({ uses: 1.5 })), null);
		assert.equal(parseInvite(inviteRow({ uses: 2, max_uses: 1 })), null);
		assert.equal(parseInvite(inviteRow({ id: 'not-a-uuid' })), null);
		assert.equal(parseInvite(inviteRow({ created_by: 'x'.repeat(40) })), null);
		assert.equal(parseInvite(inviteRow({ expires_at: 'x'.repeat(65) })), null);
		assert.equal(parseInvite(null), null);

		assert.equal(parseCreatedInvite(createdBody(), ORIGIN)?.url, INVITE_URL);
		assert.equal(parseCreatedInvite(createdBody(), ORIGIN)?.role, 'viewer');
		assert.equal(JSON.stringify(parseCreatedInvite(createdBody(), ORIGIN)).includes('"token"'), false);
		assert.equal(parseCreatedInvite(createdBody({ url: 'javascript:alert(1)' }), ORIGIN), null);
		assert.equal(parseCreatedInvite(createdBody({ url: 'https://evil.example/phish' }), ORIGIN), null);
		assert.equal(parseCreatedInvite(createdBody({ url: `https://evil.example/invite/${INVITE}` }), ORIGIN), null);
		assert.equal(parseCreatedInvite(createdBody({ url: `http://console.example/invite/${INVITE}` }), ORIGIN), null);
		assert.equal(parseCreatedInvite(createdBody(), 'http://console.example'), null);
		assert.equal(parseCreatedInvite(createdBody({ token: 'b'.repeat(43) }), ORIGIN), null);
		assert.equal(parseCreatedInvite(createdBody({ url: `https://user:pass@console.example/invite/${INVITE}` }), ORIGIN), null);
		assert.equal(acceptedInviteUrl(INVITE, INVITE_URL, ORIGIN), INVITE_URL);
		assert.equal(acceptedInviteUrl(INVITE, `https://evil.example/invite/${INVITE}`, ORIGIN), null);
		assert.equal(acceptedInviteUrl(INVITE, `http://console.example/invite/${INVITE}`, ORIGIN), null);

		assert.equal(parseInviteLookup(lookupBody())?.project_name, 'Lab');
		assert.equal(parseInviteLookup(lookupBody({ already_member: 'yes' })), null);
		assert.equal(parseInviteLookup(lookupBody({ role: 'owner' })), null);
		assert.equal(parseInviteLookup(lookupBody({ project_name: 'x'.repeat(81) })), null);
		assert.equal(parseInviteLookup(lookupBody({ project_id: 'nope' })), null);

		assert.equal(parseInviteAccept({ project_id: OTHER_PROJECT, role: 'owner' })?.project_id, OTHER_PROJECT);
		assert.equal(parseInviteAccept({ project_id: OTHER_PROJECT, role: 'viewer' })?.project_id, OTHER_PROJECT);
		assert.equal(parseInviteAccept({ project_id: 'nope', role: 'viewer' }), null);
		assert.equal(parseInviteAccept({ project_id: OTHER_PROJECT }), null);
	});

	test('create shows the url once and the list never contains a token', async () => {
		const calls = installFetch((call) => {
			assert.equal(call.method, 'POST');
			assert.equal(call.url.pathname, `/v1/projects/${PROJECT.id}/invites`);
			assert.equal(call.body, JSON.stringify({ role: 'viewer', expires_in_sec: 604800, max_uses: 1 }));
			return envelope(createdBody({ role: 'admin' }));
		});
		const built = fakeEvent({
			url: `${ORIGIN}/projects/${PROJECT.id}?tab=members`,
			session: TOKEN,
			user: USER,
			projects: [{ ...PROJECT, role: 'admin' }],
			params: { id: PROJECT.id },
			form: { role: 'viewer', expires_in_sec: '604800', max_uses: '1' }
		});
		let created: Awaited<ReturnType<typeof projectActions.createInvite>> | undefined;
		const logs = await withLogs(async () => {
			created = await projectActions.createInvite(built.event as never);
		});
		assert.equal(calls.length, 1);
		assert.equal(isRedirect(created), false);
		assert.equal(isActionFailure(created), false);
		if (!created || isRedirect(created) || isActionFailure(created)) assert.fail('expected the invite result');
		assert.equal(created.inviteUrl, INVITE_URL);
		assert.equal(created.inviteRole, 'admin');
		assert.equal(JSON.stringify(created).includes('"token"'), false);
		assert.equal(built.sets.length, 0);
		assert.equal(built.event.url.search.includes(INVITE), false);
		assert.equal(logs.some((line) => line.includes(INVITE)), false);

		const leaked = installFetch(() => envelope(createdBody({ url: 'https://evil.example/phish', token: INVITE })));
		const refused = await projectActions.createInvite(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=members`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: { role: 'viewer', expires_in_sec: '86400', max_uses: '5' }
			}).event as never
		);
		assert.equal(leaked.length, 1);
		assert.equal(isActionFailure(refused), true);
		if (!isActionFailure(refused)) return;
		assert.equal(JSON.stringify(refused.data).includes(INVITE), false);
		assert.equal(JSON.stringify(refused.data).includes('evil.example'), false);

		const other = 'https://other.example';
		const otherUrl = `${other}/invite/${INVITE}`;
		installFetch(() => envelope(createdBody({ url: otherUrl })));
		const onOther = await projectActions.createInvite(
			fakeEvent({
				url: `${other}/projects/${PROJECT.id}?tab=members`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: { role: 'viewer', expires_in_sec: '604800', max_uses: '1' }
			}).event as never
		);
		if (!onOther || isRedirect(onOther) || isActionFailure(onOther)) assert.fail('expected the other-origin invite');
		assert.equal(onOther.inviteUrl, otherUrl);

		for (const [page, apiUrl] of [
			[`${ORIGIN}/projects/${PROJECT.id}?tab=members`, `http://console.example/invite/${INVITE}`],
			[`${other}/projects/${PROJECT.id}?tab=members`, INVITE_URL],
			[`${ORIGIN}/projects/${PROJECT.id}?tab=members`, `https://evil.example/invite/${INVITE}`]
		] as const) {
			installFetch(() => envelope(createdBody({ url: apiUrl })));
			const mismatch = await projectActions.createInvite(
				fakeEvent({
					url: page,
					session: TOKEN,
					user: USER,
					projects: [PROJECT],
					params: { id: PROJECT.id },
					form: { role: 'viewer', expires_in_sec: '604800', max_uses: '1' }
				}).event as never
			);
			assert.equal(isActionFailure(mismatch), true);
			if (!isActionFailure(mismatch)) assert.fail('expected the origin failure');
			const body = JSON.stringify(mismatch.data);
			assert.equal(body.includes('inviteUrl'), false);
			assert.equal(body.includes(INVITE), false);
			assert.match(body, /unexpected/);
		}

		const skipped = installFetch(() => {
			throw new Error('api called');
		});
		for (const form of [
			{ role: 'owner', expires_in_sec: '604800', max_uses: '1' },
			{ role: 'viewer', expires_in_sec: '3600', max_uses: '1' },
			{ role: 'viewer', expires_in_sec: '604800', max_uses: '50' }
		]) {
			const rejected = await projectActions.createInvite(
				fakeEvent({
					url: `http://console.example/projects/${PROJECT.id}?tab=members`,
					session: TOKEN,
					user: USER,
					params: { id: PROJECT.id },
					form
				}).event as never
			);
			assert.equal(isActionFailure(rejected), true);
		}
		assert.equal(skipped.length, 0);

		const listed = installFetch((call) => {
			if (call.url.pathname === `/v1/projects/${PROJECT.id}`) return envelope({ ...PROJECT, role: 'admin' });
			if (call.url.pathname.endsWith('/invites')) {
				assert.equal(call.method, 'GET');
				assert.equal(call.url.searchParams.has('token'), false);
				return envelope({ items: [{ ...inviteRow(), token: INVITE, url: INVITE_URL }], next_cursor: null });
			}
			if (call.url.pathname.endsWith('/hosts') || call.url.pathname.endsWith('/members') || call.url.pathname.endsWith('/join-tokens')) {
				return envelope({ items: [], next_cursor: null });
			}
			return envelope(null, 500, 'error', 'unexpected');
		});
		const loaded = pageData(
			await projectLoad(
				fakeEvent({
					url: `http://console.example/projects/${PROJECT.id}?tab=members`,
					session: TOKEN,
					user: USER,
					projects: [{ ...PROJECT, role: 'admin' }],
					params: { id: PROJECT.id }
				}).event as never
			)
		);
		assert.equal(loaded.invites.length, 1);
		assert.equal('token' in (loaded.invites[0] ?? {}), false);
		assert.equal(containsToken(loaded, INVITE), false);
		assert.equal(listed.some((call) => call.url.pathname.endsWith('/invites') && call.method === 'GET'), true);

		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=members`);
		const shown = decode(
			render(MembersSection, {
				props: memberProps({ inviteUrl: INVITE_URL, inviteRole: 'admin' })
			}).body
		);
		const source = readFileSync(new URL('../src/routes/projects/[id]/MembersSection.svelte', import.meta.url), 'utf8');
		assert.match(source, /Anyone with this link can join as \{inviteRole\} until it expires\. It won't be shown again\./);
		assert.match(source, /<CopyButton value=\{shownUrl\} label="Copy invite link" \/>/);
		assert.match(source, /actionUrlFrom\(page\.url, 'createInvite'\)/);
		assert.match(shown, /aria-expanded="true"/);
		assert.match(shown, /Invite link/);
		if (shown.includes(INVITE_URL)) assert.match(shown, /It won't be shown again/);
	});

	test('revoke posts the delete', async () => {
		const calls = installFetch(() => envelope(null));
		await assert.rejects(
			async () => {
				await projectActions.revokeInvite(
					fakeEvent({
						url: `http://console.example/projects/${PROJECT.id}?tab=members&confirm=revoke-invite-${INVITE_ID}&/revokeInvite`,
						session: TOKEN,
						user: USER,
						params: { id: PROJECT.id },
						form: { invite_id: INVITE_ID }
					}).event as never
				);
			},
			(err: unknown) =>
				isRedirect(err) && err.status === 303 && err.location === `/projects/${PROJECT.id}?tab=members`
		);
		assert.equal(calls.length, 1);
		assert.equal(calls[0]?.method, 'DELETE');
		assert.equal(calls[0]?.url.pathname, `/v1/projects/${PROJECT.id}/invites/${INVITE_ID}`);

		const skipped = installFetch(() => {
			throw new Error('api called');
		});
		const bad = await projectActions.revokeInvite(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=members`,
				session: TOKEN,
				user: USER,
				params: { id: PROJECT.id },
				form: { invite_id: 'not-a-uuid' }
			}).event as never
		);
		assert.equal(isActionFailure(bad), true);
		assert.equal(skipped.length, 0);
	});

	test('a viewer sees no invite controls and the load does not list invites', async () => {
		const calls = installFetch((call) => {
			if (call.url.pathname === `/v1/projects/${PROJECT.id}`) return envelope({ ...PROJECT, role: 'viewer' });
			if (call.url.pathname.endsWith('/hosts') || call.url.pathname.endsWith('/members')) {
				return envelope({ items: [], next_cursor: null });
			}
			return envelope(null, 500, 'error', 'unexpected');
		});
		const url = `http://console.example/projects/${PROJECT.id}?tab=members`;
		const loaded = pageData(
			await projectLoad(
				fakeEvent({
					url,
					session: TOKEN,
					user: USER,
					projects: [{ ...PROJECT, role: 'viewer' }],
					params: { id: PROJECT.id }
				}).event as never
			)
		);
		assert.equal(loaded.canAdmin, false);
		assert.equal(calls.some((call) => call.url.pathname.endsWith('/invites')), false);
		setPageUrl(url);
		const html = decode(render(ProjectPage, { props: { data: loaded as never, form: null } }).body);
		assert.equal(html.includes('Invite link'), false);
		assert.equal(html.includes('Pending invites'), false);
		assert.equal(html.includes('revokeInvite'), false);
		assert.equal(html.includes('createInvite'), false);
	});

	test('the pending table shows role, creator, expiry, uses, and status', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=members`);
		const rows: Invite[] = [
			{
				id: '00000000-0000-4000-8000-0000000000c1',
				role: 'viewer',
				created_by: USER.id,
				created_at: '2026-10-13T00:00:00Z',
				expires_at: '2099-01-01T00:00:00Z',
				max_uses: 5,
				uses: 1,
				revoked_at: null
			},
			{
				id: '00000000-0000-4000-8000-0000000000c2',
				role: 'admin',
				created_by: USER.id,
				created_at: '2026-10-13T00:00:00Z',
				expires_at: '2020-01-01T00:00:00Z',
				max_uses: 1,
				uses: 0,
				revoked_at: null
			},
			{
				id: '00000000-0000-4000-8000-0000000000c3',
				role: 'viewer',
				created_by: USER.id,
				created_at: '2026-10-13T00:00:00Z',
				expires_at: '2099-01-01T00:00:00Z',
				max_uses: 1,
				uses: 1,
				revoked_at: null
			},
			{
				id: '00000000-0000-4000-8000-0000000000c4',
				role: 'viewer',
				created_by: USER.id,
				created_at: '2026-10-13T00:00:00Z',
				expires_at: '2020-01-01T00:00:00Z',
				max_uses: 1,
				uses: 0,
				revoked_at: '2026-10-14T00:00:00Z'
			}
		];
		const html = decode(render(MembersSection, { props: memberProps({ invites: rows, canOwner: true }) }).body);
		assert.match(html, /Pending invites/);
		assert.match(html, />Role</);
		assert.match(html, />Created by</);
		assert.match(html, />Expires</);
		assert.match(html, />Uses</);
		assert.match(html, />Status</);
		assert.match(html, new RegExp(USER.id));
		assert.match(html, />1\/5</);
		assert.equal(html.split('>active<').length - 1, 1);
		assert.equal(html.split('>expired<').length - 1, 1);
		assert.equal(html.split('>used up<').length - 1, 1);
		assert.equal(html.split('>revoked<').length - 1, 1);
		assert.match(html, /aria-label="Revoke invite 00000000-0000-4000-8000-0000000000c1"/);
		assert.match(html, /aria-label="Revoke invite 00000000-0000-4000-8000-0000000000c2"/);
		assert.match(html, /aria-label="Revoke invite 00000000-0000-4000-8000-0000000000c3"/);
		assert.equal(html.includes('Revoke invite 00000000-0000-4000-8000-0000000000c4'), false);
		assert.match(html, /lucide-ban/);
		// The confirm form is portaled and absent while the dialog is closed.
		const source = readFileSync(new URL('../src/routes/projects/[id]/MembersSection.svelte', import.meta.url), 'utf8');
		assert.match(source, /action=\{actionUrlFrom\(page\.url, 'revokeInvite'\)\}/);
		assert.match(source, /name: 'invite_id', value: invite\.id/);
		assert.match(source, /\{#if !invite\.revoked_at\}/);
	});

	test('a signed-out invite redirects to sign-in with next', async () => {
		const calls = installFetch(() => {
			throw new Error('api called');
		});
		const next = `/invite/${INVITE}`;
		const location = `/signin?next=${encodeURIComponent(next)}`;
		const { event } = fakeEvent({ url: `http://console.example${next}` });
		const redirected = await handle({ event, resolve: async () => new Response('no') } as Parameters<Handle>[0]);
		assert.equal(redirected.status, 303);
		assert.equal(redirected.headers.get('location'), location);
		assertInviteHeaders(redirected.headers);
		const loaded = fakeEvent({ url: `http://console.example${next}`, params: { token: INVITE } });
		await assert.rejects(
			async () => {
				await inviteLoad(loaded.event as never);
			},
			(err: unknown) => isRedirect(err) && err.status === 303 && err.location === location
		);
		assert.equal(calls.length, 0);

		const dropped = fakeEvent({ url: 'http://console.example/invite/short' });
		const short = await handle({
			event: dropped.event,
			resolve: async () => new Response('no')
		} as Parameters<Handle>[0]);
		assert.equal(short.status, 303);
		assert.equal(short.headers.get('location'), `/signin?next=${encodeURIComponent('/projects')}`);
		assertInviteHeaders(short.headers);

		const dataEvent = fakeEvent({ url: `http://console.example${next}/__data.json` });
		(dataEvent.event as { isDataRequest: boolean }).isDataRequest = true;
		const data = await handle({
			event: dataEvent.event,
			resolve: async () => new Response('no')
		} as Parameters<Handle>[0]);
		assert.equal(data.status, 200);
		assert.deepEqual(await data.json(), { type: 'redirect', location });
		assertInviteHeaders(data.headers);

		const signIn = await handle({
			event: fakeEvent({ url: `http://console.example/signin?next=${encodeURIComponent(next)}` }).event,
			resolve: async () => new Response('sign-in')
		} as Parameters<Handle>[0]);
		assert.equal(signIn.status, 200);
		assert.equal(await signIn.text(), 'sign-in');
		assert.equal(signIn.headers.get('referrer-policy'), 'no-referrer');
		assert.equal(signIn.headers.get('cache-control'), 'no-store');

		const toGoogle = await handle({
			event: fakeEvent({ url: `${ORIGIN}/signin?next=${encodeURIComponent(next)}` }).event,
			resolve: async () =>
				new Response(null, { status: 303, headers: { location: 'https://accounts.google.com/o/oauth2/v2/auth' } })
		} as Parameters<Handle>[0]);
		assert.equal(toGoogle.status, 303);
		assert.equal(toGoogle.headers.get('location'), 'https://accounts.google.com/o/oauth2/v2/auth');
		assert.equal(toGoogle.headers.get('referrer-policy'), 'no-referrer');
		assert.equal(toGoogle.headers.get('cache-control'), 'no-store');
	});

	test('not_found renders the invalid notice and does not offer Join', async () => {
		const calls = installFetch((call) => {
			assert.equal(call.method, 'POST');
			assert.equal(call.url.pathname, '/v1/invites/lookup');
			return envelope(null, 404, 'not_found', `gone ${INVITE}`);
		});
		const built = fakeEvent({
			url: `http://console.example/invite/${INVITE}`,
			session: TOKEN,
			user: USER,
			params: { token: INVITE }
		});
		const headers = captureHeaders(built.event);
		let loaded: Awaited<ReturnType<typeof inviteLoad>> | undefined;
		const logs = await withLogs(async () => {
			loaded = await inviteLoad(built.event as never);
		});
		const data = pageData(loaded);
		assert.equal(data.view, 'invalid');
		assert.equal(containsToken(data, INVITE), false);
		assert.equal(logs.some((line) => line.includes(INVITE)), false);
		assert.equal(calls.length, 1);
		assertInviteHeaders(headers);
		const html = decode(render(InvitePage, { props: { data, form: null } as never }).body);
		assert.match(html, new RegExp(INVALID_NOTICE));
		assert.match(html, /href="\/projects"/);
		assert.equal(html.includes('>Join<'), false);
	});

	test('an existing member sees the project link and not Join', async () => {
		installFetch((call) => {
			assert.equal(call.url.pathname, '/v1/invites/lookup');
			assert.equal(call.method, 'POST');
			return envelope(lookupBody({ already_member: true, project_name: 'Lab <ops>' }));
		});
		const data = pageData(
			await inviteLoad(
				fakeEvent({
					url: `http://console.example/invite/${INVITE}`,
					session: TOKEN,
					user: USER,
					params: { token: INVITE }
				}).event as never
			)
		);
		assert.equal(data.view, 'member');
		const html = render(InvitePage, { props: { data, form: null } as never }).body;
		assert.match(html, /You're already a member of <a[^>]*>Lab &lt;ops><\/a>\./);
		assert.match(html, new RegExp(`href="/projects/${PROJECT.id}"`));
		assert.equal(html.includes('<ops>'), false);
		assert.equal(html.includes('>Join<'), false);
	});

	test('a normal invite renders Join and the load never calls accept', async () => {
		const calls = installFetch((call) => {
			assert.equal(call.method, 'POST');
			assert.equal(call.url.pathname, '/v1/invites/lookup');
			assert.equal(call.body, JSON.stringify({ token: INVITE }));
			return envelope(lookupBody());
		});
		const built = fakeEvent({
			url: `http://console.example/invite/${INVITE}`,
			session: TOKEN,
			user: USER,
			params: { token: INVITE }
		});
		const headers = captureHeaders(built.event);
		const data = pageData(await inviteLoad(built.event as never));
		assert.deepEqual(
			calls.map((call) => `${call.method} ${call.url.pathname}`),
			['POST /v1/invites/lookup']
		);
		assert.equal(data.view, 'join');
		assert.equal(data.role, 'viewer');
		assert.equal(containsToken(data, INVITE), false);
		assertInviteHeaders(headers);
		const html = render(InvitePage, { props: { data, form: null } as never }).body;
		const text = textOf(html);
		assert.match(text, /Join Lab\?/);
		assert.match(text, /You'll join as viewer\./);
		assert.match(html, /action="\?\/accept"/);
		assert.match(html, />Join</);
		assert.equal(html.includes(INVITE), false);
		const source = readFileSync(new URL('../src/routes/invite/[token]/+page.svelte', import.meta.url), 'utf8');
		assert.match(source, /use:enhance/);
		const server = readFileSync(new URL('../src/routes/invite/[token]/+page.server.ts', import.meta.url), 'utf8');
		assert.match(server, /\/v1\/invites\/lookup/);
		assert.equal(server.includes("apiFetch(event, '/v1/invites/accept'"), true);
		const loadSource = server.slice(0, server.indexOf('export const actions'));
		assert.equal(loadSource.includes('/v1/invites/accept'), false);
	});

	test('accept posts the path token and redirects to the project id from the API', async () => {
		const hostile = 'b'.repeat(43);
		const calls = installFetch((call) => {
			assert.equal(call.method, 'POST');
			assert.equal(call.url.pathname, '/v1/invites/accept');
			assert.equal(call.body, JSON.stringify({ token: INVITE }));
			assert.equal(call.body?.includes(hostile), false);
			return envelope({ project_id: OTHER_PROJECT, role: 'owner' });
		});
		const built = fakeEvent({
			url: `http://console.example/invite/${INVITE}`,
			session: TOKEN,
			user: USER,
			params: { token: INVITE },
			form: { token: hostile }
		});
		const headers = captureHeaders(built.event);
		await assert.rejects(
			async () => {
				await inviteActions.accept(built.event as never);
			},
			(err: unknown) => isRedirect(err) && err.status === 303 && err.location === `/projects/${OTHER_PROJECT}`
		);
		assert.equal(calls.length, 1);
		assertInviteHeaders(headers);
		assert.equal(built.sets.length, 0);

		installFetch(() => envelope({ project_id: 'not-a-uuid', role: 'viewer' }));
		const malformed = await inviteActions.accept(
			fakeEvent({
				url: `http://console.example/invite/${INVITE}`,
				session: TOKEN,
				user: USER,
				params: { token: INVITE },
				form: {}
			}).event as never
		);
		assert.equal(isActionFailure(malformed), true);
		if (!isActionFailure(malformed)) return;
		assert.equal(malformed.status, 502);
		assert.equal(JSON.stringify(malformed.data).includes('not-a-uuid'), false);

		const skipped = installFetch(() => {
			throw new Error('api called');
		});
		const shaped = await inviteLoad(
			fakeEvent({
				url: 'http://console.example/invite/short',
				session: TOKEN,
				user: USER,
				params: { token: 'short' }
			}).event as never
		);
		assert.equal(pageData(shaped).view, 'invalid');
		assert.equal(skipped.length, 0);
	});
});
