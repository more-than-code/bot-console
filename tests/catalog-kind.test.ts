import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import type { CatalogEntry, Host, ImageSpec, ProjectServiceRow } from '../src/lib/api-types.ts';
import DataTable from '../src/lib/components/DataTable.svelte';
import { CATALOG_KIND_OPTIONS, catalogKindInfo } from '../src/lib/catalog.ts';
import { serviceKindLabel } from '../src/lib/host-view.ts';
import { filterHref, filterRows, readFilters, type Column } from '../src/lib/table.ts';
import CatalogSection from '../src/routes/projects/[id]/CatalogSection.svelte';
import ServicesSection from '../src/routes/projects/[id]/ServicesSection.svelte';
import { PROJECT, USER } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

const HASH = 'ab'.repeat(32);
const PROGRAM_TIP = 'A program on the host, run as a systemd unit: Run, Stop, Restart, Logs.';
const SERVICE_TIP = 'A long-running container: Deploy creates it from the image; it can have a health check.';
const JOB_TIP = 'A container that runs once to completion: Deploy runs the job.';

function imageSpec(kind: 'service' | 'job'): ImageSpec {
	return {
		kind,
		image: 'ghcr.io/acme/web:1',
		command: null,
		entrypoint: null,
		ports: [],
		env: {},
		env_sets: [],
		secret_env: {},
		volumes: [],
		files: [],
		restart: kind === 'job' ? 'no' : 'unless-stopped',
		user: 'app',
		healthy_after_sec: 30,
		memory_mb: null,
		timeout_sec: 600,
		healthcheck: null,
		logging: null,
		health_policy: null
	};
}

function base(id: string, name: string, command: string) {
	return {
		id: `00000000-0000-4000-8000-0000000000${id}`,
		project_id: PROJECT.id,
		name,
		spec_hash: HASH,
		command_display: command,
		created_by: USER.id,
		created_at: '2026-10-14T00:00:00Z',
		updated_at: '2026-10-14T00:00:00Z',
		my_actions: [] as never[]
	};
}

function image(id: string, name: string, kind: 'service' | 'job'): CatalogEntry {
	return { ...base(id, name, 'ghcr.io/acme/web:1'), kind: 'image', spec: imageSpec(kind) };
}

function program(id: string, name: string): CatalogEntry {
	return {
		...base(id, name, 'npm run dev'),
		kind: 'program',
		spec: { dir: '/srv/app', exec: 'npm', args: ['run', 'dev'], shell: false, run_as: 'joe', env: {}, port: 3031, restart: 'on-failure' }
	};
}

function unknownImage(id: string, name: string): CatalogEntry {
	return { ...base(id, name, 'ghcr.io/acme/web:1'), kind: 'image', spec: { ...imageSpec('service'), kind: 'cron' as never } };
}

// Names avoid the words program, service and job so a kind search only matches the label.
const ENTRIES = [
	image('c1', 'alpha', 'job'),
	program('c2', 'bravo'),
	image('c3', 'charlie', 'service'),
	program('c4', 'delta'),
	unknownImage('c5', 'echo')
];
const ALL = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
const SORTABLE = [
	['name', 'Name'],
	['kind', 'Kind'],
	['command', 'Command'],
	['run_as', 'Run as'],
	['port', 'Port']
] as const;

