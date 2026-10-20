import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { render } from 'svelte/server';
import type { Host, ProjectServiceRow } from '../src/lib/api-types.ts';
import { serviceDomId } from '../src/lib/host-view.ts';
import {
	SERVICE_SHOW_LABEL,
	discoveredListenersHref,
	serviceRowStatus,
	serviceShow,
	showDeploybotEmpty
} from '../src/lib/service-view.ts';
import { serverSearchHiddenFields, serverSortHref, serverTableHref } from '../src/lib/table.ts';
import ServicesSection from '../src/routes/projects/[id]/ServicesSection.svelte';
import { PROJECT } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

const HOST_ID = '00000000-0000-4000-8000-0000000000aa';
const OWNED = '00000000-0000-4000-8000-0000000000b1';
const DECLARED = '00000000-0000-4000-8000-0000000000b2';
const DISCOVERED = '00000000-0000-4000-8000-0000000000b3';
const PRESENT = '00000000-0000-4000-8000-0000000000b4';
const GONE = '2026-10-15T14:00:00Z';

const HOST: Host = {
	id: HOST_ID,
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
};

function row(id: string, source: ProjectServiceRow['source'], goneAt: string | null, status: 'up' | 'down'): ProjectServiceRow {
	return {
		id,
		name: source,
		source,
		kind: 'process',
		ports: [80],
		health: { status, last_checked_at: null, latency_ms: 1, source: null },
		last_seen_at: GONE,
		gone_at: goneAt,
		display_name: null,
		owner_user: null,
		project_id: PROJECT.id,
		host_id: HOST_ID,
		host_name: 'pi1',
		host_status: 'online',
		project_name: 'Lab',
		checks: [],
		checksMessage: null,
		catalog_entry: null,
		container_name: null,
		image_digest: null
	};
}

function decode(value: string): string {
	return value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
}

function textOf(html: string): string {
	return decode(html)
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function renderServices(
	url: string,
	rows: ProjectServiceRow[],
	extra: { total?: number; nextCursor?: string | null; message?: string | null } = {}
): string {
	setPageUrl(url);
	return decode(
		render(ServicesSection, {
			props: {
				projectId: PROJECT.id,
				projectName: 'Lab',
				hosts: [HOST],
				canAdmin: false,
				rows,
				total: extra.total ?? Math.max(rows.length, 1),
				prevCursor: null,
				nextCursor: extra.nextCursor ?? null,
				omitted: 0,
				message: extra.message ?? null,
				probe: null,
				probeServiceId: null,
				renameServiceId: null,
				typedName: null
			}
		}).body
	);
}

function rowText(html: string, id: string): string {
	const marker = `id="${serviceDomId(id)}"`;
	const start = html.indexOf(marker);
	assert.ok(start >= 0, marker);
	const end = html.indexOf('</tr>', start);
	assert.ok(end > start);
	return textOf(html.slice(start, end));
}

function triggerText(html: string, id: string): string {
	const marker = `id="${id}"`;
	const at = html.indexOf(marker);
	assert.ok(at >= 0, id);
	const start = html.lastIndexOf('<button', at);
	const end = html.indexOf('</button>', at);
	assert.ok(start >= 0 && end > start);
	return textOf(html.slice(start, end));
}

function formSlice(html: string, method: string): string {
	const attr = `method="${method}"`;
	const at = html.indexOf(attr);
	assert.ok(at >= 0, method);
	const start = html.lastIndexOf('<form', at);
	const end = html.indexOf('</form>', at);
	assert.ok(start >= 0 && end > start);
	return html.slice(start, end);
}

function hiddenValues(html: string, name: string): string[] {
	return [...html.matchAll(/<input\b[^>]*>/g)].flatMap((match) => {
		const tag = match[0];
		if (!tag.includes('type="hidden"') || !tag.includes(`name="${name}"`)) return [];
		const value = tag.match(/value="([^"]*)"/);
		return [decode(value?.[1] ?? '')];
	});
}

