import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Host, ProjectServiceRow } from '../src/lib/api-types.ts';
import { byHostName, catalogEmptyText, catalogRows, copySearchText, groupCopies, rowsOnHost } from '../src/lib/catalog-copies.ts';
import type { NotRunningPair } from '../src/lib/service-actions.ts';
import { servicesTabTarget } from '../src/lib/url.ts';
import { copyHost, copyRow, imageCatalogEntry, programCatalogEntry, renderCopies } from './copies.ts';
import { PROJECT } from './harness.ts';
import { render } from 'svelte/server';
import DockerHealthNote from '../src/routes/projects/[id]/DockerHealthNote.svelte';
import ProcessesTab from '../src/routes/hosts/[id]/ProcessesTab.svelte';

const PI1 = '00000000-0000-4000-8000-0000000000a1';
const PI2 = '00000000-0000-4000-8000-0000000000a2';
const HK = '00000000-0000-4000-8000-0000000000a3';
const OTHER_PROJECT = '00000000-0000-4000-8000-000000000099';

function id(n: number): string {
	return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function copy(n: number, entry: string, hostId: string, hostName: string, overrides: Partial<ProjectServiceRow> = {}): ProjectServiceRow {
	return copyRow({ id: id(n), catalog_entry: entry, name: entry, host_id: hostId, host_name: hostName, display_name: null, container_name: `${entry}-${hostName}`, ...overrides });
}

const HOSTS: Host[] = [copyHost({ id: PI1, name: 'pi1' }), copyHost({ id: PI2, name: 'pi2' }), copyHost({ id: HK, name: 'hk-ecs' })];

/** Entry names in table order, from the entry rows. */
function entryNames(html: string): string[] {
	return [...html.matchAll(/<tr data-entry="([^"]+)"/g)].map((match) => match[1] ?? '');
}

/** Copy rows in order, as "<entry> <host id>". */
function copyKeys(html: string): string[] {
	return [...html.matchAll(/data-copy="([^"]+)"/g)].map((match) => match[1] ?? '');
}

describe('grouping copies under their entries', () => {
	test('only owned rows of this project that name a listed entry are copies, in host-name order', () => {
		const rows = [
			copy(1, 'web', PI2, 'pi2'),
			copy(2, 'web', HK, 'hk-ecs'),
			copy(3, 'web', PI1, 'pi1', { source: 'discovered', catalog_entry: null }),
			copy(4, 'web', PI1, 'pi1', { project_id: OTHER_PROJECT, project_name: 'Other' }),
			copy(5, 'web', PI1, 'pi1', { source: 'declared' }),
			copy(6, 'unlisted', PI1, 'pi1'),
			copy(7, 'api', PI1, 'pi1', { gone_at: '2026-10-14T00:00:00Z' })
		];
		const groups = groupCopies(rows, PROJECT.id, [{ name: 'web' }, { name: 'api' }]);
		assert.deepEqual(Object.keys(groups).sort(), ['api', 'web']);
		assert.deepEqual(groups.web?.map((row) => row.host_name), ['hk-ecs', 'pi2']);
		// A stopped (gone) copy stays a copy.
		assert.deepEqual(groups.api?.map((row) => row.id), [id(7)]);
	});

	test('host names sort without case first, then exactly', () => {
		const rows = [copy(1, 'web', PI1, 'pi2'), copy(2, 'web', PI2, 'Pi1'), copy(3, 'web', HK, 'pi1'), copy(4, 'web', id(9), 'HK')];
		const groups = groupCopies(rows, PROJECT.id, [{ name: 'web' }]);
		assert.deepEqual(groups.web?.map((row) => row.host_name), ['HK', 'Pi1', 'pi1', 'pi2']);
		assert.ok(byHostName('alpha', 'Beta') < 0);
		assert.ok(byHostName('Beta', 'alpha') > 0);
		assert.equal(byHostName('pi1', 'pi1'), 0);
	});

	test('each entry gets its copies and the hosts it never ran on; the entries keep their order', () => {
		const entries = [programCatalogEntry('api', ['run']), imageCatalogEntry('web')];
		const ref = { name: 'api', kind: 'program' as const, my_actions: ['run' as const], runAs: 'joe', shell: false };
		const notRunning: NotRunningPair[] = [
			{ entry: ref, host: HOSTS[1] as Host },
			{ entry: ref, host: HOSTS[2] as Host }
		];
		const rows = catalogRows(entries, groupCopies([copy(1, 'api', PI1, 'pi1')], PROJECT.id, entries), notRunning);
		assert.deepEqual(rows.map((row) => row.entry.name), ['api', 'web']);
		assert.deepEqual(rows[0]?.copies.map((row) => row.id), [id(1)]);
		assert.deepEqual(rows[0]?.idle.map((host) => host.name), ['hk-ecs', 'pi2']);
		assert.deepEqual(rows[1]?.copies, []);
		assert.deepEqual(rows[1]?.idle, []);
	});

	test('a host keeps only what runs there and hides entries with nothing there', () => {
		const entries = [imageCatalogEntry('web'), imageCatalogEntry('db'), programCatalogEntry('api', ['run'])];
		const ref = { name: 'api', kind: 'program' as const, my_actions: ['run' as const], runAs: 'joe', shell: false };
		const rows = catalogRows(
			entries,
			groupCopies([copy(1, 'web', PI1, 'pi1'), copy(2, 'web', PI2, 'pi2'), copy(3, 'db', PI2, 'pi2')], PROJECT.id, entries),
			[{ entry: ref, host: HOSTS[0] as Host }]
		);
		const onPi1 = rowsOnHost(rows, PI1);
		assert.deepEqual(onPi1.map((row) => row.entry.name), ['web', 'api']);
		assert.deepEqual(onPi1[0]?.copies.map((row) => row.host_id), [PI1]);
		assert.deepEqual(onPi1[1]?.idle.map((host) => host.id), [PI1]);
		assert.deepEqual(rowsOnHost(rows, HK), []);
		assert.equal(rowsOnHost(rows, null).length, 3);
	});

	test('the search text of a row is its copies\' hosts and labels', () => {
		const entries = [imageCatalogEntry('web')];
		const rows = catalogRows(entries, groupCopies([copy(1, 'web', PI1, 'pi1', { display_name: 'Front' })], PROJECT.id, entries), []);
		assert.equal(copySearchText(rows[0]!), 'pi1\nFront');
	});
});

describe('the Catalog & services table', () => {
	const entries = [imageCatalogEntry('web'), imageCatalogEntry('db'), imageCatalogEntry('cache')];
	const rows = [copy(1, 'web', PI2, 'pi2'), copy(2, 'web', PI1, 'pi1', { display_name: 'Front door' }), copy(3, 'db', PI2, 'pi2')];
	const base = `http://console.example/projects/${PROJECT.id}?tab=catalog&catalog.sort=name&catalog.dir=asc`;

	function view(query = ''): string {
		return renderCopies({ rows, entries, hosts: HOSTS, url: `${base}${query}` });
	}

	test('copies sit under their entry in host-name order; an image with none says Not deployed and has no arrow', () => {
		const html = view();
		assert.deepEqual(entryNames(html), ['cache', 'db', 'web']);
		assert.deepEqual(copyKeys(html), [`db ${PI2}`, `web ${PI1}`, `web ${PI2}`]);
		const cache = html.slice(html.indexOf('data-entry="cache"'), html.indexOf('</tr>', html.indexOf('data-entry="cache"')));
		assert.match(cache, /Not deployed(?! yet)/);
		assert.equal(cache.includes('data-toggle'), false);
		assert.equal(html.includes('Not deployed yet.'), false);
		// A nested table under each entry, no tree marks.
		assert.equal(/[├└]/.test(html), false);
		assert.equal([...html.matchAll(/data-services-table/g)].length, 2);
	});

	test('search matches an entry field, or a copy host or label, and shows the entry with all its copies', () => {
		const byLabel = view('&catalog.q=front');
		assert.deepEqual(entryNames(byLabel), ['web']);
		assert.deepEqual(copyKeys(byLabel), [`web ${PI1}`, `web ${PI2}`]);
		const byHost = view('&catalog.q=pi2');
		assert.deepEqual(entryNames(byHost), ['db', 'web']);
		assert.deepEqual(copyKeys(byHost), [`db ${PI2}`, `web ${PI1}`, `web ${PI2}`]);
		const byName = view('&catalog.q=cache');
		assert.deepEqual(entryNames(byName), ['cache']);
		assert.deepEqual(entryNames(view('&catalog.q=nothing-here')), []);
	});

	test('the host filter narrows copies, hides entries with nothing there, and ignores an unknown host with a notice', () => {
		const pi1 = view(`&catalog.host=${PI1}`);
		assert.deepEqual(entryNames(pi1), ['web']);
		assert.deepEqual(copyKeys(pi1), [`web ${PI1}`]);
		assert.equal(pi1.includes('Not deployed yet.'), false);
		const empty = view(`&catalog.host=${HK}`);
		assert.deepEqual(entryNames(empty), []);
		assert.equal(empty.includes('Nothing in the catalog runs on this host.'), true);
		const unknown = view(`&catalog.host=${OTHER_PROJECT}`);
		assert.deepEqual(entryNames(unknown), ['cache', 'db', 'web']);
		assert.match(unknown, /role="alert"[\s\S]*That host is not available for this project\./);
	});

	test('the empty text names the host only for a host filter alone', () => {
		const base = { hostChosen: true, searching: false, kindFiltered: false, entries: 3 };
		assert.equal(catalogEmptyText(base), 'Nothing in the catalog runs on this host.');
		assert.equal(catalogEmptyText({ ...base, searching: true }), 'No catalog entries.');
		assert.equal(catalogEmptyText({ ...base, kindFiltered: true }), 'No catalog entries.');
		assert.equal(catalogEmptyText({ ...base, hostChosen: false }), 'No catalog entries.');
		assert.equal(catalogEmptyText({ ...base, entries: 0 }), 'No catalog entries.');
		const searched = view(`&catalog.host=${HK}&catalog.q=web`);
		assert.equal(searched.includes('Nothing in the catalog runs on this host.'), false);
		assert.equal(searched.includes('No catalog entries.'), true);
	});

	test('a copy row tells screen readers its entry, host, status and label', () => {
		const html = view();
		const at = html.indexOf(`data-copy="web ${PI1}"`);
		const row = html.slice(at, html.indexOf('</tr>', at));
		assert.match(row, /<span class="sr-only">Copy of web on <\/span>\s*<a[^>]*>pi1<\/a>/);
		assert.match(row, /<span class="sr-only">Label <\/span>/);
		// The nested table has a real header, so each cell is read with its column name.
		const table = html.slice(html.lastIndexOf('<table', at), at);
		assert.match(table, /<table[^>]*aria-label="Services of web"/);
		for (const name of ['Host', 'Status', 'Port', 'Digest', 'Uptime']) assert.match(table, new RegExp(`<th[^>]*>(?:<!--[^>]*-->)*${name}(?:<!--[^>]*-->)*</th>`));
		// The visible text is unchanged.
		assert.match(row, />Front door</);
	});

	test('a Kind filter keeps the matching entries with all their copies', () => {
		const mixed = [...entries, programCatalogEntry('api')];
		const rows2 = [...rows, copy(9, 'api', PI1, 'pi1', { kind: 'systemd', container_name: null })];
		const services = renderCopies({ rows: rows2, entries: mixed, hosts: HOSTS, url: `${base}&catalog.kind=service` });
		assert.deepEqual(entryNames(services), ['cache', 'db', 'web']);
		assert.deepEqual(copyKeys(services), [`db ${PI2}`, `web ${PI1}`, `web ${PI2}`]);
		const programs = renderCopies({ rows: rows2, entries: mixed, hosts: HOSTS, url: `${base}&catalog.kind=program` });
		assert.deepEqual(entryNames(programs), ['api']);
		assert.deepEqual(copyKeys(programs), [`api ${PI1}`]);
	});

	test('the Kind filter and sort apply to entries; copies stay with their entry', () => {
		const desc = renderCopies({ rows, entries, hosts: HOSTS, url: `http://console.example/projects/${PROJECT.id}?tab=catalog&catalog.sort=name&catalog.dir=desc` });
		assert.deepEqual(entryNames(desc), ['web', 'db', 'cache']);
		assert.deepEqual(copyKeys(desc), [`web ${PI1}`, `web ${PI2}`, `db ${PI2}`]);
		const programs = view('&catalog.kind=program');
		assert.deepEqual(entryNames(programs), []);
		assert.deepEqual(copyKeys(programs), []);
	});

	test('paging is 25 entries a page and never splits an entry\'s copies', () => {
		const many = Array.from({ length: 26 }, (_, n) => imageCatalogEntry(`e${String(n).padStart(2, '0')}`));
		const copies = many.flatMap((entry, n) => [copy(100 + n * 2, entry.name, PI1, 'pi1'), copy(101 + n * 2, entry.name, PI2, 'pi2')]);
		const page = (n: number) => renderCopies({ rows: copies, entries: many, hosts: HOSTS, url: `${base}${n > 1 ? `&catalog.page=${n}` : ''}` });
		const first = page(1);
		assert.equal(entryNames(first).length, 25);
		assert.equal(copyKeys(first).length, 50);
		assert.match(first, /Showing 1–25 of 26/);
		const second = page(2);
		assert.deepEqual(entryNames(second), ['e25']);
		assert.deepEqual(copyKeys(second), [`e25 ${PI1}`, `e25 ${PI2}`]);
	});
});

describe('old Services tab links', () => {
	test('tab=services maps its search, host and logs params and drops sort, cursor and show', () => {
		const url = new URL(
			`http://console.example/projects/p?tab=services&services.q=api&services.host=${PI1}&services.sort=status&services.dir=desc&services.cursor=abc&show=all&services.logs=api&catalog.kind=service`
		);
		assert.equal(
			servicesTabTarget(url),
			`/projects/p?tab=catalog&catalog.kind=service&catalog.q=api&catalog.host=${PI1}&catalog.logs=api`
		);
		assert.equal(servicesTabTarget(new URL('http://console.example/projects/p?tab=services')), '/projects/p?tab=catalog');
		// A catalog param already in the link wins over the old one.
		assert.equal(
			servicesTabTarget(new URL('http://console.example/projects/p?tab=services&catalog.q=web&services.q=api')),
			'/projects/p?tab=catalog&catalog.q=web'
		);
		assert.equal(servicesTabTarget(new URL('http://console.example/projects/p?tab=catalog&services.q=api')), null);
		// The old page number is dropped; a logs request without its host is dropped too.
		assert.equal(
			servicesTabTarget(new URL('http://console.example/projects/p?tab=services&services.page=3&services.q=api&services.logs=api')),
			'/projects/p?tab=catalog&catalog.q=api'
		);
		assert.equal(servicesTabTarget(new URL('http://console.example/projects/p')), null);
	});
});

describe('links into the status-reading tab', () => {
	test('the Docker health check link and process service links do not preload on hover', () => {
		const note = render(DockerHealthNote, { props: { dockerCheck: null, catalogEntry: 'web' } }).body;
		assert.match(note, /<a[^>]*data-sveltekit-preload-data="off"[^>]*>Edit the Docker health check<\/a>/);
		const href = `/projects/${PROJECT.id}?tab=catalog&catalog.host=${PI1}&catalog.q=web`;
		const processes = render(ProcessesTab, {
			props: {
				sort: 'cpu',
				processes: {
					sampled_at: '2026-10-14T00:00:00Z',
					skipped: 0,
					items: [{ pid: 3, process_name: 'node', user: 'bot', cmdline: 'node', service_id: id(1), cpu_usage: 1, memory_rss: 1, memory_usage: 1, num_threads: 1, started_at: '2026-10-14T00:00:00Z' }]
				},
				message: null,
				serviceLinks: { [id(1)]: { label: 'web', href } }
			}
		}).body.replaceAll('&amp;', '&');
		assert.match(processes, new RegExp(`<a[^>]*href="${href.replace(/[.?]/g, '\\$&')}"[^>]*data-sveltekit-preload-data="off"`));
	});
});
