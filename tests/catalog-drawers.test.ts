import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { render } from 'svelte/server';
import type { Host, ImageDeploy, ImageEntry } from '../src/lib/api-types.ts';
import type { ImageDeployState } from '../src/lib/project-action.ts';
import CatalogDeployForm from '../src/routes/projects/[id]/CatalogDeployForm.svelte';
import CatalogEntryForm from '../src/routes/projects/[id]/CatalogEntryForm.svelte';
import CatalogImageForm from '../src/routes/projects/[id]/CatalogImageForm.svelte';
import { PROJECT } from './harness.ts';
import { assertDrawerForm, assertDrawerSource } from './drawer-assert.ts';
import { setPageUrl } from './stubs/app-state.ts';

// Catalog Deploy, container and program Edit/New, and Permissions are right-side drawers (Joe 2026-10-30).
// Sheet content renders only in the browser, so the drawers are checked in their source and the forms by SSR.

const HOST_ID = '00000000-0000-4000-8000-0000000000aa';

function source(name: string): string {
	return readFileSync(new URL(`../src/routes/projects/[id]/${name}`, import.meta.url), 'utf8');
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
		agent_version: '0.2.5',
		status: 'online',
		last_seen_at: '2026-10-14T00:00:00Z',
		enrolled_at: '2026-10-13T00:00:00Z',
		revoked_at: null,
		relation: 'owner',
		share_level: null,
		programs: null
	} as Host;
}

const entry = {
	name: 'web',
	kind: 'image',
	my_actions: ['deploy'],
	spec: {
		kind: 'service',
		image: 'docker.io/library/nginx:1.27',
		user: 'root',
		ports: [],
		env: [],
		env_sets: [],
		files: [],
		healthcheck: null,
		healthy_after_sec: 30,
		health_policy: { mode: 'keep_running' },
		logging: null
	}
} as unknown as ImageEntry;

function result(lines: string[]): ImageDeployState {
	return {
		name: 'web',
		resultId: '00000000-0000-4000-8000-0000000000e9',
		hostId: HOST_ID,
		workload: 'service',
		waitSec: 30,
		outcome: { id: '00000000-0000-4000-8000-0000000000e1', outcome: 'succeeded', digest: `sha256:${'ab'.repeat(32)}`, exit_code: 0 } as unknown as ImageDeploy,
		status: { container: 'web-1', state: 'running', digest: null } as ImageDeployState['status'],
		lines,
		history: [],
		confirmation: null,
		confirmKind: null,
		message: null
	};
}

function deployHtml(state: ImageDeployState | null): string {
	setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
	return render(CatalogDeployForm, {
		props: {
			entry,
			hosts: [host()],
			deployAction: '?/catalogDeploy',
			rollbackAction: '?/catalogRollback',
			removeAction: '?/catalogRemove',
			confirmAction: '?/catalogConfirm',
			historyAction: '?/catalogDeploys',
			projectId: PROJECT.id,
			result: state
		}
	}).body;
}

function classOf(tag: string): string {
	return /class="([^"]*)"/.exec(tag)?.[1] ?? '';
}

