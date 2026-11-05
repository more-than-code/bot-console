import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import type { Host, ProjectServiceRow } from '../src/lib/api-types.ts';
import { catalogRows, copyDetailText, copyState, copySummary, copyUptime, groupCopies, healthNote, hostsText, portsText, worstState, type CopyState } from '../src/lib/catalog-copies.ts';
import {
	canOpen,
	clearOpenStorage,
	forcedNames,
	forcedOpen,
	isEntryOpen,
	NO_CHOICES,
	OPEN_NAME_LENGTH_MAX,
	OPEN_NAMES_MAX,
	openableNames,
	openReducer,
	openStorageKey,
	readOpen,
	ROW_CLICK_IGNORE,
	rowClickToggles,
	writeOpen
} from '../src/lib/catalog-open.ts';
import { runtimeFromImageState } from '../src/lib/service-actions.ts';
import { shownOnOpen } from '../src/lib/run-actions.ts';
import type { ImageState } from '../src/lib/api-types.ts';
import { copyMenuItems, entryMenuItems, menuOnWide } from '../src/lib/row-menu.ts';
import { copyHost, copyRow, imageCatalogEntry, programCatalogEntry, renderCopies } from './copies.ts';
import { PROJECT } from './harness.ts';

const PI1 = '00000000-0000-4000-8000-0000000000a1';
const PI2 = '00000000-0000-4000-8000-0000000000a2';
const HOSTS: Host[] = [copyHost({ id: PI1, name: 'pi1' }), copyHost({ id: PI2, name: 'pi2' })];

