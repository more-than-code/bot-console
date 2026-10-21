import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { isActionFailure, isRedirect } from '@sveltejs/kit';
import { render } from 'svelte/server';
import type { EnvSet, Health, Host, ImageEntry, ImageSpec, ProjectServiceRow } from '../src/lib/api-types.ts';
import { applyDockerPaste, blankImageDraft, dockerRunPreview, imageDraftFromForm, imageRequestBody, imageSpecFromDraft, loggingForPreview, parseDockerRun } from '../src/lib/image-spec.ts';
import { healthSourceLabel } from '../src/lib/service-view.ts';
import { parseEnvSet, parseHealthHistory, parseHealthPoint, parseImageSpec, parseService } from '../src/lib/server/shape.ts';
import StatusBadge from '../src/lib/components/StatusBadge.svelte';
import CatalogImageForm from '../src/routes/projects/[id]/CatalogImageForm.svelte';
import CatalogSection from '../src/routes/projects/[id]/CatalogSection.svelte';
import HealthChecks from '../src/routes/projects/[id]/HealthChecks.svelte';
import ServicesSection from '../src/routes/projects/[id]/ServicesSection.svelte';
import SettingsSection from '../src/routes/projects/[id]/SettingsSection.svelte';
import { beginAddVariable, cancelAddVariable, initialEnvSetPanel, toggleEnvSet } from '../src/routes/projects/[id]/env-set-panel.ts';
import { actions as projectActions, load as projectLoad } from '../src/routes/projects/[id]/+page.server.ts';
import { envelope, fakeEvent, installFetch, PROJECT, restoreEnv, TOKEN, useApi, USER } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

const SECRET = 'super-secret-value-99';
const PLAIN = 'visible-plain-value-99';
const CHECK_ID = '00000000-0000-4000-8000-0000000000c2';
const SERVICE_ID = '00000000-0000-4000-8000-0000000000bb';
const HOST_ID = '00000000-0000-4000-8000-0000000000aa';
const ENTRY_ID = '00000000-0000-4000-8000-0000000000c1';
const HASH = 'ab'.repeat(32);

function actionData(result: unknown): { message?: string; settingsField?: string | null } {
	assert.equal(isActionFailure(result), true);
	if (!isActionFailure(result)) return {};
	return result.data as unknown as { message?: string; settingsField?: string | null };
}

async function expectRedirect(run: () => unknown) {
	await assert.rejects(
		async () => {
			await run();
		},
		(err: unknown) => isRedirect(err) && err.status === 303
	);
}

function spec(kind: ImageSpec['kind'] = 'service'): Record<string, unknown> {
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
		user: '',
		healthy_after_sec: kind === 'service' ? 30 : 0,
		memory_mb: null,
		timeout_sec: kind === 'job' ? 600 : 0
	};
}

function imageEntry(healthcheck: ImageSpec['healthcheck']): ImageEntry {
	const parsed = parseImageSpec({ ...spec('service'), healthcheck });
	if (!parsed) throw new Error('fixture spec');
	return {
		id: ENTRY_ID,
		project_id: PROJECT.id,
		name: 'web',
		kind: 'image',
		spec: parsed,
		spec_hash: HASH,
		command_display: 'ghcr.io/acme/web:1',
		created_by: USER.id,
		created_at: '2026-10-14T00:00:00Z',
		updated_at: '2026-10-14T00:00:00Z',
		my_actions: ['logs']
	};
}

function serviceBase() {
	return { id: SERVICE_ID, name: 'api', source: 'owned', kind: 'container', ports: [80] };
}

function point(overrides: Record<string, unknown>) {
	return {
		t: '2026-10-14T00:00:00Z',
		check_id: CHECK_ID,
		protocol: 'http',
		port: 80,
		result: 'success',
		http_status: 200,
		latency_ms: 4,
		...overrides
	};
}