describe('Catalog drawers', () => {
	test('each Catalog dialog is a right-side Sheet with a header, full width on a phone', () => {
		for (const name of ['CatalogDeployDialog.svelte', 'CatalogImageDialog.svelte', 'CatalogEntryDialog.svelte', 'CatalogPermissions.svelte']) {
			assertDrawerSource(source(name), name);
		}
		// Triggers keep their names and are Sheet triggers.
		assert.match(source('CatalogDeployDialog.svelte'), /label="Deploy \{entry\.name\}"[\s\S]*?<Sheet\.Trigger \{\.\.\.props\}>/);
		for (const name of ['CatalogImageDialog.svelte', 'CatalogEntryDialog.svelte']) {
			const text = source(name);
			assert.match(text, /<Sheet\.Trigger class=\{buttonVariants\(\)\}>/, name);
			assert.match(text, /label="Edit \{entry\.name\}"[\s\S]*?<Sheet\.Trigger \{\.\.\.props\}>/, name);
			assert.match(text, /<Sheet\.Close type="button" class=\{buttonVariants\(\{ variant: 'outline' \}\)\}>Cancel<\/Sheet\.Close>/, name);
		}
		// Other dialogs stay dialogs.
		assert.match(source('CatalogRunDialog.svelte'), /<Dialog\.Root/);
		assert.match(source('RenameService.svelte'), /<Dialog\.Root/);
	});

	test('the saved-image toast still waits for the drawer to finish closing', () => {
		assert.match(source('CatalogImageDialog.svelte'), /<Sheet\.Root bind:open onOpenChangeComplete=\{onDialogOpenChangeComplete\}>/);
		// Sheet.Root is bits-ui's Dialog.Root and passes every other prop on, so the callback reaches bits-ui.
		const root = readFileSync(new URL('../src/lib/components/ui/sheet/sheet.svelte', import.meta.url), 'utf8');
		assert.match(root, /import \{ Dialog as SheetPrimitive \} from "bits-ui";/);
		assert.match(root, /<SheetPrimitive\.Root bind:open \{\.\.\.restProps\} \/>/);
	});

	test('program and container forms scroll in a body with Save pinned in a footer inside the form', () => {
		setPageUrl(`http://console.example/projects/${PROJECT.id}?tab=catalog`);
		const program = render(CatalogEntryForm, {
			props: { mode: 'create', hosts: [host()], saveAction: '?/catalogCreate', parseAction: '?/catalogParse', editor: null }
		}).body;
		assertDrawerForm(program, 'Save', 'program');
		const footer = program.slice(program.indexOf('data-slot="sheet-footer"'), program.indexOf('</form>'));
		assert.match(footer, /formaction="\?\/catalogParse"/);
		const container = render(CatalogImageForm, {
			props: { mode: 'create', entry: null, saveAction: '?/catalogCreate', sets: [], setsStatus: 'ready', editor: null }
		}).body;
		assertDrawerForm(container, 'Create', 'container');
		assert.equal(source('CatalogImageForm.svelte').includes('sticky'), false);
	});

	test('the deploy log takes half the screen and scrolls inside, with the link on the outcome line, History below and Deploy in the pinned footer', () => {
		const html = deployHtml(result(['pulling', 'ready']));
		const log = /<pre[^>]*aria-label="Deploy log"[^>]*>/.exec(html)?.[0] ?? '';
		assert.notEqual(log, '');
		assert.doesNotMatch(classOf(log), /\bmax-h-40\b/);
		// A real share of the screen: half its height, at most 32rem, at least 10rem on a short screen.
		assert.match(classOf(log), /(^|\s)h-\[min\(50dvh,32rem\)\](\s|$)/);
		assert.match(classOf(log), /\bmin-h-40\b/);
		assert.match(classOf(log), /\bshrink-0\b/);
		// It scrolls inside itself: its lines do not size the body, and it is a focusable region like the Logs view.
		assert.match(classOf(log), /\boverflow-auto\b/);
		assert.match(classOf(log), /\bcontain-size\b/);
		assert.match(log, /role="region"/);
		assert.match(log, /tabindex="0"/);
		assert.match(classOf(log), /\bfocus-visible:ring-3\b/);
		const formTag = /<form[^>]*action="\?\/catalogDeploy"[^>]*>/.exec(html)?.[0] ?? '';
		// The View logs link sits on the outcome line, before the log, so the footer never covers it.
		const linkAt = html.indexOf('View logs in Services');
		const statusAt = html.indexOf('role="status"');
		assert.ok(statusAt !== -1 && statusAt < linkAt && linkAt < html.indexOf('aria-label="Deploy log"'), 'link after the outcome, before the log');
		const statusBox = html.slice(statusAt, html.indexOf('</div>', statusAt));
		assert.equal(statusBox.includes('View logs in Services'), false, 'the link is not inside the live region');
		const bodyAt = html.indexOf('data-slot="deploy-body"');
		const historyAt = html.indexOf('>History<');
		const footerAt = html.indexOf('data-slot="sheet-footer"');
		assert.ok(bodyAt !== -1 && bodyAt < html.indexOf('aria-label="Deploy log"'));
		assert.ok(html.indexOf('aria-label="Deploy log"') < historyAt && historyAt < footerAt, 'History scrolls below the log, above the footer');
		const bodyTag = /<div[^>]*data-slot="deploy-body"[^>]*>/.exec(html)?.[0] ?? '';
		for (const name of ['min-h-0', 'flex-1', 'overflow-y-auto', 'scroll-py-4']) assert.match(classOf(bodyTag), new RegExp(`(^|\\s)${name}(\\s|$)`), name);
		// Body and footer share one column (no Sheet gap above the footer), like the other drawers' forms.
		const columnAt = html.lastIndexOf('<div class="flex min-h-0 flex-1 flex-col">', bodyAt);
		assert.notEqual(columnAt, -1);
		assert.equal(html.slice(columnAt, bodyAt).match(/<div\b/g)?.length, 2, 'the column directly wraps the body');
		const footerTag = /<div[^>]*data-slot="sheet-footer"[^>]*>/.exec(html)?.[0] ?? '';
		assert.match(classOf(footerTag), /\bborder-t\b/);
		assert.match(classOf(footerTag), /\bbg-popover\b/);
		// The rollback forms sit between, so Deploy is tied to its form by the form attribute.
		const formId = /id="([^"]+)"/.exec(formTag)?.[1] ?? '';
		assert.notEqual(formId, '');
		const submit = /<button[^>]*type="submit"[^>]*>/.exec(html.slice(footerAt))?.[0] ?? '';
		assert.match(submit, new RegExp(`form="${formId}"`));
		assert.equal(html.includes('View logs in Services'), true);
	});

	test('without a log there is no log box and the footer is still there', () => {
		const html = deployHtml(null);
		assert.equal(html.includes('aria-label="Deploy log"'), false);
		assert.notEqual(html.indexOf('data-slot="sheet-footer"'), -1);
	});
});