function id(n: number): string {
	return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function copy(n: number, entry: string, hostId: string, hostName: string, overrides: Partial<ProjectServiceRow> = {}): ProjectServiceRow {
	return copyRow({ id: id(n), catalog_entry: entry, name: entry, host_id: hostId, host_name: hostName, display_name: null, container_name: `${entry}-${hostName}`, ...overrides });
}

describe('copy states and the Services summary', () => {
	type Status = 'up' | 'down' | 'unknown';
	const health = (status: Status | null, source: 'docker' | 'check' | null = 'check') =>
		status == null ? null : { status, last_checked_at: null, latency_ms: null, source };
	type Row = Pick<ProjectServiceRow, 'kind' | 'gone_at' | 'health'>;
	const container = (status: Status | null = null, gone: string | null = null): Row => ({
		kind: 'container',
		gone_at: gone,
		health: health(status)
	});
	const program = (status: Status | null = null, gone: string | null = null): Row => ({ ...container(status, gone), kind: 'systemd' });
	const GONE = '2026-10-14T00:00:00Z';

	test('a pending read is a spinner', () => {
		assert.equal(copyState(container('up'), null), 'loading');
		assert.equal(copyState(program('up'), null), 'loading');
	});

	test('rule 1: a gone row, or a stopped or missing container, is Stopped', () => {
		assert.equal(copyState(container('up', GONE), { state: 'running' }), 'stopped');
		assert.equal(copyState(container('up', GONE), undefined), 'stopped');
		// Exited, created and dead arrive as `stopped` (runtimeFromImageState).
		assert.equal(copyState(container('up'), { state: 'stopped' }), 'stopped');
		assert.equal(copyState(container('down'), { state: 'missing' }), 'stopped');
	});

	test('rule 2: a restarting container is Unhealthy', () => {
		assert.equal(copyState(container('up'), { state: 'restarting' }), 'unhealthy');
	});

	test('rule 3: a running or paused container is Unhealthy only with health down; the tooltip explains unknown health', () => {
		assert.equal(copyState(container('down'), { state: 'running' }), 'unhealthy');
		assert.equal(copyState(container('down'), { state: 'paused' }), 'unhealthy');
		assert.equal(copyState(container('up'), { state: 'running' }), 'running');
		assert.equal(copyState(container('unknown'), { state: 'paused' }), 'running');
		assert.equal(copyState(container(null), { state: 'running' }), 'running');
		assert.equal(healthNote({ kind: 'container', health: null }, 'running'), 'No health check');
		assert.equal(healthNote({ kind: 'container', health: health('unknown', null) }, 'running'), 'No health check');
		assert.equal(healthNote({ kind: 'container', health: health('unknown', 'docker') }, 'running'), 'Health not checked recently');
		assert.equal(healthNote({ kind: 'container', health: health('up', 'check') }, 'running'), null);
		assert.equal(healthNote({ kind: 'container', health: null }, 'stopped'), null);
		assert.equal(healthNote({ kind: 'systemd', health: null }, 'running'), null);
	});

	test('rule 4: a container whose state was not read falls back to its health', () => {
		// Read failed or timed out, host not online, past the 100-copy cap: the runtime is `unknown`.
		for (const runtime of [{ state: 'unknown' }, undefined]) {
			assert.equal(copyState(container('up'), runtime), 'running');
			assert.equal(copyState(container('down'), runtime), 'unhealthy');
			assert.equal(copyState(container('unknown'), runtime), 'noStatus');
			assert.equal(copyState(container(null), runtime), 'noStatus');
		}
	});

	test('rule 5: a program is Unhealthy with health down, otherwise Running while reported, Stopped when gone', () => {
		assert.equal(copyState(program('down'), { state: 'running' }), 'unhealthy');
		assert.equal(copyState(program('up'), { state: 'running' }), 'running');
		assert.equal(copyState(program(null), undefined), 'running');
		assert.equal(copyState(program('unknown'), { state: 'unknown' }), 'running');
		assert.equal(copyState(program('up', GONE), { state: 'stopped' }), 'stopped');
	});

	test('Uptime is the time since a running container started; a dash otherwise', () => {
		const now = Date.parse('2026-11-05T12:00:00Z');
		const live = (startedAt: string | null) => ({ container: { startedAt } });
		assert.equal(copyUptime('running', live('2026-11-05T09:58:00Z'), now), '2h 2m');
		assert.equal(copyUptime('running', live('2026-11-02T11:00:00Z'), now), '3d 1h');
		assert.equal(copyUptime('unhealthy', live('2026-11-05T11:59:00Z'), now), '1m');
		assert.equal(copyUptime('running', live('2026-11-05T11:59:31Z'), now), '<1m');
		// Up to 30 s of clock skew still counts as just started.
		assert.equal(copyUptime('running', live('2026-11-05T12:00:20Z'), now), '<1m');
		// Programs (no container), stopped copies, unknown states, a missing or future time: a dash.
		assert.equal(copyUptime('running', { }, now), '—');
		assert.equal(copyUptime('stopped', live('2026-11-05T09:58:00Z'), now), '—');
		assert.equal(copyUptime('noStatus', live('2026-11-05T09:58:00Z'), now), '—');
		assert.equal(copyUptime('loading', null, now), '—');
		assert.equal(copyUptime('running', live(null), now), '—');
		assert.equal(copyUptime('running', live('2026-11-05T13:00:00Z'), now), '—');
		assert.equal(portsText([80, 443]), '80, 443');
		assert.equal(portsText([]), '');
	});

	test('every container state from the host maps through runtimeFromImageState to one badge word', () => {
		const states: Array<[ImageState, CopyState]> = [
			['running', 'running'],
			['paused', 'running'],
			['restarting', 'unhealthy'],
			['exited', 'stopped'],
			['created', 'stopped'],
			['dead', 'stopped'],
			['missing', 'stopped'],
			['unknown', 'noStatus']
		];
		for (const [state, word] of states) {
			assert.equal(copyState(container(null), runtimeFromImageState(state, 0)), word, state);
		}
	});

	test('the phone line shows the worst state present', () => {
		const base = { total: 3, hosts: [], running: 1, unhealthy: 0, stopped: 0, notStarted: 0, noStatus: 0, loading: false };
		assert.deepEqual(worstState({ ...base, unhealthy: 1, stopped: 1 }), { tone: 'down', text: '1 unhealthy' });
		assert.deepEqual(worstState({ ...base, noStatus: 2 }), { tone: 'unknown', text: '2 no status' });
		assert.deepEqual(worstState({ ...base, stopped: 1 }), { tone: 'stopped', text: '1 stopped' });
		assert.deepEqual(worstState({ ...base, running: 0, notStarted: 1 }), { tone: 'unknown', text: '1 not started' });
		assert.deepEqual(worstState(base), { tone: 'up', text: '1 running' });
		assert.equal(worstState({ ...base, running: 0 }), null);
	});

	test('reopening a start or stop dialog from the menu shows the form, not the last result', () => {
		const result = { resultId: 'r1' };
		// A result opens it on the result; any user open (icon or ⋯ menu) starts with a fresh form.
		assert.equal(shownOnOpen('result', result), result);
		assert.equal(shownOnOpen('user', result), null);
		const dialog = readFileSync(new URL('../src/routes/projects/[id]/CatalogRunDialog.svelte', import.meta.url), 'utf8');
		const request = dialog.slice(dialog.indexOf('requestSeen = request;'), dialog.indexOf('});', dialog.indexOf('requestSeen = request;')));
		assert.match(request, /shown = shownOnOpen\('user', shown\)/);
	});

	test('the summary counts copies by state and hosts it never ran on as not started', () => {
		const copies = [copy(1, 'web', PI1, 'pi1'), copy(2, 'web', PI2, 'pi2'), copy(3, 'web', PI1, 'h3'), copy(4, 'web', PI1, 'h4'), copy(5, 'web', PI1, 'h5')];
		const states: Record<string, CopyState> = { [id(1)]: 'running', [id(2)]: 'unhealthy', [id(3)]: 'stopped', [id(4)]: 'noStatus', [id(5)]: 'running' };
		const summary = copySummary({ copies, idle: [copyHost({ id: id(9), name: 'idle' })] }, (item) => states[item.id] ?? 'loading');
		assert.deepEqual(summary, {
			total: 6,
			hosts: ['pi1', 'pi2', 'h3', 'h4', 'h5', 'idle'],
			running: 2,
			unhealthy: 1,
			stopped: 1,
			notStarted: 1,
			noStatus: 1,
			loading: false
		});
		const reading = copySummary({ copies, idle: [] }, () => 'loading');
		assert.equal(reading.loading, true);
		assert.equal(reading.running + reading.unhealthy + reading.stopped + reading.noStatus, 0);
		assert.equal(hostsText(['a', 'b']), 'a, b');
		assert.equal(hostsText(['a', 'b', 'c', 'd', 'e']), 'a, b, c +2');
		assert.equal(copyDetailText([8080], 'sha256:abc'), 'port 8080 · sha256:abc');
		assert.equal(copyDetailText([80, 443], null), 'ports 80, 443');
		assert.equal(copyDetailText([], null), '');
	});

	test('the summary cell shows counts, a spinner while reading, and Not deployed with no arrow', () => {
		const entries = [imageCatalogEntry('web'), imageCatalogEntry('empty')];
		const rows = [
			copy(1, 'web', PI1, 'pi1', { runtime: { state: 'running', restarts: 0 } }),
			copy(2, 'web', PI2, 'pi2', { runtime: { state: 'stopped', restarts: 0 } })
		];
		const html = renderCopies({ rows, entries, hosts: HOSTS });
		const web = html.slice(html.indexOf('data-entry="web"'), html.indexOf('</tr>', html.indexOf('data-entry="web"')));
		assert.match(web, /2 on pi1, pi2/);
		assert.match(web, /1 running/);
		assert.match(web, /1 stopped/);
		const empty = html.slice(html.indexOf('data-entry="empty"'), html.indexOf('</tr>', html.indexOf('data-entry="empty"')));
		assert.match(empty, /Not deployed/);
		assert.equal(empty.includes('data-toggle'), false);
		// Containers of an entry with grants are read after the page renders: a spinner, never "unknown".
		const reading = renderCopies({ rows: [copy(1, 'web', PI1, 'pi1')], entries: [imageCatalogEntry('web', ['logs'])], hosts: HOSTS });
		const summary = reading.slice(reading.indexOf('data-summary'), reading.indexOf('</td>', reading.indexOf('data-summary')));
		assert.match(summary, /data-state-loading/);
		assert.equal(summary.includes('unknown'), false);
	});
});

describe('collapsible entries', () => {
	const entries = [imageCatalogEntry('web'), imageCatalogEntry('db')];
	const rows = [copy(1, 'web', PI1, 'pi1', { display_name: 'Front door' }), copy(2, 'web', PI2, 'pi2'), copy(3, 'db', PI2, 'pi2')];
	const base = `http://console.example/projects/${PROJECT.id}?tab=catalog&catalog.sort=name&catalog.dir=asc`;
	const view = (query = '') => renderCopies({ rows, entries, hosts: HOSTS, url: `${base}${query}`, collapsed: true });

	function toggleTag(html: string, name: string): string {
		const at = html.indexOf(`data-entry="${name}"`);
		const end = html.indexOf('</tr>', at);
		return html.slice(at, end).match(/<button\b[^>]*data-toggle[^>]*>/)?.[0] ?? '';
	}

	/** The entry's services row (a nested table) is in the page but hidden while collapsed. */
	function servicesHidden(html: string, name: string): boolean {
		const tag = html.match(new RegExp(`<tr[^>]*data-services-row="${name}"[^>]*>`))?.[0] ?? '';
		assert.notEqual(tag, '', `services of ${name}`);
		return / hidden/.test(tag);
	}

	test('entries are collapsed by default: the arrow is a button with aria-expanded and aria-controls', () => {
		const html = view();
		const tag = toggleTag(html, 'web');
		assert.match(tag, /aria-expanded="false"/);
		assert.match(tag, /aria-controls="services-entry-web"/);
		assert.match(html, /<tr id="services-entry-web"/);
		// A constant name; aria-expanded carries the state.
		assert.match(tag, /aria-label="Services of web"/);
		// Collapsed: the services row is there (for aria-controls) but empty and hidden.
		assert.equal(html.includes('data-services-table'), false);
		assert.equal(servicesHidden(html, 'web'), true);
		assert.equal(servicesHidden(html, 'db'), true);
		assert.match(html, /data-entry="web" data-open="false"/);
		assert.match(html, /data-expand-all="true"[^>]*>(?:<!--[^>]*-->|\s)*Expand all/);
	});

	test('a search that matches a copy, or a host filter, opens its entry; a command match does not', () => {
		const byLabel = view('&catalog.q=front');
		assert.match(toggleTag(byLabel, 'web'), /aria-expanded="true"/);
		assert.equal(servicesHidden(byLabel, 'web'), false);
		const byCommand = view('&catalog.q=ghcr.io');
		assert.match(toggleTag(byCommand, 'web'), /aria-expanded="false"/);
		const byHost = view(`&catalog.host=${PI2}`);
		assert.match(toggleTag(byHost, 'web'), /aria-expanded="true"/);
		assert.match(toggleTag(byHost, 'db'), /aria-expanded="true"/);
		// With a host chosen only that host's copies show, and the summary counts only them.
		assert.match(byHost.slice(byHost.indexOf('data-entry="web"')), /1 on pi2/);
	});

	test('filter matches and the logs link open entries; health never does', () => {
		const catalog = [imageCatalogEntry('web'), imageCatalogEntry('db'), imageCatalogEntry('empty')];
		const list = catalogRows(catalog, groupCopies(rows, PROJECT.id, catalog), []);
		assert.equal(canOpen(list[2]!), false);
		assert.deepEqual(openableNames(list), ['web', 'db']);
		assert.deepEqual(forcedOpen(list, 'front', false), ['web']);
		assert.deepEqual(forcedOpen(list, 'pi2', false), ['web', 'db']);
		assert.deepEqual(forcedOpen(list, '', true), ['web', 'db']);
		assert.deepEqual([...forcedNames(list, '', false, 'db')], ['db']);
		assert.deepEqual([...forcedNames(list, 'front', false, null)], ['web']);
		const unhealthy = catalogRows(catalog, groupCopies([copy(7, 'web', PI1, 'pi1', { health: { status: 'down', last_checked_at: null, latency_ms: null, source: null } })], PROJECT.id, catalog), []);
		assert.deepEqual(forcedOpen(unhealthy, '', false), []);
	});

	test('the open-state reducer keeps the user\'s choices apart from what filters open', () => {
		const none = new Set<string>();
		const forced = new Set(['web']);
		// Restore merges the stored names on mount.
		let state = openReducer(NO_CHOICES, { type: 'restore', stored: new Set(['db']) });
		assert.deepEqual([...state.open], ['db']);
		// A filter opens web without storing it; the user can close it while the filter holds.
		assert.equal(isEntryOpen(state, 'web', forced), true);
		state = openReducer(state, { type: 'toggle', name: 'web', forced: true });
		assert.equal(isEntryOpen(state, 'web', forced), false);
		assert.deepEqual([...state.open], ['db']);
		// A new filter forgets that close, so the next match opens it again.
		state = openReducer(state, { type: 'filters-changed' });
		assert.equal(isEntryOpen(state, 'web', forced), true);
		// Clearing the filter returns to the user's own set.
		assert.equal(isEntryOpen(state, 'web', none), false);
		assert.equal(isEntryOpen(state, 'db', none), true);
		// Toggling an unforced entry opens and closes it.
		state = openReducer(state, { type: 'toggle', name: 'web', forced: false });
		assert.equal(isEntryOpen(state, 'web', none), true);
		state = openReducer(state, { type: 'toggle', name: 'web', forced: false });
		assert.equal(isEntryOpen(state, 'web', none), false);
		// Expand and Collapse act on the names given (the entries on view).
		state = openReducer(state, { type: 'expand', names: ['web', 'api'] });
		assert.deepEqual([...state.open].sort(), ['api', 'db', 'web']);
		state = openReducer(state, { type: 'collapse', names: ['web'] });
		assert.equal(isEntryOpen(state, 'web', forced), false);
		assert.deepEqual([...state.open].sort(), ['api', 'db']);
		const same = openReducer({ open: new Set(), closed: new Set() }, { type: 'filters-changed' });
		assert.equal(same.closed.size, 0);
	});

	test('a row click toggles only on the row background, and not when it ends a text selection', () => {
		// A tiny element tree whose `closest` checks the selector list for real (tag names, [role], [data-*]).
		type Node = { tag: string; attrs: Record<string, string>; parent: Node | null };
		function matches(node: Node, selector: string): boolean {
			const role = /^\[role="([^"]+)"\]$/.exec(selector);
			if (role) return node.attrs.role === role[1];
			const data = /^\[([a-z-]+)\]$/.exec(selector);
			if (data) return data[1] in node.attrs;
			return node.tag === selector;
		}
		function element(node: Node) {
			return {
				closest(list: string) {
					const selectors = list.split(',').map((item) => item.trim());
					for (let at: Node | null = node; at; at = at.parent) if (selectors.some((selector) => matches(at!, selector))) return at;
					return null;
				}
			};
		}
		const tr: Node = { tag: 'tr', attrs: {}, parent: null };
		const td: Node = { tag: 'td', attrs: {}, parent: tr };
		const span: Node = { tag: 'span', attrs: {}, parent: td };
		const button: Node = { tag: 'button', attrs: {}, parent: td };
		const icon: Node = { tag: 'svg', attrs: {}, parent: button };
		const link: Node = { tag: 'a', attrs: {}, parent: td };
		const item: Node = { tag: 'div', attrs: { role: 'menuitem' }, parent: null };
		const marked: Node = { tag: 'div', attrs: { 'data-no-row-toggle': '' }, parent: td };
		assert.equal(rowClickToggles(element(span)), true);
		assert.equal(rowClickToggles(element(td)), true);
		assert.equal(rowClickToggles(element(icon)), false);
		assert.equal(rowClickToggles(element(link)), false);
		assert.equal(rowClickToggles(element(item)), false);
		assert.equal(rowClickToggles(element(marked)), false);
		assert.equal(rowClickToggles(null), false);
		for (const selector of ['button', 'a', 'input', 'select', 'textarea', 'label', 'form', '[role="menuitem"]']) {
			assert.ok(ROW_CLICK_IGNORE.split(', ').includes(selector), selector);
		}
		// A click that ends a selection (or a double-click word select) does not toggle; a plain click does.
		assert.equal(rowClickToggles(element(span), { isCollapsed: false }), false);
		assert.equal(rowClickToggles(element(span), { isCollapsed: true }), true);
	});

	test('the open set is kept per project in session storage, capped, and works without it', () => {
		const store = new Map<string, string>();
		const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
		const known = new Set(['web', 'db']);
		// Only names of listed entries are written.
		assert.equal(writeOpen(storage, 'p1', new Set(['web', 'db', 'gone']), known), true);
		assert.equal(store.get(openStorageKey('p1')), '["db","web"]');
		assert.deepEqual([...readOpen(storage, 'p1')].sort(), ['db', 'web']);
		assert.deepEqual([...readOpen(storage, 'p2')], []);
		for (const [raw, want] of [
			['null', []],
			['{}', []],
			['"x"', []],
			['[[]]', []],
			['{not json', []],
			['[1, "web", ""]', ['web']],
			[JSON.stringify(['ok', 'x'.repeat(OPEN_NAME_LENGTH_MAX + 1)]), ['ok']]
		] as const) {
			store.set(openStorageKey('p3'), raw);
			assert.deepEqual([...readOpen(storage, 'p3')], want, raw);
		}
		store.set(openStorageKey('p4'), JSON.stringify(Array.from({ length: OPEN_NAMES_MAX + 50 }, (_, n) => `e${n}`)));
		assert.equal(readOpen(storage, 'p4').size, OPEN_NAMES_MAX);
		const broken = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			}
		};
		assert.deepEqual([...readOpen(broken, 'p1')], []);
		assert.equal(writeOpen(broken, 'p1', new Set(['web']), known), false);
		assert.equal(writeOpen(null, 'p1', new Set(['web']), known), false);
		assert.deepEqual([...readOpen(undefined, 'p1')], []);
	});

	test('sign-out clears every project\'s open names and nothing else', () => {
		const store = new Map<string, string>([
			[openStorageKey('p1'), '["web"]'],
			[openStorageKey('p2'), '["db"]'],
			['other', 'keep']
		]);
		const storage = {
			get length() {
				return store.size;
			},
			key: (index: number) => [...store.keys()][index] ?? null,
			removeItem: (key: string) => void store.delete(key)
		};
		assert.equal(clearOpenStorage(storage), 2);
		assert.deepEqual([...store.keys()], ['other']);
		assert.equal(clearOpenStorage(null), 0);
		const layout = readFileSync(new URL('../src/routes/+layout.svelte', import.meta.url), 'utf8');
		assert.match(layout, /action="\/signout"[^>]*onsubmit=\{\(\) => clearOpenStorage\(visitStorage\(\)\)\}/);
	});
});

