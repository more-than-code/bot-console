import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { isActionFailure } from '@sveltejs/kit';
import { render } from 'svelte/server';
import {
	PIN_FAILED,
	TAG_MESSAGES,
	filterTags,
	imageDescribedBy,
	imageRepository,
	isTaggedRef,
	moreLabel,
	pinnedLine,
	pinnedRef,
	shortDigest,
	tagLookupError,
	tagAnnouncement,
	tagLookupMessage,
	tagQuery,
	taggedRef
} from '../src/lib/image-tags.ts';
import { comboboxKeyAction } from '../src/lib/components/ui/combobox/keys.ts';
import { ImageTagLookup } from '../src/lib/image-tag-lookup.ts';
import { parseImageDigest, parseImageTags } from '../src/lib/server/shape.ts';
import CatalogImageForm from '../src/routes/projects/[id]/CatalogImageForm.svelte';
import ImageTagNotes from '../src/routes/projects/[id]/ImageTagNotes.svelte';
import { actions as projectActions } from '../src/routes/projects/[id]/+page.server.ts';
import { envelope, fakeEvent, installFetch, PROJECT, restoreEnv, TOKEN, useApi, USER } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

const DIGEST = `sha256:${'c143be'.repeat(10)}abcd`;
const REPO = 'ghcr.io/joe-and-his-friends/mo-services';

type TagsData = { catalogImageTags?: { state: string; tags: string[]; truncated: boolean } };
type DigestData = { catalogImageDigest?: { state: string; digest: string | null } };

function dataOf<T>(result: unknown): T {
	if (isActionFailure(result)) return result.data as T;
	return result as T;
}