function section(query = ''): string {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog${query}`);
	return decode(
		render(CatalogSection, {
			props: { canOwner: false, entries: ENTRIES, omitted: 0, truncated: false, message: null, hosts: [], members: [] }
		}).body
	);
}

function decode(html: string): string {
	return html.replaceAll('&amp;', '&').replaceAll('&#39;', "'").replaceAll('&quot;', '"');
}

function tbody(html: string): string {
	const start = html.indexOf('<tbody');
	assert.ok(start >= 0, 'table body rendered');
	return html.slice(start, html.indexOf('</tbody>', start));
}

/** Row names in table order (the first cell of each row). */
function rowNames(html: string): string[] {
	return [...tbody(html).matchAll(/<tr[^>]*>\s*<td class="p-2 align-middle">([^<]+)<\/td>/g)].map((match) => match[1]);
}

/** Header cells: [attributes, inner HTML]. */
function headers(html: string): Array<[string, string]> {
	return [...html.matchAll(/<th(?=[\s>])([^>]*)>([\s\S]*?)<\/th>/g)].map((match) => [match[1], match[2]]);
}

function classOf(attrs: string): string {
	return attrs.match(/class="([^"]*)"/)?.[1] ?? '';
}

/** The opening tag of the filter trigger (the no-JS <summary>). */
function trigger(html: string): string {
	const tag = html.match(/<summary\b[^>]*>/)?.[0];
	assert.ok(tag, 'filter trigger');
	return tag;
}

/** The funnel icon's opening tag inside the trigger. */
function funnel(html: string): string {
	const tag = html.match(/<svg[^>]*lucide-funnel[^>]*>/)?.[0];
	assert.ok(tag, 'funnel icon');
	return tag;
}

test('catalog kind labels: program, image service, image job, and an unknown value', () => {
	assert.deepEqual(catalogKindInfo(program('a1', 'a')), { kind: 'program', label: 'Program', tip: PROGRAM_TIP, order: 0 });
	assert.deepEqual(catalogKindInfo(image('a2', 'b', 'service')), { kind: 'service', label: 'Service', tip: SERVICE_TIP, order: 1 });
	assert.deepEqual(catalogKindInfo(image('a3', 'c', 'job')), { kind: 'job', label: 'Job', tip: JOB_TIP, order: 2 });
	assert.deepEqual(catalogKindInfo({ kind: 'widget' }), { kind: 'widget', label: 'widget', tip: '', order: 3 });
	assert.deepEqual(catalogKindInfo({ kind: 'image', spec: { kind: 'cron' } }), { kind: 'cron', label: 'cron', tip: '', order: 3 });
	assert.equal(catalogKindInfo({ kind: 'constructor' }).label, 'constructor');
	assert.deepEqual(CATALOG_KIND_OPTIONS, [
		{ value: 'program', label: 'Programs' },
		{ value: 'service', label: 'Services' },
		{ value: 'job', label: 'Jobs' }
	]);
});

function host(): Host {
	return {
		id: '00000000-0000-4000-8000-0000000000aa',
		project_id: PROJECT.id,
		name: 'pi1',
		node_type: 'pi',
		os: 'linux',
		arch: 'arm64',
		always_on: true,
		agent_version: '1.2.0',
		status: 'online',
		last_seen_at: '2026-10-14T00:00:00Z',
		enrolled_at: '2026-10-13T00:00:00Z',
		revoked_at: null,
		relation: 'owner',
		share_level: null,
		programs: null
	} as Host;
}

function serviceRow(index: number, kind: string): ProjectServiceRow {
	return {
		id: `00000000-0000-4000-8000-00000000010${index}`,
		name: `svc${index}`,
		source: 'owned',
		kind: kind as ProjectServiceRow['kind'],
		ports: [3030 + index],
		health: null,
		last_seen_at: null,
		gone_at: null,
		display_name: null,
		owner_user: 'joe',
		project_id: PROJECT.id,
		host_id: host().id,
		host_name: 'pi1',
		host_status: 'online',
		project_name: 'Lab',
		catalog_entry: null,
		checks: [],
		checksMessage: null,
		container_name: null,
		image_digest: null
	};
}

test('services kind labels are readable; unknown values show as returned', () => {
	assert.equal(serviceKindLabel('container'), 'Container');
	assert.equal(serviceKindLabel('systemd'), 'systemd unit');
	assert.equal(serviceKindLabel('process'), 'Process');
	assert.equal(serviceKindLabel('socket'), 'socket');
	assert.equal(serviceKindLabel('toString'), 'toString');

	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=services`);
	const kinds = ['container', 'systemd', 'process', 'socket'];
	const html = decode(
		render(ServicesSection, {
			props: {
				projectId: PROJECT.id,
				projectName: 'Lab',
				hosts: [host()],
				canAdmin: false,
				rows: kinds.map((kind, index) => serviceRow(index, kind)),
				total: kinds.length,
				prevCursor: null,
				nextCursor: null,
				omitted: 0,
				message: null,
				probe: null,
				probeServiceId: null,
				renameServiceId: null,
				typedName: null
			}
		}).body
	);
	const kindIndex = headers(html).findIndex(([, inner]) => />Kind</.test(inner));
	assert.ok(kindIndex >= 0, 'Kind header');
	const rows = [...tbody(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((match) => match[1]);
	const cells = rows.map((row) => {
		const tds = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)];
		return tds[kindIndex]?.[1];
	});
	assert.deepEqual(cells, ['Container', 'systemd unit', 'Process', 'socket']);
});

