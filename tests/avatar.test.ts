import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { avatarInitial, avatarSrc } from '../src/lib/avatar.ts';
import { load as layoutLoad } from '../src/routes/+layout.server.ts';
import { fakeEvent, USER } from './harness.ts';

const AVATAR = 'https://lh3.googleusercontent.com/a/example=s96-c';

test('avatarSrc keeps https URLs only', () => {
	assert.equal(avatarSrc(AVATAR), AVATAR);
	assert.equal(avatarSrc('http://example.com/a.png'), null);
	assert.equal(avatarSrc('javascript:alert(1)'), null);
	assert.equal(avatarSrc('data:image/png;base64,AAAA'), null);
	assert.equal(avatarSrc('not a url'), null);
	assert.equal(avatarSrc(''), null);
	assert.equal(avatarSrc(null), null);
});

test('avatarInitial is the upper-cased first letter, or ? without a name', () => {
	assert.equal(avatarInitial('joe'), 'J');
	assert.equal(avatarInitial('  Ada '), 'A');
	assert.equal(avatarInitial(''), '?');
	assert.equal(avatarInitial(null), '?');
});

test('the layout load passes the avatar URL only when it is https', async () => {
	const withAvatar = { ...USER, avatar_url: AVATAR };
	const shown = (await layoutLoad(fakeEvent({ url: 'http://console.example/projects', user: withAvatar }).event as never)) as {
		user: { avatarUrl: string | null } | null;
	};
	assert.equal(shown.user?.avatarUrl, AVATAR);

	const plain = (await layoutLoad(
		fakeEvent({ url: 'http://console.example/projects', user: { ...USER, avatar_url: 'http://example.com/a.png' } }).event as never
	)) as { user: { avatarUrl: string | null } | null };
	assert.equal(plain.user?.avatarUrl, null);

	const signedOut = (await layoutLoad(fakeEvent({ url: 'http://console.example/signin', user: null }).event as never)) as {
		user: unknown;
	};
	assert.equal(signedOut.user, null);
});

test('the header shows the avatar left of the name, with an initial fallback', () => {
	const layout = readFileSync(new URL('../src/routes/+layout.svelte', import.meta.url), 'utf8');
	const trigger = layout.match(/<DropdownMenu\.Trigger[\s\S]*?<\/DropdownMenu\.Trigger>/)?.[0] ?? '';
	const img = trigger.indexOf('<img');
	const initial = trigger.indexOf('avatarInitial(data.user.name)');
	const name = trigger.indexOf("{data.user.name || 'Account'}");
	assert.ok(img >= 0 && initial >= 0 && name >= 0);
	assert.ok(img < name && initial < name, 'avatar comes before the name');
	assert.match(trigger, /src=\{data\.user\.avatarUrl\}\s+alt=""/);
	assert.match(trigger, /referrerpolicy="no-referrer"/);
	assert.match(trigger, /onerror=\{\(\) => \(avatarFailed = true\)\}/);
	assert.match(trigger, /aria-hidden="true"/);
});
