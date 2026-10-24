import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { isActionFailure, isRedirect } from '@sveltejs/kit';
import { render } from 'svelte/server';
import type { CatalogEntry, EnvSet, Host, ImageDeploy, ImageEntry, ImageSpec, ProjectFile, ProjectServiceRow, Registry } from '../src/lib/api-types.ts';
import { IMAGE_DEPLOY_TIP, IMAGE_RUN_TIP } from '../src/lib/catalog.ts';
import { formatBytes, formatWhen } from '../src/lib/format.ts';
import { API_TIMEOUT_MS } from '../src/lib/server/api.ts';
import { clearSecretField, settleFileSave, showViewedFile } from '../src/lib/secret-field.ts';
import {
	acceptHostHistory,
	applyDockerPaste,
	applyHistoryResponse,
	blankImageDraft,
	dockerRunPreview,
	historyAfterSwitch,
	historyFetch,
	historyNotice,
	imageDraftFromForm,
	imagePortText,
	imageRequestBody,
	imageSpecFromDraft,
	setPortPublic,
	nextHistory,
	nextIdempotencyKey,
	nextRollbackKey,
	parseDockerRun,
	redactSubmitted,
	rollbackDigests,
	shortDigest,
	switchedHistoryHost
} from '../src/lib/image-spec.ts';
import { parseCatalogEntry, parseCatalogList, parseDeployPayload, parseHostPrograms, parseImageLogs, parseImageSpec, parseImageStatus, parseProjectFile, parseProjectFileContent, parseProjectFileList, parseService } from '../src/lib/server/shape.ts';
import CatalogDeployForm from '../src/routes/projects/[id]/CatalogDeployForm.svelte';
import CatalogImageForm from '../src/routes/projects/[id]/CatalogImageForm.svelte';
import CatalogRunForm from '../src/routes/projects/[id]/CatalogRunForm.svelte';
import CatalogPermissionsForm from '../src/routes/projects/[id]/CatalogPermissionsForm.svelte';
import CatalogSection from '../src/routes/projects/[id]/CatalogSection.svelte';
import ProjectPage from '../src/routes/projects/[id]/+page.svelte';
import ServicesSection from '../src/routes/projects/[id]/ServicesSection.svelte';
import SettingsSection from '../src/routes/projects/[id]/SettingsSection.svelte';
import { actions as projectActions, load as projectLoad } from '../src/routes/projects/[id]/+page.server.ts';
import {
	imageAuxFormSettle,
	imageDialogReveal,
	imageEditorDialog,
	imageNoticeOnCloseComplete,
	imageNoticeOnDialog,
	imageNoticeOnSave,
	imageNoticeOnSubmit,
	imageNoticeOnView,
	imageSaveView,
	settleImageAuxLoad,
	settleImageForm,
	type ImageNoticeSeen
} from '../src/lib/dialog-open.ts';
import { namedFormAction } from '../src/lib/url.ts';
import { parse } from 'svelte/compiler';
import { envelope, fakeEvent, installFetch, PROJECT, restoreEnv, TOKEN, useApi, USER } from './harness.ts';
import { setPageUrl } from './stubs/app-state.ts';

const HOST_ID = '00000000-0000-4000-8000-0000000000aa';
const ENTRY_ID = '00000000-0000-4000-8000-0000000000c1';
const HASH = 'ab'.repeat(32);
const KEY = 'image-key-1';
const SECRET = 'super-secret-value-99';
const PLAIN = 'visible-plain-value-99';
const REGISTRY_TOKEN = 'registry-token-secret';

function readSource(path: string): string {
	return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function inlineAttributes(source: string): Array<{ name: string; attrs: string[] }> {
	const ast = parse(source) as { html?: unknown };
	const found: Array<{ name: string; attrs: string[] }> = [];
	function walk(node: unknown): void {
		if (!node || typeof node !== 'object') return;
		const record = node as { type?: string; name?: string; attributes?: Array<{ name?: string }> };
		if (record.type === 'InlineComponent' && record.name) {
			found.push({ name: record.name, attrs: (record.attributes ?? []).map((attr) => attr.name ?? '') });
		}
		for (const value of Object.values(record)) {
			if (Array.isArray(value)) value.forEach(walk);
			else if (value && typeof value === 'object') walk(value);
		}
	}
	walk(ast.html);
	return found;
}

function scriptCalls(source: string): string[] {
	const ast = parse(source) as { instance?: unknown };
	const calls: string[] = [];
	function walk(node: unknown): void {
		if (!node || typeof node !== 'object') return;
		const record = node as { type?: string; callee?: { type?: string; name?: string } };
		if (record.type === 'CallExpression' && record.callee?.type === 'Identifier' && record.callee.name) {
			calls.push(record.callee.name);
		}
		for (const value of Object.values(record)) {
			if (Array.isArray(value)) value.forEach(walk);
			else if (value && typeof value === 'object') walk(value);
		}
	}
	walk(ast.instance);
	return calls;
}

function digest(ch: string): string {
	return `sha256:${ch.repeat(64)}`;
}

function imageSpec(kind: ImageSpec['kind'] = 'service'): ImageSpec {
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
		healthy_after_sec: 30,
		memory_mb: null,
		timeout_sec: 600,
		healthcheck: null,
		logging: null,
		health_policy: null
	};
}

function imageEntry(my_actions: ImageEntry['my_actions']): ImageEntry {
	return {
		id: ENTRY_ID,
		project_id: PROJECT.id,
		name: 'web',
		kind: 'image',
		spec: imageSpec(),
		spec_hash: HASH,
		command_display: 'ghcr.io/acme/web:1',
		created_by: USER.id,
		created_at: '2026-10-14T00:00:00Z',
		updated_at: '2026-10-14T00:00:00Z',
		my_actions
	};
}

function programEntry(): CatalogEntry {
	return {
		id: ENTRY_ID,
		project_id: PROJECT.id,
		name: 'web',
		kind: 'program',
		spec: {
			dir: '/srv/app',
			exec: 'npm',
			args: ['run', 'dev'],
			shell: false,
			run_as: 'joe',
			env: {},
			port: 3031,
			restart: 'on-failure'
		},
		spec_hash: HASH,
		command_display: 'npm run dev',
		created_by: USER.id,
		created_at: '2026-10-14T00:00:00Z',
		updated_at: '2026-10-14T00:00:00Z',
		my_actions: ['logs']
	};
}

function host(): Host {
	return {
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
		programs: { enabled: true, run_as: ['joe'], allow_shell: true, policy_hash: 'policy-1', images: true, docker: true, files: false, logging: false, health_policy: false }
	};
}

function deployRow(id: string, outcome: ImageDeploy['outcome'], imageDigest: string | null): ImageDeploy {
	return {
		id,
		entry_id: ENTRY_ID,
		host_id: HOST_ID,
		digest: imageDigest,
		spec_hash: HASH,
		outcome,
		exit_code: outcome === 'failed' ? 1 : 0,
		started_at: '2026-10-14T00:00:00Z',
		finished_at: '2026-10-14T00:01:00Z',
		by: USER.id,
		via: 'console'
	};
}

function statusBody() {
	return {
		container: 'web',
		state: 'running',
		exit_code: null,
		restart_count: 0,
		started_at: '2026-10-14T00:00:00Z',
		finished_at: null,
		digest: digest('a'),
		ports: []
	};
}

function deployPayload(outcome: ImageDeploy['outcome'] = 'succeeded') {
	return {
		deploy: deployRow('00000000-0000-4000-8000-0000000000e1', outcome, digest('a')),
		status: statusBody(),
		lines: ['ready']
	};
}

function spyTimeouts(mode: 'hold' | 'abort'): { seen: number[]; restore: () => void } {
	const seen: number[] = [];
	const original = AbortSignal.timeout;
	const replacement = (ms: number) => {
		seen.push(ms);
		if (mode === 'abort') return AbortSignal.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
		return new AbortController().signal;
	};
	Object.defineProperty(AbortSignal, 'timeout', { configurable: true, writable: true, value: replacement });
	return {
		seen,
		restore() {
			Object.defineProperty(AbortSignal, 'timeout', { configurable: true, writable: true, value: original });
		}
	};
}

function actionData(result: unknown): {
	message?: string;
	settingsField?: 'dotenv' | 'token' | 'file' | null;
	imageDeploy?: { message?: string | null; history?: ImageDeploy[] | null; confirmation?: { plan: string } | null };
	imageEditor?: { draft: { env: Array<{ key: string; value: string }> }; message: string | null; field: string | null };
} {
	assert.equal(isActionFailure(result), true);
	if (!isActionFailure(result)) return {};
	return result.data as unknown as {
		message?: string;
		settingsField?: 'dotenv' | 'token' | 'file' | null;
		imageDeploy?: { message?: string | null; history?: ImageDeploy[] | null; confirmation?: { plan: string } | null };
		imageEditor?: { draft: { env: Array<{ key: string; value: string }> }; message: string | null; field: string | null };
	};
}