describe('row actions: fixed slots and ⋯ menus', () => {
	test('the entry menu holds Permissions and Delete (last, red); Deploy and Edit only below sm', () => {
		const owner = entryMenuItems({ name: 'web', deploy: true, edit: true, owner: true });
		assert.deepEqual(
			owner.map((item) => [item.key, item.phoneOnly, item.destructive ?? false]),
			[
				['deploy', true, false],
				['edit', true, false],
				['permissions', false, false],
				['delete', false, true]
			]
		);
		assert.equal(menuOnWide(owner), true);
		const admin = entryMenuItems({ name: 'web', deploy: true, edit: true, owner: false });
		assert.deepEqual(admin.map((item) => item.key), ['deploy', 'edit']);
		assert.equal(menuOnWide(admin), false);
		assert.deepEqual(entryMenuItems({ name: 'web', deploy: false, edit: false, owner: false }), []);
	});

	test('the copy menu holds Health checks and Rename; Start or Stop, Restart and Logs only below sm', () => {
		const items = copyMenuItems({
			entry: 'web',
			host: 'pi1',
			state: { label: 'Stop', disabledReason: null },
			restart: true,
			logs: true,
			health: { disabledReason: null },
			rename: true,
			label: 'Web'
		});
		assert.deepEqual(
			items.map((item) => [item.label, item.phoneOnly]),
			[
				['Stop web on pi1', true],
				['Restart web on pi1', true],
				['Logs web on pi1', true],
				['Health checks Web', false],
				['Rename Web', false]
			]
		);
		const blocked = copyMenuItems({ entry: 'web', host: 'pi1', state: { label: 'Start', disabledReason: 'Host offline.' }, restart: false, logs: true, health: null, rename: false, label: 'Web' });
		assert.equal(blocked[0]?.disabledReason, 'Host offline.');
		assert.equal(menuOnWide(blocked), false);
	});

	test('an action that does not apply keeps an empty slot, so icons line up', () => {
		const program = programCatalogEntry('api', ['logs'], id(50));
		const html = renderCopies({
			rows: [copy(1, 'api', PI1, 'pi1', { kind: 'systemd', container_name: null, runtime: { state: 'stopped', restarts: null } })],
			entries: [program],
			hosts: HOSTS,
			canAdmin: true
		});
		const entry = html.slice(html.indexOf('data-entry="api"'), html.indexOf('</tr>', html.indexOf('data-entry="api"')));
		// No Deploy for a program: an empty first slot, Edit second, an empty third, then ⋯.
		assert.match(entry, /data-slot-deploy=""><!--[^>]*--><span class="block size-7" aria-hidden="true" data-empty-slot="">/);
		assert.match(entry, /aria-label="Edit api"/);
		const copyAt = html.indexOf(`id="service-${id(1)}"`);
		const row = html.slice(copyAt, html.indexOf('</tr>', copyAt));
		// Stopped, logs only: no Start (no run grant) and no Restart keep their slots; Logs is third.
		assert.match(row, /data-slot-state=""><!--[^>]*--><span class="block size-7" aria-hidden="true" data-empty-slot="">/);
		assert.match(row, /data-slot-restart=""><!--[^>]*--><span class="block size-7" aria-hidden="true" data-empty-slot="">/);
		assert.match(row, /aria-label="Logs api on pi1"/);
		assert.match(row, /data-row-menu="logs health rename"/);
	});

	test('below sm only the 44 px ⋯ menu shows; the host filter is full width above the search', () => {
		const html = renderCopies({ rows: [copy(1, 'web', PI1, 'pi1')], entries: [imageCatalogEntry('web', ['deploy', 'logs'])], hosts: HOSTS, canOwner: true });
		const menu = html.match(/<button\b[^>]*data-row-menu="[^"]*"[^>]*>/)?.[0] ?? '';
		assert.match(menu, /max-sm:size-11/);
		assert.match(html, /data-slot-deploy="" class="max-sm:hidden"|class="max-sm:hidden" data-slot-deploy=""/);
		assert.match(html, /<form class="mb-3 grid min-w-0 basis-full gap-1.5 sm:w-56 sm:basis-auto" method="GET"/);
		assert.match(html, /data-phone-kind/);
		assert.match(html, /data-phone-command/);
	});
});

