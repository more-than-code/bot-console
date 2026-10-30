import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, describe, test } from 'node:test';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { toast } from 'svelte-sonner';
import RootLayout from '../src/routes/+layout.svelte';
import Toaster from '../src/lib/components/ui/sonner/sonner.svelte';
import { toastHealthSaved, toastImageSaved, toastMemberAdded } from '../src/lib/success-toast.ts';
import { toasterTheme } from '../src/lib/theme.ts';
import { setPageUrl, setRouteId } from './stubs/app-state.ts';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** Same check the public-site tests use: the code that can import. */
function scriptOf(source: string): string {
	return [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '').join('\n');
}

describe('Toaster in the root layout', () => {
	const children = createRawSnippet(() => ({ render: () => '<p>child</p>' }));
	const data = { user: null, theme: 'system' as const, timeZone: 'UTC' };

	test('the app shell mounts one bottom-center Toaster with a polite live region', () => {
		setPageUrl('http://console.example/projects');
		setRouteId('/projects');
		const app = render(RootLayout, { props: { children, data } }).body;
		const sections = [...app.matchAll(/<section\b[^>]*>/g)].map((m) => m[0]);
		const region = sections.filter((tag) => tag.includes('aria-live'));
		assert.equal(region.length, 1, 'one toaster region');
		assert.match(region[0] ?? '', /aria-live="polite"/);
		assert.match(region[0] ?? '', /aria-label="Notifications alt\+T"/);
		// After the footer: outside <main>, so no section re-render drops it.
		assert.ok(app.indexOf('aria-live="polite"') > app.indexOf('</footer>'));
		const layout = read('src/routes/+layout.svelte');
		assert.equal(layout.match(/<Toaster\b/g)?.length, 1);
		assert.notEqual(layout.indexOf('<Toaster position="bottom-center" />'), -1);
	});

	test('public site pages get no Toaster', () => {
		setPageUrl('http://console.example/about');
		setRouteId('/(site)/about');
		const site = render(RootLayout, { props: { children, data } }).body;
		assert.ok(site.includes('<p>child</p>'));
		assert.equal(site.includes('aria-live'), false);
		assert.equal(site.includes('Notifications'), false);
		// The Toaster sits in the {:else} (app shell) branch, after `{#if sitePage}`.
		const layout = read('src/routes/+layout.svelte');
		const siteBranch = layout.slice(layout.indexOf('{#if sitePage}'), layout.indexOf('{:else}'));
		assert.equal(siteBranch.includes('<Toaster'), false);
		assert.ok(layout.indexOf('<Toaster') > layout.indexOf('{:else}'));
	});
});

describe('success toasts', () => {
	const original = toast.success;
	let calls: unknown[][] = [];
	function record(): void {
		calls = [];
		toast.success = ((...args: unknown[]) => {
			calls.push(args);
			return 1;
		}) as typeof toast.success;
	}
	afterEach(() => {
		toast.success = original;
	});

	test('each success shows its exact text once', () => {
		record();
		toastImageSaved('aihub-edvisor');
		assert.deepEqual(calls, [['Saved aihub-edvisor.']]);
		record();
		toastHealthSaved();
		assert.deepEqual(calls, [['Saved health checks.']]);
		record();
		toastMemberAdded('ada@example.com');
		assert.deepEqual(calls, [['Added ada@example.com.']]);
	});

	test('the Add member toast waits until the dialog has finished closing', () => {
		const dialog = read('src/lib/components/FormDialog.svelte');
		assert.notEqual(dialog.indexOf('<Dialog.Root bind:open onOpenChangeComplete={closeComplete}>'), -1);
		assert.match(dialog, /function closeComplete\(isOpen: boolean\) \{\s*if \(!isOpen\) onCloseComplete\?\.\(\);/);
		const members = read('src/routes/projects/[id]/MembersSection.svelte');
		assert.notEqual(members.indexOf('onAdded={(email) => (pendingAdded = email)}'), -1);
		assert.notEqual(members.indexOf('onCloseComplete={onAddMemberClosed}'), -1);
		assert.match(
			members,
			/function onAddMemberClosed\(\) \{\s*const email = pendingAdded;\s*pendingAdded = null;\s*if \(email\) toastMemberAdded\(email\);/
		);
		const form = read('src/routes/projects/[id]/AddMemberForm.svelte');
		assert.equal(form.includes('onAdded(null)'), false);
		assert.notEqual(form.indexOf("if (result.type === 'redirect') onAdded(email);"), -1);
	});

	test('the callbacks that announce a save are wired to the toasts', () => {
		const page = read('src/routes/projects/[id]/+page.svelte');
		assert.notEqual(page.indexOf('onSaved={toastImageSaved}'), -1, 'create image dialog');
		assert.notEqual(page.indexOf('onImageSaved={toastImageSaved}'), -1, 'catalog section');
		assert.notEqual(page.indexOf('onHealthSaved={toastHealthSaved}'), -1, 'services section');
		const health = read('src/routes/projects/[id]/HealthChecks.svelte');
		assert.equal(health.includes('onSaved?.(null)'), false);
		assert.notEqual(health.indexOf('if (next.announce != null) onSaved?.(next.announce);'), -1);
		// The inline success lines are gone. Errors stay inline.
		for (const file of [
			'src/routes/projects/[id]/CatalogSection.svelte',
			'src/routes/projects/[id]/MembersSection.svelte',
			'src/routes/projects/[id]/ServicesSection.svelte'
		]) {
			const source = read(file);
			assert.equal(source.includes('kind="success"'), false, file);
			assert.equal(source.includes('<Notice kind="error">'), true, file);
		}
	});
});

describe('Toaster theme', () => {
	function rootWith(classes: string[]) {
		return { classList: { contains: (token: string) => classes.includes(token) } };
	}

	test('the dark class on <html> maps to dark, anything else to light', () => {
		assert.equal(toasterTheme(rootWith(['dark'])), 'dark');
		assert.equal(toasterTheme(rootWith([])), 'light');
		assert.equal(toasterTheme(rootWith(['darker'])), 'light');
		assert.equal(toasterTheme(null), 'light');
		assert.equal(toasterTheme(undefined), 'light');
	});

	test('the toaster follows the console theme, not mode-watcher, and uses the popover tokens', () => {
		const source = read('src/lib/components/ui/sonner/sonner.svelte');
		const script = scriptOf(source);
		assert.doesNotMatch(script, /from\s+['"]mode-watcher['"]/);
		assert.notEqual(script.indexOf('toasterTheme('), -1);
		assert.notEqual(script.indexOf("attributeFilter: [\"class\"]"), -1);
		assert.notEqual(source.indexOf('{theme}'), -1);
		const pkg = JSON.parse(read('package.json')) as { devDependencies: Record<string, string> };
		assert.equal(pkg.devDependencies['svelte-sonner'], '1.2.1');
		assert.equal('mode-watcher' in pkg.devDependencies, false);

		// svelte-sonner adds no toast during SSR, so the rendered theme is not observable here.
		// The source checks above pin the wiring; this pins the colours to the console tokens.
		assert.match(source, /--normal-bg: var\(--color-popover\)/);
		assert.match(source, /--normal-text: var\(--color-popover-foreground\)/);
		assert.match(source, /--normal-border: var\(--color-border\)/);
		// The server render still works (no document) and adds only the live region.
		const html = render(Toaster, { props: { position: 'bottom-center' } }).body;
		assert.match(html, /aria-live="polite"/);
	});
});
