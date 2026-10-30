import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { render } from 'svelte/server';
import type { HealthCheck, Host, ProjectServiceRow } from '../src/lib/api-types.ts';
import { COPY_FAILED_NOTE, COPIED_NOTE, copyText } from '../src/lib/copy-text.ts';
import { PROCESS_COLUMNS, SERVICE_COLUMNS, smallestPort } from '../src/lib/host-view.ts';
import { imageDigestText, showsDockerHealthcheck } from '../src/lib/service-view.ts';
import { compareCells } from '../src/lib/table.ts';
import ServicesSection from '../src/routes/projects/[id]/ServicesSection.svelte';
import { PROJECT } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

const HOST_ID = '00000000-0000-4000-8000-0000000000aa';
const SERVICE_ID = '00000000-0000-4000-8000-0000000000bb';
const DIGEST = `sha256:${'ab'.repeat(32)}`;

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

function check(protocol: 'tcp' | 'http', port: number, path: string | null): HealthCheck {
	return { id: `${protocol}-${port}`, protocol, port, path, enabled: true };
}

function row(overrides: Partial<ProjectServiceRow> = {}): ProjectServiceRow {
	return {
		id: SERVICE_ID,
		name: 'web',
		source: 'owned',
		kind: 'container',
		ports: [80, 443],
		health: null,
		last_seen_at: '2026-10-14T12:00:00Z',
		gone_at: null,
		display_name: 'Web',
		owner_user: 'root',
		project_id: PROJECT.id,
		host_id: HOST_ID,
		host_name: 'pi1',
		host_status: 'online',
		project_name: 'Lab',
		catalog_entry: null,
		container_name: 'web-1',
		image_digest: null,
		checks: [],
		checksMessage: null,
		...overrides
	};
}

function renderRow(item: ProjectServiceRow): string {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=services`);
	return render(ServicesSection, {
		props: {
			projectId: PROJECT.id,
			projectName: 'Lab',
			hosts: [HOST],
			canAdmin: false,
			rows: [item],
			total: 1,
			prevCursor: null,
			nextCursor: null,
			omitted: 0,
			message: null,
			probe: null,
			probeServiceId: null,
			renameServiceId: null,
			typedName: null
		}
	}).body;
}

test('the ports column is not numeric and its header is not right-aligned', () => {
	const ports = SERVICE_COLUMNS.find((column) => column.key === 'ports');
	assert.equal(ports?.numeric, undefined);
	assert.equal(ports?.sortable, undefined);
	assert.equal(ports?.value?.({ ports: [8080, 80] } as ProjectServiceRow), 80);
	assert.equal(smallestPort([8080, 80]), 80);
	assert.ok(compareCells(80, 8080, 'asc', true) < 0);

	const html = renderRow(row());
	const at = html.indexOf('>Ports<');
	assert.ok(at >= 0);
	const header = html.slice(html.lastIndexOf('<th', at), html.indexOf('>', html.lastIndexOf('<th', at)));
	assert.doesNotMatch(header, /text-right/);
	assert.match(header, /text-left/);
	assert.match(html, /<td class="p-2 align-middle font-mono">80, 443<\/td>/);
});

test('a services row shows the digest icon and not the short digest text', () => {
	const html = renderRow(row({ image_digest: DIGEST, catalog_entry: 'web' }));
	assert.equal(html.includes(`aria-label="Image digest ${DIGEST}"`), true);
	assert.equal(html.includes(`title="${DIGEST}"`), true);
	assert.equal(html.includes('>catalog<'), true);
	// The container name is in the label's tooltip, not shown beside it.
	assert.equal(html.includes('title="Web (container web-1)"'), true);
	assert.equal(html.replace(/ title="[^"]*"/g, '').includes('web-1'), false);
	const short = `sha256:${DIGEST.slice('sha256:'.length, 'sha256:'.length + 12)}`;
	assert.equal(html.split(DIGEST).join('').includes(short), false);
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

test('checks lead with docker healthcheck and keep tcp and http lines', () => {
	assert.equal(showsDockerHealthcheck({ health: { source: 'docker' } }), true);
	assert.equal(showsDockerHealthcheck({ health: { source: 'check' } }), false);
	assert.equal(showsDockerHealthcheck({ health: null }), false);

	const both = renderRow(
		row({
			health: { status: 'up', last_checked_at: null, latency_ms: null, source: 'docker' },
			checks: [check('tcp', 6379, null), check('http', 8080, '/health')]
		})
	);
	assert.match(both, /<p class="text-muted-foreground text-sm">docker healthcheck<\/p>/);
	assert.equal(both.includes('tcp 6379'), true);
	assert.equal(both.includes('http 8080/health'), true);
	assert.match(both, /aria-label="Probe Web tcp 6379"/);
	assert.match(both, /aria-label="Probe Web http 8080"/);
	assert.equal(both.includes('No health checks.'), false);
	const lineAt = both.indexOf('<p class="text-muted-foreground text-sm">docker healthcheck</p>');
	const formAt = both.indexOf('<form method="POST"');
	assert.ok(lineAt >= 0 && formAt > lineAt);

	const dockerOnly = renderRow(
		row({ health: { status: 'up', last_checked_at: null, latency_ms: null, source: 'docker' }, checks: [] })
	);
	assert.equal(dockerOnly.includes('docker healthcheck'), true);
	assert.equal(dockerOnly.includes('No health checks.'), false);
	assert.equal(dockerOnly.includes('Probe Web'), false);

	const neither = renderRow(row({ health: null, checks: [] }));
	assert.equal(neither.includes('docker healthcheck'), false);
	assert.equal(neither.includes('No health checks.'), true);
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

test('services cells are middle-aligned and last seen may wrap so the table fits', () => {
	const source = readFileSync(new URL('../src/routes/projects/[id]/ServicesSection.svelte', import.meta.url), 'utf8');
	const cells = [...source.matchAll(/<td\b[^>]*>/g)].map((match) => match[0]);
	assert.ok(cells.length >= 7);
	for (const cell of cells) assert.match(cell, /align-middle/);
	assert.match(source, /<td class="p-2 align-middle"><LocalTime iso=\{service\.last_seen_at\} \/>/);
	assert.match(source, /class="ml-auto inline-flex shrink-0 items-center gap-1"/);
	assert.match(source, /icon=\{Fingerprint\} iconOnly/);
	assert.match(
		readFileSync(new URL('../src/lib/components/CopyButton.svelte', import.meta.url), 'utf8'),
		/Tooltip\.Content class=\{tip \? 'max-w-sm' : 'max-w-sm font-mono break-all'\}/
	);
});
