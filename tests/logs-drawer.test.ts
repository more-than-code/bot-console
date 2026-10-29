import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test, type TestContext } from 'node:test';
import type { ActionResult } from '@sveltejs/kit';
import { render } from 'svelte/server';
import { stripAnsi } from '../src/lib/ansi.ts';
import { formatTime } from '../src/lib/format.ts';
import { LOGS_FAILED, LOGS_LOADING, atBottom, logsAnnouncement, logsInfoLine, logsOutcome, sameOriginPath, scrollAfterUpdate } from '../src/lib/log-view.ts';
import { LogsLoader, canCopy, emptyLogsView, logsText, type LogsView } from '../src/lib/logs-load.ts';
import { LIVE_DELAY_MS, LIVE_MAX_MS, LIVE_NOTE, LIVE_TIMEOUT_NOTE, createLogsPoller, type LiveEnd } from '../src/lib/logs-poll.ts';
import type { CatalogRunState } from '../src/lib/project-action.ts';
import type { ServiceControls } from '../src/lib/service-actions.ts';
import { parseImageLogs, parseProcessSample, parseProgramLogs } from '../src/lib/server/shape.ts';
import type { VisibilityDoc } from '../src/lib/visibility.ts';
import { actions as projectActions } from '../src/routes/projects/[id]/+page.server.ts';
import ServiceRowActions from '../src/routes/projects/[id]/ServiceRowActions.svelte';
import { envelope, fakeEvent, installFetch, PROJECT, restoreEnv, TOKEN, useApi, USER } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

const HOST_ID = '00000000-0000-4000-8000-000000000020';
const SERVICE_ID = '00000000-0000-4000-8000-000000000030';
const ORIGIN = 'http://console.example';
const ACTION = `?tab=services&/catalogLogs`;

function source(name: string): string {
	return readFileSync(new URL(`../src/routes/projects/[id]/${name}`, import.meta.url), 'utf8');
}

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