test('show maps onto view and unknown values use the default', () => {
	assert.deepEqual(serviceShow(null), { show: 'deploybot', view: 'deploybot' });
	assert.deepEqual(serviceShow(undefined), { show: 'deploybot', view: 'deploybot' });
	assert.deepEqual(serviceShow(''), { show: 'deploybot', view: 'deploybot' });
	assert.deepEqual(serviceShow('deploybot'), { show: 'deploybot', view: 'deploybot' });
	assert.deepEqual(serviceShow('discovered'), { show: 'discovered', view: 'deploybot_and_discovered' });
	assert.deepEqual(serviceShow('all'), { show: 'all', view: 'all' });
	assert.deepEqual(serviceShow('nope'), { show: 'deploybot', view: 'deploybot' });
	assert.deepEqual(serviceShow('deploybot_and_discovered'), { show: 'deploybot', view: 'deploybot' });
});

test('paging, search, and sort links keep show', () => {
	const url = new URL(
		`http://console.example/projects/${PROJECT.id}?tab=services&show=all&services.q=api&services.host=${HOST_ID}&services.sort=name&services.dir=asc&services.cursor=abc`
	);
	const next = new URL(serverTableHref(url, 'services', { cursor: 'n' }), url.origin);
	assert.equal(next.searchParams.get('show'), 'all');
	assert.equal(next.searchParams.get('services.cursor'), 'n');
	assert.equal(next.searchParams.get('services.host'), HOST_ID);
	assert.equal(next.searchParams.get('services.q'), 'api');
	const search = serverSearchHiddenFields(url.searchParams, 'services');
	assert.equal(search.find((field) => field.name === 'show')?.value, 'all');
	assert.equal(search.some((field) => field.name === 'services.host'), true);
	assert.equal(search.some((field) => field.name === 'services.cursor'), false);
	const sorted = new URL(serverSortHref(url, 'services', { key: 'host' }, { sort: 'name', dir: 'asc' }), url.origin);
	assert.equal(sorted.searchParams.get('show'), 'all');
	assert.equal(sorted.searchParams.get('services.host'), HOST_ID);
	assert.equal(sorted.searchParams.has('services.cursor'), false);
});

test('the discovered empty-state link keeps the host filter', () => {
	const url = new URL(
		`http://console.example/projects/${PROJECT.id}?tab=services&services.host=${HOST_ID}&services.q=api&services.cursor=abc&show=deploybot`
	);
	assert.equal(
		discoveredListenersHref(url),
		`/projects/${PROJECT.id}?tab=services&services.host=${HOST_ID}&show=discovered`
	);
	const open = new URL(`http://console.example/projects/${PROJECT.id}?tab=services&services.q=api`);
	assert.equal(discoveredListenersHref(open), `/projects/${PROJECT.id}?tab=services&show=discovered`);
});

test('gone rows replace health and present rows keep it', () => {
	assert.equal(serviceRowStatus({ source: 'owned', gone_at: GONE, health: { status: 'up' } }), 'stopped');
	assert.equal(serviceRowStatus({ source: 'declared', gone_at: GONE, health: { status: 'up' } }), 'stopped');
	assert.equal(serviceRowStatus({ source: 'discovered', gone_at: GONE, health: { status: 'down' } }), 'gone');
	assert.equal(serviceRowStatus({ source: 'owned', gone_at: null, health: { status: 'down' } }), 'down');
	assert.equal(serviceRowStatus({ source: 'discovered', gone_at: null, health: { status: 'up' } }), 'up');
	assert.equal(serviceRowStatus({ source: 'declared', gone_at: null, health: null }), 'unknown');
});

