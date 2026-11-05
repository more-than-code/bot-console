import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { ProjectServiceRow } from '../src/lib/api-types.ts';
import { serviceDomId } from '../src/lib/host-view.ts';
import { hostFilterHiddenFields } from '../src/lib/table.ts';
import { copyHost, copyRow, renderCopies } from './copies.ts';
import { PROJECT } from './harness.ts';

const HOST_ID = '00000000-0000-4000-8000-0000000000aa';
const SHARED_ID = '00000000-0000-4000-8000-0000000000ab';
const VIEW_ID = '00000000-0000-4000-8000-0000000000ac';
const OWNED = '00000000-0000-4000-8000-0000000000b1';
const PRESENT = '00000000-0000-4000-8000-0000000000b4';
const GONE = '2026-10-15T14:00:00Z';

function row(id: string, goneAt: string | null, status: 'up' | 'down', entry: string): ProjectServiceRow {
	return copyRow({
		id,
		name: entry,
		kind: 'process',
		ports: [80],
		health: { status, last_checked_at: null, latency_ms: 1, source: null },
		last_seen_at: GONE,
		gone_at: goneAt,
		display_name: null,
		owner_user: null,
		catalog_entry: entry,
		container_name: null
	});
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

function renderServices(url: string, rows: ProjectServiceRow[], hosts = [copyHost()]): string {
	return decode(renderCopies({ rows, url, hosts }));
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

test('a stopped copy stays under its entry and says Stopped; a live one with health down says Unhealthy', () => {
	const url = `http://console.example/projects/${PROJECT.id}?tab=catalog`;
	const html = renderServices(url, [row(OWNED, GONE, 'up', 'api'), row(PRESENT, null, 'down', 'web')]);
	const owned = rowText(html, OWNED);
	const present = rowText(html, PRESENT);
	assert.equal(owned.split(' ').includes('Stopped'), true);
	assert.equal(owned.split(' ').includes('Running'), false);
	assert.equal(html.slice(html.indexOf(serviceDomId(OWNED)), html.indexOf('</tr>', html.indexOf(serviceDomId(OWNED)))).includes('text-status-offline'), true);
	assert.equal(present.split(' ').includes('Unhealthy'), true);
	assert.equal(present.split(' ').includes('Stopped'), false);
});

test('there is no Show select and no discovered listeners link', () => {
	const source = readFileSync(new URL('../src/routes/projects/[id]/CatalogSection.svelte', import.meta.url), 'utf8');
	assert.equal(source.includes('services-show'), false);
	assert.equal(source.includes('discovered'), false);
	const html = renderServices(`http://console.example/projects/${PROJECT.id}?tab=catalog`, []);
	assert.equal(html.includes('Show discovered listeners'), false);
	assert.equal(html.includes('No catalog entries.'), true);
});

test('the host select lists owned and deploy-shared hosts and submits one catalog.host', () => {
	const source = readFileSync(new URL('../src/routes/projects/[id]/CatalogSection.svelte', import.meta.url), 'utf8');
	assert.equal(source.includes('<select'), false);
	assert.match(source, /id="catalog-host"/);
	assert.match(source, /<Select\.Value[^>]*>\{hostLabel\}<\/Select\.Value>/);
	// One wrapping row with the search: the select's form comes first inside the table's toolbar.
	assert.equal(source.includes('class="mb-3 grid min-w-0 basis-full gap-1.5 sm:w-56 sm:basis-auto"'), true);
	assert.match(source, /\{#snippet toolbar\(\)\}/);

	const hosts = [
		copyHost(),
		copyHost({ id: SHARED_ID, name: 'hk', relation: 'shared', share_level: 'deploy', project_id: '00000000-0000-4000-8000-0000000000ff' }),
		copyHost({ id: VIEW_ID, name: 'peek', relation: 'shared', share_level: 'metrics', project_id: '00000000-0000-4000-8000-0000000000ff' })
	];
	const base = `http://console.example/projects/${PROJECT.id}?tab=catalog&catalog.q=api&catalog.sort=name&catalog.page=2&catalog.logs=api`;
	const html = renderServices(`${base}&catalog.host=${HOST_ID}`, [row(PRESENT, null, 'up', 'api')], hosts);
	assert.equal(triggerText(html, 'catalog-host'), 'pi1');
	const hostForm = formSlice(html, 'GET');
	assert.deepEqual(hiddenValues(hostForm, 'catalog.host'), [HOST_ID]);
	assert.deepEqual(hiddenValues(hostForm, 'catalog.q'), ['api']);
	assert.deepEqual(hiddenValues(hostForm, 'catalog.sort'), ['name']);
	assert.deepEqual(hiddenValues(hostForm, 'catalog.page'), []);
	assert.deepEqual(hiddenValues(hostForm, 'catalog.logs'), []);
	assert.deepEqual(
		hostFilterHiddenFields(new URL(base).searchParams, 'catalog').map((field) => field.name),
		['tab', 'catalog.q', 'catalog.sort']
	);

	const all = renderServices(base.replace('&catalog.logs=api', ''), [row(PRESENT, null, 'up', 'api')], hosts);
	assert.equal(triggerText(all, 'catalog-host'), 'All hosts');
	assert.deepEqual(hiddenValues(formSlice(all, 'GET'), 'catalog.host'), ['']);
});