describe('review round 2: phone summary, two services cells, Kind select, busy table', () => {
	const entries = [imageCatalogEntry('web', ['logs']), imageCatalogEntry('db')];
	const rows = [
		copy(1, 'web', PI1, 'pi1'),
		copy(2, 'db', PI2, 'pi2', { gone_at: '2026-10-14T00:00:00Z' })
	];
	const base = `http://console.example/projects/${PROJECT.id}?tab=catalog&catalog.sort=name&catalog.dir=asc`;

	test('a collapsed entry keeps its worst state visible on the phone line (or a spinner while reading)', () => {
		const html = renderCopies({ rows, entries, hosts: HOSTS, url: base, collapsed: true });
		const db = html.slice(html.indexOf('data-entry="db"'), html.indexOf('</tr>', html.indexOf('data-entry="db"')));
		assert.match(db, /data-phone-summary[\s\S]*1 stopped[\s\S]*1 on pi2/);
		const web = html.slice(html.indexOf('data-entry="web"'), html.indexOf('</tr>', html.indexOf('data-entry="web"')));
		assert.match(web, /data-phone-summary[\s\S]*data-state-loading|data-phone-summary[\s\S]*motion-safe:animate-spin/);
		assert.equal(html.includes(' animate-spin'), false);
	});

	test('the services row has a wide and a narrow cell, each hidden in the other layout, and a busy table', () => {
		const html = renderCopies({ rows, entries, hosts: HOSTS, url: base });
		const start = html.indexOf('data-services-row="web"');
		const row = html.slice(start);
		assert.match(row, /<td colspan="6" class="[^"]*max-sm:hidden" data-services-cell="wide">/);
		assert.match(row, /<td colspan="2" class="[^"]*sm:hidden" data-services-cell="narrow">/);
		// The server renders the table in the wide cell only.
		const wide = row.slice(row.indexOf('data-services-cell="wide"'), row.indexOf('data-services-cell="narrow"'));
		assert.match(wide, /data-services-table/);
		assert.equal(row.slice(row.indexOf('data-services-cell="narrow"')).includes('data-services-table'), false);
		// web's container is still being read: the table says it is busy.
		assert.match(row, /<table[^>]*aria-busy="true"/);
		const db = html.slice(html.indexOf('data-services-row="db"'), start);
		assert.equal(db.includes('aria-busy'), false);
		assert.match(html, /<p class="sr-only" role="status" data-states-note=""><\/p>/);
	});

	test('below sm a Kind select writes catalog.kind; Expand all acts on the entries on view', () => {
		const html = renderCopies({ rows, entries, hosts: HOSTS, url: `${base}&catalog.kind=service`, collapsed: true });
		assert.match(html, /<div class="mb-3 grid min-w-0 basis-full gap-1.5 sm:hidden" data-kind-select="">/);
		assert.match(html, /id="catalog-kind"/);
		assert.match(html, /data-expand-all="true"[^>]*>(?:<!--[^>]*-->|\s)*Expand all/);
		assert.equal(/aria-pressed/.test(html.slice(html.indexOf('data-expand-all') - 400, html.indexOf('data-expand-all'))), false);
		// A search that leaves no entry with services hides the button.
		const none = renderCopies({ rows, entries, hosts: HOSTS, url: `${base}&catalog.q=zzz`, collapsed: true });
		assert.equal(none.includes('data-expand-all'), false);
	});

	test('below sm the copy ⋯ menu can copy the digest (its column hides there)', () => {
		const items = copyMenuItems({ entry: 'web', host: 'pi1', state: null, restart: false, logs: true, health: null, rename: false, label: 'Web', digest: true });
		assert.deepEqual(items.map((item) => [item.key, item.label, item.phoneOnly]), [
			['logs', 'Logs web on pi1', true],
			['digest', 'Copy digest', true]
		]);
		const html = renderCopies({ rows: [copy(1, 'web', PI1, 'pi1', { image_digest: `sha256:${'ab'.repeat(32)}`, runtime: { state: 'running', restarts: 0 } })], entries, hosts: HOSTS, url: base });
		assert.match(html, /data-row-menu="logs digest"/);
		// The phone badge carries the same tooltip details as the Status column.
		const phone = html.slice(html.indexOf('data-phone-status'), html.indexOf('data-phone-detail'));
		assert.match(phone, /aria-describedby/);
		assert.match(phone, /No health check\./);
	});
});
