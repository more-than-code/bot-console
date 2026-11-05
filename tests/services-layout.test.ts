import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { HealthCheck, ProjectServiceRow } from '../src/lib/api-types.ts';
import { COPY_FAILED_NOTE, COPIED_NOTE, copyText } from '../src/lib/copy-text.ts';
import { PROCESS_COLUMNS } from '../src/lib/host-view.ts';
import { imageDigestText } from '../src/lib/service-view.ts';
import { CATALOG_CELL, SERVICES_CELL } from '../src/lib/catalog-copies.ts';
import { copyRow, renderCopies } from './copies.ts';

const DIGEST = `sha256:${'ab'.repeat(32)}`;

function check(protocol: 'tcp' | 'http', port: number, path: string | null): HealthCheck {
	return { id: `${protocol}-${port}`, protocol, port, path, enabled: true };
}

function row(overrides: Partial<ProjectServiceRow> = {}): ProjectServiceRow {
	return copyRow(overrides);
}

function renderRow(item: ProjectServiceRow): string {
	return renderCopies({ rows: [item] });
}

test('a service row has Port, Digest and Uptime columns, and a phone line with all three', () => {
	const short = `sha256:${DIGEST.slice('sha256:'.length, 'sha256:'.length + 12)}`;
	const started = new Date(Date.now() - (3 * 3600 + 5 * 60) * 1000).toISOString();
	const html = renderRow(row({ image_digest: DIGEST, runtime: { state: 'running', restarts: 0, container: { state: 'running', exitCode: null, digest: DIGEST, ports: [80, 443], startedAt: started } } }));
	assert.match(html, /data-ports="">80, 443</);
	assert.match(html, new RegExp(`data-digest="">${short}<`));
	assert.match(html, /data-uptime="">3h 5m</);
	assert.match(html, new RegExp(`data-phone-detail="">ports 80, 443 · ${short} · up 3h 5m<`));
	// A copy whose state is not read (no grant) has no uptime: a dash.
	assert.match(renderRow(row()), /data-uptime="">—</);
	assert.match(renderRow(row({ ports: [8080] })), /data-ports="">8080</);
});