async function settle() {
	for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

/** A load whose answers the test releases one at a time. Records `manual` per call. */
function manualLoad() {
	const pending: Array<(ok: boolean) => void> = [];
	const manual: boolean[] = [];
	return {
		manual,
		calls: () => pending.length,
		load: (isManual: boolean) =>
			new Promise<boolean>((resolve) => {
				manual.push(isManual);
				pending.push(resolve);
			}),
		async answer(ok: boolean) {
			pending[pending.length - 1]?.(ok);
			await settle();
		}
	};
}

/** Mocked `setTimeout` plus a clock the poller reads, moved together. `jump` moves only the clock. */
function useClock(t: TestContext) {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	let ms = 0;
	return {
		now: () => ms,
		advance(by: number) {
			ms += by;
			t.mock.timers.tick(by);
		},
		jump(by: number) {
			ms += by;
		}
	};
}

function poller(t: TestContext, doc = new FakeDoc()) {
	const clock = useClock(t);
	const loads = manualLoad();
	const ends: LiveEnd[] = [];
	const polls = createLogsPoller({ load: loads.load, doc, onLiveEnd: (reason) => ends.push(reason), now: clock.now });
	return { clock, loads, ends, polls, doc };
}

describe('logs-poll', () => {
	test('Live asks again 3 s after each answer, never while one is in flight', async (t) => {
		const { clock, loads, polls } = poller(t);
		void polls.refresh();
		assert.equal(loads.calls(), 1);
		void polls.refresh();
		polls.setLive(true);
		assert.equal(loads.calls(), 1);
		// A slow answer: the clock runs, but nothing starts until it arrives.
		clock.advance(LIVE_DELAY_MS * 3);
		assert.equal(loads.calls(), 1);
		await loads.answer(true);
		clock.advance(LIVE_DELAY_MS - 1);
		assert.equal(loads.calls(), 1);
		clock.advance(1);
		assert.equal(loads.calls(), 2);
		await loads.answer(true);
		clock.advance(LIVE_DELAY_MS);
		assert.equal(loads.calls(), 3);
		assert.deepEqual(loads.manual, [true, false, false], 'Live polls are not manual');
		await loads.answer(true);
		polls.setLive(false);
		clock.advance(LIVE_DELAY_MS * 10);
		assert.equal(loads.calls(), 3, 'Live off stops requests');
		polls.dispose();
	});

	test('Live on fetches at once only when 3 s have passed since the last answer', async (t) => {
		const { clock, loads, polls } = poller(t);
		void polls.refresh();
		await loads.answer(true);
		clock.advance(LIVE_DELAY_MS * 10);
		assert.equal(loads.calls(), 1, 'no timer without Live');
		polls.setLive(true);
		assert.equal(loads.calls(), 2);
		await loads.answer(true);
		polls.setLive(false);
		clock.advance(1000);
		polls.setLive(true);
		assert.equal(loads.calls(), 2, 'the rest of the gap first');
		clock.advance(LIVE_DELAY_MS - 1001);
		assert.equal(loads.calls(), 2);
		clock.advance(1);
		assert.equal(loads.calls(), 3);
		polls.dispose();
	});

	test('a hidden tab pauses Live; visible resumes after the rest of the gap; in flight or Live off it does nothing', async (t) => {
		const { clock, loads, polls, doc } = poller(t);
		polls.setLive(true);
		assert.equal(loads.calls(), 1, 'the first Live fetch has no earlier answer to wait for');
		await loads.answer(true);
		doc.set('hidden');
		clock.advance(LIVE_DELAY_MS * 10);
		assert.equal(loads.calls(), 1);
		doc.set('visible');
		assert.equal(loads.calls(), 2, 'the gap has passed');
		// An answer that lands while hidden does not schedule the next one.
		doc.set('hidden');
		await loads.answer(true);
		clock.advance(1000);
		doc.set('visible');
		assert.equal(loads.calls(), 2, 'resume waits the rest of the gap');
		clock.advance(LIVE_DELAY_MS - 1000);
		assert.equal(loads.calls(), 3);
		doc.set('hidden');
		doc.set('visible');
		assert.equal(loads.calls(), 3, 'visible while in flight');
		await loads.answer(true);
		polls.setLive(false);
		clock.advance(LIVE_DELAY_MS * 10);
		doc.set('hidden');
		doc.set('visible');
		assert.equal(loads.calls(), 3, 'visible with Live off');
		polls.dispose();
	});

	test('three failures in a row turn Live off; one failure keeps it on', async (t) => {
		const { clock, loads, polls, ends } = poller(t);
		polls.setLive(true);
		await loads.answer(false);
		clock.advance(LIVE_DELAY_MS);
		await loads.answer(true);
		clock.advance(LIVE_DELAY_MS);
		await loads.answer(false);
		clock.advance(LIVE_DELAY_MS);
		await loads.answer(false);
		assert.deepEqual(ends, [], 'a success in between resets the count');
		clock.advance(LIVE_DELAY_MS);
		await loads.answer(false);
		assert.deepEqual(ends, ['failures']);
		clock.advance(LIVE_DELAY_MS * 10);
		assert.equal(loads.calls(), 5);
		polls.dispose();
	});

	test('failures while Live is off never end Live, and Live on starts a fresh count', async (t) => {
		const { clock, loads, polls, ends } = poller(t);
		for (let i = 0; i < 3; i += 1) {
			void polls.refresh();
			await loads.answer(false);
		}
		assert.deepEqual(ends, []);
		polls.setLive(true);
		clock.advance(LIVE_DELAY_MS);
		assert.equal(loads.calls(), 4);
		await loads.answer(false);
		assert.deepEqual(ends, []);
		polls.dispose();
	});

	test('Live on again resets its age and its failure count', async (t) => {
		const { clock, loads, polls, ends } = poller(t);
		polls.setLive(true);
		await loads.answer(false);
		clock.advance(LIVE_DELAY_MS);
		await loads.answer(false);
		polls.setLive(false);
		clock.advance(LIVE_MAX_MS - 1000);
		polls.setLive(true);
		assert.equal(loads.calls(), 3);
		await loads.answer(false);
		clock.advance(LIVE_DELAY_MS);
		await loads.answer(false);
		assert.deepEqual(ends, [], 'two failures after Live on again');
		clock.advance(LIVE_DELAY_MS);
		await loads.answer(true);
		assert.deepEqual(ends, [], 'age counts from the second Live on');
		polls.dispose();
	});

	test('Live turns off after 15 minutes: after an answer, in the timer, and on a visible tab', async (t) => {
		const { clock, loads, polls, ends } = poller(t);
		polls.setLive(true);
		await loads.answer(true);
		clock.jump(LIVE_MAX_MS - LIVE_DELAY_MS - 1);
		clock.advance(LIVE_DELAY_MS);
		assert.equal(loads.calls(), 2);
		clock.jump(1);
		await loads.answer(true);
		assert.deepEqual(ends, ['timeout'], 'after an answer');
		clock.advance(LIVE_DELAY_MS * 10);
		assert.equal(loads.calls(), 2);
		polls.dispose();

		const doc = new FakeDoc();
		const timerLoads = manualLoad();
		const timerEnds: LiveEnd[] = [];
		const inTimer = createLogsPoller({ load: timerLoads.load, doc, onLiveEnd: (reason) => timerEnds.push(reason), now: clock.now });
		inTimer.setLive(true);
		await timerLoads.answer(true);
		clock.jump(LIVE_MAX_MS);
		clock.advance(LIVE_DELAY_MS);
		assert.deepEqual(timerEnds, ['timeout'], 'in the timer');
		assert.equal(timerLoads.calls(), 1);
		inTimer.dispose();

		const resumeDoc = new FakeDoc();
		const resumeLoads = manualLoad();
		const resumeEnds: LiveEnd[] = [];
		const onResume = createLogsPoller({ load: resumeLoads.load, doc: resumeDoc, onLiveEnd: (reason) => resumeEnds.push(reason), now: clock.now });
		onResume.setLive(true);
		await resumeLoads.answer(true);
		resumeDoc.set('hidden');
		clock.jump(LIVE_MAX_MS);
		resumeDoc.set('visible');
		assert.deepEqual(resumeEnds, ['timeout'], 'on a visible tab');
		assert.equal(resumeLoads.calls(), 1);
		onResume.dispose();
	});

	test('on, off, on during a request leaves one schedule', async (t) => {
		const { clock, loads, polls } = poller(t);
		void polls.refresh();
		polls.setLive(true);
		polls.setLive(false);
		polls.setLive(true);
		assert.equal(loads.calls(), 1);
		await loads.answer(true);
		clock.advance(LIVE_DELAY_MS);
		assert.equal(loads.calls(), 2);
		await loads.answer(true);
		clock.advance(LIVE_DELAY_MS - 1);
		assert.equal(loads.calls(), 2);
		polls.dispose();
	});

	test('a manual refresh while a timer is pending cancels it and reschedules from its own answer', async (t) => {
		const { clock, loads, polls } = poller(t);
		polls.setLive(true);
		await loads.answer(true);
		clock.advance(2000);
		void polls.refresh();
		assert.equal(loads.calls(), 2);
		assert.deepEqual(loads.manual, [false, true]);
		await loads.answer(true);
		clock.advance(LIVE_DELAY_MS - 1);
		assert.equal(loads.calls(), 2, 'the old timer did not fire');
		clock.advance(1);
		assert.equal(loads.calls(), 3);
		polls.dispose();
	});

	test('dispose ignores a late answer, leaves no timer, and unhooks visibility', async (t) => {
		const { loads, polls, doc, ends } = poller(t);
		polls.setLive(true);
		polls.dispose();
		await loads.answer(true);
		t.mock.timers.runAll();
		doc.set('hidden');
		doc.set('visible');
		void polls.refresh();
		polls.setLive(true);
		assert.equal(loads.calls(), 1);
		assert.equal(doc.listeners.size, 0);
		assert.deepEqual(ends, []);

		const pending = manualLoad();
		const withTimer = createLogsPoller({ load: pending.load, doc: new FakeDoc(), onLiveEnd: () => {}, now: () => 0 });
		withTimer.setLive(true);
		await pending.answer(true);
		withTimer.dispose();
		t.mock.timers.runAll();
		assert.equal(pending.calls(), 1, 'the pending timer was cleared');
	});

	test('the notes are built from the timings', () => {
		assert.equal(LIVE_NOTE, 'Live, every 3 s');
		assert.equal(LIVE_TIMEOUT_NOTE, 'Live stopped after 15 minutes.');
	});
});

/** A `fetch` whose answers the test releases. `honourAbort` false lets an answer land after close. */
function fakeFetch(honourAbort = true) {
	const calls: Array<{ url: string; init: RequestInit; answer: (result: ActionResult) => void; fail: () => void }> = [];
	const fn = ((url: string, init: RequestInit) =>
		new Promise<Response>((resolve, reject) => {
			if (honourAbort) init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
			calls.push({
				url,
				init,
				answer: (result) => resolve(new Response(JSON.stringify(result))),
				fail: () => reject(new TypeError('network'))
			});
		})) as unknown as typeof fetch;
	return { fn, calls };
}

async function flush() {
	for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

function runState(overrides: Partial<CatalogRunState>): CatalogRunState {
	return { name: 'web', hostId: HOST_ID, serviceId: null, kind: 'logs', resultId: 'r', status: null, logs: null, message: null, ...overrides };
}

function linesResult(lines: string[]): ActionResult {
	return { type: 'success', status: 200, data: { scope: 'services', catalogAction: runState({ logs: { container: 'c', lines, truncated: false } }) } };
}

function loader(honourAbort = true) {
	const fetcher = fakeFetch(honourAbort);
	const gone: string[] = [];
	const views: LogsView[] = [];
	const logs = new LogsLoader({
		fetch: fetcher.fn,
		deserialize: (text) => JSON.parse(text) as ActionResult,
		goto: async (path) => {
			gone.push(path);
		},
		origin: ORIGIN,
		form: { action: ACTION, name: 'web', hostId: HOST_ID, entryKind: 'image' },
		onChange: (view) => views.push(view),
		now: () => new Date(Date.UTC(2026, 9, 29, 10, 0, 0))
	});
	return { fetcher, gone, views, logs };
}

describe('logs-load', () => {
	test('opening fetches the action with the row fields and shows the lines', async () => {
		const { fetcher, logs } = loader();
		logs.open();
		const first = logs.load(true);
		assert.equal(fetcher.calls.length, 1);
		const call = fetcher.calls[0]!;
		assert.equal(call.url, ACTION);
		assert.equal(call.init.method, 'POST');
		assert.deepEqual(call.init.headers, { accept: 'application/json', 'x-sveltekit-action': 'true' });
		const body = call.init.body as FormData;
		assert.deepEqual([...body.entries()], [
			['name', 'web'],
			['host_id', HOST_ID],
			['entry_kind', 'image']
		]);
		assert.equal(logs.view.loading, true);
		assert.equal(logs.view.spinning, true);
		call.answer(linesResult(['a', 'b']));
		assert.equal(await first, true);
		assert.deepEqual(logs.view.logs?.lines, ['a', 'b']);
		assert.equal(logs.view.loading, false);
		assert.equal(logs.view.spinning, false);
		assert.equal(logs.view.error, null);
		assert.equal(logs.view.updatedAt?.toISOString(), '2026-10-29T10:00:00.000Z');
		assert.equal(logsText(logs.view), 'a\nb');
	});

	test('a Live poll does not spin; one failure keeps the lines and shows the error; the next answer clears it', async () => {
		const { fetcher, logs } = loader();
		logs.open();
		const first = logs.load(true);
		fetcher.calls[0]!.answer(linesResult(['kept']));
		await first;
		const poll = logs.load(false);
		assert.equal(logs.view.loading, true);
		assert.equal(logs.view.spinning, false);
		fetcher.calls[1]!.answer({ type: 'failure', status: 503, data: { catalogAction: runState({ message: 'Host offline.' }) } });
		assert.equal(await poll, false);
		assert.deepEqual(logs.view.logs?.lines, ['kept']);
		assert.equal(logs.view.error, 'Host offline.');
		const network = logs.load(false);
		fetcher.calls[2]!.fail();
		assert.equal(await network, false);
		assert.equal(logs.view.error, LOGS_FAILED);
		assert.deepEqual(logs.view.logs?.lines, ['kept']);
		logs.endLive(LIVE_TIMEOUT_NOTE);
		const next = logs.load(true);
		fetcher.calls[3]!.answer(linesResult(['new']));
		assert.equal(await next, true);
		assert.equal(logs.view.error, null);
		assert.equal(logs.view.endNote, null);
	});

	test('Refresh while a request runs is ignored', async () => {
		const { fetcher, logs } = loader();
		logs.open();
		const first = logs.load(true);
		assert.equal(await logs.load(true), false);
		assert.equal(fetcher.calls.length, 1);
		fetcher.calls[0]!.answer(linesResult(['a']));
		await first;
	});

	test('closing aborts the request and drops a late answer; a reopen starts empty', async () => {
		const aborting = loader();
		aborting.logs.open();
		const first = aborting.logs.load(true);
		aborting.logs.close();
		assert.equal((aborting.fetcher.calls[0]!.init.signal as AbortSignal).aborted, true);
		assert.equal(await first, false);
		assert.deepEqual(aborting.logs.view, emptyLogsView());

		const late = loader(false);
		late.logs.open();
		const pending = late.logs.load(true);
		late.logs.close();
		late.fetcher.calls[0]!.answer(linesResult(['late']));
		assert.equal(await pending, false);
		await flush();
		assert.equal(late.logs.view.logs, null);
		assert.equal(late.views.some((view) => view.logs != null), false);

		// A reopen fetches again from an empty view.
		late.logs.open();
		const again = late.logs.load(true);
		assert.equal(late.fetcher.calls.length, 2);
		late.fetcher.calls[1]!.answer(linesResult(['fresh']));
		await again;
		late.logs.close();
		assert.deepEqual(late.logs.view, emptyLogsView());
		late.logs.open();
		assert.deepEqual(late.logs.view, emptyLogsView());
	});

	test('a redirect is followed only to a path on this site', async () => {
		const cases: Array<[string, string | null]> = [
			['/signin?next=%2Fprojects', '/signin?next=%2Fprojects'],
			[`${ORIGIN}/signin`, '/signin'],
			['//evil.example/signin', null],
			['/\\evil.example', null],
			['https://evil.example/signin', null],
			['javascript:alert(1)', null]
		];
		for (const [location, expected] of cases) {
			assert.equal(sameOriginPath(location, ORIGIN), expected, location);
			const { fetcher, gone, logs } = loader();
			logs.open();
			const pending = logs.load(true);
			fetcher.calls[0]!.answer({ type: 'redirect', status: 303, location });
			assert.equal(await pending, false);
			assert.deepEqual(gone, expected == null ? [] : [expected], location);
			assert.equal(logs.view.error, expected == null ? LOGS_FAILED : null, location);
			assert.equal(logs.view.loading, false);
		}
	});

	test('Copy is offered only with lines on view', () => {
		const view = emptyLogsView();
		assert.equal(canCopy(view), false);
		assert.equal(canCopy({ ...view, logs: { unit: 'u', lines: [], truncated: false } }), false);
		assert.equal(canCopy({ ...view, logs: { unit: 'u', lines: ['a'], truncated: false } }), true);
		assert.match(source('LogsDrawer.svelte'), /<CopyButton value=\{text\} label="Copy" disabled=\{!canCopy\(view\)\} \/>/);
	});
});

describe('log text', () => {
	const cases: Array<[string, string]> = [
		['\u001B[32mINFO\u001B[0m ready', 'INFO ready'],
		['\u001B[1;31merror\u001B[39;49m', 'error'],
		['\u001B[2K\u001B[1Gprogress', 'progress'],
		['\u001B]0;my title\u0007text', 'text'],
		['\u001B]8;;https://x.example\u001B\\link\u001B]8;;\u001B\\ end', 'link end'],
		['a\u001B(Bb', 'ab'],
		['\u001B7x\u001B8\u001B=\u001B>\u001Bc', 'x'],
		['red\u001B[31', 'red'],
		['a\u009Bb\u0085c', 'abc'],
		['a\u0007b\u0007c', 'a�b�c'],
		['a\rb', 'a�b'],
		['a\u0000b', 'a�b'],
		['a\u007Fb', 'a�b'],
		['col1\tcol2\tcol3', 'col1 col2 col3'],
		['no codes', 'no codes']
	];

	test('log lines lose escape sequences and C1 controls, and every other control character is replaced', () => {
		for (const [raw, shown] of cases) {
			assert.equal(parseProgramLogs({ unit: 'u', lines: [raw], truncated: false })?.lines[0], shown, JSON.stringify(raw));
			assert.equal(parseImageLogs({ container: 'c', lines: [raw], truncated: false })?.lines[0], shown, JSON.stringify(raw));
		}
		assert.equal(stripAnsi('tab\tstays'), 'tab\tstays');
		// The cap applies after stripping, so codes do not use up the line length.
		const capped = parseProgramLogs({ unit: 'u', lines: [`\u001B[31m${'L'.repeat(8192)}\u001B[0m`], truncated: false })?.lines[0];
		assert.equal(capped, 'L'.repeat(8192));
	});

	test('a tab and several control characters on a non-log field', () => {
		const sample = parseProcessSample({
			sampled_at: null,
			items: [{ pid: 1, process_name: 'a\tb\u0001c\u0002', user: 'u', cmdline: 'run\t--x\u0007\u0008y\u001B[0m' }]
		});
		assert.equal(sample?.items[0]?.process_name, 'a b�c�');
		// No ANSI strip outside logs: the escape shows as U+FFFD.
		assert.equal(sample?.items[0]?.cmdline, 'run --x��y�[0m');
	});

	test('formatTime is hh:mm:ss in a given zone or the runtime zone', () => {
		const at = new Date(Date.UTC(2026, 9, 29, 13, 4, 5));
		assert.equal(formatTime(new Date(Number.NaN)), '');
		assert.equal(formatTime(at, 'UTC'), '13:04:05');
		assert.equal(formatTime(at, 'Pacific/Auckland'), '02:04:05');
		assert.match(formatTime(at), /^\d{2}:\d{2}:\d{2}$/);
		assert.equal(formatTime(at, ''), formatTime(at));
	});

	test('scrolling follows the end only when the view was at the end', () => {
		assert.equal(atBottom({ scrollTop: 600, clientHeight: 400, scrollHeight: 1000 }), true);
		assert.equal(atBottom({ scrollTop: 595, clientHeight: 400, scrollHeight: 1000 }), true);
		assert.equal(atBottom({ scrollTop: 500, clientHeight: 400, scrollHeight: 1000 }), false);
		assert.equal(atBottom({ scrollTop: 0, clientHeight: 400, scrollHeight: 300 }), true);
		assert.equal(scrollAfterUpdate(true, true), 'follow');
		assert.equal(scrollAfterUpdate(true, false), 'follow');
		assert.equal(scrollAfterUpdate(false, true), 'notify');
		assert.equal(scrollAfterUpdate(false, false), 'keep');
	});

	test('the action answer becomes lines, an error, or a redirect', () => {
		const logs = { unit: 'u', lines: ['a'], truncated: false };
		assert.deepEqual(logsOutcome({ type: 'success', status: 200, data: { catalogAction: runState({ logs }) } }), { kind: 'logs', logs });
		assert.deepEqual(logsOutcome({ type: 'failure', status: 503, data: { catalogAction: runState({ message: 'Host offline.' }) } }), {
			kind: 'error',
			message: 'Host offline.'
		});
		assert.deepEqual(logsOutcome({ type: 'success', status: 200, data: {} }), { kind: 'error', message: LOGS_FAILED });
		assert.deepEqual(logsOutcome({ type: 'error', error: new Error('stack') }), { kind: 'error', message: LOGS_FAILED });
		assert.deepEqual(logsOutcome({ type: 'redirect', status: 303, location: '/signin' }), { kind: 'redirect', location: '/signin' });
	});

	test('the live region holds the error, the end note, or the first-load message; the info line is separate', () => {
		assert.equal(logsAnnouncement({ error: 'Host offline.', endNote: LIVE_TIMEOUT_NOTE, firstLoad: true }), 'Host offline.');
		assert.equal(logsAnnouncement({ error: null, endNote: LIVE_TIMEOUT_NOTE, firstLoad: false }), LIVE_TIMEOUT_NOTE);
		assert.equal(logsAnnouncement({ error: null, endNote: null, firstLoad: true }), LOGS_LOADING);
		assert.equal(logsAnnouncement({ error: null, endNote: null, firstLoad: false }), '');
		assert.equal(logsInfoLine({ live: true, updated: '10:00:00' }), 'Live, every 3 s. Updated 10:00:00.');
		assert.equal(logsInfoLine({ live: true, updated: null }), 'Live, every 3 s.');
		assert.equal(logsInfoLine({ live: false, updated: '10:00:00' }), 'Updated 10:00:00.');
		assert.equal(logsInfoLine({ live: false, updated: null }), '');
	});
});

describe('Logs drawer', () => {
	before(() => useApi('https://api.example'));
	after(() => restoreEnv());

	const controls: ServiceControls = {
		entry: 'web',
		entryKind: 'image',
		stateAction: 'stop',
		blockedReason: null,
		restart: true,
		logs: true,
		crashNote: null
	};

	test('Logs on a row opens the drawer with no confirm step; Run, Stop and Restart keep their dialogs', () => {
		setPageUrl(`${ORIGIN}/projects/${PROJECT.id}?tab=services`);
		const html = render(ServiceRowActions, { props: { controls, hostId: HOST_ID, hostName: 'pi1', serviceId: SERVICE_ID } }).body;
		assert.match(html, /data-logs-slot/);
		assert.equal(html.includes('data-run-slot="logs"'), false);
		assert.match(html, /data-run-slot="stop"/);
		assert.match(html, /data-run-slot="restart"/);
		const labels = [...html.matchAll(/aria-label="([^"]*)"/g)].map((match) => match[1]);
		assert.deepEqual(labels, ['Stop web on pi1', 'Restart web on pi1', 'Logs web on pi1']);
		const startOnly = render(ServiceRowActions, {
			props: { controls: { ...controls, stateAction: 'run' }, hostId: HOST_ID, hostName: 'pi1', startOnly: true }
		}).body;
		assert.equal(startOnly.includes('data-logs-slot'), false);
	});

	test('the drawer wires the loader, Live, Refresh, the regions and focus', () => {
		const drawer = source('LogsDrawer.svelte');
		assert.match(drawer, /new LogsLoader\(\{\s*fetch,\s*deserialize,\s*goto,\s*origin: location\.origin/);
		assert.match(drawer, />\{text\}<\/pre>/);
		assert.equal(drawer.includes('{@html'), false);
		// Live has one owner: shown one way, changed in the handler and by the poller's end.
		assert.match(drawer, /<Switch id=\{liveId\} checked=\{live\} onCheckedChange=\{onLive\} \/>/);
		assert.equal(drawer.includes('bind:checked'), false);
		assert.match(drawer, /<Label for=\{liveId\}>Live<\/Label>/);
		// Refresh stays focusable while a request runs.
		assert.match(drawer, /aria-disabled=\{view\.loading \? 'true' : undefined\}/);
		assert.equal(/<Button[^>]*\sdisabled=/.test(drawer), false);
		// One always-present status region; the Live and update text is not live.
		assert.equal((drawer.match(/role="status"/g) ?? []).length, 1);
		assert.equal(drawer.includes('aria-live'), false);
		assert.match(drawer, /role="region"\s+tabindex="0"\s+aria-label="Log lines"/);
		assert.match(drawer, /function jumpToEnd\(\) \{\s*viewEl\?\.focus\(\);/);
		assert.match(drawer, /current\.close\(\);/);
		for (const note of ['No log lines.', 'Older lines were left out.', 'New lines below']) assert.ok(drawer.includes(note), note);
		assert.match(drawer, /data-\[side=right\]:w-full/);
		assert.match(source('ServiceRowActions.svelte'), /<LogsDrawer/);
	});

	test('the logs branch is gone from the run dialog and its result view', () => {
		assert.match(source('CatalogRunDialog.svelte'), /kind: Exclude<CatalogRunKind, 'logs'>/);
		assert.equal(source('CatalogRunResult.svelte').includes('result.logs'), false);
		assert.equal(source('ServiceRowActions.svelte').includes("kind === 'logs'"), false);
	});

	test('the logs action posts host_id only and returns cleaned lines', async () => {
		const calls = installFetch(() => envelope({ container: 'deploybot-lab-web', lines: ['\u001B[32mok\u001B[0m\tdone'], truncated: false }));
		const result = await projectActions.catalogLogs(
			fakeEvent({
				url: `${ORIGIN}/projects/${PROJECT.id}?tab=services&/catalogLogs`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: { name: 'web', host_id: HOST_ID, entry_kind: 'image' }
			}).event as never
		);
		assert.equal(calls[0]?.url.pathname, `/v1/projects/${PROJECT.id}/catalog/web/logs`);
		assert.equal(calls[0]?.body, JSON.stringify({ host_id: HOST_ID }));
		const outcome = logsOutcome({ type: 'success', status: 200, data: result as Record<string, unknown> });
		assert.deepEqual(outcome, { kind: 'logs', logs: { container: 'deploybot-lab-web', lines: ['ok done'], truncated: false } });
	});
});