test('the services table shows stopped or gone instead of health', () => {
	const url = `http://console.example/projects/${PROJECT.id}?tab=services`;
	const html = renderServices(url, [
		row(OWNED, 'owned', GONE, 'up'),
		row(DECLARED, 'declared', GONE, 'up'),
		row(DISCOVERED, 'discovered', GONE, 'down'),
		row(PRESENT, 'owned', null, 'down')
	]);
	const owned = rowText(html, OWNED);
	const declared = rowText(html, DECLARED);
	const discovered = rowText(html, DISCOVERED);
	const present = rowText(html, PRESENT);
	assert.equal(owned.split(' ').includes('stopped'), true);
	assert.equal(owned.split(' ').includes('up'), false);
	assert.equal(html.slice(html.indexOf(serviceDomId(OWNED)), html.indexOf('</tr>', html.indexOf(serviceDomId(OWNED)))).includes('text-status-offline'), true);
	assert.equal(declared.split(' ').includes('stopped'), true);
	assert.equal(declared.split(' ').includes('gone'), false);
	assert.equal(discovered.split(' ').includes('gone'), true);
	assert.equal(discovered.split(' ').includes('down'), false);
	assert.equal(discovered.split(' ').includes('stopped'), false);
	assert.equal(
		html.slice(html.indexOf(serviceDomId(DISCOVERED)), html.indexOf('</tr>', html.indexOf(serviceDomId(DISCOVERED)))).includes('text-status-unknown'),
		true
	);
	assert.equal(present.split(' ').includes('down'), true);
	assert.equal(present.split(' ').includes('stopped'), false);
	assert.equal(present.split(' ').includes('gone'), false);
});

test('the Deploybot empty line is only a quiet default view', () => {
	assert.equal(showDeploybotEmpty({ show: 'deploybot', search: '', message: null }), true);
	assert.equal(showDeploybotEmpty({ show: 'deploybot', search: 'api', message: null }), false);
	assert.equal(showDeploybotEmpty({ show: 'deploybot', search: '', message: 'api down' }), false);
	assert.equal(showDeploybotEmpty({ show: 'discovered', search: '', message: null }), false);
	assert.equal(showDeploybotEmpty({ show: 'all', search: '', message: null }), false);
});

test('the default empty state links to discovered listeners and keeps the host', () => {
	const url = `http://console.example/projects/${PROJECT.id}?tab=services&services.host=${HOST_ID}`;
	const html = renderServices(url, []);
	assert.equal(html.includes('No services run by Deploybot yet.'), true);
	assert.equal(html.includes('No services reported.'), false);
	const href = `/projects/${PROJECT.id}?tab=services&services.host=${HOST_ID}&show=discovered`;
	assert.equal(html.includes(`href="${href}"`), true);
	assert.equal(html.includes('Show discovered listeners'), true);
	const link = html.match(/<a\b[^>]*>Show discovered listeners/)?.[0] ?? '';
	assert.match(link, /\bunderline\b/);
	assert.match(link, /underline-offset-4/);
	assert.match(link, /focus-visible:ring-ring/);
	assert.equal(html.includes(`${href}&services.q=`), false);

	const searched = renderServices(`${url}&services.q=api`, []);
	assert.equal(searched.includes('No services reported.'), true);
	assert.equal(searched.includes('No services run by Deploybot yet.'), false);
	assert.equal(searched.includes('Show discovered listeners'), false);

	const failed = renderServices(url, [], { message: 'The API returned an unexpected response.' });
	assert.equal(failed.includes('No services reported.'), true);
	assert.equal(failed.includes('No services run by Deploybot yet.'), false);
	assert.equal(failed.includes('Show discovered listeners'), false);
	assert.equal(failed.includes('The API returned an unexpected response.'), true);

	const discovered = renderServices(
		`http://console.example/projects/${PROJECT.id}?tab=services&show=discovered`,
		[]
	);
	assert.equal(discovered.includes('No services reported.'), true);
	assert.equal(discovered.includes('No services run by Deploybot yet.'), false);
	assert.equal(discovered.includes('Show discovered listeners'), false);

	const filled = renderServices(url, [row(PRESENT, 'discovered', null, 'up')]);
	assert.equal(filled.includes('No services run by Deploybot yet.'), false);
	assert.equal(filled.includes('Show discovered listeners'), false);

	const everything = renderServices(
		`http://console.example/projects/${PROJECT.id}?tab=services&show=all`,
		[]
	);
	assert.equal(everything.includes('No services reported.'), true);
	assert.equal(everything.includes('No services run by Deploybot yet.'), false);
	assert.equal(everything.includes('Show discovered listeners'), false);

	const unknown = renderServices(
		`http://console.example/projects/${PROJECT.id}?tab=services&show=nope`,
		[]
	);
	assert.equal(unknown.includes('No services run by Deploybot yet.'), true);
	assert.equal(unknown.includes(`href="/projects/${PROJECT.id}?tab=services&show=discovered"`), true);
});