function event(action: 'catalogImageTags' | 'catalogImageDigest', image: string) {
	return fakeEvent({
		url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/${action}`,
		session: TOKEN,
		user: USER,
		projects: [PROJECT],
		params: { id: PROJECT.id },
		form: { image }
	}).event as never;
}

describe('image tag helpers', () => {
	test('imageRepository strips the tag and digest and keeps a registry port', () => {
		assert.equal(imageRepository(`${REPO}:v1.4.2`), REPO);
		assert.equal(imageRepository(`${REPO}@${DIGEST}`), REPO);
		assert.equal(imageRepository(`${REPO}:v1.4.2@${DIGEST}`), REPO);
		assert.equal(imageRepository('localhost:5000/team/app:1.0'), 'localhost:5000/team/app');
		assert.equal(imageRepository('registry.lan:5000/app'), 'registry.lan:5000/app');
		assert.equal(imageRepository('nginx'), 'nginx');
		assert.equal(imageRepository('  nginx:1.27  '), 'nginx');
		assert.equal(imageRepository(''), null);
		assert.equal(imageRepository('Not/Lower'), null);
		assert.equal(imageRepository('localhost:5000'), null);
		assert.equal(imageRepository('two words'), null);
	});

	test('tagQuery is the text after the tag colon, without a digest', () => {
		assert.equal(tagQuery(`${REPO}:v1.4`), 'v1.4');
		assert.equal(tagQuery(`${REPO}:v1.4.2@${DIGEST}`), 'v1.4.2');
		assert.equal(tagQuery(REPO), '');
		assert.equal(tagQuery('localhost:5000/app'), '');
		assert.equal(tagQuery(`${REPO}:`), '');
	});

	test('isTaggedRef accepts only repo:tag with no digest', () => {
		assert.equal(isTaggedRef(`${REPO}:v1.4.2`), true);
		assert.equal(isTaggedRef('localhost:5000/app:1'), true);
		assert.equal(isTaggedRef(REPO), false);
		assert.equal(isTaggedRef(`${REPO}:v1.4.2@${DIGEST}`), false);
		assert.equal(isTaggedRef(`${REPO}:-bad`), false);
		assert.equal(isTaggedRef(` ${REPO}:v1`), false);
	});

	test('filterTags filters on the query, caps at 50 and counts the rest', () => {
		const tags = Array.from({ length: 120 }, (_, index) => `v1.${index}`);
		const all = filterTags(tags, '');
		assert.equal(all.shown.length, 50);
		assert.equal(all.more, 70);
		assert.equal(moreLabel(all.more), '70 more, type to filter');
		const some = filterTags(tags, 'V1.11');
		assert.deepEqual(some.shown, ['v1.11', 'v1.110', 'v1.111', 'v1.112', 'v1.113', 'v1.114', 'v1.115', 'v1.116', 'v1.117', 'v1.118', 'v1.119']);
		assert.equal(some.more, 0);
		assert.deepEqual(filterTags(['latest', 'v2'], 'zzz'), { shown: [], more: 0 });
		assert.deepEqual(filterTags(['a', 'b', 'c'], '', 2), { shown: ['a', 'b'], more: 1 });
	});

	test('taggedRef drops the digest and pinnedRef adds it back', () => {
		assert.equal(taggedRef(REPO, 'v1.4.2'), `${REPO}:v1.4.2`);
		assert.equal(pinnedRef(`${REPO}:v1.4.2`, DIGEST), `${REPO}:v1.4.2@${DIGEST}`);
		assert.equal(shortDigest(DIGEST), 'sha256:c143bec143be…');
		assert.equal(pinnedLine(DIGEST), 'Pinned to sha256:c143bec143be…');
	});

	test('tagLookupError maps codes and reasons to message keys', () => {
		assert.equal(tagLookupError(404, 'not_found', 'not found', null), 'unsupported');
		assert.equal(tagLookupError(404, 'error', 'The API returned an unexpected response.', null), 'unsupported');
		assert.equal(tagLookupError(400, 'bad_request', 'registry not allowed', null), 'not_allowed');
		assert.equal(tagLookupError(400, 'bad_request', 'invalid image', null), 'failed');
		assert.equal(tagLookupError(502, 'registry_unavailable', '', 'auth_failed'), 'auth_failed');
		assert.equal(tagLookupError(502, 'registry_unavailable', '', 'not_found'), 'not_found');
		assert.equal(tagLookupError(502, 'registry_unavailable', '', 'unreachable'), 'unreachable');
		assert.equal(tagLookupError(502, 'registry_unavailable', '', 'timeout'), 'failed');
		assert.equal(tagLookupError(502, 'registry_unavailable', '', 'bad_response'), 'failed');
		assert.equal(tagLookupError(502, 'registry_unavailable', '', undefined), 'failed');
		assert.equal(tagLookupError(429, 'rate_limited', 'slow down', null), 'failed');
		assert.equal(tagLookupError(503, 'unavailable', 'The API is unavailable.', null), 'failed');
	});

	test('tagLookupMessage gives the spec lines and nothing for an older API', () => {
		assert.equal(tagLookupMessage({ state: 'not_allowed' }), "Tags are only listed for known registries and this project's registries.");
		assert.equal(tagLookupMessage({ state: 'auth_failed' }), 'The registry refused the stored credentials.');
		assert.equal(tagLookupMessage({ state: 'not_found' }), 'Image not found in the registry, or it is private.');
		assert.equal(tagLookupMessage({ state: 'unreachable' }), 'Could not reach the registry.');
		assert.equal(tagLookupMessage({ state: 'failed' }), 'Could not load tags.');
		assert.equal(tagLookupMessage({ state: 'unsupported' }), null);
		assert.equal(tagLookupMessage({ state: 'loading' }), null);
		assert.equal(tagLookupMessage({ state: 'ready', tags: [], truncated: false }), null);
		assert.equal(tagLookupMessage(undefined), null);
	});
});

describe('image tag shapes', () => {
	test('parseImageTags keeps valid tags only', () => {
		const parsed = parseImageTags({
			items: [{ tag: 'v1.4.2' }, { tag: 'latest' }, { tag: '-bad' }, { tag: 'a'.repeat(129) }, { tag: 'has space' }, { tag: 7 }, 'v1', null, { tag: 'v1.4.2' }, { tag: '_ok.1-x' }],
			truncated: false
		});
		assert.deepEqual(parsed, { tags: ['v1.4.2', 'latest', '_ok.1-x'], truncated: false });
		assert.equal(parseImageTags({ items: [], truncated: 'no' }), null);
		assert.equal(parseImageTags({ truncated: false }), null);
		assert.equal(parseImageTags(null), null);
		const many = parseImageTags({ items: Array.from({ length: 250 }, (_, index) => ({ tag: `t${index}` })), truncated: false });
		assert.equal(many?.tags.length, 200);
		assert.equal(many?.truncated, true);
	});

	test('parseImageDigest needs sha256 and 64 lowercase hex', () => {
		assert.equal(parseImageDigest({ digest: DIGEST }), DIGEST);
		assert.equal(parseImageDigest({ digest: DIGEST.toUpperCase() }), null);
		assert.equal(parseImageDigest({ digest: `sha512:${'a'.repeat(64)}` }), null);
		assert.equal(parseImageDigest({ digest: `sha256:${'a'.repeat(63)}` }), null);
		assert.equal(parseImageDigest({ digest: `${DIGEST} ` }), null);
		assert.equal(parseImageDigest({}), null);
		assert.equal(parseImageDigest('x'), null);
	});
});

describe('image tag actions', () => {
	const originalFetch = globalThis.fetch;

	before(() => {
		useApi('https://api.test');
	});

	after(() => {
		globalThis.fetch = originalFetch;
		restoreEnv();
	});

	test('catalogImageTags calls image-tags with the repository encoded', async () => {
		const calls = installFetch(() => envelope({ items: [{ tag: 'v1.4.2' }, { tag: 'bad tag' }, { tag: 'latest' }], truncated: true }));
		const result = dataOf<TagsData>(await projectActions.catalogImageTags(event('catalogImageTags', REPO)));
		assert.equal(calls.length, 1);
		assert.equal(calls[0]?.method, 'GET');
		assert.equal(calls[0]?.url.pathname, `/v1/projects/${PROJECT.id}/image-tags`);
		assert.equal(calls[0]?.url.search, `?image=${encodeURIComponent(REPO)}`);
		assert.equal(calls[0]?.url.searchParams.get('image'), REPO);
		assert.deepEqual(result.catalogImageTags, { state: 'ready', tags: ['v1.4.2', 'latest'], truncated: true });
	});

	test('catalogImageTags refuses a value that is not a bare repository without calling the API', async () => {
		const calls = installFetch(() => envelope({ items: [], truncated: false }));
		for (const image of [`${REPO}:v1`, `${REPO}@${DIGEST}`, '', 'Bad/Repo']) {
			const result = await projectActions.catalogImageTags(event('catalogImageTags', image));
			assert.equal(isActionFailure(result), true, image);
			assert.equal(dataOf<TagsData>(result).catalogImageTags?.state, 'failed', image);
		}
		assert.equal(calls.length, 0);
	});

	test('catalogImageTags maps each error to a message key', async () => {
		const cases: Array<{ response: () => Response; state: string }> = [
			{ response: () => envelope(null, 400, 'bad_request', 'registry not allowed'), state: 'not_allowed' },
			{ response: () => envelope(null, 400, 'bad_request', 'invalid image'), state: 'failed' },
			{ response: () => envelope({ reason: 'auth_failed' }, 502, 'registry_unavailable', 'registry unavailable'), state: 'auth_failed' },
			{ response: () => envelope({ reason: 'not_found' }, 502, 'registry_unavailable', 'registry unavailable'), state: 'not_found' },
			{ response: () => envelope({ reason: 'unreachable' }, 502, 'registry_unavailable', 'registry unavailable'), state: 'unreachable' },
			{ response: () => envelope({ reason: 'timeout' }, 502, 'registry_unavailable', 'registry unavailable'), state: 'failed' },
			{ response: () => envelope({ reason: 'bad_response' }, 502, 'registry_unavailable', 'registry unavailable'), state: 'failed' },
			{ response: () => envelope(null, 429, 'rate_limited', 'too many lookups'), state: 'failed' },
			{ response: () => envelope(null, 404, 'not_found', 'not found'), state: 'unsupported' },
			{ response: () => new Response('404 page not found', { status: 404 }), state: 'unsupported' },
			{ response: () => envelope({ items: 'nope', truncated: false }), state: 'failed' }
		];
		for (const item of cases) {
			installFetch(item.response);
			const result = await projectActions.catalogImageTags(event('catalogImageTags', REPO));
			assert.equal(isActionFailure(result), true, item.state);
			const data = dataOf<TagsData>(result);
			assert.deepEqual(data.catalogImageTags, { state: item.state, tags: [], truncated: false }, item.state);
			assert.equal(JSON.stringify(data).includes('registry unavailable'), false);
		}
	});

	test('catalogImageDigest calls image-digest with repo:tag encoded and returns the digest', async () => {
		const calls = installFetch(() => envelope({ digest: DIGEST }));
		const image = `${REPO}:v1.4.2`;
		const result = dataOf<DigestData>(await projectActions.catalogImageDigest(event('catalogImageDigest', image)));
		assert.equal(calls[0]?.url.pathname, `/v1/projects/${PROJECT.id}/image-digest`);
		assert.equal(calls[0]?.url.search, `?image=${encodeURIComponent(image)}`);
		assert.deepEqual(result.catalogImageDigest, { state: 'ready', digest: DIGEST });
	});

	test('catalogImageDigest drops a malformed digest and maps errors', async () => {
		const image = `${REPO}:v1.4.2`;
		installFetch(() => envelope({ digest: 'sha256:XYZ' }));
		const bad = await projectActions.catalogImageDigest(event('catalogImageDigest', image));
		assert.equal(isActionFailure(bad), true);
		assert.deepEqual(dataOf<DigestData>(bad).catalogImageDigest, { state: 'failed', digest: null });
		installFetch(() => envelope({ reason: 'not_found' }, 502, 'registry_unavailable', 'registry unavailable'));
		assert.equal(dataOf<DigestData>(await projectActions.catalogImageDigest(event('catalogImageDigest', image))).catalogImageDigest?.state, 'not_found');
		installFetch(() => new Response('404 page not found', { status: 404 }));
		assert.equal(dataOf<DigestData>(await projectActions.catalogImageDigest(event('catalogImageDigest', image))).catalogImageDigest?.state, 'unsupported');
		const calls = installFetch(() => envelope({ digest: DIGEST }));
		for (const value of [REPO, `${image}@${DIGEST}`]) {
			const refused = await projectActions.catalogImageDigest(event('catalogImageDigest', value));
			assert.deepEqual(dataOf<DigestData>(refused).catalogImageDigest, { state: 'failed', digest: null }, value);
		}
		assert.equal(calls.length, 0);
	});
});

describe('image tag rendering', () => {
	test('the Image field is a combobox that keeps its form attributes', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const html = render(CatalogImageForm, {
			props: {
				mode: 'create',
				saveAction: '?/catalogCreate',
				tagsAction: '?/catalogImageTags',
				digestAction: '?/catalogImageDigest',
				sets: [],
				setsStatus: 'ready',
				editor: null
			}
		}).body;
		const tag = [...html.matchAll(/<input\b[^>]*>/g)].map((match) => match[0]).find((item) => item.includes('id="catalog-image-new-image"')) ?? '';
		assert.match(tag, /role="combobox"/);
		assert.match(tag, /aria-expanded="false"/);
		assert.match(tag, /aria-controls="[^"]+-list"/);
		assert.match(tag, /name="image"/);
		assert.match(tag, /maxlength="255"/);
		assert.match(tag, /required/);
		assert.match(tag, /aria-invalid="false"/);
		// One input named image: bits-ui's hidden selection input is not rendered.
		assert.equal([...html.matchAll(/name="image"/g)].length, 1);
		assert.match(html, /action="\?\/catalogImageTags"/);
		assert.match(html, /action="\?\/catalogImageDigest"/);
		// The polite live region is always mounted, even before any lookup.
		assert.match(html, /<div class="sr-only" role="status" aria-live="polite">/);
	});

	test('without the tag actions the field still saves as a plain value', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const html = render(CatalogImageForm, {
			props: { mode: 'create', saveAction: '?/catalogCreate', sets: [], setsStatus: 'ready', editor: null }
		}).body;
		assert.equal(html.includes('catalogImageTags'), false);
		assert.match(html, /name="image"/);
	});

	test('the error and pin lines render with the ids aria-describedby names', () => {
		const settingsHref = `/projects/${PROJECT.id}?tab=settings#registries`;
		const html = render(ImageTagNotes, {
			props: { fieldId: 'catalog-image-web', message: TAG_MESSAGES.auth_failed, authFailed: true, settingsHref, pinLine: pinnedLine(DIGEST) }
		}).body;
		const describedBy = imageDescribedBy('catalog-image-web', { error: false, tags: true, pin: true });
		assert.equal(describedBy, 'catalog-image-web-image-tags catalog-image-web-image-pin');
		for (const id of describedBy?.split(' ') ?? []) assert.match(html, new RegExp(`id="${id}"`));
		assert.match(html, /The registry refused the stored credentials\./);
		assert.match(html, new RegExp(`href="${settingsHref.replace(/[?]/g, '\\?')}" rel="noopener noreferrer" target="_blank"`));
		assert.match(html, /Settings → Registries<span class="sr-only">\s*\(opens in a new tab\)<\/span>/);
		assert.match(html, /Pinned to sha256:c143bec143be…/);
		const failed = render(ImageTagNotes, { props: { fieldId: 'f', settingsHref, pinLine: PIN_FAILED } }).body;
		assert.match(failed, /Could not pin a digest; the tag will be used\./);
		assert.equal(failed.includes('Settings → Registries'), false);
		assert.equal(render(ImageTagNotes, { props: { fieldId: 'f', settingsHref } }).body.includes('<p'), false);
		assert.equal(imageDescribedBy('f', { error: true, tags: false, pin: false }), 'f-error');
		assert.equal(imageDescribedBy('f', { error: false, tags: false, pin: false }), undefined);
	});
});