test('a copy row shows the digest icon with the short digest text', () => {
	const html = renderRow(row({ image_digest: DIGEST }));
	assert.equal(html.includes(`aria-label="Image digest ${DIGEST}"`), true);
	assert.equal(html.includes(`title="${DIGEST}"`), true);
	// The container name is in the label's tooltip, not shown beside it.
	assert.equal(html.includes('title="Web (container web-1)"'), true);
	assert.equal(html.replace(/ title="[^"]*"/g, '').includes('web-1'), false);
	const short = `sha256:${DIGEST.slice('sha256:'.length, 'sha256:'.length + 12)}`;
	assert.equal(html.split(DIGEST).join('').includes(short), true);
	assert.match(html, /<svg[^>]*lucide-fingerprint/);

	const plain = renderRow(row({ image_digest: null, container_name: 'Web' }));
	assert.equal(plain.includes('Image digest'), false);
	assert.equal(plain.includes('lucide-fingerprint'), false);
	assert.equal(imageDigestText(null), null);
	assert.equal(imageDigestText('  '), null);
	assert.equal(imageDigestText(DIGEST), DIGEST);
});

test('copyText writes the full value and reports the copy notes', async () => {
	const seen: string[] = [];
	assert.equal(
		await copyText(DIGEST, async (text) => {
			seen.push(text);
		}),
		COPIED_NOTE
	);
	assert.deepEqual(seen, [DIGEST]);
	assert.equal(
		await copyText(DIGEST, async () => {
			throw new Error('denied');
		}),
		COPY_FAILED_NOTE
	);
});

test('health-check lines and Probe are not in the services table (they are in the dialog)', () => {
	const both = renderRow(
		row({
			health: { status: 'up', last_checked_at: null, latency_ms: null, source: 'docker' },
			checks: [check('tcp', 6379, null), check('http', 8080, '/health')]
		})
	);
	assert.equal(both.includes('docker healthcheck'), false);
	assert.equal(both.includes('tcp 6379'), false);
	assert.equal(both.includes('aria-label="Probe '), false);
	assert.equal(both.includes('data-checks'), false);
});

test('process numeric cells stay right-aligned with their headers', () => {
	assert.deepEqual(
		PROCESS_COLUMNS.filter((column) => column.numeric).map((column) => column.key),
		['pid', 'cpu', 'rss', 'memory', 'threads']
	);
	const processes = readFileSync(new URL('../src/routes/hosts/[id]/ProcessesTab.svelte', import.meta.url), 'utf8');
	for (const cell of [
		'{row.pid}',
		'{formatPercent(row.cpu_usage)}',
		'{formatBytes(row.memory_rss)}',
		'{formatPercent(row.memory_usage)}',
		'{count(row.num_threads)}'
	]) {
		assert.match(processes, new RegExp(`<td class="p-2 text-right font-mono align-middle">${cell.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</td>`));
	}
	const table = readFileSync(new URL('../src/lib/components/DataTable.svelte', import.meta.url), 'utf8');
	assert.match(table, /column\.numeric \? 'text-right'/);
});

test('an expanded entry holds a nested services table; its rows have one cell per header', () => {
	const source = readFileSync(new URL('../src/routes/projects/[id]/CatalogCopyRow.svelte', import.meta.url), 'utf8');
	assert.equal(source.includes('<LocalTime iso={copy.last_seen_at}'), false);
	assert.match(source, /icon=\{Fingerprint\} iconOnly/);
	assert.match(
		readFileSync(new URL('../src/lib/components/CopyButton.svelte', import.meta.url), 'utf8'),
		/Tooltip\.Content class=\{tip \? 'max-w-sm' : 'max-w-sm font-mono break-all'\}/
	);
	const html = renderRow(row());
	const tbody = html.slice(html.indexOf('<tbody'));
	const rowAt = (marker: string) => {
		const at = tbody.indexOf(marker);
		assert.ok(at >= 0, marker);
		return tbody.slice(tbody.lastIndexOf('<tr', at), tbody.indexOf('</tr>', at));
	};
	// The services row: an empty first cell, then one cell spanning the other columns, holding the panel.
	const servicesAt = html.indexOf('data-services-row="web"');
	const servicesTr = html.slice(html.lastIndexOf('<tr', servicesAt), html.indexOf('data-services-table', servicesAt));
	const outerHeads = [...html.slice(0, html.indexOf('</thead>')).matchAll(/<th\b/g)].length;
	assert.match(servicesTr, /<td class="w-px p-2 align-middle"><\/td>/);
	assert.match(servicesTr, new RegExp(`<td colspan="${outerHeads - 1}"`));
	assert.match(html, /<div class="bg-muted\/40 rounded-lg px-1 py-1" data-services-table="">/);
	// The nested table: Host | Status | Port | Digest | Uptime | actions, with a cell for each.
	const nested = html.slice(html.indexOf('data-services-table'));
	const nestedHeads = [...nested.slice(0, nested.indexOf('</thead>')).matchAll(/<th\b/g)].length;
	assert.equal(nestedHeads, 6);
	const copyCells = [...rowAt('data-copy="web ').matchAll(/<td\b[^>]*class="([^"]*)"/g)].map((match) => match[1].trim());
	assert.deepEqual(copyCells, Object.values(SERVICES_CELL));
	// The actions use the entry row's slot grid, right-aligned, so icons line up under the entry's.
	const groups = [...tbody.matchAll(/<fieldset\b[^>]*class="([^"]*)"/g)].map((match) => match[1]);
	assert.equal(groups.length, 2);
	assert.equal(groups[0], groups[1]);
	assert.equal(groups[0], CATALOG_CELL.actionsGroup);
	assert.match(CATALOG_CELL.actionsGroup, /\bml-auto\b/);
});

test('below sm the services table stacks: host and status, then port, digest and uptime; actions only in ⋯', () => {
	for (const cell of [SERVICES_CELL.status, SERVICES_CELL.port, SERVICES_CELL.digest, SERVICES_CELL.uptime]) {
		assert.equal(cell.includes('max-sm:hidden'), true, cell);
	}
	assert.equal(SERVICES_CELL.host.includes('max-sm:hidden'), false);
	assert.match(SERVICES_CELL.host, /max-sm:w-full max-sm:max-w-0/);
	assert.equal(SERVICES_CELL.actions.includes('max-sm'), false);
	const source = readFileSync(new URL('../src/routes/projects/[id]/CatalogCopyRow.svelte', import.meta.url), 'utf8');
	assert.match(source, /extra=\{copyActions\}/);
	assert.equal(source.includes('contents'), false);
	const html = renderRow(row({ ports: [80] }));
	const copyAt = html.indexOf('data-copy="web ');
	const copy = html.slice(copyAt, html.indexOf('</tr>', copyAt));
	assert.match(copy, /data-phone-status/);
	assert.match(copy, /data-phone-detail="">port 80</);
	// The nested header hides below sm.
	assert.match(html, /<thead[^>]*class="[^"]*max-sm:hidden/);
});