test('the Show select submits one value and the trigger shows that label', () => {
	const source = readFileSync(new URL('../src/routes/projects/[id]/ServicesSection.svelte', import.meta.url), 'utf8');
	assert.equal(source.includes('<select'), false);
	assert.match(source, /id="services-show"/);
	assert.match(source, /bind:value=\{showValue\}/);
	assert.match(source, /<Select\.Item value=\{option\}>\{SERVICE_SHOW_LABEL\[option\]\}<\/Select\.Item>/);
	assert.match(source, /<Select\.Value[^>]*>\{showLabel\}<\/Select\.Value>/);
	assert.match(source, /\{#each SERVICE_SHOWS as option/);
	assert.equal(source.includes('basis-full gap-1.5 sm:max-w-xs sm:basis-0 sm:flex-1'), true);
	assert.equal(source.includes('basis-full gap-1.5 sm:max-w-sm sm:basis-0 sm:flex-1'), true);
	assert.equal([...source.matchAll(/class="w-full min-w-0"/g)].length, 2);
	assert.equal([...source.matchAll(/class="min-w-0 truncate"/g)].length, 2);
	assert.deepEqual(SERVICE_SHOW_LABEL, {
		deploybot: 'Deploybot services',
		discovered: 'Also discovered',
		all: 'Everything, including gone'
	});

	const base = `http://console.example/projects/${PROJECT.id}?tab=services&services.q=api&services.host=${HOST_ID}&services.sort=name&services.dir=asc`;
	const discovered = renderServices(`${base}&show=discovered`, [row(PRESENT, 'discovered', null, 'up')], {
		total: 40,
		nextCursor: 'n'
	});
	assert.equal(triggerText(discovered, 'services-show'), SERVICE_SHOW_LABEL.discovered);
	const hostForm = formSlice(discovered, 'GET');
	assert.deepEqual(hiddenValues(hostForm, 'show'), ['discovered']);
	assert.deepEqual(hiddenValues(hostForm, 'services.q'), ['api']);
	assert.equal(hostForm.includes('services.cursor'), false);
	const searchForm = formSlice(discovered, 'get');
	assert.deepEqual(hiddenValues(searchForm, 'show'), ['discovered']);
	assert.equal(
		[...discovered.matchAll(/href="([^"]*)"/g)].some((match) => {
			const href = match[1] ?? '';
			return href.includes('show=discovered') && href.includes('services.cursor=n');
		}),
		true
	);
	assert.equal(
		[...discovered.matchAll(/href="([^"]*)"/g)].some((match) => {
			const href = match[1] ?? '';
			return href.includes('show=discovered') && href.includes('services.sort=');
		}),
		true
	);

	const fallback = renderServices(`${base}&show=nope`, [row(PRESENT, 'owned', null, 'up')]);
	assert.equal(triggerText(fallback, 'services-show'), SERVICE_SHOW_LABEL.deploybot);
	assert.deepEqual(hiddenValues(formSlice(fallback, 'GET'), 'show'), ['deploybot']);
	assert.equal(formSlice(fallback, 'GET').includes('value="nope"'), false);

	const missing = renderServices(base, [row(PRESENT, 'owned', null, 'up')]);
	assert.equal(triggerText(missing, 'services-show'), SERVICE_SHOW_LABEL.deploybot);
	assert.deepEqual(hiddenValues(formSlice(missing, 'GET'), 'show'), ['deploybot']);
});