type Harness = {
	lookup: ImageTagLookup;
	tags: string[];
	digests: string[];
	advance: (ms: number) => void;
	changes: () => number;
};

/** The lookup with a fake clock: `advance` runs timers whose time has come. */
function harness(): Harness {
	let now = 0;
	let changes = 0;
	let nextId = 1;
	const timers = new Map<number, { at: number; run: () => void }>();
	const tags: string[] = [];
	const digests: string[] = [];
	const lookup = new ImageTagLookup({
		schedule: (run, ms) => {
			const id = nextId++;
			timers.set(id, { at: now + ms, run });
			return id;
		},
		cancel: (handle) => {
			timers.delete(handle as number);
		},
		requestTags: (repo) => tags.push(repo),
		requestDigest: (ref) => digests.push(ref),
		onChange: () => {
			changes += 1;
		}
	});
	return {
		lookup,
		tags,
		digests,
		advance(ms) {
			now += ms;
			for (const [id, timer] of [...timers]) {
				if (timer.at > now) continue;
				timers.delete(id);
				timer.run();
			}
		},
		changes: () => changes
	};
}

const READY = { state: 'ready' as const, tags: ['v1.4.2', 'v1.4.1'], truncated: false };

describe('ImageTagLookup', () => {
	test('debounce: nothing before 400 ms, one request after, and a repository change resets it', () => {
		const h = harness();
		h.lookup.update('ngin', true);
		h.advance(300);
		h.lookup.update('nginx', true);
		h.advance(300);
		assert.deepEqual(h.tags, []);
		h.advance(100);
		assert.deepEqual(h.tags, ['nginx']);
		assert.equal(h.lookup.lookup('nginx')?.state, 'loading');
	});

	test('fetches only when the repository changes, not when the tag does', () => {
		const h = harness();
		h.lookup.update(REPO, true);
		h.advance(400);
		h.lookup.update(`${REPO}:v1`, true);
		h.lookup.update(`${REPO}:v1.4@${DIGEST}`, true);
		h.advance(1000);
		assert.deepEqual(h.tags, [REPO]);
	});

	test('nothing is requested without focus or for an invalid reference', () => {
		const h = harness();
		h.lookup.update(REPO, false);
		h.lookup.update('Not A Ref', true);
		h.advance(1000);
		assert.deepEqual(h.tags, []);
		h.lookup.update(REPO, true);
		h.lookup.update(REPO, false);
		h.advance(1000);
		assert.deepEqual(h.tags, []);
	});

	test('a cached answer is not requested again on refocus or on a change back', () => {
		const h = harness();
		h.lookup.update('nginx', true);
		h.advance(400);
		h.lookup.takeTags('nginx', READY);
		h.lookup.update('redis', true);
		h.advance(400);
		h.lookup.takeTags('redis', READY);
		h.lookup.update('nginx', true);
		h.advance(400);
		h.lookup.update('nginx', false);
		h.lookup.update('nginx', true);
		h.advance(400);
		assert.deepEqual(h.tags, ['nginx', 'redis']);
		assert.deepEqual(h.lookup.lookup('nginx:1'), READY);
	});

	test('retryable errors stay visible and are retried on refocus; permanent ones are not', () => {
		for (const state of ['failed', 'unreachable'] as const) {
			const h = harness();
			h.lookup.update('nginx', true);
			h.advance(400);
			h.lookup.takeTags('nginx', { state, tags: [], truncated: false });
			assert.equal(h.lookup.lookup('nginx')?.state, state);
			h.lookup.update('nginx:1', true);
			h.advance(400);
			assert.equal(h.tags.length, 1, `${state}: no retry while the repository is unchanged`);
			h.lookup.update('nginx:1', false);
			assert.equal(h.lookup.lookup('nginx')?.state, state, `${state}: message kept until the retry starts`);
			h.lookup.update('nginx:1', true);
			h.advance(400);
			assert.equal(h.tags.length, 2, `${state}: retried on refocus`);
			assert.equal(h.lookup.lookup('nginx')?.state, 'loading');
		}
		for (const state of ['not_allowed', 'auth_failed', 'not_found'] as const) {
			const h = harness();
			h.lookup.update('nginx', true);
			h.advance(400);
			h.lookup.takeTags('nginx', { state, tags: [], truncated: false });
			h.lookup.update('nginx', false);
			h.lookup.update('nginx', true);
			h.advance(400);
			h.lookup.update('redis', true);
			h.advance(400);
			h.lookup.update('nginx', true);
			h.advance(400);
			assert.deepEqual(h.tags, ['nginx', 'redis'], state);
			assert.equal(h.lookup.lookup('nginx')?.state, state);
		}
	});

	test('a retryable error is retried on a change back to that repository', () => {
		const h = harness();
		h.lookup.update('nginx', true);
		h.advance(400);
		h.lookup.takeTags('nginx', null);
		assert.equal(h.lookup.lookup('nginx')?.state, 'failed');
		h.lookup.update('redis', true);
		h.advance(400);
		h.lookup.update('nginx', true);
		h.advance(400);
		assert.deepEqual(h.tags, ['nginx', 'redis', 'nginx']);
	});

	test('a 404 (unsupported) stops all further requests and shows nothing', () => {
		const h = harness();
		h.lookup.update('nginx', true);
		h.advance(400);
		h.lookup.takeTags('nginx', { state: 'unsupported', tags: [], truncated: false });
		assert.equal(h.lookup.lookup('nginx'), undefined);
		h.lookup.update('redis', true);
		h.lookup.update('redis', false);
		h.lookup.update('postgres', true);
		h.advance(2000);
		assert.deepEqual(h.tags, ['nginx']);
		assert.equal(h.lookup.pick('nginx', 'v1'), 'nginx:v1');
		assert.deepEqual(h.digests, []);
	});

	test('pick, then digest, then pin', () => {
		const h = harness();
		const picked = h.lookup.pick(`${REPO}:old@${DIGEST}`, 'v1.4.2');
		assert.equal(picked, `${REPO}:v1.4.2`);
		assert.deepEqual(h.digests, [`${REPO}:v1.4.2`]);
		const pinned = h.lookup.takeDigest(`${REPO}:v1.4.2`, `${REPO}:v1.4.2`, { state: 'ready', digest: DIGEST });
		assert.equal(pinned, `${REPO}:v1.4.2@${DIGEST}`);
		assert.equal(h.lookup.pinLine(pinned ?? ''), 'Pinned to sha256:c143bec143be…');
		// Deleting the digest follows the tag again: the line goes away.
		assert.equal(h.lookup.pinLine(`${REPO}:v1.4.2`), null);
		assert.equal(tagAnnouncement(undefined, h.lookup.pinLine(pinned ?? '')), 'Pinned to sha256:c143bec143be…');
	});

	test('a stale digest is ignored when the field changed', () => {
		const h = harness();
		const picked = h.lookup.pick(REPO, 'v1.4.2') ?? '';
		const before = h.changes();
		assert.equal(h.lookup.takeDigest(`${picked}x`, picked, { state: 'ready', digest: DIGEST }), null);
		assert.equal(h.lookup.takeDigest(`${picked}x`, picked, { state: 'failed', digest: null }), null);
		assert.equal(h.lookup.pinLine(picked), null);
		assert.equal(h.lookup.pinLine(`${picked}x`), null);
		assert.equal(h.changes(), before);
	});

	test('a failed or malformed digest keeps the tag and shows the pin failure line', () => {
		for (const result of [{ state: 'failed' as const, digest: null }, { state: 'ready' as const, digest: 'sha256:XYZ' }, null]) {
			const h = harness();
			const picked = h.lookup.pick(REPO, 'v1.4.0') ?? '';
			assert.equal(h.lookup.takeDigest(picked, picked, result), null);
			assert.equal(h.lookup.pinLine(picked), PIN_FAILED);
		}
		const h = harness();
		const picked = h.lookup.pick(REPO, 'v1') ?? '';
		assert.equal(h.lookup.takeDigest(picked, picked, { state: 'unsupported', digest: null }), null);
		assert.equal(h.lookup.pinLine(picked), null);
	});

	test('a pinned reference over 255 bytes is not written', () => {
		const h = harness();
		const longRepo = `ghcr.io/${'a'.repeat(200)}/app`;
		const picked = h.lookup.pick(longRepo, 'v1') ?? '';
		assert.ok(picked.length + 1 + DIGEST.length > 255);
		assert.equal(h.lookup.takeDigest(picked, picked, { state: 'ready', digest: DIGEST }), null);
		assert.equal(h.lookup.pinLine(picked), PIN_FAILED);
	});

	test('a pinned reference of exactly 255 bytes is written; 256 is not', () => {
		const suffix = `:v1@${DIGEST}`.length;
		for (const [size, pinned] of [
			[255, true],
			[256, false]
		] as const) {
			const h = harness();
			const repo = `ghcr.io/${'a'.repeat(size - suffix - 'ghcr.io/'.length)}`;
			const picked = h.lookup.pick(repo, 'v1') ?? '';
			assert.equal(`${picked}@${DIGEST}`.length, size);
			const value = h.lookup.takeDigest(picked, picked, { state: 'ready', digest: DIGEST });
			assert.equal(value != null, pinned, String(size));
			assert.equal(h.lookup.pinLine(value ?? picked), pinned ? pinnedLine(DIGEST) : PIN_FAILED);
		}
	});

	test('dispose cancels a pending debounce, so nothing is requested', () => {
		const h = harness();
		h.lookup.update('nginx', true);
		h.advance(200);
		h.lookup.dispose();
		h.advance(1000);
		assert.deepEqual(h.tags, []);
	});

	test('a repository still loading is not requested again on refocus', () => {
		const h = harness();
		h.lookup.update('nginx', true);
		h.advance(400);
		h.lookup.update('nginx', false);
		h.lookup.update('nginx', true);
		h.advance(400);
		assert.deepEqual(h.tags, ['nginx']);
		assert.equal(h.lookup.lookup('nginx')?.state, 'loading');
	});

	test('a typed tag never requests a digest', () => {
		const h = harness();
		h.lookup.update(`${REPO}:v1.4.2`, true);
		h.advance(400);
		h.lookup.takeTags(REPO, READY);
		h.lookup.update(`${REPO}:v1.4.1`, true);
		h.advance(400);
		assert.deepEqual(h.digests, []);
	});

	test('tagAnnouncement says loading, the count, the error, or the pin line', () => {
		assert.equal(tagAnnouncement({ state: 'loading' }, null), 'Loading tags…');
		assert.equal(tagAnnouncement({ state: 'ready', tags: ['a', 'b'], truncated: false }, null), '2 tags');
		assert.equal(tagAnnouncement({ state: 'ready', tags: ['a'], truncated: false }, null), '1 tag');
		assert.equal(tagAnnouncement({ state: 'not_found' }, null), TAG_MESSAGES.not_found);
		assert.equal(tagAnnouncement({ state: 'unsupported' }, null), '');
		assert.equal(tagAnnouncement(undefined, PIN_FAILED), PIN_FAILED);
		const many = { state: 'ready' as const, tags: Array.from({ length: 83 }, (_, index) => `t${index}`), truncated: false };
		assert.equal(tagAnnouncement(many, null), '83 tags');
		assert.equal(tagAnnouncement(many, null, 50), '83 tags, 50 shown; type to filter');
		assert.equal(tagAnnouncement({ state: 'ready', tags: ['a', 'b'], truncated: false }, null, 2), '2 tags');
	});
});