describe('env sets, docker health, and catalog edit', { concurrency: false }, () => {
	const originalFetch = globalThis.fetch;

	before(() => {
		useApi('https://api.test');
	});

	after(() => {
		globalThis.fetch = originalFetch;
		restoreEnv();
	});

	test('env keys keep a preview and drop every secret value', () => {
		const leaked = parseEnvSet({
			name: 'app',
			keys: [
				{ key: 'API_TOKEN', is_secret: true, value: SECRET, preview: SECRET },
				{ key: 'LOG_LEVEL', is_secret: false, value: PLAIN, preview: 'nope' }
			],
			updated_at: '2026-10-14T00:00:00Z',
			updated_by: USER.id
		});
		assert.equal(leaked?.keys[0]?.value, null);
		assert.equal(leaked?.keys[0]?.preview, null);
		assert.equal(leaked?.keys[1]?.value, PLAIN);
		assert.equal(leaked?.keys[1]?.preview, null);
		assert.equal(JSON.stringify(leaked).includes(SECRET), false);

		const shown = parseEnvSet({
			name: 'app',
			keys: [{ key: 'API_TOKEN', is_secret: true, value: SECRET, preview: 'supe\u2026' }],
			updated_at: '2026-10-14T00:00:00Z',
			updated_by: USER.id
		});
		assert.equal(shown?.keys[0]?.preview, 'supe\u2026');
		assert.equal(JSON.stringify(shown).includes(SECRET), false);

		const bullets = parseEnvSet({
			name: 'app',
			keys: [{ key: 'API_TOKEN', is_secret: true, value: null, preview: '\u2022\u2022\u2022\u2022' }],
			updated_at: '2026-10-14T00:00:00Z',
			updated_by: USER.id
		});
		assert.equal(bullets?.keys[0]?.preview, '\u2022\u2022\u2022\u2022');
		assert.equal(parseEnvSet({
			name: 'app',
			keys: [{ key: 'API_TOKEN', is_secret: true, value: null, preview: 4 }],
			updated_at: '2026-10-14T00:00:00Z',
			updated_by: USER.id
		}), null);
	});

	test('health source and history accept docker rows and nullable latency', () => {
		const docker = parseService({
			...serviceBase(),
			health: { status: 'up', last_checked_at: '2026-10-14T00:00:00Z', latency_ms: null, source: 'docker' }
		});
		assert.equal(docker?.health?.source, 'docker');
		assert.equal(docker?.health?.latency_ms, null);
		const legacy = parseService({
			...serviceBase(),
			health: { status: 'down', last_checked_at: null, latency_ms: 4 }
		});
		assert.equal(legacy?.health?.source, null);
		assert.equal(legacy?.health?.latency_ms, 4);
		assert.equal(parseService({ ...serviceBase(), health: { status: 'up', last_checked_at: null, latency_ms: null, source: 'agent' } }), null);

		const history = parseHealthHistory({
			items: [
				point({ protocol: 'docker', check_id: null, port: null, http_status: null, latency_ms: null, result: 'unhealthy' }),
				point({})
			]
		});
		assert.equal(history?.items.length, 2);
		assert.equal(history?.items[0]?.protocol, 'docker');
		assert.equal(history?.items[0]?.latency_ms, null);
		assert.equal(history?.items[1]?.protocol, 'http');
		assert.equal(history?.items[1]?.latency_ms, 4);
		assert.equal(parseHealthPoint(point({ protocol: 'docker', check_id: null, port: null, http_status: null, latency_ms: 1, result: 'success' })), null);
		assert.equal(parseHealthPoint(point({ protocol: 'tcp', http_status: null, result: 'timeout' }))?.protocol, 'tcp');
		assert.equal(parseHealthPoint(point({ latency_ms: null })), null);
	});

	test('an image healthcheck is allowlisted and omitted when the command is empty', () => {
		const check = {
			test: ['CMD', '--ready'],
			interval_sec: 10,
			timeout_sec: 2,
			retries: 3,
			start_period_sec: 5
		};
		const parsed = parseImageSpec({ ...spec('service'), healthcheck: check });
		assert.deepEqual(parsed?.healthcheck, check);
		assert.equal(parseImageSpec(spec('service'))?.healthcheck, null);
		assert.equal(parseImageSpec({ ...spec('service'), healthcheck: { ...check, extra: true } }), null);
		assert.equal(parseImageSpec({ ...spec('service'), healthcheck: { ...check, timeout_sec: 10, interval_sec: 10 } }), null);
		assert.equal(parseImageSpec({ ...spec('job'), healthcheck: check }), null);
		const defaults = parseImageSpec({ ...spec('service'), healthcheck: { test: ['CMD'] } });
		assert.deepEqual(defaults?.healthcheck, { test: ['CMD'], interval_sec: 30, timeout_sec: 5, retries: 3, start_period_sec: 0 });

		const draft = blankImageDraft();
		draft.image = 'ghcr.io/acme/web:1';
		draft.healthTest = 'CMD\n--ready';
		draft.healthInterval = '10';
		draft.healthTimeout = '2';
		draft.healthRetries = '3';
		draft.healthStart = '5';
		const built = imageSpecFromDraft(draft, undefined, false);
		assert.equal(built.ok, true);
		if (!built.ok) return;
		assert.deepEqual(built.spec.healthcheck, check);
		const body = imageRequestBody(built.spec, null).spec as Record<string, unknown>;
		assert.deepEqual(body.healthcheck, check);

		draft.healthTest = '\n';
		draft.healthInterval = '999';
		const empty = imageSpecFromDraft(draft, undefined, false);
		assert.equal(empty.ok, true);
		if (!empty.ok) return;
		assert.equal(empty.spec.healthcheck, null);
		assert.equal(Object.hasOwn(imageRequestBody(empty.spec, null).spec as Record<string, unknown>, 'healthcheck'), false);

		draft.healthTest = 'CMD';
		draft.healthTimeout = '30';
		draft.healthInterval = '30';
		const slow = imageSpecFromDraft(draft, undefined, false);
		assert.equal(slow.ok, false);
		if (slow.ok) return;
		assert.equal(slow.field, 'healthcheck.timeout_sec');
		assert.equal(slow.message.includes('CMD'), false);

		const job = blankImageDraft();
		job.workload = 'job';
		job.image = 'ghcr.io/acme/web:1';
		job.healthTest = 'CMD';
		const jobSpec = imageSpecFromDraft(job, undefined, false);
		assert.equal(jobSpec.ok, true);
		if (!jobSpec.ok) return;
		assert.equal(jobSpec.spec.healthcheck, null);

		const form = new FormData();
		form.set('workload', 'service');
		form.set('image', 'ghcr.io/acme/web:1');
		form.set('health_test', `CMD\n${'x'.repeat(1025)}`);
		const read = imageDraftFromForm(form);
		assert.equal(read.draft.healthTest, '');
		assert.equal(read.field, 'healthcheck');
		assert.equal(read.message?.includes('x'.repeat(20)), false);
	});

	test('logging is omitted unless both bounds are set, and the preview shows the cap', () => {
		assert.equal(parseImageSpec(spec('service'))?.logging, null);
		assert.equal(parseImageSpec({ ...spec('service'), logging: null })?.logging, null);
		const pair = { max_size_mb: 5, max_files: 2 };
		assert.deepEqual(parseImageSpec({ ...spec('service'), logging: pair })?.logging, pair);
		assert.deepEqual(parseImageSpec({ ...spec('job'), logging: { max_size_mb: 1, max_files: 1 } })?.logging, { max_size_mb: 1, max_files: 1 });
		assert.deepEqual(parseImageSpec({ ...spec('service'), logging: { max_size_mb: 100, max_files: 10 } })?.logging, { max_size_mb: 100, max_files: 10 });
		assert.equal(parseImageSpec({ ...spec('service'), logging: { max_size_mb: 5 } }), null);
		assert.equal(parseImageSpec({ ...spec('service'), logging: { max_files: 2 } }), null);
		assert.equal(parseImageSpec({ ...spec('service'), logging: {} }), null);
		assert.equal(parseImageSpec({ ...spec('service'), logging: [] }), null);
		assert.equal(parseImageSpec({ ...spec('service'), logging: { ...pair, driver: 'json-file' } }), null);
		assert.equal(parseImageSpec({ ...spec('service'), logging: { max_size_mb: 1.5, max_files: 2 } }), null);
		assert.equal(parseImageSpec({ ...spec('service'), logging: { max_size_mb: 0, max_files: 2 } }), null);
		assert.equal(parseImageSpec({ ...spec('service'), logging: { max_size_mb: 101, max_files: 2 } }), null);
		assert.equal(parseImageSpec({ ...spec('service'), logging: { max_size_mb: 5, max_files: 0 } }), null);
		assert.equal(parseImageSpec({ ...spec('service'), logging: { max_size_mb: 5, max_files: 11 } }), null);
		assert.equal(parseImageSpec({ ...spec('service'), logging: { max_size_mb: '5', max_files: 2 } }), null);

		function built(size: string, files: string, workload: 'service' | 'job' = 'service') {
			const draft = blankImageDraft();
			draft.workload = workload;
			draft.image = 'ghcr.io/acme/web:1';
			draft.logMaxSizeMb = size;
			draft.logMaxFiles = files;
			return imageSpecFromDraft(draft, undefined, false);
		}
		const empty = built('', '');
		assert.equal(empty.ok, true);
		if (!empty.ok) return;
		assert.equal(empty.spec.logging, null);
		assert.equal(Object.hasOwn(imageRequestBody(empty.spec, null).spec as Record<string, unknown>, 'logging'), false);

		const onlySize = built('5', '');
		assert.equal(onlySize.ok, false);
		if (onlySize.ok) return;
		assert.equal(onlySize.field, 'logging.max_files');
		assert.match(onlySize.message, /Files kept/);
		const onlyFiles = built('', '2');
		assert.equal(onlyFiles.ok, false);
		if (onlyFiles.ok) return;
		assert.equal(onlyFiles.field, 'logging.max_size_mb');
		assert.match(onlyFiles.message, /Max size per file/);

		const sizeBounds = 'Max size per file must be an integer from 1 to 100 MB.';
		const filesBounds = 'Files kept must be an integer from 1 to 10.';
		for (const size of ['0', '101', '1.5', 'abc']) {
			const bad = built(size, '2');
			assert.equal(bad.ok, false, size);
			if (bad.ok) continue;
			assert.equal(bad.field, 'logging.max_size_mb', size);
			assert.equal(bad.message, sizeBounds, size);
		}
		const blankSize = built('  ', '2');
		assert.equal(blankSize.ok, false);
		if (!blankSize.ok) {
			assert.equal(blankSize.field, 'logging.max_size_mb');
			assert.equal(blankSize.message, 'Max size per file is required when files kept is set.');
		}
		for (const files of ['0', '11', '2.5']) {
			const bad = built('5', files);
			assert.equal(bad.ok, false, files);
			if (bad.ok) continue;
			assert.equal(bad.field, 'logging.max_files', files);
			assert.equal(bad.message, filesBounds, files);
		}

		const both = built('5', '2');
		assert.equal(both.ok, true);
		if (!both.ok) return;
		assert.deepEqual(both.spec.logging, pair);
		assert.deepEqual((imageRequestBody(both.spec, 'web').spec as Record<string, unknown>).logging, pair);
		const edges = built('100', '10');
		assert.equal(edges.ok, true);
		if (!edges.ok) return;
		assert.deepEqual(edges.spec.logging, { max_size_mb: 100, max_files: 10 });
		const low = built('1', '1');
		assert.equal(low.ok, true);
		if (!low.ok) return;
		assert.deepEqual(low.spec.logging, { max_size_mb: 1, max_files: 1 });

		const job = built('5', '2', 'job');
		assert.equal(job.ok, true);
		if (!job.ok) return;
		assert.equal(job.spec.healthcheck, null);
		assert.deepEqual(job.spec.logging, pair);
		assert.deepEqual((imageRequestBody(job.spec, null).spec as Record<string, unknown>).logging, pair);

		const form = new FormData();
		form.set('workload', 'service');
		form.set('image', 'ghcr.io/acme/web:1');
		form.set('log_max_size_mb', '5');
		form.set('log_max_files', '2');
		const read = imageDraftFromForm(form);
		assert.equal(read.draft.logMaxSizeMb, '5');
		assert.equal(read.draft.logMaxFiles, '2');
		const fromForm = imageSpecFromDraft(read.draft, undefined, false);
		assert.equal(fromForm.ok, true);
		if (!fromForm.ok) return;
		assert.deepEqual(fromForm.spec.logging, pair);
		const huge = new FormData();
		huge.set('image', 'ghcr.io/acme/web:1');
		huge.set('log_max_size_mb', '1000');
		huge.set('log_max_files', '2');
		const hugeDraft = imageDraftFromForm(huge);
		assert.equal(hugeDraft.draft.logMaxSizeMb, '1000');
		const clipped = imageSpecFromDraft(hugeDraft.draft, undefined, false);
		assert.equal(clipped.ok, false);
		if (clipped.ok) return;
		assert.equal(clipped.field, 'logging.max_size_mb');
		assert.equal(clipped.message.includes('1000'), false);
		const absurd = new FormData();
		absurd.set('image', 'ghcr.io/acme/web:1');
		absurd.set('log_max_size_mb', '1'.repeat(20));
		absurd.set('log_max_files', '2');
		const absurdDraft = imageDraftFromForm(absurd);
		assert.equal(absurdDraft.draft.logMaxSizeMb, 'x');
		assert.equal(absurdDraft.draft.logMaxSizeMb.includes('1'), false);

		assert.equal(loggingForPreview('', ''), null);
		assert.equal(loggingForPreview('5', ''), null);
		assert.equal(loggingForPreview('', '2'), null);
		assert.equal(loggingForPreview('200', '2'), null);
		assert.deepEqual(loggingForPreview('5', '2'), pair);
		const previewInput = {
			name: 'web',
			image: 'nginx',
			command: [],
			entrypoint: [],
			ports: [],
			envKeys: [],
			volumes: [],
			restart: 'unless-stopped',
			user: '',
			memoryMb: null
		};
		const defaults = dockerRunPreview(previewInput);
		assert.match(defaults, /--log-opt max-size=10m --log-opt max-file=3/);
		const override = dockerRunPreview({ ...previewInput, logging: pair });
		assert.match(override, /--log-opt max-size=5m --log-opt max-file=2/);
		assert.equal(override.includes('max-size=10m'), false);

		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const stored = parseImageSpec({ ...spec('service'), logging: pair });
		if (!stored) throw new Error('fixture spec');
		const entry = imageEntry(null);
		entry.spec = stored;
		const editHtml = render(CatalogImageForm, {
			props: { mode: 'edit', entry, saveAction: '?/catalogUpdate', sets: [] }
		}).body;
		function inputTag(source: string, id: string): string {
			const found = [...source.matchAll(/<input\b[^>]*>/g)].map((match) => match[0]).find((tag) => tag.includes(`id="${id}"`));
			assert.equal(found != null, true, id);
			return found ?? '';
		}
		const sizeInput = inputTag(editHtml, 'catalog-image-web-log-size');
		const filesInput = inputTag(editHtml, 'catalog-image-web-log-files');
		assert.match(sizeInput, /name="log_max_size_mb"/);
		assert.match(sizeInput, /placeholder="10"/);
		assert.match(sizeInput, /min="1"/);
		assert.match(sizeInput, /max="100"/);
		assert.match(sizeInput, /value="5"/);
		assert.match(filesInput, /name="log_max_files"/);
		assert.match(filesInput, /placeholder="3"/);
		assert.match(filesInput, /max="10"/);
		assert.match(filesInput, /value="2"/);
		assert.equal(editHtml.includes('>Logs<'), true);
		assert.equal(editHtml.includes('Max size per file (MB)'), true);
		assert.equal(editHtml.includes('Files kept'), true);
		assert.equal(editHtml.includes('Deploybot uses 10 MB and 3 files.'), true);
		const editPreview = editHtml.slice(editHtml.indexOf('aria-label="docker run preview"'), editHtml.indexOf('</pre>', editHtml.indexOf('aria-label="docker run preview"')));
		assert.match(editPreview, /--log-opt max-size=5m --log-opt max-file=2/);

		const createHtml = render(CatalogImageForm, {
			props: { mode: 'create', saveAction: '?/catalogCreate', sets: [], setsStatus: 'ready', editor: null }
		}).body;
		const blankSizeInput = inputTag(createHtml, 'catalog-image-new-log-size');
		assert.match(blankSizeInput, /placeholder="10"/);
		assert.equal(blankSizeInput.includes('value="'), false);
		const createPreview = createHtml.slice(createHtml.indexOf('aria-label="docker run preview"'), createHtml.indexOf('</pre>', createHtml.indexOf('aria-label="docker run preview"')));
		assert.match(createPreview, /--log-opt max-size=10m --log-opt max-file=3/);

		const jobEntry = imageEntry(null);
		jobEntry.spec = { ...stored, kind: 'job', restart: 'no', healthy_after_sec: 0, timeout_sec: 600 };
		const jobHtml = render(CatalogImageForm, {
			props: { mode: 'edit', entry: jobEntry, saveAction: '?/catalogUpdate', sets: [] }
		}).body;
		assert.equal(jobHtml.includes('Health check (Docker)'), false);
		assert.equal(jobHtml.includes('aria-label="Logs"'), true);
		assert.match(inputTag(jobHtml, 'catalog-image-web-log-size'), /value="5"/);

		const message = 'Max size per file must be an integer from 1 to 100 MB.';
		const invalidDraft = blankImageDraft();
		invalidDraft.logMaxSizeMb = '0';
		invalidDraft.logMaxFiles = '2';
		const invalidHtml = render(CatalogImageForm, {
			props: {
				mode: 'create',
				saveAction: '?/catalogCreate',
				sets: [],
				editor: { mode: 'create', name: null, draft: invalidDraft, field: 'logging.max_size_mb', message }
			}
		}).body;
		const sizeAt = invalidHtml.indexOf('id="catalog-image-new-log-size"');
		const errorAt = invalidHtml.indexOf(message);
		const filesAt = invalidHtml.indexOf('Files kept');
		assert.equal(sizeAt >= 0 && errorAt > sizeAt && filesAt > errorAt, true);
		assert.match(invalidHtml, /id="catalog-image-new-log-size"[^>]*aria-invalid="true"/);
		assert.match(invalidHtml, /aria-describedby="catalog-image-new-error"/);
	});

	test('pasting the docker run preview restores log options and the image', () => {
		function source(size: string, files: string) {
			const draft = blankImageDraft();
			draft.image = 'ghcr.io/acme/web:1';
			draft.command = ['serve'];
			draft.entrypoint = ['/entry'];
			draft.ports = [
				{ host: '8080', container: '80', public: true },
				{ host: '9090', container: '90', public: false }
			];
			draft.env = [{ key: 'PORT', value: '' }];
			draft.volumes = [{ name: 'data', target: '/data', readOnly: true }];
			draft.restart = 'on-failure';
			draft.user = 'app';
			draft.logMaxSizeMb = size;
			draft.logMaxFiles = files;
			return draft;
		}
		function roundTrip(size: string, files: string) {
			const draft = source(size, files);
			const line = dockerRunPreview({
				name: 'web',
				image: draft.image,
				command: draft.command,
				entrypoint: draft.entrypoint,
				ports: draft.ports.map((port) => ({ host: Number(port.host), container: Number(port.container), public: port.public })),
				envKeys: draft.env.map((row) => row.key),
				volumes: draft.volumes,
				restart: draft.restart,
				user: draft.user,
				memoryMb: null,
				logging: loggingForPreview(draft.logMaxSizeMb, draft.logMaxFiles)
			});
			const parsed = parseDockerRun(line);
			assert.equal(parsed.ok, true, line);
			if (!parsed.ok) return null;
			assert.equal(parsed.draft.image, draft.image, line);
			const applied = applyDockerPaste(blankImageDraft(), parsed);
			assert.equal(applied.image, draft.image);
			assert.deepEqual(applied.command, draft.command);
			assert.deepEqual(applied.entrypoint, draft.entrypoint);
			assert.deepEqual(applied.ports, draft.ports);
			assert.deepEqual(applied.env, draft.env);
			assert.deepEqual(applied.volumes, draft.volumes);
			assert.equal(applied.restart, draft.restart);
			assert.equal(applied.user, draft.user);
			assert.equal(applied.logMaxSizeMb, draft.logMaxSizeMb);
			assert.equal(applied.logMaxFiles, draft.logMaxFiles);
			return applied;
		}
		const defaults = roundTrip('', '');
		if (!defaults) return;
		const defaultSpec = imageSpecFromDraft(defaults);
		assert.equal(defaultSpec.ok, true);
		if (!defaultSpec.ok) return;
		assert.equal(defaultSpec.spec.logging, null);
		assert.equal(Object.hasOwn(imageRequestBody(defaultSpec.spec, null).spec as Record<string, unknown>, 'logging'), false);
		const override = roundTrip('5', '2');
		if (!override) return;
		const overrideSpec = imageSpecFromDraft(override);
		assert.equal(overrideSpec.ok, true);
		if (!overrideSpec.ok) return;
		assert.deepEqual(overrideSpec.spec.logging, { max_size_mb: 5, max_files: 2 });

		const filled = source('5', '2');
		const unchanged = parseDockerRun('docker run nginx');
		assert.equal(unchanged.ok, true);
		if (!unchanged.ok) return;
		const kept = applyDockerPaste(filled, unchanged);
		assert.equal(kept.logMaxSizeMb, '5');
		assert.equal(kept.logMaxFiles, '2');
		const cleared = parseDockerRun('docker run --log-opt max-size=10m --log-opt max-file=3 nginx');
		assert.equal(cleared.ok, true);
		if (!cleared.ok) return;
		const blankLogs = applyDockerPaste(filled, cleared);
		assert.equal(blankLogs.logMaxSizeMb, '');
		assert.equal(blankLogs.logMaxFiles, '');
		assert.equal(blankLogs.image, 'nginx');

		for (const line of [
			'docker run --log-opt max-size=5m --log-opt max-file=2 nginx extra',
			'docker run --log-opt=max-size=5m --log-opt=max-file=2 nginx extra',
			'docker run --log-opt max-size=5 --log-opt=max-file=2 nginx extra',
			'docker run --log-opt=max-file=2 --log-opt max-size=5m nginx extra'
		]) {
			const parsed = parseDockerRun(line);
			assert.equal(parsed.ok, true, line);
			if (!parsed.ok) continue;
			assert.equal(parsed.draft.image, 'nginx', line);
			assert.deepEqual(parsed.draft.command, ['extra'], line);
			const applied = applyDockerPaste(blankImageDraft(), parsed);
			assert.equal(applied.logMaxSizeMb, '5', line);
			assert.equal(applied.logMaxFiles, '2', line);
		}
		const edges = parseDockerRun('docker run --log-opt max-size=100m --log-opt max-file=10 ghcr.io/acme/web:1');
		assert.equal(edges.ok, true);
		if (!edges.ok) return;
		assert.equal(edges.draft.image, 'ghcr.io/acme/web:1');
		assert.equal(applyDockerPaste(blankImageDraft(), edges).logMaxSizeMb, '100');
		assert.equal(applyDockerPaste(blankImageDraft(), edges).logMaxFiles, '10');
		const low = parseDockerRun('docker run --log-opt=max-size=1 --log-opt=max-file=1 nginx');
		assert.equal(low.ok, true);
		if (!low.ok) return;
		assert.equal(applyDockerPaste(blankImageDraft(), low).logMaxSizeMb, '1');
		assert.equal(applyDockerPaste(blankImageDraft(), low).logMaxFiles, '1');
		const consumed = parseDockerRun('docker run --log-opt max-size=5m --log-opt max-file=2');
		assert.equal(consumed.ok, false);
		if (!consumed.ok) assert.equal(consumed.message, 'The docker run command has no image.');

		const sizeBounds = '--log-opt max-size must be an integer from 1 to 100 MB.';
		const filesBounds = '--log-opt max-file must be an integer from 1 to 10.';
		const oneKey = '--log-opt max-size and max-file must both be set.';
		const cases: Array<[string, string, string]> = [
			['docker run --log-opt max-size=0m --log-opt max-file=2 nginx', sizeBounds, 'nginx'],
			['docker run --log-opt max-size=101 --log-opt max-file=2 nginx', sizeBounds, '101'],
			['docker run --log-opt=max-size=10g --log-opt max-file=2 nginx', sizeBounds, '10g'],
			['docker run --log-opt max-size=5M --log-opt max-file=2 nginx', sizeBounds, '5M'],
			['docker run --log-opt max-size=5m --log-opt max-file=0 nginx', filesBounds, 'nginx'],
			['docker run --log-opt max-size=5m --log-opt max-file=11 nginx', filesBounds, '11'],
			['docker run --log-opt max-size=5m --log-opt=max-file=2m nginx', filesBounds, '2m'],
			['docker run --log-opt label=SECRETOPT nginx', '--log-opt is not supported.', 'SECRETOPT'],
			['docker run --log-opt=mode=non-blocking nginx', '--log-opt is not supported.', 'non-blocking'],
			['docker run --log-driver json-file nginx', '--log-driver is not supported.', 'json-file'],
			['docker run --log-driver=journald nginx', '--log-driver is not supported.', 'journald'],
			['docker run --log-opt max-size=5m nginx', oneKey, 'nginx'],
			['docker run --log-opt=max-file=2 nginx', oneKey, 'nginx']
		];
		for (const [line, message, hidden] of cases) {
			const parsed = parseDockerRun(line);
			assert.equal(parsed.ok, false, line);
			if (parsed.ok) continue;
			assert.equal(parsed.message, message, line);
			assert.equal(parsed.message.includes(hidden), false, line);
		}
	});

	test('putEnvKey sends is_secret only when adding, and deleteEnvKey does not send a value', async () => {
		const calls = installFetch(() => envelope({}));
		const base = {
			session: TOKEN,
			user: USER,
			projects: [PROJECT],
			params: { id: PROJECT.id }
		};
		await expectRedirect(() =>
			projectActions.putEnvKey(
				fakeEvent({
					...base,
					url: `http://console.example/projects/${PROJECT.id}?tab=settings&/putEnvKey`,
					form: { set: 'app', key: 'API_TOKEN', value: SECRET, op: 'add', is_secret: '1' }
				}).event as never
			)
		);
		assert.equal(calls[0]?.method, 'PUT');
		assert.equal(calls[0]?.url.pathname, `/v1/projects/${PROJECT.id}/env-sets/app/keys/API_TOKEN`);
		assert.equal(calls[0]?.url.href.includes(SECRET), false);
		assert.deepEqual(JSON.parse(calls[0]?.body ?? '{}'), { value: SECRET, is_secret: true });

		await expectRedirect(() =>
			projectActions.putEnvKey(
				fakeEvent({
					...base,
					url: `http://console.example/projects/${PROJECT.id}?tab=settings&/putEnvKey`,
					form: { set: 'app', key: 'LOG_LEVEL', value: PLAIN, op: 'add', is_secret: '0' }
				}).event as never
			)
		);
		assert.deepEqual(JSON.parse(calls[1]?.body ?? '{}'), { value: PLAIN, is_secret: false });

		await expectRedirect(() =>
			projectActions.putEnvKey(
				fakeEvent({
					...base,
					url: `http://console.example/projects/${PROJECT.id}?tab=settings&/putEnvKey`,
					form: { set: 'app', key: 'LOG_LEVEL', value: '', is_secret: '0' }
				}).event as never
			)
		);
		assert.deepEqual(JSON.parse(calls[2]?.body ?? '{}'), { value: '' });
		assert.equal(Object.hasOwn(JSON.parse(calls[2]?.body ?? '{}') as object, 'is_secret'), false);

		installFetch(() => envelope(null, 400, 'bad_request', `refused ${SECRET}`));
		const failed = await projectActions.putEnvKey(
			fakeEvent({
				...base,
				url: `http://console.example/projects/${PROJECT.id}?tab=settings&/putEnvKey`,
				form: { set: 'app', key: 'API_TOKEN', value: SECRET }
			}).event as never
		);
		const failedData = actionData(failed);
		assert.equal(failedData.settingsField ?? null, null);
		assert.equal(failedData.message?.includes(SECRET), false);
		assert.equal(failedData.message?.includes('[redacted]'), true);
		assert.equal(failedData.message?.includes('Paste the value again.'), false);
		assert.equal(JSON.stringify(failed).includes(SECRET), false);

		const local = await projectActions.putEnvKey(
			fakeEvent({
				...base,
				url: `http://console.example/projects/${PROJECT.id}?tab=settings&/putEnvKey`,
				form: { set: 'app', key: 'API_TOKEN', value: `bad\n${SECRET}` }
			}).event as never
		);
		assert.equal(actionData(local).message?.includes(SECRET), false);
		assert.equal(actionData(local).message?.includes('line break'), true);

		const removed = installFetch(() => envelope({}));
		await expectRedirect(() =>
			projectActions.deleteEnvKey(
				fakeEvent({
					...base,
					url: `http://console.example/projects/${PROJECT.id}?tab=settings&/deleteEnvKey`,
					form: { set: 'app', key: 'API_TOKEN' }
				}).event as never
			)
		);
		assert.equal(removed[0]?.method, 'DELETE');
		assert.equal(removed[0]?.url.pathname, `/v1/projects/${PROJECT.id}/env-sets/app/keys/API_TOKEN`);
		assert.equal(removed[0]?.body, null);

		const saved = installFetch((call) => {
			assert.equal(call.method, 'PUT');
			return envelope({});
		});
		await expectRedirect(() =>
			projectActions.saveEnvSet(
				fakeEvent({
					...base,
					url: `http://console.example/projects/${PROJECT.id}?tab=settings&/saveEnvSet`,
					form: { set: 'app', dotenv: `LOG_LEVEL=${PLAIN}\nAPI_TOKEN=${SECRET}`, new_keys_secret: '0' }
				}).event as never
			)
		);
		assert.deepEqual(JSON.parse(saved[0]?.body ?? '{}'), {
			dotenv: `LOG_LEVEL=${PLAIN}\nAPI_TOKEN=${SECRET}`,
			new_keys_secret: false
		});
		const implicit = installFetch(() => envelope({}));
		await expectRedirect(() =>
			projectActions.saveEnvSet(
				fakeEvent({
					...base,
					url: `http://console.example/projects/${PROJECT.id}?tab=settings&/saveEnvSet`,
					form: { set: 'app', dotenv: 'LOG_LEVEL=info' }
				}).event as never
			)
		);
		assert.equal(JSON.parse(implicit[0]?.body ?? '{}').new_keys_secret, true);
	});

	test('a loaded settings page never contains a secret value', async () => {
		installFetch((call) => {
			if (call.url.pathname === `/v1/projects/${PROJECT.id}`) return envelope({ ...PROJECT, role: 'admin' });
			if (call.url.pathname.endsWith('/env-sets')) {
				return envelope({
					items: [
						{
							name: 'app',
							keys: [
								{ key: 'API_TOKEN', is_secret: true, value: SECRET, preview: SECRET },
								{ key: 'LOG_LEVEL', is_secret: false, value: PLAIN, preview: null }
							],
							updated_at: '2026-10-14T00:00:00Z',
							updated_by: USER.id
						}
					]
				});
			}
			if (call.url.pathname.endsWith('/hosts')) return envelope({ items: [], next_cursor: null });
			if (call.url.pathname.endsWith('/members') || call.url.pathname.endsWith('/join-tokens') || call.url.pathname.endsWith('/invites')) {
				return envelope({ items: [], next_cursor: null });
			}
			if (call.url.pathname.endsWith('/registries') || call.url.pathname.endsWith('/files')) return envelope({ items: [] });
			return envelope(null, 500, 'error', 'unexpected');
		});
		const loaded = await projectLoad(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=settings`,
				session: TOKEN,
				user: USER,
				projects: [{ ...PROJECT, role: 'admin' }],
				params: { id: PROJECT.id }
			}).event as never
		);
		const json = JSON.stringify(loaded);
		assert.equal(json.includes(SECRET), false);
		assert.equal(json.includes(PLAIN), true);
	});

	test('the plain and secret toggle is gone, and the table shows preview only for a secret', () => {
		const actions = readFileSync(new URL('../src/lib/server/image-actions.ts', import.meta.url), 'utf8');
		const page = readFileSync(new URL('../src/routes/projects/[id]/+page.server.ts', import.meta.url), 'utf8');
		const settings = readFileSync(new URL('../src/routes/projects/[id]/SettingsSection.svelte', import.meta.url), 'utf8');
		assert.equal(actions.includes('patchEnvKey'), false);
		assert.equal(actions.includes('function putEnvKey'), true);
		assert.equal(actions.includes('function deleteEnvKey'), true);
		assert.equal(page.includes('patchEnvKey'), false);
		assert.equal(settings.includes('patchEnvKey'), false);
		assert.equal(settings.includes('Make secret'), false);
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=settings`);
		const sets: EnvSet[] = [
			{
				name: 'app',
				keys: [
					{ key: 'API_TOKEN', is_secret: true, value: SECRET, preview: 'supe\u2026' },
					{ key: 'LOG_LEVEL', is_secret: false, value: PLAIN, preview: null }
				],
				updated_at: '2026-10-14T00:00:00Z',
				updated_by: USER.id
			}
		];
		const html = render(SettingsSection, {
			props: { project: PROJECT, canOwner: false, canAdmin: true, message: null, envSets: sets, registries: [] }
		}).body;
		assert.equal(html.includes(SECRET), false);
		assert.equal(html.includes('supe\u2026') || html.includes('supe…'), true);
		assert.equal(html.includes(PLAIN), true);
		assert.equal(html.includes('Copy LOG_LEVEL'), true);
		assert.equal(html.includes('Copy API_TOKEN'), false);
		assert.equal(html.includes('secret, preview only'), true);
		assert.equal(html.includes('select-none'), true);
		assert.equal(html.includes('Add variable'), true);
		assert.equal(html.includes('New env set'), true);
		assert.equal(html.includes('Add env set'), false);
		assert.equal(html.includes('Make secret'), false);
		assert.equal(html.includes('Make plain'), false);
	});

	test('an env set starts expanded, and Add variable inserts a row at the top', () => {
		const drafted = { ...beginAddVariable(initialEnvSetPanel()), addKey: 'TOKEN', addPlain: 'x', addSecret: false };
		const closed = toggleEnvSet(drafted);
		assert.equal(closed.open, false);
		assert.equal(closed.adding, true);
		assert.equal(closed.addKey, 'TOKEN');
		assert.equal(closed.addSecret, false);
		const opened = beginAddVariable({ ...initialEnvSetPanel(), open: false });
		assert.equal(opened.open, true);
		assert.equal(opened.adding, true);
		assert.equal(opened.addSecret, true);
		const cleared = cancelAddVariable({ ...opened, addKey: 'TOKEN', addPlain: 'x', addSecret: false });
		assert.equal(cleared.open, true);
		assert.equal(cleared.adding, false);
		assert.equal(cleared.addKey, '');
		assert.equal(cleared.addPlain, '');
		assert.equal(cleared.addSecret, true);

		const table = readFileSync(new URL('../src/routes/projects/[id]/EnvSetTable.svelte', import.meta.url), 'utf8');
		const addAt = table.indexOf('name="op"');
		const eachAt = table.indexOf('{#each set.keys');
		assert.equal(addAt > 0 && eachAt > addAt, true);
		assert.equal(table.slice(eachAt).includes('name="op"'), false);
		assert.equal(table.includes('onkeydown'), false);
		assert.equal(table.match(/editing = null/g)?.length, 1);
		assert.match(table, /panel = toggleEnvSet\(panel\)/);
		assert.match(table, /panel = beginAddVariable\(panel\)/);
		assert.match(table, /panel = cancelAddVariable\(panel\)/);
		assert.match(table, /hidden=\{!panel\.open\}/);

		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=settings`);
		const html = render(SettingsSection, {
			props: {
				project: PROJECT,
				canOwner: false,
				canAdmin: true,
				message: null,
				envSets: [
					{
						name: 'app',
						keys: [
							{ key: 'API_TOKEN', is_secret: true, value: null, preview: 'supe\u2026' },
							{ key: 'LOG_LEVEL', is_secret: false, value: PLAIN, preview: null }
						],
						updated_at: '2026-10-14T00:00:00Z',
						updated_by: USER.id
					}
				],
				registries: []
			}
		}).body;
		const actionAt = html.indexOf('data-slot="card-action"');
		const newAt = html.indexOf('>New env set<');
		const addAtHtml = html.indexOf('Add variable');
		const tableAt = html.indexOf('id="env-table-app"');
		assert.equal(actionAt >= 0 && newAt > actionAt && addAtHtml > newAt && tableAt > addAtHtml, true);
		assert.equal(html.includes('2 keys'), true);
		assert.equal(html.includes('name="op"'), false);
		const toggle = [...html.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]).find((tag) => tag.includes('aria-controls="env-table-app"'));
		assert.equal(toggle?.includes('aria-expanded="true"'), true);
		assert.equal(toggle?.includes('type="button"'), true);
		const tableTag = html.match(/<table\b[^>]*id="env-table-app"[^>]*>/)?.[0] ?? '';
		assert.equal(tableTag.includes('hidden'), false);
		const newer = html.match(/<button\b[^>]*id="new-env-set"[^>]*>/)?.[0] ?? '';
		assert.equal(newer.includes('aria-expanded="false"'), true);
	});

	test('an admin sees Edit and not Create, Delete, or Permissions', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const entry = imageEntry(null);
		const admin = render(CatalogSection, {
			props: {
				canOwner: false,
				canAdmin: true,
				entries: [entry],
				omitted: 0,
				truncated: false,
				message: null,
				hosts: [],
				members: []
			}
		}).body;
		assert.equal(admin.includes('Edit web'), true);
		assert.equal(admin.includes('Delete web'), false);
		assert.equal(admin.includes('Permissions web'), false);
		assert.equal(admin.includes('New service'), false);
		assert.equal(admin.includes('Container'), false);
		const viewer = render(CatalogSection, {
			props: {
				canOwner: false,
				entries: [entry],
				omitted: 0,
				truncated: false,
				message: null,
				hosts: [],
				members: []
			}
		}).body;
		assert.equal(viewer.includes('Edit web'), false);
	});

	test('a docker health badge names its source and a null latency is hidden', () => {
		assert.equal(healthSourceLabel({ gone_at: null, health: { source: 'docker' } }), 'Docker health check');
		assert.equal(healthSourceLabel({ gone_at: null, health: { source: 'check' } }), 'Deploybot check');
		assert.equal(healthSourceLabel({ gone_at: '2026-10-14T00:00:00Z', health: { source: 'docker' } }), null);
		assert.equal(healthSourceLabel({ gone_at: null, health: null }), null);
		const dockerBadge = render(StatusBadge, { props: { status: 'up', hint: 'Docker health check' } }).body;
		assert.equal(dockerBadge.includes('Docker health check'), true);
		assert.equal(dockerBadge.includes('title="Docker health check"'), true);
		const checkBadge = render(StatusBadge, { props: { status: 'up', hint: 'Deploybot check' } }).body;
		assert.equal(checkBadge.includes('Deploybot check'), true);
		assert.equal(render(StatusBadge, { props: { status: 'up' } }).body.includes('Docker health check'), false);

		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=services`);
		const health: Health = { status: 'up', last_checked_at: '2026-10-14T00:00:00Z', latency_ms: null, source: 'docker' };
		const row: ProjectServiceRow = {
			id: SERVICE_ID,
			name: 'web',
			source: 'owned',
			kind: 'container',
			ports: [80],
			health,
			last_seen_at: null,
			gone_at: null,
			display_name: null,
			owner_user: null,
			project_id: PROJECT.id,
			host_id: HOST_ID,
			host_name: 'pi1',
			host_status: 'online',
			project_name: 'Lab',
			catalog_entry: null,
			container_name: 'web-1',
			image_digest: null,
			checks: [],
			checksMessage: null
		};
		const services = render(ServicesSection, {
			props: {
				projectId: PROJECT.id,
				projectName: 'Lab',
				hosts: [{ id: HOST_ID, name: 'pi1', relation: 'owner', share_level: null } as Host],
				canAdmin: true,
				rows: [row],
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
		assert.equal(services.includes('Docker health check'), true);

		const dialog = render(HealthChecks, {
			props: {
				action: '?/saveHealthChecks',
				probeAction: '?/probe',
				serviceId: SERVICE_ID,
				rowLabel: 'web',
				ports: [80],
				checks: [],
				health,
				failed: true
			}
		}).body;
		// Dialog content is portaled, so the open trigger is what SSR returns.
		assert.match(dialog, /aria-expanded="true"/);
		const source = readFileSync(new URL('../src/routes/projects/[id]/HealthChecks.svelte', import.meta.url), 'utf8');
		const sentence = "Docker reports this container's health; the checks below are used only when Docker has none.";
		const branchAt = source.indexOf("{#if health?.source === 'docker'}");
		const sentenceAt = source.indexOf(sentence);
		const latencyAt = source.indexOf('{#if health?.latency_ms != null}');
		assert.equal(branchAt >= 0 && sentenceAt > branchAt && latencyAt > sentenceAt, true);
	});

	test('the image form shows a Docker health check for a service and hides it for a job', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const serviceHtml = render(CatalogImageForm, {
			props: {
				mode: 'edit',
				entry: imageEntry({ test: ['CMD', '--ready'], interval_sec: 10, timeout_sec: 2, retries: 4, start_period_sec: 6 }),
				saveAction: '?/catalogUpdate',
				sets: []
			}
		}).body;
		assert.equal(serviceHtml.includes('Health check (Docker)'), true);
		assert.equal(serviceHtml.includes('CMD'), true);
		assert.equal(serviceHtml.includes('--ready'), true);
		assert.equal(serviceHtml.includes('min="5"'), true);
		assert.equal(serviceHtml.includes('max="300"'), true);
		assert.equal(serviceHtml.includes('min="1"'), true);
		assert.equal(serviceHtml.includes('max="60"'), true);
		assert.equal(serviceHtml.includes('max="10"'), true);
		assert.equal(serviceHtml.includes('max="600"'), true);
		const job = imageEntry(null);
		job.spec = { ...job.spec, kind: 'job', restart: 'no', healthy_after_sec: 0, timeout_sec: 600 };
		const jobHtml = render(CatalogImageForm, {
			props: { mode: 'edit', entry: job, saveAction: '?/catalogUpdate', sets: [] }
		}).body;
		assert.equal(jobHtml.includes('Health check (Docker)'), false);
	});
});