describe('catalog images', { concurrency: false }, () => {
	const originalFetch = globalThis.fetch;
	const originalTimeout = AbortSignal.timeout;

	before(() => {
		useApi('https://api.test');
	});

	after(() => {
		globalThis.fetch = originalFetch;
		Object.defineProperty(AbortSignal, 'timeout', { configurable: true, writable: true, value: originalTimeout });
		restoreEnv();
	});

	test('an image form maps empty argv to null and a job forces restart no', () => {
		const service = new FormData();
		service.set('name', 'web');
		service.set('workload', 'service');
		service.set('image', 'ghcr.io/acme/web:1');
		service.set('restart', 'on-failure');
		service.set('healthy_after_sec', '40');
		service.append('command', '');
		service.append('entrypoint', '');
		service.append('port_host', '8080');
		service.append('port_container', '80');
		service.append('port_public', '1');
		const built = imageDraftFromForm(service);
		assert.equal(built.message, null);
		const check = imageSpecFromDraft(built.draft, undefined, true);
		assert.equal(check.ok, true);
		if (!check.ok) return;
		assert.equal(check.spec.command, null);
		assert.equal(check.spec.entrypoint, null);
		assert.equal(check.spec.restart, 'on-failure');
		assert.deepEqual(check.spec.ports, [{ host: 8080, container: 80, public: true }]);
		const body = imageRequestBody(check.spec, check.name);
		assert.equal(body.kind, 'image');
		const spec = body.spec as Record<string, unknown>;
		assert.equal(spec.healthy_after_sec, 40);
		assert.equal(Object.hasOwn(spec, 'timeout_sec'), false);

		const job = new FormData();
		job.set('name', 'migrate');
		job.set('workload', 'job');
		job.set('image', 'ghcr.io/acme/web:1');
		job.set('restart', 'unless-stopped');
		job.set('timeout_sec', '90');
		job.append('command', 'npm');
		job.append('command', '');
		const jobCheck = imageSpecFromDraft(imageDraftFromForm(job).draft, undefined, true);
		assert.equal(jobCheck.ok, true);
		if (!jobCheck.ok) return;
		assert.deepEqual(jobCheck.spec.command, ['npm']);
		assert.equal(jobCheck.spec.restart, 'no');
		const jobSpec = imageRequestBody(jobCheck.spec, jobCheck.name).spec as Record<string, unknown>;
		assert.equal(jobSpec.restart, 'no');
		assert.equal(jobSpec.timeout_sec, 90);
		assert.equal(Object.hasOwn(jobSpec, 'healthy_after_sec'), false);
	});

	test('client checks reject a bad image form before it is saved', () => {
		const draft = blankImageDraft();
		draft.name = 'Bad';
		draft.image = 'ghcr.io/acme/web:1';
		const name = imageSpecFromDraft(draft, undefined, true);
		assert.equal(name.ok, false);
		if (name.ok) return;
		assert.equal(name.field, 'name');

		const secret = blankImageDraft();
		secret.name = 'web';
		secret.image = 'ghcr.io/acme/web:1';
		secret.env = [{ key: 'API_TOKEN', value: SECRET }];
		const token = imageSpecFromDraft(secret, undefined, true);
		assert.equal(token.ok, false);
		if (token.ok) return;
		assert.equal(token.field, 'env');
	});

	test('docker run preview shows env keys and not values', () => {
		const parsed = parseDockerRun(`docker run -e PORT=3000 -e API_TOKEN=${SECRET} ghcr.io/acme/web:1`);
		assert.equal(parsed.ok, true);
		if (!parsed.ok) return;
		const nginx = parseDockerRun('docker run -e PORT=3000 nginx');
		assert.equal(nginx.ok, true);
		if (!nginx.ok) return;
		assert.equal(nginx.draft.image, 'nginx');
		const published = parseDockerRun('docker run -p 8080:80 nginx');
		assert.equal(published.ok, true);
		if (!published.ok) return;
		assert.deepEqual(published.draft.ports, [{ host: '8080', container: '80', public: true }]);
		for (const line of [
			'docker run --memory 256m nginx',
			'docker run --gpus all nginx',
			'docker run -dp 80:80 nginx',
			'docker run --security-opt no-new-privileges nginx',
			'docker run --network bridge nginx',
			'docker run --restart always nginx'
		]) {
			const refused = parseDockerRun(line);
			assert.equal(refused.ok, false, line);
			if (refused.ok) continue;
			const flag = line.split(' ')[2] ?? '';
			assert.equal(refused.message.includes(flag), true, line);
			assert.equal(refused.message.includes('nginx'), false, line);
		}
		const privileged = parseDockerRun('docker run --privileged ghcr.io/acme/web:1');
		assert.equal(privileged.ok, false);
		if (!privileged.ok) assert.equal(privileged.message, '--privileged is not supported.');
		const hostNet = parseDockerRun('docker run --network host nginx');
		assert.equal(hostNet.ok, false);
		if (!hostNet.ok) assert.equal(hostNet.message, 'Host networking is not supported.');
		const cap = parseDockerRun('docker run --cap-add SYS_ADMIN nginx');
		assert.equal(cap.ok, false);
		if (!cap.ok) assert.equal(cap.message, '--cap-add is not supported.');
		const root = parseDockerRun('docker run --user root nginx');
		assert.equal(root.ok, false);
		if (!root.ok) assert.equal(root.message, 'Running as root is refused.');
		const bind = parseDockerRun('docker run -v /:/host nginx');
		assert.equal(bind.ok, false);
		if (!bind.ok) assert.equal(bind.message, 'Bind mounts are refused.');
		const rootUser = blankImageDraft();
		rootUser.image = 'nginx';
		rootUser.user = 'root';
		const rootCheck = imageSpecFromDraft(rootUser);
		assert.equal(rootCheck.ok, false);
		if (!rootCheck.ok) assert.equal(rootCheck.field, 'user');
		const line = dockerRunPreview({
			name: 'web',
			image: parsed.draft.image ?? '',
			command: parsed.draft.command ?? [],
			entrypoint: parsed.draft.entrypoint ?? [],
			ports: [],
			envKeys: (parsed.draft.env ?? []).map((row) => row.key),
			volumes: (parsed.draft.volumes ?? []).map((volume) => ({ name: volume.name, target: volume.target, readOnly: volume.readOnly })),
			restart: parsed.draft.restart ?? 'unless-stopped',
			user: parsed.draft.user ?? '',
			memoryMb: null
		});
		assert.match(line, /-e PORT\b/);
		assert.match(line, /-e API_TOKEN\b/);
		assert.equal(line.includes('3000'), false);
		assert.equal(line.includes(SECRET), false);
	});

	test('harmless docker run flags are ignored and listed', () => {
		const real = parseDockerRun('docker run -d --name web -p 127.0.0.1:8088:80 nginx');
		assert.equal(real.ok, true);
		if (!real.ok) return;
		assert.equal(real.draft.image, 'nginx');
		assert.deepEqual(real.draft.ports, [{ host: '8088', container: '80', public: false }]);
		assert.deepEqual(real.unsupported, ['-d', '--name']);
		const ignored: Array<[string, string[], 'service' | 'job']> = [
			['docker run -d nginx', ['-d'], 'service'],
			['docker run --detach nginx', ['--detach'], 'service'],
			['docker run --name web nginx', ['--name'], 'service'],
			['docker run --name=web nginx', ['--name'], 'service'],
			['docker run -it nginx', ['-it'], 'service'],
			['docker run -i nginx', ['-i'], 'service'],
			['docker run -t nginx', ['-t'], 'service'],
			['docker run --interactive nginx', ['--interactive'], 'service'],
			['docker run --tty nginx', ['--tty'], 'service'],
			['docker run --rm nginx', ['--rm'], 'service'],
			['docker run --rm nginx', [], 'job']
		];
		for (const [line, notice, workload] of ignored) {
			const parsed = parseDockerRun(line, workload);
			assert.equal(parsed.ok, true, line);
			if (!parsed.ok) continue;
			assert.equal(parsed.draft.image, 'nginx', line);
			assert.deepEqual(parsed.unsupported, notice, line);
		}
		const refused = parseDockerRun('docker run --gpus all nginx');
		assert.equal(refused.ok, false);
		if (!refused.ok) {
			assert.equal(refused.message, '--gpus is not supported.');
			assert.equal(refused.message.includes('nginx'), false);
		}
	});

	test('public and loopback ports round-trip through the draft, the spec, and the preview', () => {
		const form = new FormData();
		form.set('name', 'web');
		form.set('workload', 'service');
		form.set('image', 'nginx');
		form.append('port_host', '8080');
		form.append('port_container', '80');
		form.append('port_public', '1');
		form.append('port_host', '9090');
		form.append('port_container', '90');
		form.append('port_public', '0');
		const built = imageDraftFromForm(form);
		assert.equal(built.message, null);
		assert.deepEqual(built.draft.ports, [
			{ host: '8080', container: '80', public: true },
			{ host: '9090', container: '90', public: false }
		]);
		const check = imageSpecFromDraft(built.draft, undefined, true);
		assert.equal(check.ok, true);
		if (!check.ok) return;
		assert.deepEqual(check.spec.ports, [
			{ host: 8080, container: 80, public: true },
			{ host: 9090, container: 90, public: false }
		]);
		const direct = blankImageDraft();
		direct.name = 'web';
		direct.image = 'nginx';
		direct.ports = [
			{ host: '80', container: '80', public: true },
			{ host: '8080', container: '8080', public: false }
		];
		const directCheck = imageSpecFromDraft(direct, undefined, true);
		assert.equal(directCheck.ok, true);
		if (!directCheck.ok) return;
		assert.deepEqual(directCheck.spec.ports, [
			{ host: 80, container: 80, public: true },
			{ host: 8080, container: 8080, public: false }
		]);
		const preview = dockerRunPreview({
			name: 'web',
			image: 'nginx',
			command: [],
			entrypoint: [],
			ports: check.spec.ports,
			envKeys: [],
			volumes: [],
			restart: 'unless-stopped',
			user: '',
			memoryMb: null
		});
		assert.match(preview, /-p 8080:80\b/);
		assert.match(preview, /-p 127\.0\.0\.1:9090:90\b/);
		assert.equal(preview.includes('127.0.0.1:8080'), false);
		const omitted = new FormData();
		omitted.set('name', 'web');
		omitted.set('image', 'nginx');
		omitted.append('port_host', '8080');
		omitted.append('port_container', '80');
		const quiet = imageSpecFromDraft(imageDraftFromForm(omitted).draft, undefined, true);
		assert.equal(quiet.ok, true);
		if (!quiet.ok) return;
		assert.deepEqual(quiet.spec.ports, [{ host: 8080, container: 80, public: false }]);
	});

	test('pasted docker publish flags set public or refuse another bind address', () => {
		const accepted: Array<[string, Array<{ host: string; container: string; public: boolean }>]> = [
			['docker run -p 80:80 nginx', [{ host: '80', container: '80', public: true }]],
			['docker run -p 0.0.0.0:80:80 nginx', [{ host: '80', container: '80', public: true }]],
			['docker run -p 127.0.0.1:80:80 nginx', [{ host: '80', container: '80', public: false }]],
			['docker run -p localhost:80:80 nginx', [{ host: '80', container: '80', public: false }]],
			[
				'docker run -p 80:80 -p 127.0.0.1:8080:80 -p 0.0.0.0:9090:90 nginx',
				[
					{ host: '80', container: '80', public: true },
					{ host: '8080', container: '80', public: false },
					{ host: '9090', container: '90', public: true }
				]
			]
		];
		for (const [line, ports] of accepted) {
			const parsed = parseDockerRun(line);
			assert.equal(parsed.ok, true, line);
			if (!parsed.ok) continue;
			assert.deepEqual(parsed.draft.ports, ports, line);
		}
		const mixed = parseDockerRun('docker run -p 80:80 -p 127.0.0.1:8080:80 nginx');
		assert.equal(mixed.ok, true);
		if (!mixed.ok) return;
		const applied = applyDockerPaste(blankImageDraft(), mixed);
		applied.name = 'web';
		applied.image = 'nginx';
		const spec = imageSpecFromDraft(applied, undefined, true);
		assert.equal(spec.ok, true);
		if (!spec.ok) return;
		assert.deepEqual(spec.spec.ports, [
			{ host: 80, container: 80, public: true },
			{ host: 8080, container: 80, public: false }
		]);
		for (const line of ['docker run -p 192.168.1.10:80:80 nginx', 'docker run -p 10.0.0.1:80:80 nginx', 'docker run --publish 172.16.0.1:80:80 nginx']) {
			const refused = parseDockerRun(line);
			assert.equal(refused.ok, false, line);
			if (refused.ok) continue;
			assert.equal(refused.message, 'Only 127.0.0.1 or all interfaces (0.0.0.0) can be bound.', line);
			assert.equal(refused.message.includes('nginx'), false, line);
		}
		for (const line of ['docker run -p [::1]:80:80 nginx', 'docker run -p [::]:80:80 nginx']) {
			const refused = parseDockerRun(line);
			assert.equal(refused.ok, false, line);
			if (refused.ok) continue;
			assert.equal(refused.message, '-p is not supported.', line);
		}
	});

	test('the container form labels a public checkbox and keeps an existing public port', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const entry = imageEntry(['deploy']);
		entry.spec.ports = [
			{ host: 8080, container: 80, public: true },
			{ host: 9090, container: 90, public: false }
		];
		const editHtml = render(CatalogImageForm, {
			props: {
				mode: 'edit',
				entry,
				saveAction: '?/catalogUpdate',
				sets: [],
				setsStatus: 'ready',
				editor: null
			}
		}).body;
		function portBox(source: string, label: string): string {
			const tag = [...source.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]).find((item) => item.includes(`aria-label="${label}"`));
			assert.equal(tag != null, true, label);
			return tag ?? '';
		}
		function publicValues(source: string): string[] {
			return [...source.matchAll(/<input\b[^>]*>/g)]
				.map((match) => match[0])
				.filter((tag) => tag.includes('name="port_public"'))
				.map((tag) => /value="([^"]*)"/.exec(tag)?.[1] ?? '');
		}
		const open = portBox(editHtml, 'Public (all interfaces) port 1');
		const loopback = portBox(editHtml, 'Public (all interfaces) port 2');
		assert.equal(open.includes('role="checkbox"'), true);
		assert.equal(open.includes('type="button"'), true);
		assert.equal(open.includes('id="catalog-image-web-port-public-0"'), true);
		assert.equal(open.includes('aria-checked="true"'), true);
		assert.equal(loopback.includes('role="checkbox"'), true);
		assert.equal(loopback.includes('id="catalog-image-web-port-public-1"'), true);
		assert.equal(loopback.includes('aria-checked="false"'), true);
		assert.match(editHtml, /for="catalog-image-web-port-public-0"/);
		assert.equal([...editHtml.matchAll(/Public \(all interfaces\)<!----><\/label>/g)].length, 2);
		assert.deepEqual(publicValues(editHtml), ['1', '0']);
		assert.match(editHtml, /Public ports listen on all of the host's interfaces/);
		assert.match(editHtml, /allow_public_ports = true/);
		assert.match(editHtml, /Otherwise the deploy is refused\./);
		const editPreview = editHtml.slice(editHtml.indexOf('aria-label="docker run preview"'), editHtml.indexOf('</pre>', editHtml.indexOf('aria-label="docker run preview"')));
		assert.match(editPreview, /-p 8080:80\b/);
		assert.match(editPreview, /-p 127\.0\.0\.1:9090:90\b/);
		assert.equal(editPreview.includes('127.0.0.1:8080'), false);
		const created = blankImageDraft();
		created.ports = [{ host: '80', container: '80', public: false }];
		const createHtml = render(CatalogImageForm, {
			props: {
				mode: 'create',
				saveAction: '?/catalogCreate',
				sets: [],
				setsStatus: 'ready',
				editor: { mode: 'create', name: null, draft: created, field: null, message: null }
			}
		}).body;
		const fresh = portBox(createHtml, 'Public (all interfaces) port 1');
		assert.equal(fresh.includes('role="checkbox"'), true);
		assert.equal(fresh.includes('aria-checked="false"'), true);
		assert.deepEqual(publicValues(createHtml), ['0']);
		const empty = render(CatalogImageForm, {
			props: { mode: 'create', saveAction: '?/catalogCreate', sets: [], setsStatus: 'ready', editor: null }
		}).body;
		assert.match(empty, /allow_public_ports = true/);
		assert.equal(empty.includes('aria-label="Public (all interfaces) port 1"'), false);
		const formSource = readFileSync(new URL('../src/routes/projects/[id]/CatalogImageForm.svelte', import.meta.url), 'utf8');
		assert.match(formSource, /\{ host: '', container: '', public: false \}/);
	});

	test('setPortPublic toggles one port row and the checkbox calls it', () => {
		const ports = [
			{ host: '8080', container: '80', public: false },
			{ host: '9090', container: '90', public: true }
		];
		const first = ports[0];
		const second = ports[1];
		assert.ok(first);
		assert.ok(second);
		setPortPublic(first, true);
		assert.equal(first.public, true);
		assert.equal(second.public, true);
		setPortPublic(second, false);
		assert.equal(second.public, false);
		assert.equal(first.public, true);
		setPortPublic(first, 'indeterminate');
		assert.equal(first.public, false);
		assert.equal(second.public, false);
		const formSource = readFileSync(new URL('../src/routes/projects/[id]/CatalogImageForm.svelte', import.meta.url), 'utf8');
		assert.match(formSource, /onCheckedChange=\{\(value\) => setPortPublic\(draft\.ports\[index\], value\)\}/);
	});

	test('parseImageSpec keeps a public port and refuses a non-boolean', () => {
		const spec = {
			env: {},
			kind: 'service',
			user: '',
			image: 'nginx',
			ports: [{ host: 80, container: 80, public: true }],
			command: null,
			restart: 'unless-stopped',
			volumes: [],
			env_sets: [],
			memory_mb: null,
			entrypoint: null,
			secret_env: {},
			timeout_sec: 600,
			healthy_after_sec: 30
		};
		assert.deepEqual(parseImageSpec(spec)?.ports, [{ host: 80, container: 80, public: true }]);
		for (const flag of ['true', 1, null]) {
			assert.equal(parseImageSpec({ ...spec, ports: [{ host: 80, container: 80, public: flag }] }), null, String(flag));
		}
		assert.equal(parseImageSpec({ ...spec, ports: [{ host: 80, container: 80 }] }), null);
	});

	test('catalog update posts mixed port_public flags', async () => {
		const calls = installFetch(() => envelope({ id: ENTRY_ID }));
		const base = { session: TOKEN, user: USER, projects: [PROJECT], params: { id: PROJECT.id } };
		await assert.rejects(
			async () => {
				await projectActions.catalogUpdate(
					fakeEvent({
						...base,
						url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogUpdate`,
						form: {
							entry_kind: 'image',
							name: 'web',
							entry_name: 'web',
							workload: 'service',
							image: 'nginx',
							restart: 'unless-stopped',
							port_host: ['8080', '9090'],
							port_container: ['80', '90'],
							port_public: ['1', '0']
						}
					}).event as never
				);
			},
			(err: unknown) => isRedirect(err) && err.status === 303
		);
		const call = calls[0];
		assert.equal(call?.method, 'PUT');
		assert.equal(call?.url.pathname, `/v1/projects/${PROJECT.id}/catalog/web`);
		const body = JSON.parse(call?.body ?? '{}') as { spec?: { ports?: unknown } };
		assert.deepEqual(body.spec?.ports, [
			{ host: 8080, container: 80, public: true },
			{ host: 9090, container: 90, public: false }
		]);
	});

	test('the catalog row and deploy dialog mark a public port', () => {
		assert.equal(imagePortText({ host: 8080, container: 80, public: true }), '8080:80 public');
		assert.equal(imagePortText({ host: 9090, container: 90, public: false }), '9090:90');
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const mixed = imageEntry(['deploy', 'logs']);
		mixed.spec.ports = [
			{ host: 8080, container: 80, public: true },
			{ host: 9090, container: 90, public: false }
		];
		const loopback = imageEntry(['logs']);
		loopback.id = '00000000-0000-4000-8000-0000000000c2';
		loopback.name = 'api';
		loopback.spec.ports = [{ host: 9090, container: 90, public: false }];
		const program = programEntry();
		program.id = '00000000-0000-4000-8000-0000000000c3';
		const section = render(CatalogSection, {
			props: {
				canOwner: true,
				entries: [mixed, loopback, program],
				omitted: 0,
				truncated: false,
				message: null,
				hosts: [host()],
				members: []
			}
		}).body;
		const cells = [...section.matchAll(/<td class="p-2 align-middle font-mono">([^<]*)<\/td>/g)].map((match) => match[1]);
		assert.deepEqual(cells, ['8080:80 public, 9090:90', '9090:90', '3031']);
		assert.equal(section.includes('Publishes on all of the host'), false);
		const sectionSource = readFileSync(new URL('../src/routes/projects/[id]/CatalogSection.svelte', import.meta.url), 'utf8');
		const deploySource = readFileSync(new URL('../src/routes/projects/[id]/CatalogDeployForm.svelte', import.meta.url), 'utf8');
		assert.match(sectionSource, /imagePortText\(port\)/);
		assert.match(deploySource, /imagePortText\(port\)/);

		function deployHtml(entry: ImageEntry): string {
			return render(CatalogDeployForm, {
				props: {
					entry,
					hosts: [host()],
					deployAction: '?/catalogDeploy',
					rollbackAction: '?/catalogRollback',
					removeAction: '?/catalogRemove',
					confirmAction: '?/catalogConfirm',
					historyAction: '?/catalogDeploys',
					result: null
				}
			}).body;
		}
		const warning = "Publishes on all of the host's interfaces.";
		const open = deployHtml(mixed);
		const buttonAt = open.search(/>Deploy(?:<!---->)?</);
		const markedAt = open.indexOf('8080:80 public');
		const warnAt = open.indexOf(warning);
		assert.equal(markedAt >= 0 && buttonAt > markedAt, true);
		assert.equal(warnAt >= 0 && buttonAt > warnAt, true);
		assert.equal(open.includes('9090:90'), true);
		assert.equal(open.includes('9090:90 public'), false);
		const closed = deployHtml(loopback);
		assert.equal(closed.includes('9090:90'), true);
		assert.equal(closed.includes('9090:90 public'), false);
		assert.equal(closed.includes(warning), false);
		assert.equal(closed.includes('8080:80 public'), false);
	});

	test('deploy and rollback use the long timeout, and a timeout says the host is still running', async () => {
		const hold = spyTimeouts('hold');
		installFetch((call) => {
			if (call.url.pathname.endsWith('/deploys')) return envelope({ items: [] });
			if (call.url.pathname.endsWith('/deploy') || call.url.pathname.endsWith('/rollback')) return envelope(deployPayload());
			if (call.url.pathname.endsWith('/remove')) return envelope({ status: statusBody() });
			return envelope(null, 500, 'error', call.url.pathname);
		});
		const base = {
			session: TOKEN,
			user: USER,
			projects: [PROJECT],
			params: { id: PROJECT.id }
		};
		await projectActions.catalogDeploy(
			fakeEvent({
				...base,
				url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogDeploy`,
				form: { name: 'web', host_id: HOST_ID, workload: 'service', wait_sec: '40', idempotency_key: KEY, force: '1' }
			}).event as never
		);
		await projectActions.catalogRollback(
			fakeEvent({
				...base,
				url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogRollback`,
				form: { name: 'web', host_id: HOST_ID, workload: 'job', wait_sec: '90', idempotency_key: KEY, digest: digest('b') }
			}).event as never
		);
		await projectActions.catalogRemove(
			fakeEvent({
				...base,
				url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogRemove`,
				form: { name: 'web', host_id: HOST_ID, workload: 'service', wait_sec: '40', idempotency_key: KEY }
			}).event as never
		);
		assert.deepEqual(hold.seen, [430000, API_TIMEOUT_MS, 480000, API_TIMEOUT_MS, API_TIMEOUT_MS, API_TIMEOUT_MS]);
		hold.restore();

		const abort = spyTimeouts('abort');
		installFetch((call) => {
			if (call.signal?.aborted) {
				const reason = call.signal.reason;
				return Promise.reject(reason instanceof Error ? reason : new DOMException('aborted', 'AbortError'));
			}
			return envelope(deployPayload());
		});
		const failed = await projectActions.catalogDeploy(
			fakeEvent({
				...base,
				url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogDeploy`,
				form: { name: 'web', host_id: HOST_ID, workload: 'service', wait_sec: '30', idempotency_key: KEY }
			}).event as never
		);
		assert.equal(abort.seen.length, 1);
		assert.equal(abort.seen[0], 420000);
		const failedDeploy = actionData(failed).imageDeploy;
		assert.equal(failedDeploy?.message, 'Still running on the host. Check the history in a minute.');
		assert.equal(failedDeploy?.history, null);
		abort.restore();

		const rollbackAbort = spyTimeouts('abort');
		const rolled = await projectActions.catalogRollback(
			fakeEvent({
				...base,
				url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogRollback`,
				form: { name: 'web', host_id: HOST_ID, workload: 'job', wait_sec: '90', idempotency_key: KEY, digest: digest('b') }
			}).event as never
		);
		assert.equal(rollbackAbort.seen.length, 1);
		assert.equal(rollbackAbort.seen[0], 480000);
		assert.equal(actionData(rolled).imageDeploy?.message, 'Still running on the host. Check the history in a minute.');
		rollbackAbort.restore();
	});

	test('roll back is offered only for older succeeded or unchanged digests', () => {
		const history = [
			deployRow('00000000-0000-4000-8000-0000000000e1', 'failed', digest('e')),
			deployRow('00000000-0000-4000-8000-0000000000e2', 'succeeded', digest('a')),
			deployRow('00000000-0000-4000-8000-0000000000e3', 'succeeded', digest('b')),
			deployRow('00000000-0000-4000-8000-0000000000e4', 'unchanged', digest('c')),
			deployRow('00000000-0000-4000-8000-0000000000e5', 'succeeded', digest('d'))
		];
		assert.deepEqual(rollbackDigests(history), [digest('b'), digest('c')]);
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const html = render(CatalogDeployForm, {
			props: {
				entry: imageEntry(['deploy']),
				hosts: [host()],
				deployAction: '?/catalogDeploy',
				rollbackAction: '?/catalogRollback',
				removeAction: '?/catalogRemove',
				confirmAction: '?/catalogConfirm',
				historyAction: '?/catalogDeploys',
				result: {
					name: 'web',
					resultId: '00000000-0000-4000-8000-0000000000e9',
					hostId: HOST_ID,
					workload: 'service',
					waitSec: 30,
					outcome: history[1] ?? null,
					status: null,
					lines: ['ready'],
					history,
					confirmation: null,
					confirmKind: null,
					message: null
				}
			}
		}).body;
		assert.equal(html.split('Roll back').length - 1, 2);
		assert.equal(html.includes(`Roll back to ${shortDigest(digest('a'))}`), false);
		assert.equal(html.includes(`Roll back to ${shortDigest(digest('b'))}`), true);
		assert.equal(html.includes(`Roll back to ${shortDigest(digest('c'))}`), true);
		assert.equal(html.includes('succeeded'), true);
		assert.equal(html.includes('exit 0'), true);
		assert.equal(html.includes(shortDigest(digest('a')) ?? ''), true);
		assert.equal(html.includes('ready'), true);
		assert.equal(html.includes(`value="${digest('a')}"`), false);
		assert.equal(html.includes(`value="${digest('b')}"`), true);
		assert.equal(html.includes(`value="${digest('c')}"`), true);
		assert.equal(html.includes(`value="${digest('d')}"`), false);
		assert.equal(html.includes(`value="${digest('e')}"`), false);
		assert.equal(html.includes('>pi1<'), true);
		const current = [
			deployRow('00000000-0000-4000-8000-0000000000e2', 'succeeded', digest('a')),
			deployRow('00000000-0000-4000-8000-0000000000e3', 'succeeded', digest('b'))
		];
		const currentHtml = render(CatalogDeployForm, {
			props: {
				entry: imageEntry(['deploy']),
				hosts: [host()],
				deployAction: '?/catalogDeploy',
				rollbackAction: '?/catalogRollback',
				removeAction: '?/catalogRemove',
				confirmAction: '?/catalogConfirm',
				historyAction: '?/catalogDeploys',
				result: {
					name: 'web',
					resultId: '00000000-0000-4000-8000-0000000000ea',
					hostId: HOST_ID,
					workload: 'service',
					waitSec: 30,
					outcome: current[0] ?? null,
					status: null,
					lines: [],
					history: current,
					confirmation: null,
					confirmKind: null,
					message: null
				}
			}
		}).body;
		assert.equal(currentHtml.split('Roll back').length - 1, 1);
		assert.equal(currentHtml.includes(shortDigest(digest('b')) ?? ''), true);
		assert.equal(currentHtml.includes(`value="${digest('a')}"`), false);

		const sameDigest = [
			deployRow('00000000-0000-4000-8000-0000000000e6', 'failed', digest('a')),
			deployRow('00000000-0000-4000-8000-0000000000e7', 'succeeded', digest('a'))
		];
		assert.deepEqual(rollbackDigests(sameDigest), []);
		const sameHtml = render(CatalogDeployForm, {
			props: {
				entry: imageEntry(['deploy']),
				hosts: [host()],
				deployAction: '?/catalogDeploy',
				rollbackAction: '?/catalogRollback',
				removeAction: '?/catalogRemove',
				confirmAction: '?/catalogConfirm',
				historyAction: '?/catalogDeploys',
				result: {
					name: 'web',
					resultId: '00000000-0000-4000-8000-0000000000eb',
					hostId: HOST_ID,
					workload: 'service',
					waitSec: 30,
					outcome: sameDigest[0] ?? null,
					status: null,
					lines: [],
					history: sameDigest,
					confirmation: null,
					confirmKind: null,
					message: null
				}
			}
		}).body;
		assert.equal(sameHtml.split('Roll back').length - 1, 0);
		assert.equal(sameHtml.includes(shortDigest(digest('a')) ?? ''), true);
		assert.equal(sameHtml.includes(`value="${digest('a')}"`), false);

		const jobHistory = [
			deployRow('00000000-0000-4000-8000-0000000000e8', 'failed', digest('a')),
			deployRow('00000000-0000-4000-8000-0000000000e9', 'succeeded', digest('a')),
			deployRow('00000000-0000-4000-8000-0000000000ea', 'succeeded', digest('b'))
		];
		const jobHtml = render(CatalogDeployForm, {
			props: {
				entry: { ...imageEntry(['deploy']), spec: imageSpec('job') },
				hosts: [host()],
				deployAction: '?/catalogDeploy',
				rollbackAction: '?/catalogRollback',
				removeAction: '?/catalogRemove',
				confirmAction: '?/catalogConfirm',
				historyAction: '?/catalogDeploys',
				result: {
					name: 'web',
					resultId: '00000000-0000-4000-8000-0000000000ec',
					hostId: HOST_ID,
					workload: 'job',
					waitSec: 600,
					outcome: jobHistory[1] ?? null,
					status: null,
					lines: [],
					history: jobHistory,
					confirmation: null,
					confirmKind: null,
					message: null
				}
			}
		}).body;
		assert.equal(jobHtml.split('Roll back').length - 1, 0);
		assert.equal(jobHtml.includes(`value="${digest('b')}"`), false);
		assert.equal(jobHtml.includes('Run job'), true);
	});

	test('a successful image edit closes the dialog', () => {
		const editing = { open: true, sawFailure: false };
		assert.equal(imageEditorDialog(editing, 'redirect').open, false);
		assert.equal(imageEditorDialog(editing, 'success').open, false);
		assert.equal(imageEditorDialog(editing, 'failure').open, true);
		assert.equal(imageEditorDialog({ open: true, sawFailure: true }, 'redirect').open, false);
		assert.equal(imageEditorDialog(editing, '').open, true);
	});

	test('create and edit image saves close on success and stay open on failure', () => {
		// Same settle for both. Create posts catalogCreate; edit posts catalogUpdate.
		// A failure opens only while sawFailure is false. After the user closes that failure
		// ({ open: false, sawFailure: true }), the same failure does not reopen. That is nextFormDialog.
		const editing = { open: true, sawFailure: false };
		const created = imageSaveView(editing, 'redirect', 'api');
		assert.equal(created.open, false);
		assert.equal(created.sawFailure, false);
		assert.equal(created.savedName, 'api');
		const edited = imageSaveView({ open: true, sawFailure: true }, 'success', ' web ');
		assert.equal(edited.open, false);
		assert.equal(edited.sawFailure, false);
		assert.equal(edited.savedName, 'web');
		const failed = imageSaveView(editing, 'failure', 'web');
		assert.equal(failed.open, true);
		assert.equal(failed.sawFailure, true);
		assert.equal(failed.savedName, null);
		const errored = imageSaveView(editing, 'error', 'api');
		assert.equal(errored.open, true);
		assert.equal(errored.sawFailure, true);
		assert.equal(errored.savedName, null);
		const dismissed = imageSaveView({ open: false, sawFailure: true }, 'failure', 'web');
		assert.equal(dismissed.open, false);
		assert.equal(dismissed.sawFailure, true);
		assert.equal(dismissed.savedName, null);
		const dismissedError = imageSaveView({ open: false, sawFailure: true }, 'error', 'web');
		assert.equal(dismissedError.open, false);
		assert.equal(dismissedError.savedName, null);
		const idle = imageSaveView(editing, '', 'web');
		assert.equal(idle.open, true);
		assert.equal(idle.sawFailure, false);
		assert.equal(idle.savedName, null);
	});

	test('a still-revealed editor does not reopen the dialog after a successful save', () => {
		const openOnFailure = imageDialogReveal({ open: false, sawReveal: false }, true);
		assert.equal(openOnFailure.open, true);
		assert.equal(openOnFailure.sawReveal, true);
		const settled = imageSaveView({ open: true, sawFailure: true }, 'redirect', 'web');
		assert.equal(settled.open, false);
		// update() has not applied the redirect yet, so revealed is still true.
		const rerun = imageDialogReveal({ open: settled.open, sawReveal: openOnFailure.sawReveal }, true);
		assert.equal(rerun.open, false);
		assert.equal(rerun.sawReveal, true);
		const cleared = imageDialogReveal(rerun, false);
		assert.equal(cleared.open, false);
		assert.equal(cleared.sawReveal, false);
		const calls = scriptCalls(readSource('../src/routes/projects/[id]/CatalogImageDialog.svelte'));
		assert.equal(calls.includes('imageDialogReveal'), true);
	});

	test('the saved notice wraps a 48-character name', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const name = 'n'.repeat(48);
		const html = render(CatalogSection, {
			props: {
				canOwner: true,
				entries: [],
				omitted: 0,
				truncated: false,
				message: null,
				hosts: [],
				members: [],
				savedImage: name
			}
		}).body;
		const at = html.indexOf(`Saved ${name}.`);
		assert.equal(at > 0, true);
		const wrap = html.lastIndexOf('min-w-0 break-all', at);
		assert.equal(wrap !== -1 && wrap < at, true);
	});

	test('the page passes the saved notice into the catalog and both image dialogs', () => {
		// Callback props are not in the SSR HTML. The template AST fails if a prop is removed.
		const pageAttrs = inlineAttributes(readSource('../src/routes/projects/[id]/+page.svelte'));
		const create = pageAttrs.filter((item) => item.name === 'CatalogImageDialog');
		const section = pageAttrs.filter((item) => item.name === 'CatalogSection');
		assert.equal(create.length, 1);
		assert.equal(create[0]?.attrs.includes('onSaved'), true);
		assert.equal(section.length, 1);
		assert.equal(section[0]?.attrs.includes('savedImage'), true);
		assert.equal(section[0]?.attrs.includes('onImageSaved'), true);
		const edit = inlineAttributes(readSource('../src/routes/projects/[id]/CatalogSection.svelte')).filter(
			(item) => item.name === 'CatalogImageDialog'
		);
		assert.equal(edit.length, 1);
		assert.equal(edit[0]?.attrs.includes('onSaved'), true);
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const html = render(CatalogSection, {
			props: {
				canOwner: true,
				entries: [imageEntry(['deploy'])],
				omitted: 0,
				truncated: false,
				message: null,
				hosts: [],
				members: [],
				savedImage: 'web',
				onImageSaved: () => {}
			}
		}).body;
		assert.equal(html.includes('Saved web.'), true);
		assert.equal(html.includes('Edit web'), true);
	});

	test('env set and file loads keep the image dialog open and still take their lists', () => {
		assert.deepEqual(imageAuxFormSettle(true, 'success'), { open: true, take: true });
		assert.deepEqual(imageAuxFormSettle(true, 'failure'), { open: true, take: true });
		assert.deepEqual(imageAuxFormSettle(false, 'success'), { open: false, take: true });
		assert.deepEqual(imageAuxFormSettle(true, 'redirect'), { open: true, take: false });
		const dialog = readSource('../src/routes/projects/[id]/CatalogImageDialog.svelte');
		const sets = dialog.indexOf('settleImageAuxLoad(result, open, takeSets)');
		assert.notEqual(sets, -1);
		const files = dialog.indexOf('settleImageAuxLoad(result, open, takeFiles)');
		assert.notEqual(files, -1);
		const setsHandler = dialog.slice(sets, files);
		const filesHandler = dialog.slice(files, dialog.indexOf('<CatalogImageForm'));
		assert.notEqual(setsHandler.indexOf('takeSets'), -1);
		assert.notEqual(filesHandler.indexOf('takeFiles'), -1);
		assert.equal(setsHandler.includes('open = false'), false);
		assert.equal(filesHandler.includes('open = false'), false);
	});

	test('a saved image notice clears on project, tab, permissions, and other catalog actions', () => {
		const onCatalog: ImageNoticeSeen = { projectId: PROJECT.id, tab: 'catalog', permissions: false };
		const stayed = imageNoticeOnView('web', onCatalog, onCatalog);
		assert.equal(stayed.name, 'web');
		const otherProject = imageNoticeOnView('web', onCatalog, { ...onCatalog, projectId: 'other-project' });
		assert.equal(otherProject.name, null);
		const back = imageNoticeOnView(otherProject.name, otherProject.seen, onCatalog);
		assert.equal(back.name, null);
		const left = imageNoticeOnView('api', onCatalog, { ...onCatalog, tab: 'hosts' });
		assert.equal(left.name, null);
		const returned = imageNoticeOnView(left.name, left.seen, onCatalog);
		assert.equal(returned.name, null);
		const permissions = imageNoticeOnView('web', onCatalog, { ...onCatalog, permissions: true });
		assert.equal(permissions.name, null);
		assert.equal(imageNoticeOnSubmit('web', 'catalogDelete'), null);
		assert.equal(imageNoticeOnSubmit('web', 'catalogRun'), null);
		assert.equal(imageNoticeOnSubmit('web', 'rename'), 'web');
		assert.equal(imageNoticeOnSubmit('web', null), 'web');
		// FIX-2: create and update submits do not clear. A cancelled save is one of those submits.
		assert.equal(imageNoticeOnSubmit('old', 'catalogCreate'), 'old');
		assert.equal(imageNoticeOnSave('api'), 'api');
		assert.equal(imageNoticeOnSubmit('old', 'catalogUpdate'), 'old');
		assert.equal(imageNoticeOnSave(' web '), 'web');
		assert.equal(imageNoticeOnSave(null), null);
		assert.equal(namedFormAction(`http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogDelete`), 'catalogDelete');
		assert.equal(namedFormAction(`http://console.example/projects/${PROJECT.id}?/catalogCreate`), 'catalogCreate');
		assert.equal(namedFormAction(`http://console.example/projects/${PROJECT.id}?tab=catalog`), null);
		const calls = scriptCalls(readSource('../src/routes/projects/[id]/+page.svelte'));
		assert.equal(calls.includes('imageNoticeOnView'), true);
		assert.equal(calls.includes('imageNoticeOnSubmit'), true);
		assert.equal(calls.includes('imageNoticeOnSave'), true);
	});

	test('the image form enhance callback settles before update', async () => {
		const modes = ['create', 'edit'] as const;
		const results = [
			['success', 'success'],
			['redirect', 'success'],
			['failure', 'failure'],
			['error', 'failure']
		] as const;
		for (const mode of modes) {
			for (const [type, outcome] of results) {
				const order: string[] = [];
				let seenOutcome = '';
				let seenName = '';
				await settleImageForm(
					{ type },
					mode,
					mode === 'edit' ? { name: 'web' } : null,
					{ name: 'api' },
					async (nextOutcome, name) => {
						order.push('settled');
						seenOutcome = nextOutcome;
						seenName = name;
						await Promise.resolve();
						order.push('settled-done');
					},
					async () => {
						order.push('update');
					}
				);
				assert.equal(seenOutcome, outcome, `${mode} ${type}`);
				assert.equal(seenName, mode === 'edit' ? 'web' : 'api', `${mode} ${type}`);
				assert.deepEqual(order, ['settled', 'settled-done', 'update'], `${mode} ${type}`);
			}
		}
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let returned = false;
		const pending = settleImageForm({ type: 'redirect' }, 'create', null, { name: 'api' }, async () => {}, () => gate);
		void pending.then(() => {
			returned = true;
		});
		await Promise.resolve();
		await Promise.resolve();
		assert.equal(returned, false);
		release();
		await pending;
		assert.equal(returned, true);
		const form = readSource('../src/routes/projects/[id]/CatalogImageForm.svelte');
		assert.notEqual(form.indexOf('settleImageForm(result, mode, entry, draft, onSettled, update)'), -1);
	});

	test('hidden env-set and file loads take success and failure and do not close the dialog', () => {
		const taken: unknown[] = [];
		const take = (data: Record<string, unknown>) => {
			taken.push(data);
		};
		assert.equal(settleImageAuxLoad({ type: 'success', data: { catalogSets: ['app'] } }, true, take), true);
		assert.deepEqual(taken, [{ catalogSets: ['app'] }]);
		taken.length = 0;
		assert.equal(settleImageAuxLoad({ type: 'failure', data: { catalogFiles: ['key.json'] } }, true, take), true);
		assert.deepEqual(taken, [{ catalogFiles: ['key.json'] }]);
		taken.length = 0;
		assert.equal(settleImageAuxLoad({ type: 'redirect' }, true, take), true);
		assert.equal(settleImageAuxLoad({ type: 'error' }, true, take), true);
		assert.equal(settleImageAuxLoad({ type: 'success', data: null }, true, take), true);
		assert.deepEqual(taken, [{}]);
		taken.length = 0;
		assert.equal(settleImageAuxLoad({ type: 'success', data: { catalogSets: [] } }, false, take), false);
		const dialog = readSource('../src/routes/projects/[id]/CatalogImageDialog.svelte');
		const sets = dialog.indexOf('settleImageAuxLoad(result, open, takeSets)');
		assert.notEqual(sets, -1);
		const files = dialog.indexOf('settleImageAuxLoad(result, open, takeFiles)');
		assert.notEqual(files, -1);
		assert.equal(dialog.slice(sets, dialog.indexOf('<CatalogImageForm')).includes('open = false'), false);
	});

	test('the saved notice clears only for user catalog actions and is announced after the dialog closes', () => {
		for (const action of ['catalogDelete', 'catalogRun', 'catalogStop', 'catalogRestart', 'catalogDeploy', 'catalogRollback']) {
			assert.equal(imageNoticeOnSubmit('web', action), null, action);
		}
		for (const action of ['catalogEnvSets', 'catalogFiles', 'catalogCreate', 'catalogUpdate']) {
			assert.equal(imageNoticeOnSubmit('web', action), 'web', action);
		}
		let name = imageNoticeOnSubmit('web', 'catalogCreate');
		assert.equal(name, 'web');
		name = imageNoticeOnSave('api');
		assert.equal(name, 'api');
		name = imageNoticeOnDialog(name, false, true);
		assert.equal(name, null);
		name = imageNoticeOnDialog(name, true, true);
		assert.equal(name, null);
		name = imageNoticeOnDialog('web', true, false);
		assert.equal(name, 'web');
		name = imageNoticeOnSave('worker');
		assert.equal(name, 'worker');
		const whileOpen = imageNoticeOnCloseComplete('worker', true);
		assert.equal(whileOpen.announce, null);
		assert.equal(whileOpen.pending, 'worker');
		const closed = imageNoticeOnCloseComplete(whileOpen.pending, false);
		assert.equal(closed.announce, 'worker');
		assert.equal(closed.pending, null);
		assert.equal(imageNoticeOnSave(closed.announce), 'worker');
		assert.equal(imageNoticeOnCloseComplete(null, false).announce, null);
		const imageDialog = readSource('../src/routes/projects/[id]/CatalogImageDialog.svelte');
		const imageCalls = scriptCalls(imageDialog);
		assert.equal(imageCalls.includes('imageNoticeOnDialog'), true);
		assert.equal(imageCalls.includes('imageNoticeOnCloseComplete'), true);
		assert.notEqual(imageDialog.indexOf('onOpenChangeComplete={onDialogOpenChangeComplete}'), -1);
		assert.equal(scriptCalls(readSource('../src/routes/projects/[id]/CatalogEntryDialog.svelte')).includes('imageNoticeOnDialog'), true);
		const page = readSource('../src/routes/projects/[id]/+page.svelte');
		assert.equal(scriptCalls(page).includes('imageNoticeOnDialog'), true);
		const pageEntry = inlineAttributes(page).filter((item) => item.name === 'CatalogEntryDialog');
		assert.equal(pageEntry.length, 1);
		assert.equal(pageEntry[0]?.attrs.includes('onOpened'), true);
		const section = readSource('../src/routes/projects/[id]/CatalogSection.svelte');
		const sectionEntry = inlineAttributes(section).filter((item) => item.name === 'CatalogEntryDialog');
		assert.equal(sectionEntry.length, 1);
		assert.equal(sectionEntry[0]?.attrs.includes('onOpened'), true);
		const pageSection = inlineAttributes(page).filter((item) => item.name === 'CatalogSection');
		assert.equal(pageSection[0]?.attrs.includes('onEditOpen'), true);
	});

	test('the settings tab loads env sets and registries only while that tab is open', async () => {
		function answer(call: { url: URL }) {
			const path = call.url.pathname;
			if (path === `/v1/projects/${PROJECT.id}`) return envelope({ ...PROJECT, role: 'admin' });
			if (path === `/v1/projects/${PROJECT.id}/hosts`) return envelope({ items: [host()], next_cursor: null });
			if (path === `/v1/projects/${PROJECT.id}/members`) return envelope({ items: [], next_cursor: null });
			if (path.endsWith('/join-tokens') || path.endsWith('/invites')) return envelope({ items: [], next_cursor: null });
			if (path === `/v1/projects/${PROJECT.id}/env-sets`) {
				return envelope({
					items: [{ name: 'app', keys: [{ key: 'API_TOKEN', is_secret: true, value: SECRET }], updated_at: '2026-10-14T00:00:00Z', updated_by: USER.id }]
				});
			}
			if (path === `/v1/projects/${PROJECT.id}/registries`) {
				return envelope({ items: [{ host: 'ghcr.io', username: 'ada', token: REGISTRY_TOKEN, updated_at: '2026-10-14T00:00:00Z', updated_by: USER.id }] });
			}
			if (path === `/v1/projects/${PROJECT.id}/files`) {
				return envelope({
					items: [
						{
							name: 'app.conf',
							is_secret: false,
							size: 17,
							sha256: 'ab'.repeat(32),
							updated_at: '2026-10-13T12:00:00Z',
							updated_by: USER.id,
							content: 'plain-should-not-load'
						},
						{
							name: 'key.json',
							is_secret: true,
							size: 31,
							sha256: null,
							updated_at: '2026-10-13T12:00:00Z',
							updated_by: USER.id,
							content: 'secret-should-not-load'
						}
					]
				});
			}
			return envelope(null, 500, 'error', path);
		}
		const catalogCalls = installFetch(answer);
		await projectLoad(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=catalog`,
				session: TOKEN,
				user: USER,
				projects: [{ ...PROJECT, role: 'admin' }],
				params: { id: PROJECT.id }
			}).event as never
		);
		assert.equal(catalogCalls.some((call) => call.url.pathname.includes('/env-sets')), false);
		assert.equal(catalogCalls.some((call) => call.url.pathname.includes('/registries')), false);
		assert.equal(catalogCalls.some((call) => call.url.pathname.endsWith('/files')), false);
		assert.equal(catalogCalls.some((call) => call.url.pathname.includes('/deploys')), false);

		const viewerCalls = installFetch(answer);
		await projectLoad(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=settings`,
				session: TOKEN,
				user: USER,
				projects: [{ ...PROJECT, role: 'viewer' }],
				params: { id: PROJECT.id }
			}).event as never
		);
		assert.equal(viewerCalls.some((call) => call.url.pathname.includes('/env-sets')), false);
		assert.equal(viewerCalls.some((call) => call.url.pathname.endsWith('/files')), false);

		const settingsCalls = installFetch(answer);
		const loaded = await projectLoad(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=settings`,
				session: TOKEN,
				user: USER,
				projects: [{ ...PROJECT, role: 'admin' }],
				params: { id: PROJECT.id }
			}).event as never
		);
		assert.equal(settingsCalls.some((call) => call.url.pathname.endsWith('/env-sets')), true);
		assert.equal(settingsCalls.some((call) => call.url.pathname.endsWith('/registries')), true);
		assert.equal(settingsCalls.some((call) => call.url.pathname.endsWith('/files')), true);
		assert.equal(settingsCalls.some((call) => call.url.pathname.includes('/deploys')), false);
		const loadedJson = JSON.stringify(loaded);
		assert.equal(loadedJson.includes(SECRET), false);
		assert.equal(loadedJson.includes(REGISTRY_TOKEN), false);
		assert.equal(loadedJson.includes('plain-should-not-load'), false);
		assert.equal(loadedJson.includes('secret-should-not-load'), false);
		assert.equal(loadedJson.includes('app.conf'), true);
	});

	test('the settings tab shows a plain value, hides a secret, and starts paste and token fields empty', async () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=settings`);
		const sets: EnvSet[] = [
			{
				name: 'app',
				keys: [
					{ key: 'API_TOKEN', is_secret: true, value: SECRET, preview: null },
					{ key: 'LOG_LEVEL', is_secret: false, value: PLAIN, preview: null }
				],
				updated_at: '2026-10-14T00:00:00Z',
				updated_by: USER.id
			}
		];
		const registries = [{ host: 'ghcr.io', username: 'ada', token: REGISTRY_TOKEN, updated_at: '2026-10-14T00:00:00Z', updated_by: USER.id }] as unknown as Registry[];
		const html = render(SettingsSection, {
			props: { project: PROJECT, canOwner: true, canAdmin: true, message: null, envSets: sets, registries }
		}).body;
		assert.equal(html.includes(SECRET), false);
		assert.equal(html.includes(PLAIN), true);
		// v1.17: a one-way Make secret row action on plain rows only; no plain toggle.
		assert.equal(html.includes('aria-label="Make LOG_LEVEL secret"'), true);
		assert.equal(html.includes('aria-label="Make API_TOKEN secret"'), false);
		assert.equal(html.includes('Make plain'), false);
		assert.equal(html.includes('patchEnvKey'), false);
		assert.equal(html.includes(REGISTRY_TOKEN), false);
		assert.equal(html.includes('API_TOKEN'), true);
		assert.match(html, /type="password"/);
		assert.doesNotMatch(html, /type="password"[^>]*value="[^"]+"/);

		const calls = installFetch(() => envelope(null, 400, 'bad_request', `refused ${SECRET}`));
		const saved = await projectActions.saveEnvSet(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=settings&/saveEnvSet`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: { set: 'app', dotenv: `API_TOKEN=${SECRET}` }
			}).event as never
		);
		const savedJson = JSON.stringify(saved);
		assert.equal(savedJson.includes(SECRET), false);
		assert.equal(actionData(saved).settingsField, 'dotenv');
		assert.equal(actionData(saved).message?.includes('Paste the value again.'), true);
		assert.equal(calls[0]?.body?.includes(SECRET), true);
		installFetch(() => envelope(null, 409, 'conflict', 'env set app is referenced by web'));
		const conflict = await projectActions.deleteEnvSet(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=settings&/deleteEnvSet`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: { set: 'app' }
			}).event as never
		);
		assert.equal(actionData(conflict).message, 'Env set app is still used by catalog entries. Remove it from those entries first, or delete its variables one by one.');
		assert.equal(actionData(conflict).settingsField ?? null, null);
		assert.equal(actionData(conflict).message?.includes('Paste the value again.'), false);
	});

	test('deleting an env set that entries still use explains why and closes the dialog', async () => {
		installFetch(() => envelope(null, 409, 'conflict', 'conflict'));
		const conflict = await projectActions.deleteEnvSet(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=settings&/deleteEnvSet`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: { set: 'services' }
			}).event as never
		);
		assert.equal(isActionFailure(conflict), true);
		assert.equal(isActionFailure(conflict) && conflict.status, 409);
		assert.equal(
			actionData(conflict).message,
			'Env set services is still used by catalog entries. Remove it from those entries first, or delete its variables one by one.'
		);

		// Other errors keep the API message unchanged.
		installFetch(() => envelope(null, 404, 'not_found', 'env set not found: services'));
		const missing = await projectActions.deleteEnvSet(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=settings&/deleteEnvSet`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: { set: 'services' }
			}).event as never
		);
		assert.equal(isActionFailure(missing) && missing.status, 404);
		assert.equal(actionData(missing).message, 'env set not found: services');

		// Bounded to the one delete-set element: it closes on failure and focuses the settings notice.
		const table = readFileSync(new URL('../src/routes/projects/[id]/EnvSetTable.svelte', import.meta.url), 'utf8');
		const element = table.match(/<ConfirmAction\s+id="delete-env-\{set\.name\}"[^<]*?\/>/)?.[0] ?? '';
		assert.match(element, /\scloseOnFailure\s/);
		assert.match(element, /failureFocusId="settings-error"/);
	});

	test('container Run and Deploy tooltips explain the action', () => {
		const section = readFileSync(new URL('../src/routes/projects/[id]/CatalogSection.svelte', import.meta.url), 'utf8');
		const run = readFileSync(new URL('../src/routes/projects/[id]/CatalogRunDialog.svelte', import.meta.url), 'utf8');
		const deploy = readFileSync(new URL('../src/routes/projects/[id]/CatalogDeployDialog.svelte', import.meta.url), 'utf8');
		const row = readFileSync(new URL('../src/lib/components/RowAction.svelte', import.meta.url), 'utf8');
		assert.match(section, /entry\.kind === 'image' && action === 'run' \? IMAGE_RUN_TIP : undefined/);
		assert.match(run, /label="\{label\} \{entryName\}" \{tip\}/);
		assert.match(deploy, /label="Deploy \{entry\.name\}" tip=\{IMAGE_DEPLOY_TIP\}/);
		assert.match(row, /const hover = \$derived\(tip \? `\$\{label\}\. \$\{tip\}` : label\)/);
		assert.match(row, /<Tooltip\.Content>\{hover\}<\/Tooltip\.Content>/);
		assert.equal(IMAGE_RUN_TIP, 'Starts the container already on this host.');
		assert.equal(IMAGE_DEPLOY_TIP, 'Pulls the image and creates or replaces the container from this catalog entry.');
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const html = render(CatalogSection, {
			props: {
				canOwner: false,
				entries: [imageEntry(['run', 'deploy'])],
				omitted: 0,
				truncated: false,
				message: null,
				hosts: [host()],
				members: []
			}
		}).body;
		assert.match(html, /aria-label="Run web"/);
		assert.match(html, /aria-label="Deploy web"/);
		assert.equal(html.includes('Starts the container already on this host.'), false);
		assert.equal(html.includes('Pulls the image'), false);
	});

	test('deploy is offered for an image entry only when my_actions includes it', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const hidden = render(CatalogSection, {
			props: {
				canOwner: true,
				entries: [imageEntry(['logs'])],
				omitted: 0,
				truncated: false,
				message: null,
				hosts: [host()],
				members: []
			}
		}).body;
		assert.equal(hidden.includes('Deploy web'), false);
		const shown = render(CatalogSection, {
			props: {
				canOwner: false,
				entries: [imageEntry(['deploy', 'logs'])],
				omitted: 0,
				truncated: false,
				message: null,
				hosts: [host()],
				members: [],
				permissions: { name: 'web', grants: [], message: null, loaded: true }
			}
		}).body;
		assert.equal(shown.includes('Deploy web'), true);
		assert.equal(shown.includes('admin_deploy'), true);
		const program = render(CatalogSection, {
			props: {
				canOwner: true,
				entries: [programEntry()],
				omitted: 0,
				truncated: false,
				message: null,
				hosts: [host()],
				members: [],
				permissions: { name: 'web', grants: [], message: null, loaded: true }
			}
		}).body;
		assert.equal(program.includes('admin_deploy'), false);
		const form = render(CatalogPermissionsForm, {
			props: { action: '?/catalogPermissions', name: 'web', grants: [], members: [], loaded: true, includeDeploy: false }
		}).body;
		assert.equal(form.includes('admin_deploy'), false);
	});

	test('a saved env set is announced and its name field is cleared', () => {
		// The enhance callback runs only in the browser, so check its wiring in the source.
		const settings = readFileSync(new URL('../src/routes/projects/[id]/EnvSetDialog.svelte', import.meta.url), 'utf8');
		assert.match(settings, /id="env-set-name" name="set" bind:value=\{setName\}/);
		assert.match(settings, /saved: \(\) => \{\s*onStatus\(savedEnvSetNote\(name\)\);[\s\S]*?setName = '';\s*newKeysSecret = true;/);
		// The note is on the card's status line now, not inside the dialog.
		assert.equal(settings.includes('kind="success"'), false);
		assert.equal(settings.includes('savedSet'), false);
	});

	test('the delete confirmation names what keeps running for each entry kind', () => {
		// The dialog body renders only when open, so check the source as dialog-open.test.ts does.
		const section = readFileSync(new URL('../src/routes/projects/[id]/CatalogSection.svelte', import.meta.url), 'utf8');
		assert.match(
			section,
			/entry\.kind === 'image'\s*\?\s*`Delete \$\{entry\.name\}\? Its containers keep running on their hosts\.`\s*:\s*`Delete \$\{entry\.name\}\? Running units are not stopped\.`/
		);
	});

	test('an owned container row shows its name and the digest icon', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=services`);
		const row: ProjectServiceRow = {
			id: '00000000-0000-4000-8000-0000000000bb',
			name: 'port-80',
			source: 'owned',
			kind: 'container',
			ports: [80],
			health: null,
			last_seen_at: null,
			gone_at: null,
			display_name: 'Web',
			owner_user: 'root',
			project_id: PROJECT.id,
			host_id: HOST_ID,
			host_name: 'pi1',
			host_status: 'online',
			project_name: 'Lab',
			catalog_entry: 'web',
			container_name: 'web-1',
			image_digest: digest('a'),
			checks: [],
			checksMessage: null
		};
		const owned = render(ServicesSection, {
			props: {
				projectId: PROJECT.id,
				projectName: 'Lab',
				hosts: [host()],
				canAdmin: false,
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
		assert.equal(owned.includes('web-1'), true);
		assert.equal(owned.includes('Web'), true);
		const full = digest('a');
		assert.equal(owned.includes(`aria-label="Image digest ${full}"`), true);
		assert.equal(owned.includes(`title="${full}"`), true);
		assert.equal(owned.split(full).join('').includes(shortDigest(full) ?? ''), false);
		const unnamed = { ...row, display_name: null };
		const once = render(ServicesSection, {
			props: {
				projectId: PROJECT.id,
				projectName: 'Lab',
				hosts: [host()],
				canAdmin: false,
				rows: [unnamed],
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
		// The label tooltip repeats the name. The muted container name is omitted when it matches the label.
		assert.equal(once.replace(/ title="[^"]*"/g, '').split('web-1').length - 1, 1);
		assert.equal(once.includes(`aria-label="Image digest ${digest('a')}"`), true);
		assert.equal(once.split(digest('a')).join('').includes(shortDigest(digest('a')) ?? ''), false);
		const discovered = { ...row, source: 'discovered' as const, display_name: null, catalog_entry: null, image_digest: null };
		const found = render(ServicesSection, {
			props: {
				projectId: PROJECT.id,
				projectName: 'Lab',
				hosts: [host()],
				canAdmin: false,
				rows: [discovered],
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
		assert.equal(found.includes('web-1'), true);
		assert.equal(found.includes('port 80'), false);
	});

	test('the catalog create action posts an image spec', async () => {
		const calls = installFetch(() => envelope({ id: ENTRY_ID }));
		await assert.rejects(
			async () => {
				await projectActions.catalogCreate(
					fakeEvent({
						url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogCreate`,
						session: TOKEN,
						user: USER,
						projects: [PROJECT],
						params: { id: PROJECT.id },
						form: {
							entry_kind: 'image',
							name: 'web',
							workload: 'service',
							image: 'ghcr.io/acme/web:1',
							restart: 'unless-stopped',
							healthy_after_sec: '40',
							command: '',
							port_host: '8080',
							port_container: '80',
							port_public: '1'
						}
					}).event as never
				);
			},
			(err: unknown) => isRedirect(err) && err.status === 303
		);
		const body = JSON.parse(calls.find((call) => call.method === 'POST')?.body ?? '{}') as {
			kind?: string;
			spec?: { command?: unknown; memory_mb?: unknown; ports?: unknown };
		};
		assert.equal(body.kind, 'image');
		assert.equal(body.spec?.command, null);
		assert.equal(body.spec?.memory_mb, null);
		assert.deepEqual(body.spec?.ports, [{ host: 8080, container: 80, public: true }]);
		assert.deepEqual((body.spec as { files?: unknown }).files, []);
	});

	test('admins see settings, and the container button stays with the owner', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const data = {
			project: { ...PROJECT, role: 'admin' as const },
			userId: USER.id,
			message: null,
			tab: 'catalog' as const,
			canAdmin: true,
			canOwner: false,
			hosts: [host()],
			hostsOmitted: 0,
			hostsTruncated: false,
			hostsMessage: null,
			members: [],
			membersOmitted: 0,
			membersTruncated: false,
			membersMessage: null,
			tokens: [],
			tokensOmitted: 0,
			tokensTruncated: false,
			tokensMessage: null,
			invites: [],
			invitesOmitted: 0,
			invitesTruncated: false,
			invitesMessage: null,
			catalog: [],
			catalogOmitted: 0,
			catalogTruncated: false,
			catalogMessage: null,
			permissions: null,
			envSets: [],
			envSetsMessage: null,
			registries: [],
			registriesMessage: null,
			services: [],
			servicesTotal: 0,
			servicesPrev: null,
			servicesNext: null,
			servicesOmitted: 0,
			servicesMessage: null
		};
		const admin = render(ProjectPage, { props: { data: data as never, form: null } }).body;
		assert.equal(admin.includes('>Settings<'), true);
		assert.equal(admin.includes('Container'), false);
		assert.equal(admin.includes('New service'), false);
	});

	test('a secret env value is blanked before a failed save returns the draft', async () => {
		const calls = installFetch(() => envelope(null, 500, 'error', `echo ${SECRET}`));
		const form = {
			entry_kind: 'image',
			name: 'web',
			workload: 'service',
			image: 'ghcr.io/acme/web:1',
			env_key: 'API_TOKEN',
			env_value: SECRET,
			restart: 'unless-stopped'
		};
		const base = {
			session: TOKEN,
			user: USER,
			projects: [PROJECT],
			params: { id: PROJECT.id }
		};
		const created = await projectActions.catalogCreate(
			fakeEvent({ ...base, url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogCreate`, form }).event as never
		);
		assert.equal(calls.length, 0);
		const editor = actionData(created).imageEditor;
		assert.equal(editor?.field, 'env');
		assert.equal(editor?.draft.env[0]?.value, '');
		assert.equal(JSON.stringify(created).includes(SECRET), false);
		const updated = await projectActions.catalogUpdate(
			fakeEvent({
				...base,
				url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogUpdate`,
				form: { ...form, entry_name: 'web', editor_mode: 'edit' }
			}).event as never
		);
		assert.equal(actionData(updated).imageEditor?.draft.env[0]?.value, '');
		assert.equal(JSON.stringify(updated).includes(SECRET), false);
	});

	test('a short registry token is redacted and the failure sits on that form', async () => {
		const token = 's3cret!';
		installFetch(() => envelope(null, 400, 'bad_request', `refused ${token}`));
		const saved = await projectActions.saveRegistry(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=settings&/saveRegistry`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: { host: 'ghcr.io', username: 'ada', token }
			}).event as never
		);
		const data = actionData(saved);
		assert.equal(data.settingsField, 'token');
		assert.equal(data.message, 'refused [redacted] Paste the value again.');
		assert.equal(JSON.stringify(saved).includes(token), false);
		assert.equal(redactSubmitted('abc stays', ['ab']), 'abc stays');
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=settings`);
		const html = render(SettingsSection, {
			props: {
				project: PROJECT,
				canOwner: true,
				canAdmin: true,
				message: data.message ?? null,
				settingsField: 'token',
				envSets: [],
				registries: []
			}
		}).body;
		const tokenAt = html.indexOf('id="registry-token"');
		const errorAt = html.indexOf('id="registry-token-error"');
		assert.equal(tokenAt >= 0 && errorAt > tokenAt, true);
		assert.equal(html.includes('Paste the value again.'), true);
		assert.equal(html.includes(token), false);
		assert.match(html, /id="registry-token-error"[^>]*tabindex="-1"/);
		assert.match(html, /id="registry-token-error"[^>]*break-words/);
		assert.match(html, /id="registry-token-error"[^>]*focus-visible:ring-3/);
		assert.doesNotMatch(html, /id="registry-token-error"[^>]*outline-none/);
		assert.equal(html.includes('aria-describedby="registry-token-error"'), true);
		assert.equal(html.includes('aria-invalid="true"'), true);
		assert.doesNotMatch(html, /type="password"[^>]*value="[^"]+"/);
		const dotenvHtml = render(SettingsSection, {
			props: {
				project: PROJECT,
				canOwner: true,
				canAdmin: true,
				message: 'Could not save the env set. Paste the value again.',
				settingsField: 'dotenv',
				envSets: [
					{
						name: 'app',
						keys: [{ key: 'A'.repeat(64), is_secret: true, value: null, preview: null }],
						updated_at: '2026-10-14T00:00:00Z',
						updated_by: USER.id
					}
				],
				registries: []
			}
		}).body;
		const registriesAt = dotenvHtml.indexOf('>Registries<');
		// Dialog content is portaled, so SSR HTML has the open trigger and not the textarea.
		assert.equal(dotenvHtml.indexOf('id="env-set-dotenv"'), -1);
		assert.equal(registriesAt > 0, true);
		const newSet = dotenvHtml.match(/<button\b[^>]*id="new-env-set"[^>]*>/)?.[0] ?? '';
		assert.equal(newSet.includes('aria-expanded="true"'), true);
		// A long key without an underscore is capped and breaks inside its box instead of widening the table.
		assert.match(dotenvHtml, new RegExp(`max-w-28[^"]*break-words[^>]*>(?:<!--[^>]*-->)*${'A'.repeat(64)}`));
		assert.equal(dotenvHtml.includes(SECRET), false);
		const dialog = readFileSync(new URL('../src/routes/projects/[id]/EnvSetDialog.svelte', import.meta.url), 'utf8');
		const areaAt = dialog.indexOf('id="env-set-dotenv"');
		const dotenvErrorAt = dialog.indexOf('id="env-set-error"');
		assert.equal(areaAt >= 0 && dotenvErrorAt > areaAt, true);
		assert.equal(dialog.includes("aria-describedby={settingsField === 'dotenv' && message ? 'env-set-error' : undefined}"), true);
		assert.match(dialog, /id="env-set-error"[^>]*focus-visible:ring-3/);
		assert.doesNotMatch(dialog, /id="env-set-error"[^>]*outline-none/);
		assert.match(readFileSync(new URL('../src/lib/components/Textarea.svelte', import.meta.url), 'utf8'), /text-base/);
	});

	test('clearSecretField blanks the value before the result is applied', async () => {
		let value = SECRET;
		let during = 'still-set';
		await clearSecretField(
			(next) => {
				value = next;
			},
			async () => {
				during = value;
			}
		);
		assert.equal(during, '');
		assert.equal(value, '');
	});

	test('an image validation error is rendered on that field', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const message = 'Enter an image reference, such as ghcr.io/acme/web:1.';
		const draft = blankImageDraft();
		draft.image = 'not an image';
		const html = render(CatalogImageForm, {
			props: {
				mode: 'create',
				saveAction: '?/catalogCreate',
				sets: [],
				editor: { mode: 'create', name: null, draft, field: 'image', message }
			}
		}).body;
		const imageAt = html.indexOf('id="catalog-image-new-image"');
		const errorAt = html.indexOf(message);
		const commandAt = html.indexOf('>Command<');
		assert.equal(imageAt >= 0 && errorAt > imageAt && commandAt > errorAt, true);
		// The Image field is a combobox now; its attribute order follows bits-ui, so match within the tag.
		assert.match(html, /<input\b(?=[^>]*id="catalog-image-new-image")[^>]*aria-invalid="true"/);
		assert.match(html, /id="catalog-image-new-error"[^>]*tabindex="-1"/);
		assert.match(html, /aria-pressed="true">(?:<!---->)?Service/);
		assert.match(html, /aria-pressed="false">(?:<!---->)?Job/);
		assert.equal(html.includes('No env sets yet'), false);
		assert.equal(html.includes('Loading env sets…'), true);
		const ready = render(CatalogImageForm, {
			props: { mode: 'create', saveAction: '?/catalogCreate', sets: [], setsStatus: 'ready', editor: null }
		}).body;
		assert.equal(ready.includes('No env sets yet.'), true);
		const failedSets = render(CatalogImageForm, {
			props: {
				mode: 'create',
				saveAction: '?/catalogCreate',
				sets: [],
				setsStatus: 'error',
				setsMessage: 'Env sets could not be loaded.',
				retrySets: () => {}
			}
		}).body;
		assert.equal(failedSets.includes('Env sets could not be loaded.'), true);
		assert.equal(failedSets.includes('>Retry<'), true);
		assert.equal(failedSets.includes('No env sets yet'), false);
	});

	test('the docker run preview in the form omits env values', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const draft = blankImageDraft();
		draft.name = 'web';
		draft.image = 'nginx';
		draft.env = [{ key: 'PORT', value: '3000' }];
		draft.envSets = ['app'];
		draft.secrets = [{ key: 'API_TOKEN', set: 'app', name: 'API_TOKEN' }];
		draft.entrypoint = ['/bin/sh', '-c'];
		const html = render(CatalogImageForm, {
			props: {
				mode: 'create',
				saveAction: '?/catalogCreate',
				sets: [{ name: 'app', keys: ['API_TOKEN'] }],
				setsStatus: 'ready',
				editor: { mode: 'create', name: null, draft, field: null, message: null }
			}
		}).body;
		const start = html.indexOf('aria-label="docker run preview"');
		const preview = html.slice(start, html.indexOf('</pre>', start));
		assert.match(preview, /-e PORT\b/);
		assert.match(preview, /-e API_TOKEN\b/);
		assert.equal(preview.includes('3000'), false);
		assert.equal(preview.includes('app.API_TOKEN'), false);
		assert.equal(preview.includes('entrypoint /bin/sh -c'), true);
		const one = dockerRunPreview({
			name: 'web',
			image: 'nginx',
			command: [],
			entrypoint: ['/bin/sh'],
			ports: [],
			envKeys: [],
			volumes: [],
			restart: 'no',
			user: '',
			memoryMb: null
		});
		assert.equal(one.includes('--entrypoint /bin/sh'), true);
	});

	test('deploy history stays put when the action did not load a new list', () => {
		assert.deepEqual(nextHistory(['kept'], null), ['kept']);
		assert.deepEqual(nextHistory(['kept'], []), []);
		assert.equal(nextIdempotencyKey({ hostId: HOST_ID, force: false, key: KEY }, { hostId: HOST_ID, force: false }, 'fresh'), KEY);
		assert.equal(nextIdempotencyKey({ hostId: HOST_ID, force: false, key: KEY }, { hostId: 'other', force: false }, 'fresh'), 'fresh');
		assert.equal(nextIdempotencyKey({ hostId: HOST_ID, force: false, key: KEY }, { hostId: HOST_ID, force: true }, 'fresh'), 'fresh');
		assert.equal(nextRollbackKey({ hostId: HOST_ID, key: KEY }, HOST_ID, 'fresh'), KEY);
		assert.equal(nextRollbackKey({ hostId: HOST_ID, key: KEY }, 'other', 'fresh'), 'fresh');
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const props = {
			entry: imageEntry(['deploy']),
			hosts: [host()],
			deployAction: '?/catalogDeploy',
			rollbackAction: '?/catalogRollback',
			removeAction: '?/catalogRemove',
			confirmAction: '?/catalogConfirm',
			historyAction: '?/catalogDeploys'
		};
		const waiting = render(CatalogDeployForm, { props: { ...props, result: null } }).body;
		assert.equal(waiting.includes('Loading history'), false);
		assert.equal(waiting.includes('No deploys yet'), false);
		const empty = render(CatalogDeployForm, {
			props: {
				...props,
				result: {
					name: 'web',
					resultId: '00000000-0000-4000-8000-0000000000eb',
					hostId: HOST_ID,
					workload: 'service',
					waitSec: 30,
					outcome: null,
					status: null,
					lines: [],
					history: [],
					confirmation: null,
					confirmKind: null,
					message: null
				}
			}
		}).body;
		assert.equal(empty.includes('No deploys yet.'), true);
		const stalled = render(CatalogDeployForm, {
			props: {
				...props,
				result: {
					name: 'web',
					resultId: '00000000-0000-4000-8000-0000000000ec',
					hostId: HOST_ID,
					workload: 'service',
					waitSec: 30,
					outcome: null,
					status: null,
					lines: [],
					history: null,
					confirmation: null,
					confirmKind: null,
					message: 'Still running on the host. Check the history in a minute.'
				}
			}
		}).body;
		assert.equal(stalled.includes('Still running on the host. Check the history in a minute.'), true);
		assert.equal(stalled.includes('>Retry<'), true);
		assert.equal(stalled.includes('No deploys yet'), false);
		assert.equal(stalled.includes('Loading history'), false);
	});

	test('a confirmation plan drops env values and confirm uses the long timeout', async () => {
		const planSecret = 'plan-secret-value';
		const confirmationId = 'A'.repeat(43);
		const hold = spyTimeouts('hold');
		installFetch((call) => {
			if (call.url.pathname === `/v1/projects/${PROJECT.id}/catalog/web/deploy`) {
				return envelope({
					confirmation_id: confirmationId,
					plan: `Deploy web API_TOKEN=${planSecret} on pi1`,
					expires_at: '2026-10-14T00:00:00Z'
				});
			}
			if (call.url.pathname.endsWith('/deploys')) return envelope({ items: [] });
			if (call.url.pathname.startsWith('/v1/confirmations/')) return envelope(deployPayload());
			return envelope(null, 500, 'error', call.url.pathname);
		});
		const base = {
			session: TOKEN,
			user: USER,
			projects: [PROJECT],
			params: { id: PROJECT.id }
		};
		const deployed = (await projectActions.catalogDeploy(
			fakeEvent({
				...base,
				url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogDeploy`,
				form: { name: 'web', host_id: HOST_ID, workload: 'service', wait_sec: '30', idempotency_key: KEY }
			}).event as never
		)) as { imageDeploy?: { confirmation?: { plan: string; confirmation_id: string } | null } };
		const plan = deployed.imageDeploy?.confirmation?.plan ?? '';
		assert.equal(plan.includes('Deploy'), true);
		assert.equal(plan.includes('API_TOKEN'), true);
		assert.equal(plan.includes(planSecret), false);
		assert.equal(JSON.stringify(deployed).includes(planSecret), false);
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const html = render(CatalogDeployForm, {
			props: {
				entry: imageEntry(['deploy']),
				hosts: [host()],
				deployAction: '?/catalogDeploy',
				rollbackAction: '?/catalogRollback',
				removeAction: '?/catalogRemove',
				confirmAction: '?/catalogConfirm',
				historyAction: '?/catalogDeploys',
				result: {
					name: 'web',
					resultId: '00000000-0000-4000-8000-0000000000ed',
					hostId: HOST_ID,
					workload: 'service',
					waitSec: 30,
					outcome: null,
					status: null,
					lines: [],
					history: [],
					confirmation: {
						confirmation_id: confirmationId,
						plan,
						expires_at: '2026-10-14T00:00:00Z'
					},
					confirmKind: 'deploy',
					message: null
				}
			}
		}).body;
		assert.equal(html.includes('>Confirm<'), true);
		assert.equal(html.includes(planSecret), false);
		assert.equal(html.includes(plan), true);
		hold.restore();

		const confirmHold = spyTimeouts('hold');
		const confirmCalls = installFetch((call) => {
			if (call.url.pathname.startsWith('/v1/confirmations/')) return envelope(deployPayload());
			if (call.url.pathname.endsWith('/deploys')) return envelope({ items: [] });
			return envelope(null, 500, 'error', call.url.pathname);
		});
		await projectActions.catalogConfirm(
			fakeEvent({
				...base,
				url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogConfirm`,
				form: {
					name: 'web',
					host_id: HOST_ID,
					workload: 'service',
					wait_sec: '40',
					idempotency_key: KEY,
					confirmation_id: confirmationId,
					confirm_kind: 'deploy'
				}
			}).event as never
		);
		const post = confirmCalls.find((call) => call.method === 'POST' && call.url.pathname.startsWith('/v1/confirmations/'));
		assert.equal(post?.url.pathname, `/v1/confirmations/${confirmationId}`);
		assert.deepEqual(JSON.parse(post?.body ?? '{}'), { idempotency_key: KEY });
		assert.equal(confirmHold.seen[0], 430000);
		confirmHold.restore();

		const removeHold = spyTimeouts('hold');
		await projectActions.catalogConfirm(
			fakeEvent({
				...base,
				url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogConfirm`,
				form: {
					name: 'web',
					host_id: HOST_ID,
					workload: 'service',
					wait_sec: '40',
					idempotency_key: KEY,
					confirmation_id: confirmationId,
					confirm_kind: 'remove'
				}
			}).event as never
		);
		assert.equal(removeHold.seen[0], API_TIMEOUT_MS);
		removeHold.restore();

		const abort = spyTimeouts('abort');
		installFetch((call) => {
			if (call.signal?.aborted) return Promise.reject(call.signal.reason instanceof Error ? call.signal.reason : new DOMException('aborted', 'AbortError'));
			return envelope(deployPayload());
		});
		const failed = await projectActions.catalogConfirm(
			fakeEvent({
				...base,
				url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogConfirm`,
				form: {
					name: 'web',
					host_id: HOST_ID,
					workload: 'service',
					wait_sec: '30',
					idempotency_key: KEY,
					confirmation_id: confirmationId,
					confirm_kind: 'deploy'
				}
			}).event as never
		);
		assert.equal(abort.seen.length, 1);
		assert.equal(abort.seen[0], 420000);
		assert.equal(actionData(failed).imageDeploy?.message, 'Still running on the host. Check the history in a minute.');
		abort.restore();
	});

	test('image status and logs parse and post host_id only', async () => {
		const parsedStatus = parseImageStatus(statusBody());
		assert.equal(parsedStatus?.state, 'running');
		assert.equal(parsedStatus?.container, 'web');
		const parsedLogs = parseImageLogs({ container: 'web', lines: ['ready'], truncated: false });
		assert.deepEqual(parsedLogs?.lines, ['ready']);
		const calls = installFetch((call) => {
			if (call.url.pathname.endsWith('/status')) return envelope(statusBody());
			if (call.url.pathname.endsWith('/logs')) return envelope({ container: 'web', lines: ['ready'], truncated: false });
			return envelope(null, 500, 'error', call.url.pathname);
		});
		const base = {
			session: TOKEN,
			user: USER,
			projects: [PROJECT],
			params: { id: PROJECT.id }
		};
		const status = (await projectActions.catalogStatus(
			fakeEvent({
				...base,
				url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogStatus`,
				form: { name: 'web', host_id: HOST_ID, entry_kind: 'image' }
			}).event as never
		)) as { catalogAction?: { status?: { state?: string; container?: string | null } | null } };
		assert.equal(status.catalogAction?.status?.state, 'running');
		assert.equal(status.catalogAction?.status?.container, 'web');
		const logs = (await projectActions.catalogLogs(
			fakeEvent({
				...base,
				url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogLogs`,
				form: { name: 'web', host_id: HOST_ID, entry_kind: 'image' }
			}).event as never
		)) as { catalogAction?: { logs?: { lines?: string[] } | null } };
		assert.deepEqual(logs.catalogAction?.logs?.lines, ['ready']);
		for (const call of calls) {
			assert.deepEqual(JSON.parse(call.body ?? '{}'), { host_id: HOST_ID });
			assert.equal(call.body?.includes('idempotency'), false);
		}
		const blank = parseDeployPayload({
			deploy: {
				id: '00000000-0000-4000-8000-0000000000e1',
				entry_id: ENTRY_ID,
				host_id: HOST_ID,
				digest: null,
				spec_hash: HASH,
				outcome: 'timeout',
				exit_code: null,
				started_at: '2026-10-14T00:00:00Z',
				finished_at: null,
				by: USER.id,
				via: 'console'
			},
			status: {
				container: null,
				state: 'unknown',
				exit_code: null,
				restart_count: 0,
				started_at: null,
				finished_at: null,
				digest: null,
				ports: []
			},
			lines: []
		});
		assert.equal(blank?.kind, 'deploy');
		if (blank?.kind !== 'deploy') return;
		assert.equal(blank.status.state, 'unknown');
		assert.equal(blank.status.container, null);
		assert.equal(blank.deploy.outcome, 'timeout');
		assert.equal(blank.deploy.digest, null);
		assert.equal(parseImageStatus({ ...statusBody(), state: '' }), null);
		assert.equal(parseImageStatus({ ...statusBody(), state: 'bogus' }), null);
		assert.equal(parseImageStatus({ ...statusBody(), state: 'missing' })?.state, 'missing');
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const html = render(CatalogDeployForm, {
			props: {
				entry: imageEntry(['deploy']),
				hosts: [host()],
				deployAction: '?/catalogDeploy',
				rollbackAction: '?/catalogRollback',
				removeAction: '?/catalogRemove',
				confirmAction: '?/catalogConfirm',
				historyAction: '?/catalogDeploys',
				result: {
					name: 'web',
					resultId: '00000000-0000-4000-8000-0000000000f3',
					hostId: HOST_ID,
					workload: 'service',
					waitSec: 30,
					outcome: deployRow('00000000-0000-4000-8000-0000000000e1', 'timeout', null),
					status: blank.status,
					lines: [],
					history: [],
					confirmation: null,
					confirmKind: null,
					message: null
				}
			}
		}).body;
		const unknownAt = html.indexOf('text-status-unknown');
		assert.equal(unknownAt > 0, true);
		const unknownBadge = html.slice(unknownAt, html.indexOf('</p>', unknownAt));
		assert.equal(unknownBadge.includes('text-status-unknown'), true);
		assert.equal(unknownBadge.includes('unknown<!---->'), true);
		assert.equal(unknownBadge.includes('text-status-offline'), false);
		assert.equal(unknownBadge.includes('missing'), false);
		assert.equal(unknownBadge.includes('stopped'), false);
		const runHtml = render(CatalogRunForm, {
			props: {
				kind: 'status',
				entryName: 'web',
				runAs: 'joe',
				shell: false,
				hosts: [host()],
				action: '?/catalogStatus',
				entryKind: 'image',
				result: {
					name: 'web',
					kind: 'status',
					resultId: '00000000-0000-4000-8000-0000000000f4',
					status: blank.status,
					logs: null,
					message: null
				}
			}
		}).body;
		const runAt = runHtml.indexOf('text-status-unknown');
		assert.equal(runAt > 0, true);
		const runBadge = runHtml.slice(runAt, runHtml.indexOf('</p>', runAt));
		assert.equal(runBadge.includes('unknown<!---->'), true);
		assert.equal(runBadge.includes('text-status-offline'), false);
		assert.equal(runBadge.includes('missing'), false);
		assert.equal(runBadge.includes('stopped'), false);
	});

	test('a catalog image entry and a container digest round-trip', () => {
		const entry = {
			id: ENTRY_ID,
			project_id: PROJECT.id,
			name: 'web',
			kind: 'image',
			spec: {
				kind: 'service',
				image: 'ghcr.io/acme/web:1',
				command: null,
				entrypoint: null,
				ports: [{ host: 8080, container: 80, public: false }],
				env: { PORT: '3000' },
				env_sets: [],
				secret_env: {},
				volumes: [],
				restart: 'unless-stopped',
				user: 'app',
				healthy_after_sec: 30,
				memory_mb: null,
				timeout_sec: 600
			},
			spec_hash: HASH,
			command_display: 'ghcr.io/acme/web:1',
			created_by: USER.id,
			created_at: '2026-10-14T00:00:00Z',
			updated_at: '2026-10-14T00:00:00Z',
			my_actions: ['deploy']
		};
		const parsed = parseCatalogEntry(entry);
		assert.equal(parsed?.kind, 'image');
		if (parsed?.kind !== 'image') return;
		assert.equal(parsed.spec.image, 'ghcr.io/acme/web:1');
		assert.equal(parsed.spec.command, null);
		assert.equal(parsed.spec.restart, 'unless-stopped');
		assert.equal(parsed.spec.user, 'app');
		assert.deepEqual(parsed.spec.ports, [{ host: 8080, container: 80, public: false }]);
		assert.deepEqual(parsed.spec.env, { PORT: '3000' });
		const job = parseCatalogEntry({
			...entry,
			spec: { ...entry.spec, kind: 'job', restart: 'unless-stopped' }
		});
		assert.equal(job, null);
		const service = {
			id: '00000000-0000-4000-8000-0000000000bb',
			name: 'web-1',
			source: 'owned',
			kind: 'container',
			ports: [80],
			health: null,
			container_name: 'web-1',
			image_digest: digest('a')
		};
		const row = parseService(service);
		assert.equal(row?.container_name, 'web-1');
		assert.equal(row?.image_digest, digest('a'));
		assert.equal(parseService({ ...service, image_digest: 'sha256:nope' }), null);
		assert.equal(parseService({ ...service, container_name: undefined, image_digest: undefined })?.container_name, null);
	});

	test('a stored service with timeout 0 stays in the catalog list', () => {
		const spec = {
			env: { FOO: 'bar' },
			kind: 'service',
			user: '',
			image: 'docker.io/library/nginx:1.27',
			ports: [{ host: 8088, public: false, container: 80 }],
			command: null,
			restart: 'unless-stopped',
			volumes: [],
			env_sets: [],
			memory_mb: null,
			entrypoint: null,
			secret_env: {},
			timeout_sec: 0,
			healthy_after_sec: 30
		};
		const parsed = parseImageSpec(spec);
		assert.equal(parsed?.kind, 'service');
		if (!parsed || parsed.kind !== 'service') return;
		assert.equal(parsed.image, 'docker.io/library/nginx:1.27');
		assert.equal(parsed.timeout_sec, 0);
		assert.equal(parsed.healthy_after_sec, 30);
		assert.equal(parsed.user, '');
		assert.equal(parsed.restart, 'unless-stopped');
		assert.equal(parsed.command, null);
		assert.equal(parsed.entrypoint, null);
		assert.deepEqual(parsed.ports, [{ host: 8088, container: 80, public: false }]);
		assert.deepEqual(parsed.env, { FOO: 'bar' });
		const list = parseCatalogList({
			items: [
				{
					id: ENTRY_ID,
					project_id: PROJECT.id,
					name: 'web',
					kind: 'image',
					spec,
					spec_hash: HASH,
					command_display: 'docker.io/library/nginx:1.27',
					created_by: USER.id,
					created_at: '2026-10-14T00:00:00Z',
					updated_at: '2026-10-14T00:00:00Z',
					my_actions: ['deploy']
				}
			],
			next_cursor: null
		});
		assert.equal(list?.omitted, 0);
		assert.equal(list?.items.length, 1);
		assert.equal(list?.items[0]?.kind, 'image');
		const job = parseImageSpec({ ...spec, kind: 'job', restart: 'no', timeout_sec: 600, healthy_after_sec: 0 });
		assert.equal(job?.kind, 'job');
		if (!job || job.kind !== 'job') return;
		assert.equal(job.healthy_after_sec, 0);
		assert.equal(job.timeout_sec, 600);
		assert.equal(job.restart, 'no');
		assert.equal(job.image, 'docker.io/library/nginx:1.27');
		const serviceWithoutTimeout: Record<string, unknown> = { ...spec };
		delete serviceWithoutTimeout.timeout_sec;
		const omittedTimeout = parseImageSpec(serviceWithoutTimeout);
		assert.equal(omittedTimeout?.kind, 'service');
		assert.equal(omittedTimeout?.timeout_sec, 0);
		assert.equal(omittedTimeout?.healthy_after_sec, 30);
		const jobWithoutHealthy: Record<string, unknown> = { ...spec, kind: 'job', restart: 'no', timeout_sec: 600 };
		delete jobWithoutHealthy.healthy_after_sec;
		const omittedHealthy = parseImageSpec(jobWithoutHealthy);
		assert.equal(omittedHealthy?.kind, 'job');
		assert.equal(omittedHealthy?.healthy_after_sec, 0);
		assert.equal(omittedHealthy?.timeout_sec, 600);
		assert.equal(parseImageSpec({ ...spec, healthy_after_sec: 4 }), null);
		assert.equal(parseImageSpec({ ...spec, kind: 'job', restart: 'no', timeout_sec: 9, healthy_after_sec: 0 }), null);
		assert.equal(parseImageSpec({ ...spec, kind: 'job', restart: 'no', timeout_sec: 0, healthy_after_sec: 0 }), null);
		assert.equal(parseImageSpec({ ...spec, timeout_sec: -1 }), null);
	});

	test('an image permissions save can grant deploy', async () => {
		const memberId = '00000000-0000-4000-8000-0000000000d1';
		const calls = installFetch((call) => {
			if (call.url.pathname.endsWith('/members')) {
				return envelope({
					items: [{ user_id: memberId, email: 'bea@example.com', name: 'Bea', role: 'admin', created_at: '2026-10-13T00:00:00Z' }],
					next_cursor: null
				});
			}
			return envelope({ grants: [] });
		});
		const base = {
			session: TOKEN,
			user: USER,
			projects: [PROJECT],
			params: { id: PROJECT.id }
		};
		await assert.rejects(
			async () => {
				await projectActions.catalogPermissions(
					fakeEvent({
						...base,
						url: `http://console.example/projects/${PROJECT.id}?tab=catalog&permissions=web&/catalogPermissions`,
						form: { name: 'web', entry_kind: 'image', admin_deploy: '1', admin_logs: '1' }
					}).event as never
				);
			},
			(err: unknown) => isRedirect(err) && err.status === 303
		);
		const put = calls.find((call) => call.method === 'PUT');
		assert.deepEqual(JSON.parse(put?.body ?? ''), { grants: [{ subject: 'role:admin', actions: ['logs', 'deploy'] }] });
		const plain = installFetch((call) => {
			if (call.url.pathname.endsWith('/members')) return envelope({ items: [], next_cursor: null });
			return envelope({ grants: [] });
		});
		await assert.rejects(
			async () => {
				await projectActions.catalogPermissions(
					fakeEvent({
						...base,
						url: `http://console.example/projects/${PROJECT.id}?tab=catalog&permissions=web&/catalogPermissions`,
						form: { name: 'web', admin_deploy: '1', admin_logs: '1' }
					}).event as never
				);
			},
			(err: unknown) => isRedirect(err) && err.status === 303
		);
		const programPut = plain.find((call) => call.method === 'PUT');
		assert.deepEqual(JSON.parse(programPut?.body ?? ''), { grants: [{ subject: 'role:admin', actions: ['logs'] }] });
	});

	test('a history response for another host is ignored', () => {
		assert.equal(acceptHostHistory('host-b', 'host-a', 'host-a'), 'ignore');
		assert.equal(acceptHostHistory('host-b', 'host-b', 'host-a'), 'ignore');
		assert.equal(acceptHostHistory('host-b', 'host-b', 'host-b'), 'accept');
		assert.equal(acceptHostHistory('host-b', 'host-b', null), 'missing');
		assert.equal(acceptHostHistory('', 'host-b', 'host-b'), 'ignore');
		assert.equal(switchedHistoryHost('host-a', 'host-b'), true);
		assert.equal(switchedHistoryHost('', 'host-a'), false);
		assert.equal(switchedHistoryHost('host-a', 'host-a'), false);
		const listed = { history: [digest('a')], ready: true, pending: false, error: null, listedHost: 'host-a' };
		const switched = historyAfterSwitch('host-a', 'host-b', listed);
		assert.equal(switched.switched, true);
		assert.deepEqual(switched.history, []);
		assert.equal(switched.ready, false);
		assert.equal(switched.pending, true);
		assert.equal(switched.error, null);
		const cleared = { history: switched.history, ready: switched.ready, pending: switched.pending, error: switched.error, listedHost: 'host-a' };
		const late = applyHistoryResponse(cleared, 'host-b', 'host-a', 'host-a', [digest('a')], null);
		assert.deepEqual(late.history, []);
		assert.equal(late.ready, false);
		assert.equal(late.pending, true);
		const wrongHost = applyHistoryResponse(cleared, 'host-b', 'host-b', 'host-a', [digest('a')], null);
		assert.deepEqual(wrongHost.history, []);
		assert.equal(wrongHost.ready, false);
		const accepted = applyHistoryResponse(cleared, 'host-b', 'host-b', 'host-b', [digest('b')], null);
		assert.deepEqual(accepted.history, [digest('b')]);
		assert.equal(accepted.ready, true);
		assert.equal(accepted.pending, false);
		assert.equal(accepted.listedHost, 'host-b');
		const missing = applyHistoryResponse(
			{ history: ['kept'], ready: true, pending: false, error: null, listedHost: 'host-b' },
			'host-b',
			'host-b',
			null,
			['other'],
			null
		);
		assert.deepEqual(missing.history, ['kept']);
		assert.equal(missing.ready, true);
		assert.equal(missing.pending, false);
		assert.equal(missing.error, 'History could not be loaded.');
		const first = historyAfterSwitch('', 'host-a', { history: ['kept'], ready: true, pending: false, error: null });
		assert.equal(first.switched, false);
		assert.deepEqual(first.history, ['kept']);
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const waiting = render(CatalogDeployForm, {
			props: {
				entry: imageEntry(['deploy']),
				hosts: [host()],
				deployAction: '?/catalogDeploy',
				rollbackAction: '?/catalogRollback',
				removeAction: '?/catalogRemove',
				confirmAction: '?/catalogConfirm',
				historyAction: '?/catalogDeploys',
				result: null
			}
		}).body;
		assert.equal(waiting.split('Roll back').length - 1, 0);
		assert.equal(waiting.includes('Loading history'), false);
	});

	test('history is read for a host that cannot deploy', () => {
		assert.equal(historyNotice({ hostCount: 0, pending: true, ready: false, count: 0 }), 'no-hosts');
		assert.equal(historyNotice({ hostCount: 1, pending: false, ready: false, count: 0 }), 'quiet');
		assert.equal(historyNotice({ hostCount: 1, pending: true, ready: false, count: 0 }), 'loading');
		assert.equal(historyNotice({ hostCount: 1, pending: false, ready: true, count: 0 }), 'empty');
		assert.deepEqual(historyFetch('', '', true), { submit: false, pending: false });
		assert.deepEqual(historyFetch(HOST_ID, '', true), { submit: true, pending: true });
		assert.deepEqual(historyFetch(HOST_ID, HOST_ID, true), { submit: false, pending: false });
		assert.deepEqual(historyFetch(HOST_ID, '', false), { submit: false, pending: false });
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const second = '00000000-0000-4000-8000-0000000000ab';
		const programs = { enabled: true, run_as: ['joe'], allow_shell: true, policy_hash: 'policy-1', images: false, docker: true, files: false, logging: false, health_policy: false };
		const blockedHost = { ...host(), programs };
		const openHost = { ...host(), id: second, name: 'pi2', programs: { ...programs, images: true, docker: true } };
		const props = {
			entry: imageEntry(['deploy']),
			deployAction: '?/catalogDeploy',
			rollbackAction: '?/catalogRollback',
			removeAction: '?/catalogRemove',
			confirmAction: '?/catalogConfirm',
			historyAction: '?/catalogDeploys'
		};
		function buttons(html: string): string[] {
			return [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map((match) => match[0]);
		}
		function control(html: string, label: string): string {
			const found = buttons(html).find((tag) => tag.includes(label));
			assert.equal(found != null, true, label);
			return found ?? '';
		}
		function markedDisabled(tag: string): boolean {
			const open = tag.slice(0, tag.indexOf('>') + 1);
			return /\sdisabled(?:=|\s|>)/.test(open);
		}
		const blocked = render(CatalogDeployForm, { props: { ...props, hosts: [blockedHost, openHost], result: null } }).body;
		const radios = buttons(blocked).filter((tag) => tag.includes('role="radio"'));
		assert.equal(radios.length, 2);
		assert.equal(radios[0]?.includes('aria-checked="true"'), true);
		assert.equal(radios[0]?.includes('pi1'), true);
		assert.equal(markedDisabled(radios[0] ?? ''), false);
		assert.equal(radios[1]?.includes('aria-checked="false"'), true);
		assert.equal(radios[1]?.includes('pi2'), true);
		assert.equal(markedDisabled(radios[1] ?? ''), false);
		assert.equal(blocked.includes('pi1: This host does not run containers.'), true);
		assert.equal(blocked.includes('pi2: This host does not run containers.'), false);
		assert.equal(blocked.includes(`value="${HOST_ID}"`), true);
		assert.equal(blocked.includes(`value="${second}"`), false);
		assert.equal(blocked.includes('Loading history'), false);
		assert.equal(blocked.includes('No hosts in this project.'), false);
		assert.equal(markedDisabled(control(blocked, 'Deploy')), true);
		assert.equal(markedDisabled(control(blocked, 'Remove')), true);
		const open = render(CatalogDeployForm, { props: { ...props, hosts: [openHost], result: null } }).body;
		assert.equal(markedDisabled(control(open, 'Deploy')), false);
		assert.equal(markedDisabled(control(open, 'Remove')), false);
		assert.equal(open.includes('Loading history'), false);
		const listed = render(CatalogDeployForm, {
			props: {
				...props,
				hosts: [blockedHost],
				result: {
					name: 'web',
					resultId: '00000000-0000-4000-8000-0000000000f2',
					hostId: HOST_ID,
					workload: 'service' as const,
					waitSec: 30,
					outcome: null,
					status: null,
					lines: [],
					history: [deployRow('00000000-0000-4000-8000-0000000000e2', 'succeeded', digest('a')), deployRow('00000000-0000-4000-8000-0000000000e3', 'succeeded', digest('b'))],
					confirmation: null,
					confirmKind: null,
					message: null
				}
			}
		}).body;
		assert.equal(markedDisabled(control(listed, 'Roll back to')), true);
		assert.equal(markedDisabled(control(listed, 'Deploy')), true);
		assert.equal(markedDisabled(control(listed, 'Remove')), true);
		const none = render(CatalogDeployForm, { props: { ...props, hosts: [], result: null } }).body;
		assert.equal(none.includes('No hosts in this project.'), true);
		assert.equal(none.includes('Loading history'), false);
		const flying = render(CatalogDeployForm, { props: { ...props, hosts: [blockedHost], result: null, historyInFlight: true } }).body;
		assert.equal(flying.includes('Loading history…'), true);
		assert.equal(flying.includes('No hosts in this project.'), false);
		const stuck = render(CatalogDeployForm, { props: { ...props, hosts: [], result: null, historyInFlight: true } }).body;
		assert.equal(stuck.includes('No hosts in this project.'), true);
		assert.equal(stuck.includes('Loading history'), false);
	});

	test('deploy notices wrap and remove waits for a host', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const longRef = `ghcr.io/${'a'.repeat(200)}/web:1`;
		const message = `Could not deploy ${longRef}`;
		const plan = `Plan ${longRef}`;
		const longHost = 'h'.repeat(80);
		const props = {
			entry: imageEntry(['deploy']),
			deployAction: '?/catalogDeploy',
			rollbackAction: '?/catalogRollback',
			removeAction: '?/catalogRemove',
			confirmAction: '?/catalogConfirm',
			historyAction: '?/catalogDeploys'
		};
		const html = render(CatalogDeployForm, {
			props: {
				...props,
				hosts: [{ ...host(), name: longHost }],
				result: {
					name: 'web',
					resultId: '00000000-0000-4000-8000-0000000000ee',
					hostId: HOST_ID,
					workload: 'service' as const,
					waitSec: 30,
					outcome: null,
					status: null,
					lines: [],
					history: [],
					confirmation: { confirmation_id: 'A'.repeat(43), plan, expires_at: '2026-10-14T00:00:00Z' },
					confirmKind: 'deploy' as const,
					message
				}
			}
		}).body;
		const messageAt = html.indexOf(message);
		const planAt = html.indexOf(plan);
		assert.equal(messageAt > 0 && html.slice(Math.max(0, messageAt - 500), messageAt).includes('break-words'), true);
		assert.equal(planAt > 0 && html.slice(Math.max(0, planAt - 500), planAt).includes('break-words'), true);
		const radios = [...html.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]).filter((tag) => tag.includes('role="radio"'));
		assert.equal(radios.some((tag) => tag.includes('break-all') && tag.includes('whitespace-normal')), true);
		assert.equal(html.includes(longHost), true);
		assert.equal(html.includes('Remove'), true);
		const blocked = render(CatalogDeployForm, {
			props: { ...props, hosts: [{ ...host(), programs: null }], result: null }
		}).body;
		assert.equal(blocked.includes('Loading history'), false);
		assert.equal(blocked.includes('This host does not run containers.'), true);
		const unnamed = render(CatalogDeployForm, {
			props: {
				...props,
				hosts: [host()],
				result: {
					name: 'web',
					resultId: '00000000-0000-4000-8000-0000000000ef',
					hostId: '00000000-0000-4000-8000-0000000000ff',
					workload: 'service' as const,
					waitSec: 30,
					outcome: null,
					status: null,
					lines: [],
					history: null,
					confirmation: null,
					confirmKind: null,
					message: null
				}
			}
		}).body;
		assert.equal(unnamed.includes('Remove'), false);
		const runHtml = render(CatalogRunForm, {
			props: {
				kind: 'run',
				entryName: 'web',
				runAs: 'joe',
				shell: false,
				hosts: [host()],
				action: '?/catalogRun',
				entryKind: 'image',
				result: {
					name: 'web',
					kind: 'run',
					resultId: '00000000-0000-4000-8000-0000000000f1',
					status: null,
					logs: null,
					message: `Run failed for ${longRef}`
				}
			}
		}).body;
		const runAt = runHtml.indexOf(longRef);
		assert.equal(runAt > 0 && runHtml.slice(Math.max(0, runAt - 500), runAt).includes('break-words'), true);
		assert.equal([...runHtml.matchAll(/<button\b[^>]*>/g)].some((match) => match[0].includes('role="radio"') && match[0].includes('break-all')), true);
	});

	test('an image field error names its control and env set names wrap when ready', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const message = 'Enter an image reference, such as ghcr.io/acme/web:1.';
		const draft = blankImageDraft();
		draft.image = 'not an image';
		const setName = 'a'.repeat(48);
		const secretKey = 'A'.repeat(64);
		draft.secrets = [{ key: 'API_TOKEN', set: setName, name: secretKey }];
		draft.volumes = [{ name: 'data', target: '/data', readOnly: false }];
		const html = render(CatalogImageForm, {
			props: {
				mode: 'create',
				saveAction: '?/catalogCreate',
				sets: [{ name: setName, keys: [secretKey] }],
				setsStatus: 'ready',
				editor: { mode: 'create', name: null, draft, field: 'image', message }
			}
		}).body;
		assert.equal(html.includes('aria-describedby="catalog-image-new-error"'), true);
		assert.match(html, /id="catalog-image-new-error"[^>]*focus-visible:ring-3/);
		assert.doesNotMatch(html, /id="catalog-image-new-error"[^>]*outline-none/);
		assert.match(html, new RegExp(`break-all[^>]*>${setName}`));
		assert.match(html, /min-w-0 items-start/);
		assert.equal(html.includes(secretKey), true);
		assert.equal(html.includes('aria-label="Remove command argument 1"'), true);
		assert.equal(html.includes('aria-label="Remove entrypoint argument 1"'), true);
		assert.equal(html.includes('aria-label="Remove secret 1"'), true);
		assert.equal(html.includes('aria-label="Remove volume 1"'), true);
		assert.equal(html.includes('aria-label="Read only volume 1"'), true);
		const secretRadios = [...html.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]).filter((tag) => tag.includes('role="radio"'));
		assert.equal(secretRadios.some((tag) => tag.includes('break-all') && tag.includes('whitespace-normal')), true);
		const loading = render(CatalogImageForm, {
			props: {
				mode: 'create',
				saveAction: '?/catalogCreate',
				sets: [{ name: 'gone', keys: [] }],
				setsStatus: 'loading',
				editor: null
			}
		}).body;
		assert.equal(loading.includes('gone'), false);
		assert.equal(loading.includes('Loading env sets…'), true);
		assert.equal(loading.includes('No env sets yet'), false);
	});

	test('v1.9 file examples parse, and anything else fails closed', () => {
		const fixtureIds = {
			PROJECT: '11111111-1111-4111-8111-111111111111',
			OWNER: '22222222-2222-4222-8222-222222222222',
			ENTRY_WEB: '33333333-3333-4333-8333-333333333333',
			ENTRY_API: '44444444-4444-4444-8444-444444444444'
		} as const;
		const text = readFileSync(new URL('../docs/examples/v1.9-files.json', import.meta.url), 'utf8');
		const placeholder = /"([A-Z][A-Z0-9_]*)"/g;
		const found = [...text.matchAll(placeholder)].map((match) => match[1]);
		for (const token of found) assert.equal(Object.hasOwn(fixtureIds, token), true, token);
		let substituted = text;
		for (const [name, id] of Object.entries(fixtureIds)) substituted = substituted.replaceAll(`"${name}"`, `"${id}"`);
		assert.deepEqual([...substituted.matchAll(placeholder)].map((match) => match[1]), []);
		const raw = JSON.parse(substituted) as Record<string, unknown>;
		assert.deepEqual(Object.keys(raw).sort(), ['catalog_entry', 'delete_conflict', 'deploy_unsupported', 'get_plain', 'host_programs', 'list_files', 'put_file']);
		function envelopeOf(key: string): { code: string; msg: string; payload: unknown } {
			const value = raw[key];
			assert.equal(value != null && typeof value === 'object', true, key);
			return value as { code: string; msg: string; payload: unknown };
		}
		function payloadOf(key: string): Record<string, unknown> {
			const payload = envelopeOf(key).payload;
			assert.equal(payload != null && typeof payload === 'object', true, key);
			return payload as Record<string, unknown>;
		}

		const entry = payloadOf('catalog_entry');
		const catalog = parseCatalogEntry(entry);
		assert.equal(catalog?.kind, 'image');
		assert.equal(catalog?.id, fixtureIds.ENTRY_WEB);
		assert.equal(catalog?.project_id, fixtureIds.PROJECT);
		assert.equal(catalog?.created_by, fixtureIds.OWNER);
		const spec = parseImageSpec(entry.spec);
		assert.equal(spec?.kind, 'service');
		assert.deepEqual(spec?.files, [
			{ file: 'app.conf', target: '/config/app.conf' },
			{ file: 'key.json', target: '/run/secrets/key.json' }
		]);
		const omitted = { ...(entry.spec as Record<string, unknown>) };
		delete omitted.files;
		assert.deepEqual(parseImageSpec(omitted)?.files, []);
		assert.equal(parseImageSpec({ ...(entry.spec as Record<string, unknown>), files: null }), null);
		assert.equal(parseImageSpec({ ...(entry.spec as Record<string, unknown>), files: [{ file: 'app.conf', target: '/proc/self' }] }), null);
		assert.equal(parseImageSpec({ ...(entry.spec as Record<string, unknown>), files: [{ file: 'app.conf', target: '/config/app.conf' }, { file: 'app.conf', target: '/other' }] }), null);
		function filesOnSpec(count: number): Record<string, unknown> {
			return {
				...(entry.spec as Record<string, unknown>),
				files: Array.from({ length: count }, (_, index) => ({ file: `f${index}.conf`, target: `/opt/f${index}.conf` }))
			};
		}
		assert.equal(parseImageSpec(filesOnSpec(16))?.files.length, 16);
		assert.equal(parseImageSpec(filesOnSpec(17)), null);
		const nestedFiles = {
			...(entry.spec as Record<string, unknown>),
			files: [
				{ file: 'app.conf', target: '/config' },
				{ file: 'key.json', target: '/config/key.json' }
			]
		};
		assert.equal(parseImageSpec({ ...(entry.spec as Record<string, unknown>), files: [{ file: 'Bad', target: '/config/app.conf' }] }), null);
		assert.equal(
			parseImageSpec({
				...(entry.spec as Record<string, unknown>),
				volumes: [{ name: 'data', target: '/data', read_only: false }],
				files: [{ file: 'app.conf', target: '/data/app.conf' }]
			}),
			null
		);
		assert.equal(
			parseImageSpec({
				...(entry.spec as Record<string, unknown>),
				volumes: [{ name: 'data', target: '/config/extra', read_only: true }],
				files: [{ file: 'app.conf', target: '/config' }]
			}),
			null
		);
		assert.deepEqual(parseImageSpec(nestedFiles)?.files, [
			{ file: 'app.conf', target: '/config' },
			{ file: 'key.json', target: '/config/key.json' }
		]);
		assert.equal(
			parseImageSpec({
				...(entry.spec as Record<string, unknown>),
				files: [
					{ file: 'app.conf', target: '/config/app.conf' },
					{ file: 'key.json', target: '/config/app.conf' }
				]
			}),
			null
		);

		for (const key of ['delete_conflict', 'deploy_unsupported']) {
			assert.equal(parseProjectFile(raw[key]), null, key);
			assert.equal(parseProjectFile(envelopeOf(key).payload), null, key);
			assert.equal(parseProjectFileContent(envelopeOf(key).payload), null, key);
			assert.equal(parseProjectFileList(envelopeOf(key).payload), null, key);
			assert.equal(parseHostPrograms(raw[key]), null, key);
		}
		assert.equal(envelopeOf('delete_conflict').msg, 'referenced by api, web');
		assert.equal(envelopeOf('deploy_unsupported').msg, "this host's agent does not support files");

		const programs = parseHostPrograms(raw.host_programs);
		assert.equal(programs?.files, true);
		assert.equal(programs?.images, true);
		assert.equal(programs?.docker, true);
		const missingFlag = { ...(raw.host_programs as Record<string, unknown>) };
		delete missingFlag.files;
		assert.equal(parseHostPrograms(missingFlag)?.files, false);
		assert.equal(parseHostPrograms({ ...(raw.host_programs as Record<string, unknown>), files: null })?.files, false);
		assert.equal(parseHostPrograms({ ...(raw.host_programs as Record<string, unknown>), files: 'yes' }), null);

		const listed = parseProjectFileList(envelopeOf('list_files').payload);
		assert.deepEqual(listed?.items.map((item) => item.name), ['app.conf', 'key.json']);
		assert.equal(listed?.items[0]?.is_secret, false);
		assert.equal(listed?.items[0]?.sha256, 'f395f66c028f7f579159bec04d13356b2027b4f36809bd4634301abb3cb530ff');
		assert.equal(listed?.items[1]?.is_secret, true);
		assert.equal(listed?.items[1]?.sha256, null);
		assert.equal(JSON.stringify(listed).includes('content'), false);
		const leaked = parseProjectFile({ ...(listed?.items[1] as ProjectFile), content: 'secret-should-not-load' });
		assert.equal(leaked?.sha256, null);
		assert.equal(JSON.stringify(leaked).includes('secret-should-not-load'), false);

		const plain = parseProjectFileContent(payloadOf('get_plain'));
		assert.equal(plain?.content, 'plain-config-line');
		assert.equal(plain?.size, 17);
		assert.equal(plain?.name, 'app.conf');
		assert.equal(parseProjectFileContent({ ...payloadOf('get_plain'), size: 16 }), null);
		assert.equal(parseProjectFileContent({ ...payloadOf('get_plain'), content: 'plain-config-line\0' }), null);
		assert.equal(parseProjectFileContent({ ...payloadOf('get_plain'), content: '' }), null);
		const utf8 = { ...payloadOf('get_plain'), content: 'héllo', size: 6 };
		assert.equal(parseProjectFileContent(utf8)?.size, 6);
		assert.equal(parseProjectFileContent({ ...utf8, size: 5 }), null);

		const saved = parseProjectFile(payloadOf('put_file'));
		assert.equal(saved?.name, 'key.json');
		assert.equal(saved?.is_secret, true);
		assert.equal(saved?.sha256, null);
		assert.equal(saved?.updated_by, fixtureIds.OWNER);
		assert.equal(plain?.updated_by, fixtureIds.OWNER);
		assert.equal(listed?.items[0]?.updated_by, fixtureIds.OWNER);
		assert.equal(listed?.items[1]?.updated_by, fixtureIds.OWNER);
		assert.equal(parseProjectFileContent(payloadOf('put_file')), null);
		const plainRow = listed?.items[0] as ProjectFile;
		assert.equal(parseProjectFile({ ...plainRow, sha256: null }), null);
		assert.equal(parseProjectFile({ ...saved, sha256: 'ab'.repeat(32) }), null);
		const noDigest = { ...plainRow } as Record<string, unknown>;
		delete noDigest.sha256;
		assert.equal(parseProjectFile(noDigest), null);
		assert.equal(parseProjectFile({ ...plainRow, updated_by: USER.id })?.updated_by, USER.id);
		assert.equal(parseProjectFile({ ...plainRow, updated_by: 'OWNER' }), null);
		assert.equal(parseProjectFile({ ...plainRow, updated_by: 'not a user' }), null);
		assert.equal(parseProjectFileList({ items: [plainRow, plainRow] }), null);
		assert.equal(parseProjectFileList({ items: [plainRow, { ...plainRow, name: 'BAD' }] }), null);
		const sixtyFour = Array.from({ length: 64 }, (_, index) => ({ ...plainRow, name: `f${index}.conf` }));
		assert.equal(parseProjectFileList({ items: sixtyFour })?.items.length, 64);
		const tooMany = Array.from({ length: 65 }, (_, index) => ({ ...plainRow, name: `f${index}.conf` }));
		assert.equal(parseProjectFileList({ items: tooMany }), null);
	});

	test('settings files keep the paste empty, view only a plain file, and name a delete conflict', async () => {
		const secretLine = 'file-secret-line-99';
		const otherLine = 'second-secret-line';
		const content = `${secretLine}\n${otherLine}`;
		const files: ProjectFile[] = [
			{
				name: 'app.conf',
				is_secret: false,
				size: 17,
				sha256: 'ab'.repeat(32),
				updated_at: '2026-10-13T12:00:00Z',
				updated_by: USER.id
			},
			{
				name: 'key.json',
				is_secret: true,
				size: 31,
				sha256: null,
				updated_at: '2026-10-13T12:00:00Z',
				updated_by: USER.id
			}
		];
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=settings`);
		const html = render(SettingsSection, {
			props: { project: PROJECT, canOwner: true, canAdmin: true, message: null, files }
		}).body;
		assert.equal(html.includes('app.conf'), true);
		assert.equal(html.includes('key.json'), true);
		assert.equal(html.includes('plain'), true);
		assert.equal(html.includes('secret'), true);
		assert.equal(html.includes(formatBytes(17)), true);
		assert.equal(html.includes(formatBytes(31)), true);
		assert.equal(html.includes(formatWhen('2026-10-13T12:00:00Z')), true);
		assert.equal(html.includes('aria-label="View app.conf"'), true);
		assert.equal(html.includes('aria-label="View key.json"'), false);
		assert.equal(html.includes(secretLine), false);
		assert.equal(html.includes(otherLine), false);
		const secretInput = [...html.matchAll(/<input\b[^>]*>/g)].map((match) => match[0]).find((tag) => tag.includes('name="secret"'));
		assert.equal(secretInput?.includes('value="1"'), true);
		assert.equal(html.includes('aria-label="Secret file"'), true);
		const area = html.match(/<textarea\b[^>]*id="file-content"[^>]*>[\s\S]*?<\/textarea>/);
		assert.equal(area != null, true);
		assert.equal(area?.[0].includes('autocomplete="off"'), true);
		assert.equal(area?.[0].includes(secretLine), false);
		assert.doesNotMatch(html, /[?&]content=/);

		const settings = readFileSync(new URL('../src/routes/projects/[id]/SettingsSection.svelte', import.meta.url), 'utf8');
		assert.match(settings, /settleFileSave\(/);
		assert.match(settings, /showViewedFile\(/);
		assert.match(settings, /message="Delete file \{file\.name\}\?"/);
		assert.match(settings, /messageClass="max-w-full min-w-0 break-all"/);
		assert.match(settings, /closeOnFailure/);

		const refused = installFetch(() => envelope(null, 400, 'bad_request', `saw ${otherLine} and ${secretLine}`));
		const failed = await projectActions.saveProjectFile(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=settings&/saveProjectFile`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: { name: 'key.json', content, secret: '1' }
			}).event as never
		);
		const failedData = actionData(failed);
		assert.equal(failedData.settingsField, 'file');
		assert.equal(failedData.message?.includes('Paste the value again.'), true);
		assert.equal(failedData.message?.includes(secretLine), false);
		assert.equal(failedData.message?.includes(otherLine), false);
		assert.equal(JSON.stringify(failed).includes(secretLine), false);
		assert.equal(JSON.stringify(failed).includes(otherLine), false);
		assert.equal(refused[0]?.body?.includes(secretLine), true);
		const failedHtml = render(SettingsSection, {
			props: {
				project: PROJECT,
				canOwner: true,
				canAdmin: true,
				message: failedData.message ?? null,
				settingsField: 'file',
				files
			}
		}).body;
		assert.equal(failedHtml.includes(secretLine), false);
		assert.equal(failedHtml.includes(otherLine), false);
		assert.equal(failedHtml.includes('Paste the value again.'), true);
		const failedArea = failedHtml.match(/<textarea\b[^>]*id="file-content"[^>]*>[\s\S]*?<\/textarea>/);
		assert.equal(failedArea?.[0].includes(secretLine), false);
		assert.match(failedHtml, /id="file-error"[^>]*tabindex="-1"/);

		const savedCalls = installFetch(() =>
			envelope({
				name: 'key.json',
				is_secret: true,
				size: 31,
				sha256: null,
				updated_at: '2026-10-13T12:00:00Z',
				updated_by: USER.id
			})
		);
		await assert.rejects(
			async () => {
				await projectActions.saveProjectFile(
					fakeEvent({
						url: `http://console.example/projects/${PROJECT.id}?tab=settings&/saveProjectFile`,
						session: TOKEN,
						user: USER,
						projects: [PROJECT],
						params: { id: PROJECT.id },
						form: { name: 'key.json', content }
					}).event as never
				);
			},
			(err: unknown) => {
				assert.equal(JSON.stringify(err).includes(secretLine), false);
				assert.equal(JSON.stringify(err).includes(otherLine), false);
				return isRedirect(err) && err.status === 303;
			}
		);
		const sent = JSON.parse(savedCalls[0]?.body ?? '{}') as { content?: string; secret?: boolean };
		assert.equal(savedCalls[0]?.method, 'PUT');
		assert.equal(savedCalls[0]?.url.pathname, `/v1/projects/${PROJECT.id}/files/key.json`);
		assert.equal(sent.secret, true);
		assert.equal(sent.content, content);
		for (const [flag, secret] of [
			['0', false],
			['1', true]
		] as const) {
			const flagged = installFetch(() =>
				envelope({
					name: 'key.json',
					is_secret: secret,
					size: 31,
					sha256: secret ? null : 'ab'.repeat(32),
					updated_at: '2026-10-13T12:00:00Z',
					updated_by: USER.id
				})
			);
			await assert.rejects(
				async () => {
					await projectActions.saveProjectFile(
						fakeEvent({
							url: `http://console.example/projects/${PROJECT.id}?tab=settings&/saveProjectFile`,
							session: TOKEN,
							user: USER,
							projects: [PROJECT],
							params: { id: PROJECT.id },
							form: { name: 'key.json', content, secret: flag }
						}).event as never
					);
				},
				(err: unknown) => isRedirect(err)
			);
			const body = JSON.parse(flagged[0]?.body ?? '{}') as { secret?: boolean };
			assert.equal(body.secret, secret, flag);
		}
		const afterSave = render(SettingsSection, {
			props: { project: PROJECT, canOwner: true, canAdmin: true, message: null, files }
		}).body;
		assert.equal(afterSave.includes(secretLine), false);
		assert.equal(afterSave.match(/<textarea\b[^>]*id="file-content"[^>]*>[\s\S]*?<\/textarea>/)?.[0].includes(content), false);

		const viewCalls = installFetch(() =>
			envelope({
				name: 'app.conf',
				content: 'plain-config-line',
				size: 17,
				sha256: 'f395f66c028f7f579159bec04d13356b2027b4f36809bd4634301abb3cb530ff',
				updated_at: '2026-10-13T12:00:00Z',
				updated_by: USER.id
			})
		);
		const viewedAgain = (await projectActions.viewProjectFile(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=settings&/viewProjectFile`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: { name: 'app.conf' }
			}).event as never
		)) as { viewedFile?: { name: string; content: string } };
		assert.equal(viewCalls[0]?.method, 'GET');
		assert.equal(viewCalls[0]?.url.pathname, `/v1/projects/${PROJECT.id}/files/app.conf`);
		assert.equal(viewedAgain.viewedFile?.name, 'app.conf');
		assert.equal(viewedAgain.viewedFile?.content, 'plain-config-line');
		assert.equal(JSON.stringify(viewedAgain).includes(secretLine), false);
		const viewedHtml = render(SettingsSection, {
			props: {
				project: PROJECT,
				canOwner: true,
				canAdmin: true,
				message: null,
				files,
				viewedFile: viewedAgain.viewedFile ?? null
			}
		}).body;
		const viewTag = [...viewedHtml.matchAll(/<pre\b[^>]*>/g)].map((match) => match[0]).find((tag) => tag.includes('id="file-view-app.conf"'));
		assert.equal(viewTag?.includes('tabindex="-1"'), true);
		assert.equal(viewTag?.includes('aria-label="File app.conf"'), true);
		assert.equal(viewedHtml.includes('plain-config-line'), true);
		assert.equal(viewedHtml.includes('aria-label="View key.json"'), false);

		installFetch(() => envelope(null, 403, 'forbidden', 'secret files cannot be read'));
		const denied = await projectActions.viewProjectFile(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=settings&/viewProjectFile`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: { name: 'key.json' }
			}).event as never
		);
		assert.equal(actionData(denied).settingsField ?? null, null);
		assert.equal(actionData(denied).message, 'secret files cannot be read');
		assert.equal(actionData(denied).message?.includes('Paste the value again.'), false);
		assert.equal(JSON.stringify(denied).includes(secretLine), false);

		const deleteCalls = installFetch(() => envelope(null, 409, 'conflict', 'referenced by api, web'));
		const conflict = await projectActions.deleteProjectFile(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=settings&/deleteProjectFile`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: { name: 'key.json' }
			}).event as never
		);
		assert.equal(deleteCalls[0]?.method, 'DELETE');
		assert.equal(deleteCalls[0]?.url.pathname, `/v1/projects/${PROJECT.id}/files/key.json`);
		assert.equal(actionData(conflict).message, 'referenced by api, web');
		assert.equal((actionData(conflict) as { settingsName?: string }).settingsName, 'key.json');
		assert.equal(actionData(conflict).settingsField ?? null, null);
		const longName = `${'a'.repeat(60)}.conf`;
		const conflictHtml = render(SettingsSection, {
			props: {
				project: PROJECT,
				canOwner: true,
				canAdmin: true,
				message: actionData(conflict).message ?? null,
				settingsName: 'key.json',
				files: [...files, { ...files[1], name: longName }]
			}
		}).body;
		const filesAt = conflictHtml.indexOf('>Files<');
		const rowAt = conflictHtml.indexOf('key.json');
		const messageAt = conflictHtml.indexOf('referenced by api, web');
		const formAt = conflictHtml.indexOf('id="file-name"');
		assert.equal(filesAt >= 0 && rowAt > filesAt && messageAt > rowAt && formAt > messageAt, true);
		assert.equal(conflictHtml.slice(0, filesAt).includes('referenced by api, web'), false);
		assert.match(conflictHtml, new RegExp(`break-all[\\s\\S]{0,80}${longName}`));

		const namesOnly = installFetch(() =>
			envelope({
				items: [
					{
						name: 'key.json',
						is_secret: true,
						size: 31,
						sha256: null,
						updated_at: '2026-10-13T12:00:00Z',
						updated_by: USER.id,
						content: secretLine
					}
				]
			})
		);
		const catalog = (await projectActions.catalogFiles(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogFiles`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id }
			}).event as never
		)) as { catalogFiles?: Array<{ name: string }> };
		assert.deepEqual(catalog.catalogFiles, [{ name: 'key.json' }]);
		assert.equal(JSON.stringify(catalog).includes(secretLine), false);
		assert.equal(namesOnly[0]?.method, 'GET');
	});

	test('a file save clears the paste, and name and secret reset only after success', async () => {
		let content = 'secret-paste';
		let name = 'key.json';
		let secret = false;
		let saved: string | null = 'previous';
		let during = 'unset';
		await settleFileSave(
			(next) => {
				content = next.content;
				name = next.name;
				secret = next.secret;
				saved = next.saved;
			},
			{ name: 'key.json', secret: false },
			'key.json',
			async () => {
				during = content;
			},
			'failure'
		);
		assert.equal(during, '');
		assert.equal(content, '');
		assert.equal(name, 'key.json');
		assert.equal(secret, false);
		assert.equal(saved, null);
		content = 'secret-paste';
		await settleFileSave(
			(next) => {
				content = next.content;
				name = next.name;
				secret = next.secret;
				saved = next.saved;
			},
			{ name: 'key.json', secret: false },
			'key.json',
			async () => undefined,
			'redirect'
		);
		assert.equal(content, '');
		assert.equal(name, '');
		assert.equal(secret, true);
		assert.equal(saved, 'key.json');
		let focused = false;
		let applied = false;
		await showViewedFile(
			async () => {
				applied = true;
			},
			() => {
				focused = applied;
			}
		);
		assert.equal(focused, true);
	});

	test('a file save redacts a secret inside a word and past the 500-character cut', async () => {
		const line = 'innersecret';
		const content = `${line}\nother-line-ok`;
		installFetch(() => envelope(null, 400, 'bad_request', `saw zz${line}zz now`));
		const inside = await projectActions.saveProjectFile(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=settings&/saveProjectFile`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: { name: 'key.json', content, secret: '1' }
			}).event as never
		);
		const insideMessage = actionData(inside).message ?? '';
		assert.equal(insideMessage.includes(line), false);
		assert.equal(insideMessage.includes('[redacted]'), true);
		const piece = 'longsecret';
		const long = `${'q'.repeat(495)}${piece}${'q'.repeat(30)}`;
		installFetch(() => envelope(null, 400, 'bad_request', long));
		const cut = await projectActions.saveProjectFile(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=settings&/saveProjectFile`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: { name: 'key.json', content: piece, secret: '1' }
			}).event as never
		);
		const cutMessage = actionData(cut).message ?? '';
		assert.equal(cutMessage.includes(piece), false);
		assert.equal(cutMessage.includes(piece.slice(0, 5)), false);
		assert.equal(cutMessage.includes('Paste the value again.'), true);
	});

	test('a file save refuses an empty, NUL, or over-long paste before calling the API', async () => {
		const calls = installFetch(() => envelope(null, 500, 'error', 'should not run'));
		const base = {
			url: `http://console.example/projects/${PROJECT.id}?tab=settings&/saveProjectFile`,
			session: TOKEN,
			user: USER,
			projects: [PROJECT],
			params: { id: PROJECT.id }
		};
		for (const content of ['', 'has\0nul', 'a'.repeat(65537)]) {
			const refused = await projectActions.saveProjectFile(fakeEvent({ ...base, form: { name: 'key.json', content, secret: '1' } }).event as never);
			assert.equal(actionData(refused).settingsField, 'file');
			assert.equal(actionData(refused).message?.includes('1 to 64 KiB'), true);
		}
		assert.equal(calls.length, 0);
	});

	test('catalog create and update post spec.files', async () => {
		const calls = installFetch(() => envelope({ id: '33333333-3333-4333-8333-333333333333' }));
		const files = [
			{ file: 'app.conf', target: '/config/app.conf' },
			{ file: 'key.json', target: '/run/secrets/key.json' }
		];
		const form = {
			entry_kind: 'image',
			name: 'web',
			workload: 'service',
			image: 'nginx',
			restart: 'unless-stopped',
			file_name: files.map((row) => row.file),
			file_target: files.map((row) => row.target)
		};
		const base = { session: TOKEN, user: USER, projects: [PROJECT], params: { id: PROJECT.id } };
		await assert.rejects(
			async () => {
				await projectActions.catalogCreate(
					fakeEvent({ ...base, url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogCreate`, form }).event as never
				);
			},
			(err: unknown) => isRedirect(err) && err.status === 303
		);
		const created = JSON.parse(calls[0]?.body ?? '{}') as { spec?: { files?: unknown } };
		assert.equal(calls[0]?.method, 'POST');
		assert.equal(calls[0]?.url.pathname, `/v1/projects/${PROJECT.id}/catalog`);
		assert.deepEqual(created.spec?.files, files);
		await assert.rejects(
			async () => {
				await projectActions.catalogUpdate(
					fakeEvent({
						...base,
						url: `http://console.example/projects/${PROJECT.id}?tab=catalog&/catalogUpdate`,
						form: { ...form, entry_name: 'web' }
					}).event as never
				);
			},
			(err: unknown) => isRedirect(err) && err.status === 303
		);
		const updated = JSON.parse(calls[1]?.body ?? '{}') as { spec?: { files?: unknown } };
		assert.equal(calls[1]?.method, 'PUT');
		assert.equal(calls[1]?.url.pathname, `/v1/projects/${PROJECT.id}/catalog/web`);
		assert.deepEqual(updated.spec?.files, files);
	});

	test('file rows round-trip, follow rule 13, and the preview mounts them read-only', () => {
		const pasted = parseDockerRun('docker run -v app.conf:/config/app.conf:ro nginx');
		assert.equal(pasted.ok, true);
		if (!pasted.ok) return;
		assert.equal(pasted.draft.files, undefined);
		assert.deepEqual(pasted.draft.volumes, [{ name: 'app.conf', target: '/config/app.conf', readOnly: true }]);
		const keptFiles = [
			{ file: 'app.conf', target: '/config/app.conf' },
			{ file: 'key.json', target: '/run/secrets/key.json' }
		];
		const beforePaste = blankImageDraft();
		beforePaste.files = keptFiles;
		beforePaste.image = 'old';
		const mounted = parseDockerRun('docker run -v a:/b:ro nginx');
		assert.equal(mounted.ok, true);
		if (!mounted.ok) return;
		const afterPaste = applyDockerPaste(beforePaste, mounted);
		assert.deepEqual(afterPaste.files, keptFiles);
		assert.deepEqual(afterPaste.volumes, [{ name: 'a', target: '/b', readOnly: true }]);
		assert.equal(afterPaste.image, 'nginx');
		const formSource = readFileSync(new URL('../src/routes/projects/[id]/CatalogImageForm.svelte', import.meta.url), 'utf8');
		assert.match(formSource, /draft = applyDockerPaste\(draft, parsed\)/);
		assert.match(formSource, /filesStatus === 'ready' \? files\.map\(\(file\) => file\.name\) : undefined/);
		assert.match(formSource, /max-w-\[calc\(100vw-2rem\)\]/);
		assert.match(formSource, /\[&>span:last-of-type\]:break-all/);

		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const entry = imageEntry(['deploy']);
		entry.spec.files = [
			{ file: 'app.conf', target: '/config/app.conf' },
			{ file: 'key.json', target: '/run/secrets/key.json' }
		];
		const html = render(CatalogImageForm, {
			props: {
				mode: 'edit',
				entry,
				saveAction: '?/catalogUpdate',
				sets: [],
				setsStatus: 'ready',
				files: [{ name: 'app.conf' }, { name: 'key.json' }],
				filesStatus: 'ready',
				editor: null
			}
		}).body;
		function inputValue(source: string, name: string, value: string): boolean {
			return [...source.matchAll(/<input\b[^>]*>/g)].some((match) => match[0].includes(`name="${name}"`) && match[0].includes(`value="${value}"`));
		}
		assert.equal(inputValue(html, 'file_name', 'app.conf'), true);
		assert.equal(inputValue(html, 'file_target', '/config/app.conf'), true);
		assert.equal(inputValue(html, 'file_name', 'key.json'), true);
		assert.equal(inputValue(html, 'file_target', '/run/secrets/key.json'), true);
		assert.equal(html.includes('for="catalog-image-web-file-0"'), true);
		const preview = html.slice(html.indexOf('aria-label="docker run preview"'), html.indexOf('</pre>', html.indexOf('aria-label="docker run preview"')));
		assert.match(preview, /-v app\.conf:\/config\/app\.conf:ro/);
		assert.match(preview, /-v key\.json:\/run\/secrets\/key\.json:ro/);
		const names = [...html.matchAll(/name="file_name"/g)];
		assert.equal(names.length, 2);

		const round = new FormData();
		round.set('name', 'web');
		round.set('image', 'nginx');
		round.append('file_name', 'app.conf');
		round.append('file_target', '/config/app.conf');
		const built = imageDraftFromForm(round);
		assert.deepEqual(built.draft.files, [{ file: 'app.conf', target: '/config/app.conf' }]);
		const kept = imageSpecFromDraft(built.draft, undefined, true, ['app.conf']);
		assert.equal(kept.ok, true);
		if (!kept.ok) return;
		assert.deepEqual(kept.spec.files, [{ file: 'app.conf', target: '/config/app.conf' }]);

		function fileMessage(rows: Array<{ file: string; target: string }>, known?: string[], volumes: ImageDraftVolumes = []): string {
			const draft = blankImageDraft();
			draft.image = 'nginx';
			draft.volumes = volumes;
			draft.files = rows;
			const check = imageSpecFromDraft(draft, undefined, false, known);
			assert.equal(check.ok, false);
			if (check.ok) return '';
			assert.equal(check.field, 'files');
			return check.message;
		}
		type ImageDraftVolumes = Array<{ name: string; target: string; readOnly: boolean }>;
		assert.equal(fileMessage([{ file: 'Bad', target: '/config/app.conf' }]), 'File names use lowercase letters, digits, dots, underscores, and hyphens.');
		assert.equal(fileMessage([{ file: 'app.conf', target: '/config/app.conf' }, { file: 'app.conf', target: '/other' }]), 'Each file can appear once.');
		assert.equal(fileMessage([{ file: 'missing.conf', target: '/config/app.conf' }], ['app.conf']), 'Unknown file missing.conf.');
		assert.equal(
			fileMessage([{ file: 'app.conf', target: 'relative' }]),
			'A file target must be an absolute path, at most 255 bytes, with no empty, . or .. segment, and not /, /proc, /sys, /dev, or under them.'
		);
		for (const target of ['/', '/proc', '/proc/self', '/sys/fs', '/dev/null', '/config/', '/config/../etc', '/config//app', `/${'a'.repeat(255)}`]) {
			assert.match(fileMessage([{ file: 'app.conf', target }]), /absolute path/, target);
		}
		const allowed = blankImageDraft();
		allowed.image = 'nginx';
		allowed.files = [{ file: 'app.conf', target: '/devfoo' }];
		assert.equal(imageSpecFromDraft(allowed, undefined, false, ['app.conf']).ok, true);
		allowed.files = [{ file: 'app.conf', target: '/Proc/self' }];
		assert.equal(imageSpecFromDraft(allowed, undefined, false, ['app.conf']).ok, true);
		const withoutList = blankImageDraft();
		withoutList.image = 'nginx';
		withoutList.files = [{ file: 'app.conf', target: '/config/app.conf' }];
		assert.equal(imageSpecFromDraft(withoutList).ok, true);
		assert.equal(
			fileMessage([{ file: 'app.conf', target: '/data' }, { file: 'key.json', target: '/data' }]),
			'Each file and volume target can appear once.'
		);
		const nested = blankImageDraft();
		nested.image = 'nginx';
		nested.files = [
			{ file: 'app.conf', target: '/config' },
			{ file: 'key.json', target: '/config/key.json' }
		];
		const nestedSpec = imageSpecFromDraft(nested, undefined, false, ['app.conf', 'key.json']);
		assert.equal(nestedSpec.ok, true);
		if (nestedSpec.ok) {
			assert.deepEqual(nestedSpec.spec.files, [
				{ file: 'app.conf', target: '/config' },
				{ file: 'key.json', target: '/config/key.json' }
			]);
		}
		const longName = new FormData();
		longName.set('image', 'nginx');
		longName.append('file_name', 'a'.repeat(65));
		longName.append('file_target', '/config/app.conf');
		const nameError = imageDraftFromForm(longName);
		assert.equal(nameError.field, 'files');
		assert.equal(nameError.message, 'File names use lowercase letters, digits, dots, underscores, and hyphens.');
		assert.equal(JSON.stringify(nameError).includes('a'.repeat(65)), false);
		const longTarget = new FormData();
		longTarget.set('image', 'nginx');
		longTarget.append('file_name', 'app.conf');
		longTarget.append('file_target', `/${'a'.repeat(255)}`);
		const targetError = imageDraftFromForm(longTarget);
		assert.equal(targetError.field, 'files');
		assert.match(targetError.message ?? '', /255 bytes/);
		assert.equal(JSON.stringify(targetError).includes('a'.repeat(255)), false);
		assert.equal(
			fileMessage([{ file: 'app.conf', target: '/data' }], undefined, [{ name: 'data', target: '/data', readOnly: false }]),
			'Each file and volume target can appear once.'
		);
		assert.equal(
			fileMessage([{ file: 'app.conf', target: '/data/app.conf' }], undefined, [{ name: 'data', target: '/data', readOnly: false }]),
			'A file target cannot sit inside a volume target, or the other way around.'
		);
		assert.equal(
			fileMessage([{ file: 'app.conf', target: '/config' }], undefined, [{ name: 'data', target: '/config/extra', readOnly: false }]),
			'A file target cannot sit inside a volume target, or the other way around.'
		);

		const many = new FormData();
		many.set('name', 'web');
		many.set('image', 'nginx');
		for (let index = 0; index < 17; index += 1) {
			many.append('file_name', `f${index}.conf`);
			many.append('file_target', `/config/f${index}.conf`);
		}
		const over = imageDraftFromForm(many);
		assert.equal(over.message, null);
		const tooMany = imageSpecFromDraft(over.draft, undefined, true);
		assert.equal(tooMany.ok, false);
		if (!tooMany.ok) assert.equal(tooMany.message, 'At most 16 files.');
		const sixteen = new FormData();
		sixteen.set('name', 'web');
		sixteen.set('image', 'nginx');
		for (let index = 0; index < 16; index += 1) {
			sixteen.append('file_name', `f${index}.conf`);
			sixteen.append('file_target', `/opt/f${index}.conf`);
		}
		const full = imageSpecFromDraft(imageDraftFromForm(sixteen).draft, undefined, true);
		assert.equal(full.ok, true);
		if (full.ok) assert.equal(full.spec.files.length, 16);
		const mismatch = new FormData();
		mismatch.append('file_name', 'app.conf');
		const uneven = imageDraftFromForm(mismatch);
		assert.equal(uneven.message, 'Each file needs a name and a target.');
		assert.equal(uneven.field, 'files');
		const line = dockerRunPreview({
			name: 'web',
			image: 'nginx',
			command: [],
			entrypoint: [],
			ports: [],
			envKeys: [],
			volumes: [],
			files: [{ file: 'app.conf', target: '/config/app.conf' }],
			restart: 'unless-stopped',
			user: '',
			memoryMb: null
		});
		assert.match(line, /-v app\.conf:\/config\/app\.conf:ro/);
		const quoted = dockerRunPreview({
			name: 'web',
			image: 'nginx',
			command: [],
			entrypoint: [],
			ports: [],
			envKeys: [],
			volumes: [],
			files: [{ file: 'app.conf', target: '/config/my file' }],
			restart: 'unless-stopped',
			user: '',
			memoryMb: null
		});
		assert.match(quoted, /-v 'app\.conf:\/config\/my file:ro'/);
	});

	test('a host without files support is not offered deploy for an entry that mounts files', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		function buttons(html: string): string[] {
			return [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map((match) => match[0]);
		}
		function control(html: string, label: string): string {
			const found = buttons(html).find((tag) => tag.includes(label));
			assert.equal(found != null, true, label);
			return found ?? '';
		}
		function markedDisabled(tag: string): boolean {
			const open = tag.slice(0, tag.indexOf('>') + 1);
			return /\sdisabled(?:=|\s|>)/.test(open);
		}
		const plainHost = host();
		const capable = host();
		if (capable.programs) capable.programs = { ...capable.programs, files: true };
		const withFiles = imageEntry(['deploy']);
		withFiles.spec.files = [{ file: 'app.conf', target: '/config/app.conf' }];
		const props = {
			deployAction: '?/catalogDeploy',
			rollbackAction: '?/catalogRollback',
			removeAction: '?/catalogRemove',
			confirmAction: '?/catalogConfirm',
			historyAction: '?/catalogDeploys',
			result: null
		};
		const blocked = render(CatalogDeployForm, { props: { ...props, entry: withFiles, hosts: [plainHost] } }).body;
		assert.equal(blocked.includes("pi1: This host's agent does not support files"), true);
		assert.equal(markedDisabled(control(blocked, 'Deploy')), true);
		assert.equal(markedDisabled(control(blocked, 'Remove')), false);
		const radios = buttons(blocked).filter((tag) => tag.includes('role="radio"'));
		assert.equal(radios.length, 1);
		assert.equal(markedDisabled(radios[0] ?? ''), false);
		assert.equal(radios[0]?.includes('pi1'), true);

		const open = render(CatalogDeployForm, { props: { ...props, entry: imageEntry(['deploy']), hosts: [plainHost] } }).body;
		assert.equal(open.includes('does not support files'), false);
		assert.equal(markedDisabled(control(open, 'Deploy')), false);

		const offered = render(CatalogDeployForm, { props: { ...props, entry: withFiles, hosts: [capable] } }).body;
		assert.equal(offered.includes('does not support files'), false);
		assert.equal(markedDisabled(control(offered, 'Deploy')), false);

		const second = '00000000-0000-4000-8000-0000000000ab';
		const withoutFiles = { ...host(), id: second, name: 'pi2' };
		const both = render(CatalogDeployForm, { props: { ...props, entry: withFiles, hosts: [capable, withoutFiles] } }).body;
		assert.equal(both.includes("pi1: This host's agent does not support files"), false);
		assert.equal(both.includes("pi2: This host's agent does not support files"), true);
		assert.equal(markedDisabled(control(both, 'Deploy')), false);
		const hostRadios = buttons(both).filter((tag) => tag.includes('role="radio"'));
		assert.equal(hostRadios.length, 2);
		assert.equal(hostRadios[0]?.includes('pi1') && hostRadios[0]?.includes('aria-checked="true"'), true);
		assert.equal(hostRadios[1]?.includes('pi2') && hostRadios[1]?.includes('aria-checked="false"'), true);
	});

	test('programs.logging is false when absent, and a host without it is not offered deploy', () => {
		const base = {
			enabled: true,
			allow_shell: false,
			docker: true,
			files: true,
			images: true,
			policy_hash: 'abc',
			run_as: ['joe']
		};
		assert.equal(parseHostPrograms(base)?.logging, false);
		assert.equal(parseHostPrograms({ ...base, logging: null })?.logging, false);
		assert.equal(parseHostPrograms({ ...base, logging: true })?.logging, true);
		assert.equal(parseHostPrograms({ ...base, logging: false })?.logging, false);
		assert.equal(parseHostPrograms({ ...base, logging: 'yes' }), null);

		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		function buttons(html: string): string[] {
			return [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map((match) => match[0]);
		}
		function control(html: string, label: string): string {
			const found = buttons(html).find((tag) => tag.includes(label));
			assert.equal(found != null, true, label);
			return found ?? '';
		}
		function markedDisabled(tag: string): boolean {
			const open = tag.slice(0, tag.indexOf('>') + 1);
			return /\sdisabled(?:=|\s|>)/.test(open);
		}
		const plainHost = host();
		const capable = host();
		if (capable.programs) capable.programs = { ...capable.programs, logging: true };
		const withLogging = imageEntry(['deploy']);
		withLogging.spec.logging = { max_size_mb: 5, max_files: 2 };
		const props = {
			deployAction: '?/catalogDeploy',
			rollbackAction: '?/catalogRollback',
			removeAction: '?/catalogRemove',
			confirmAction: '?/catalogConfirm',
			historyAction: '?/catalogDeploys',
			result: null
		};
		const reason = "This host's agent does not support log settings";
		const blocked = render(CatalogDeployForm, { props: { ...props, entry: withLogging, hosts: [plainHost] } }).body;
		assert.equal(blocked.includes(`pi1: ${reason}`), true);
		assert.equal(markedDisabled(control(blocked, 'Deploy')), true);
		assert.equal(markedDisabled(control(blocked, 'Remove')), false);
		const radios = buttons(blocked).filter((tag) => tag.includes('role="radio"'));
		assert.equal(radios.length, 1);
		assert.equal(markedDisabled(radios[0] ?? ''), false);

		const open = render(CatalogDeployForm, { props: { ...props, entry: imageEntry(['deploy']), hosts: [plainHost] } }).body;
		assert.equal(open.includes('does not support log settings'), false);
		assert.equal(markedDisabled(control(open, 'Deploy')), false);

		const offered = render(CatalogDeployForm, { props: { ...props, entry: withLogging, hosts: [capable] } }).body;
		assert.equal(offered.includes('does not support log settings'), false);
		assert.equal(markedDisabled(control(offered, 'Deploy')), false);

		const second = '00000000-0000-4000-8000-0000000000ab';
		const withoutLogging = { ...host(), id: second, name: 'pi2' };
		const both = render(CatalogDeployForm, { props: { ...props, entry: withLogging, hosts: [capable, withoutLogging] } }).body;
		assert.equal(both.includes(`pi1: ${reason}`), false);
		assert.equal(both.includes(`pi2: ${reason}`), true);
		assert.equal(markedDisabled(control(both, 'Deploy')), false);

		const job = imageEntry(['deploy']);
		job.spec = { ...job.spec, kind: 'job', restart: 'no', logging: { max_size_mb: 5, max_files: 2 } };
		const jobHtml = render(CatalogDeployForm, { props: { ...props, entry: job, hosts: [plainHost] } }).body;
		assert.equal(jobHtml.includes(`pi1: ${reason}`), true);
		assert.equal(markedDisabled(control(jobHtml, 'Run job')), true);
	});

	test('a failed file save does not put the paste back into the box', async () => {
		const secret = 'failed-save-paste-99';
		installFetch(() => envelope(null, 400, 'bad_request', 'no'));
		const failed = await projectActions.saveProjectFile(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=settings&/saveProjectFile`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: { name: 'key.json', content: secret, secret: '1' }
			}).event as never
		);
		assert.equal(isActionFailure(failed), true);
		if (!isActionFailure(failed)) return;
		const returned = failed.data as unknown as { scope?: string; message?: string; settingsField?: string; content?: string };
		assert.equal(returned.content, undefined);
		assert.equal(JSON.stringify(returned).includes(secret), false);
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=settings`);
		const files: ProjectFile[] = [
			{
				name: 'key.json',
				is_secret: true,
				size: 20,
				sha256: null,
				updated_at: '2026-10-13T12:00:00Z',
				updated_by: USER.id
			}
		];
		const echoed = render(SettingsSection, {
			props: {
				project: PROJECT,
				canOwner: true,
				canAdmin: true,
				message: returned.message ?? null,
				settingsField: 'file',
				files,
				content: secret
			} as never
		}).body;
		const area = echoed.match(/<textarea\b[^>]*id="file-content"[^>]*>[\s\S]*?<\/textarea>/);
		const inner = area?.[0].replace(/^<textarea\b[^>]*>/, '').replace(/<\/textarea>$/, '') ?? secret;
		assert.equal(inner.trim(), '');
		assert.equal(echoed.includes(secret), false);
		const page = render(ProjectPage, {
			props: {
				data: {
					project: PROJECT,
					userId: USER.id,
					message: null,
					tab: 'settings',
					canAdmin: true,
					canOwner: true,
					files,
					filesMessage: null,
					envSets: [],
					envSetsMessage: null,
					registries: [],
					registriesMessage: null
				} as never,
				form: { ...returned, content: secret } as never
			}
		}).body;
		const pageArea = page.match(/<textarea\b[^>]*id="file-content"[^>]*>[\s\S]*?<\/textarea>/);
		const pageInner = pageArea?.[0].replace(/^<textarea\b[^>]*>/, '').replace(/<\/textarea>$/, '') ?? secret;
		assert.equal(pageInner.trim(), '');
		assert.equal(page.includes(secret), false);
	});

	test('a failed file save redacts lines of 8 or 9 characters and keeps a line of 5', async () => {
		const line8 = 'eightchr';
		const line9 = 'ninechars';
		const line5 = 'abcde';
		assert.equal(line8.length, 8);
		assert.equal(line9.length, 9);
		assert.equal(line5.length, 5);
		const content = `${line8}\n${line9}\n${line5}`;
		const base = {
			url: `http://console.example/projects/${PROJECT.id}?tab=settings&/saveProjectFile`,
			session: TOKEN,
			user: USER,
			projects: [PROJECT],
			params: { id: PROJECT.id }
		};
		installFetch(() => envelope(null, 400, 'bad_request', `xx${line8}xx yy${line9}yy ${line5}`));
		const pieces = await projectActions.saveProjectFile(
			fakeEvent({ ...base, form: { name: 'key.json', content, secret: '1' } }).event as never
		);
		const pieceMessage = actionData(pieces).message ?? '';
		assert.equal(pieceMessage.includes(line8), false);
		assert.equal(pieceMessage.includes(line9), false);
		assert.equal(pieceMessage.includes('[redacted]'), true);
		assert.equal((pieceMessage.match(new RegExp(line5, 'g')) ?? []).length, 1);
		installFetch(() => envelope(null, 400, 'bad_request', `${content} ${line5}`));
		const whole = await projectActions.saveProjectFile(
			fakeEvent({ ...base, form: { name: 'key.json', content, secret: '1' } }).event as never
		);
		const wholeMessage = actionData(whole).message ?? '';
		assert.equal(wholeMessage.includes(content), false);
		assert.equal(wholeMessage.includes(`${line9}\n${line5}`), false);
		assert.equal((wholeMessage.match(new RegExp(line5, 'g')) ?? []).length, 1);
	});

	test('a secret file cannot be viewed', async () => {
		const secretBody = 'secret-view-body-77';
		const files: ProjectFile[] = [
			{
				name: 'app.conf',
				is_secret: false,
				size: 17,
				sha256: 'ab'.repeat(32),
				updated_at: '2026-10-13T12:00:00Z',
				updated_by: USER.id
			},
			{
				name: 'key.json',
				is_secret: true,
				size: secretBody.length,
				sha256: null,
				updated_at: '2026-10-13T12:00:00Z',
				updated_by: USER.id
			}
		];
		installFetch(() =>
			envelope(
				{
					name: 'key.json',
					content: secretBody,
					size: secretBody.length,
					sha256: null,
					updated_at: '2026-10-13T12:00:00Z',
					updated_by: USER.id
				},
				403,
				'forbidden',
				'secret files cannot be read'
			)
		);
		const denied = await projectActions.viewProjectFile(
			fakeEvent({
				url: `http://console.example/projects/${PROJECT.id}?tab=settings&/viewProjectFile`,
				session: TOKEN,
				user: USER,
				projects: [PROJECT],
				params: { id: PROJECT.id },
				form: { name: 'key.json' }
			}).event as never
		);
		assert.equal(isActionFailure(denied), true);
		if (!isActionFailure(denied)) return;
		const returned = denied.data as unknown as { message?: string; viewedFile?: { name: string; content: string } | null };
		assert.equal(returned.viewedFile ?? null, null);
		assert.equal(JSON.stringify(denied).includes(secretBody), false);
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=settings`);
		const fromAction = render(SettingsSection, {
			props: {
				project: PROJECT,
				canOwner: true,
				canAdmin: true,
				message: returned.message ?? null,
				files,
				viewedFile: returned.viewedFile ?? null
			}
		}).body;
		assert.equal(fromAction.includes(secretBody), false);
		assert.equal(fromAction.includes('id="file-view-key.json"'), false);
		const shown = render(SettingsSection, {
			props: {
				project: PROJECT,
				canOwner: true,
				canAdmin: true,
				message: null,
				files,
				viewedFile: { name: 'key.json', content: secretBody }
			}
		}).body;
		assert.equal(shown.includes('key.json'), true);
		assert.equal(shown.includes(secretBody), false);
		assert.equal(shown.includes('id="file-view-key.json"'), false);
	});
});