describe('comboboxKeyAction', () => {
	const fresh = { open: true, navigated: false, hasHighlight: true };
	const moved = { open: true, navigated: true, hasHighlight: true };

	test('Home and End move the caret, open or closed, before or after navigating', () => {
		for (const key of ['Home', 'End']) {
			for (const state of [fresh, moved, { open: false, navigated: false, hasHighlight: false }]) {
				assert.equal(comboboxKeyAction(key, state), 'caret', `${key} ${JSON.stringify(state)}`);
			}
		}
	});

	test('the first ArrowDown reveals the first option and the first ArrowUp sends End', () => {
		assert.equal(comboboxKeyAction('ArrowDown', fresh), 'reveal');
		assert.equal(comboboxKeyAction('ArrowUp', fresh), 'end');
		// With no highlight yet (options arrived after opening), bits-ui moves from nothing.
		assert.equal(comboboxKeyAction('ArrowUp', { ...fresh, hasHighlight: false }), 'navigate');
		assert.equal(comboboxKeyAction('ArrowDown', moved), 'navigate');
		assert.equal(comboboxKeyAction('ArrowUp', moved), 'navigate');
	});

	test('Enter submits the typed text until the user navigates, then picks', () => {
		assert.equal(comboboxKeyAction('Enter', fresh), 'submit');
		assert.equal(comboboxKeyAction('Enter', moved), 'pass');
		// Closed list: bits-ui ignores Enter and the form submits.
		assert.equal(comboboxKeyAction('Enter', { open: false, navigated: false, hasHighlight: false }), 'pass');
	});

	test('Escape and typing go to bits-ui; arrow and Page keys mark navigation', () => {
		assert.equal(comboboxKeyAction('Escape', fresh), 'pass');
		assert.equal(comboboxKeyAction('a', fresh), 'pass');
		for (const key of ['PageDown', 'PageUp']) assert.equal(comboboxKeyAction(key, fresh), 'navigate');
		for (const key of ['ArrowDown', 'ArrowUp']) assert.equal(comboboxKeyAction(key, { open: false, navigated: false, hasHighlight: false }), 'navigate');
	});
});