test('table filter helpers read, apply, set and clear a namespaced param', () => {
	type Row = { name: string; kind: string };
	const columns: Column<Row>[] = [
		{ key: 'name', label: 'Name' },
		{
			key: 'kind',
			label: 'Kind',
			filter: { param: 'kind', label: 'Kind', options: [{ value: 'a', label: 'As' }, { value: 'b', label: 'Bs' }], value: (row) => row.kind }
		}
	];
	const rows: Row[] = [{ name: 'x', kind: 'a' }, { name: 'y', kind: 'b' }, { name: 'z', kind: 'a' }];
	const active = readFilters(new URLSearchParams('t.kind=a'), 't', columns);
	assert.deepEqual(active, [{ column: 'kind', param: 'kind', value: 'a', label: 'As' }]);
	assert.deepEqual(filterRows(rows, columns, active).map((row) => row.name), ['x', 'z']);
	assert.deepEqual(readFilters(new URLSearchParams('t.kind=nope'), 't', columns), []);
	assert.deepEqual(readFilters(new URLSearchParams('kind=a&other.kind=a'), 't', columns), []);
	assert.equal(filterRows(rows, columns, []).length, 3);

	const url = new URL('http://console.example/p?tab=catalog&t.page=3&t.q=x&other.page=2');
	assert.equal(filterHref(url, 't', 'kind', 'b'), '/p?tab=catalog&t.q=x&other.page=2&t.kind=b');
	const filtered = new URL('http://console.example/p?tab=catalog&t.kind=b&t.page=2');
	assert.equal(filterHref(filtered, 't', 'kind', null), '/p?tab=catalog');
});

test('catalog has a Kind column after Name with a badge, tooltip and accessible description', () => {
	const html = section();
	const heads = headers(html);
	assert.equal(heads.length, 6);
	assert.match(heads[0][1], /Name/);
	assert.match(heads[1][1], /Kind/);
	assert.match(heads[2][1], /Command/);
	for (const [label, tip] of [
		['Program', PROGRAM_TIP],
		['Service', SERVICE_TIP],
		['Job', JOB_TIP]
	]) {
		assert.ok(html.includes(`title="${tip}"`), `${label} title`);
		assert.ok(html.includes(`${label}<span class="sr-only">: ${tip}</span>`), `${label} accessible text`);
	}
	assert.equal((html.match(/data-kind="program"/g) ?? []).length, 2);
	assert.equal((html.match(/data-kind="service"/g) ?? []).length, 1);
	assert.equal((html.match(/data-kind="job"/g) ?? []).length, 1);
	// An unknown kind shows as returned, with no tooltip and no description.
	const unknown = html.match(/<span data-kind="cron">[\s\S]*?<\/td>/)?.[0];
	assert.ok(unknown, 'unknown kind cell');
	assert.doesNotMatch(unknown, /title=|sr-only/);
	assert.match(unknown, />cron</);
	assert.match(html, /placeholder="Search name, kind or command"/);
});

test('catalog Kind sorts Program, Service, Job, unknown, then by name', () => {
	assert.deepEqual(rowNames(section('&catalog.sort=kind&catalog.dir=asc')), ['bravo', 'delta', 'charlie', 'alpha', 'echo']);
	assert.deepEqual(rowNames(section('&catalog.sort=kind&catalog.dir=desc')), ['echo', 'alpha', 'charlie', 'delta', 'bravo']);
});

test('catalog search matches the kind label, name and command, case-insensitively', () => {
	assert.deepEqual(rowNames(section('&catalog.q=job')), ['alpha']);
	assert.deepEqual(rowNames(section('&catalog.q=JOB')), ['alpha']);
	assert.deepEqual(rowNames(section('&catalog.q=program')), ['bravo', 'delta']);
	assert.deepEqual(rowNames(section('&catalog.q=service')), ['charlie']);
	assert.deepEqual(rowNames(section('&catalog.q=Delta')), ['delta']);
	assert.deepEqual(rowNames(section('&catalog.q=npm')), ['bravo', 'delta']);
	assert.deepEqual(rowNames(section('&catalog.q=cron')), ['echo']);
});

test('catalog Kind filter: button name, menu links, current option, chip, and URL state', () => {
	const plain = section('&catalog.page=1');
	assert.match(trigger(plain), /aria-label="Filter Kind"/);
	assert.doesNotMatch(plain, /Filtered:/);
	// Before hydration the menu is plain links, so it works without JavaScript; the list is in flow.
	assert.match(plain, /<details class="inline-block">/);
	const list = plain.match(/<summary[\s\S]*?<\/summary>\s*(?:<!--[^>]*-->\s*)*<ul class="([^"]*)"/);
	assert.ok(list, 'options list');
	assert.doesNotMatch(list[1], /absolute|fixed/);
	const links = [...plain.matchAll(/<a class="[^"]*" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
		.filter((match) => /lucide-check/.test(match[2]))
		.map((match) => ({ href: match[1], html: match[2], text: match[2].replace(/<[^>]+>/g, '').trim() }));
	assert.deepEqual(
		links.map((link) => [link.text, link.href]),
		[
			['All (current)', `/projects/${PROJECT.id}?tab=catalog`],
			['Programs', `/projects/${PROJECT.id}?tab=catalog&catalog.kind=program`],
			['Services', `/projects/${PROJECT.id}?tab=catalog&catalog.kind=service`],
			['Jobs', `/projects/${PROJECT.id}?tab=catalog&catalog.kind=job`]
		]
	);
	// The current option has a visible, aria-hidden check; the others keep the space with an invisible one.
	assert.match(links[0].html, /<svg[^>]*class="[^"]*lucide-check(?![^"]*invisible)[^"]*"[^>]*aria-hidden="true"/);
	for (const link of links.slice(1)) assert.match(link.html, /<svg[^>]*class="[^"]*lucide-check[^"]*invisible[^"]*"[^>]*aria-hidden="true"/);
	assert.deepEqual(rowNames(plain), ALL);

	const jobs = section('&catalog.kind=job');
	assert.deepEqual(rowNames(jobs), ['alpha']);
	assert.match(trigger(jobs), /aria-label="Filter Kind: Jobs"/);
	assert.match(jobs, /aria-current="true">[\s\S]*?Jobs(?:<!--[^>]*-->)*<span class="sr-only"> \(current\)<\/span>/);
	const chip = jobs.match(/<a href="([^"]+)" class="([^"]*)">Filtered: Jobs<span class="sr-only"> \(clear filter\)<\/span>/);
	assert.ok(chip, 'clearable chip');
	assert.equal(chip[1], `/projects/${PROJECT.id}?tab=catalog`);
	assert.match(chip[2], /outline-none/);
	assert.match(chip[2], /focus-visible:ring-3/);
	assert.match(chip[2], /focus-visible:ring-ring\/50/);
	// The chip sits in the search form, beside the field, and the form keeps the filter.
	const form = jobs.slice(jobs.indexOf('role="search"'), jobs.indexOf('</form>'));
	assert.ok(form.includes('Filtered: Jobs'));
	assert.match(form, /type="hidden" value="job" name="catalog.kind"/);

	// Each option excludes the unknown kind; All and an unrecognised value show every row.
	assert.deepEqual(rowNames(section('&catalog.kind=program')), ['bravo', 'delta']);
	assert.deepEqual(rowNames(section('&catalog.kind=service')), ['charlie']);
	const unknown = section('&catalog.kind=cron');
	assert.deepEqual(rowNames(unknown), ALL);
	assert.match(trigger(unknown), /aria-label="Filter Kind"/);
	assert.doesNotMatch(unknown, /Filtered:/);
});

test('filter trigger contrast: muted and outlined when inactive, primary and filled when active', () => {
	const off = section();
	assert.match(trigger(off), /text-muted-foreground/);
	assert.doesNotMatch(trigger(off), /text-primary/);
	assert.doesNotMatch(funnel(off), /fill-current/);
	assert.match(funnel(off), /aria-hidden="true"/);
	const on = section('&catalog.kind=service');
	assert.match(trigger(on), /text-primary/);
	assert.doesNotMatch(trigger(on), /text-muted-foreground/);
	assert.match(funnel(on), /fill-current/);
});

test('filter works with sort and search, and sort links keep the filter and drop the page', () => {
	assert.deepEqual(rowNames(section('&catalog.kind=program&catalog.sort=name&catalog.dir=desc')), ['delta', 'bravo']);
	assert.deepEqual(rowNames(section('&catalog.kind=program&catalog.q=delta')), ['delta']);
	const html = section('&catalog.kind=job&catalog.page=2');
	const hrefs = headers(html).flatMap(([, inner]) => [...inner.matchAll(/aria-label="Sort[^"]*"|href="([^"]+)"[^>]*aria-label="Sort/g)].map((m) => m[1]).filter(Boolean));
	assert.equal(hrefs.length, 5);
	for (const href of hrefs) {
		assert.ok(href.includes('catalog.kind=job'), href);
		assert.equal(href.includes('catalog.page'), false, href);
	}
});

test('zero matches with a filter keep the header and offer Clear filter; without a filter the empty text stays', () => {
	const none = section('&catalog.kind=job&catalog.q=bravo');
	assert.equal(headers(none).length, 6);
	assert.match(trigger(none), /aria-label="Filter Kind: Jobs"/);
	const body = tbody(none);
	assert.match(body, /<td[^>]*colspan="6"[^>]*>[\s\S]*No entries match this filter\./);
	const clear = body.match(/<a [^>]*href="([^"]+)"[^>]*>Clear filter<\/a>/);
	assert.ok(clear, 'Clear filter link');
	assert.equal(clear[1], `/projects/${PROJECT.id}?tab=catalog&catalog.q=bravo`);
	assert.doesNotMatch(none, /No catalog entries\./);

	const empty = section('&catalog.q=zzz');
	assert.match(empty, /No catalog entries\./);
	assert.doesNotMatch(empty, /No entries match this filter/);
	assert.doesNotMatch(empty, /<table/);
});

test('every sortable header shows the right aria-hidden icon, aria-sort and name in asc and desc', () => {
	const unsorted = headers(section());
	for (const [index, [, label]] of SORTABLE.entries()) {
		const [attrs, inner] = unsorted[index];
		assert.match(attrs, /aria-sort="none"/, label);
		assert.match(inner, new RegExp(`aria-label="Sort by ${label}"`));
		assert.match(inner, /<svg[^>]*class="[^"]*lucide-arrow-up-down[^"]*text-muted-foreground[^"]*"[^>]*aria-hidden="true"/, label);
	}
	assert.doesNotMatch(unsorted[5][1], /<svg|aria-label="Sort/);
	assert.equal(unsorted[5][0].includes('aria-sort'), false);

	for (const dir of ['asc', 'desc'] as const) {
		for (const [activeIndex, [key, activeLabel]] of SORTABLE.entries()) {
			const heads = headers(section(`&catalog.sort=${key}&catalog.dir=${dir}`));
			for (const [index, [, label]] of SORTABLE.entries()) {
				const [attrs, inner] = heads[index];
				for (const svg of inner.match(/<svg[^>]*>/g) ?? []) assert.match(svg, /aria-hidden="true"/);
				if (index === activeIndex) {
					assert.match(attrs, new RegExp(`aria-sort="${dir === 'asc' ? 'ascending' : 'descending'}"`), `${activeLabel} ${dir}`);
					assert.match(inner, new RegExp(`aria-label="Sorted by ${label}"`));
					const icon = inner.match(new RegExp(`<svg[^>]*lucide-arrow-${dir === 'asc' ? 'up' : 'down'}\\b[^>]*>`))?.[0];
					assert.ok(icon, `${label} ${dir} icon`);
					assert.doesNotMatch(icon, /text-muted-foreground|lucide-arrow-up-down/);
				} else {
					assert.match(attrs, /aria-sort="none"/);
					assert.match(inner, new RegExp(`aria-label="Sort by ${label}"`));
					assert.match(inner, /lucide-arrow-up-down[^"]*text-muted-foreground/);
				}
			}
		}
	}
});

test('Run as and Port are hidden below sm on the header and every cell; no other column is', () => {
	const html = section();
	const heads = headers(html).map(([attrs]) => classOf(attrs));
	const hidden = new Set([3, 4]);
	for (const [index, cls] of heads.entries()) {
		if (hidden.has(index)) assert.match(cls, /(^|\s)max-sm:hidden(\s|$)/, `th ${index}`);
		else assert.doesNotMatch(cls, /max-sm:/, `th ${index}`);
	}
	assert.doesNotMatch(html, /max-sm:sr-only/);
	const rows = [...tbody(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((match) => match[1]);
	assert.equal(rows.length, 5);
	for (const row of rows) {
		const cells = [...row.matchAll(/<td\b([^>]*)>/g)].map((match) => classOf(match[1]));
		assert.equal(cells.length, 6);
		for (const [index, cls] of cells.entries()) {
			if (hidden.has(index)) assert.match(cls, /(^|\s)max-sm:hidden(\s|$)/, `td ${index}`);
			else assert.doesNotMatch(cls, /max-sm:/, `td ${index}`);
		}
	}
	// Below sm the actions are a grid of at most four per line.
	assert.match(html, /<fieldset[^>]*class="[^"]*max-sm:grid max-sm:grid-cols-\[repeat\(4,max-content\)\]/);
});

type Item = { name: string; size: number; kind: string };
const ITEMS: Item[] = [
	{ name: 'a', size: 2, kind: 'x' },
	{ name: 'b', size: 1, kind: 'y' }
];
const ITEM_COLUMNS: Column<Item>[] = [
	{ key: 'name', label: 'Name', sortable: true, searchable: true, value: (row) => row.name },
	{ key: 'size', label: 'Size', numeric: true, sortable: true, value: (row) => row.size },
	{
		key: 'kind',
		label: 'Kind',
		sortable: true,
		value: (row) => row.kind,
		filter: { param: 'kind', label: 'Kind', options: [{ value: 'x', label: 'Xs' }], value: (row) => row.kind }
	}
];
const itemRow = createRawSnippet((item: () => Item) => ({
	render: () => `<tr><td class="p-2 align-middle">${item().name}</td><td>${item().size}</td><td>${item().kind}</td></tr>`
}));

function table(query: string, columns: Column<Item>[], server = false): string {
	setPageUrl(`http://console.example/list?${query}`);
	return decode(
		render(DataTable<Item>, {
			props: {
				rows: ITEMS,
				columns,
				id: 't',
				labelledBy: 'h',
				empty: 'Nothing.',
				row: itemRow,
				...(server ? { server: { total: 2, prevCursor: null, nextCursor: null } } : {})
			}
		}).body
	);
}

test('DataTable server mode: no filter control or chip, icons follow the server sort', () => {
	const html = table('t.kind=x&t.sort=size&t.dir=desc', ITEM_COLUMNS, true);
	assert.doesNotMatch(html, /<details|lucide-funnel|Filter Kind|Filtered:/);
	assert.deepEqual(rowNames(html), ['a', 'b']);
	const heads = headers(html);
	assert.match(heads[1][0], /aria-sort="descending"/);
	assert.match(heads[1][1], /lucide-arrow-down\b/);
	assert.match(heads[0][1], /lucide-arrow-up-down/);
	assert.match(heads[2][1], /lucide-arrow-up-down/);
});

test('DataTable plain client table: no menu or chip; numeric headers stay right-aligned with -mr-2', () => {
	const plain = ITEM_COLUMNS.map(({ filter: _filter, ...column }) => column);
	// A filter param in the URL is ignored when no column declares a filter.
	const html = table('t.sort=name&t.kind=x', plain);
	assert.doesNotMatch(html, /<details|lucide-funnel|Filtered:/);
	assert.deepEqual(rowNames(html), ['a', 'b']);
	const heads = headers(html);
	assert.match(classOf(heads[1][0]), /text-right/);
	const sizeLink = heads[1][1].match(/<a [^>]*class="([^"]*)"/)?.[1] ?? '';
	assert.match(sizeLink, /(^|\s)-mr-2(\s|$)/);
	assert.doesNotMatch(sizeLink, /-ml-2/);
	const nameLink = heads[0][1].match(/<a [^>]*class="([^"]*)"/)?.[1] ?? '';
	assert.match(nameLink, /(^|\s)-ml-2(\s|$)/);
	assert.doesNotMatch(classOf(heads[0][0]), /text-right/);
});
