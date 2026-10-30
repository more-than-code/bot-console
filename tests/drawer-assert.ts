import assert from 'node:assert/strict';

/** Class list of the first tag matching `pattern` (a regex source for the tag's start), or null. */
function tagClass(html: string, pattern: string): string | null {
	const tag = new RegExp(`<${pattern}[^>]*>`).exec(html)?.[0];
	return tag ? (/class="([^"]*)"/.exec(tag)?.[1] ?? '') : null;
}

/**
 * A Catalog drawer form: the form fills the sheet, its fields scroll in `form-body`, and the pinned
 * Sheet footer (border-top, the sheet's bg-popover) holds the submit button inside the same form.
 */
export function assertDrawerForm(html: string, submit: string, label = submit): void {
	const formAt = html.search(/<form\b[^>]*class="flex min-h-0 flex-1 flex-col"/);
	assert.notEqual(formAt, -1, `${label}: form fills the drawer`);
	const formEnd = html.indexOf('</form>', formAt);
	const form = html.slice(formAt, formEnd);
	const body = tagClass(form, 'div\\b[^>]*data-slot="form-body"');
	assert.ok(body != null, `${label}: scroll body`);
	for (const name of ['min-h-0', 'flex-1', 'overflow-y-auto', 'scroll-py-4']) assert.match(body, new RegExp(`(^|\\s)${name}(\\s|$)`), `${label}: body ${name}`);
	const footerAt = form.indexOf('data-slot="sheet-footer"');
	assert.notEqual(footerAt, -1, `${label}: footer inside the form`);
	assert.ok(footerAt > form.indexOf('data-slot="form-body"'), `${label}: footer after the body`);
	const footerClass = tagClass(form, 'div\\b[^>]*data-slot="sheet-footer"') ?? '';
	assert.match(footerClass, /\bborder-t\b/, `${label}: footer border`);
	assert.match(footerClass, /\bbg-popover\b/, `${label}: footer uses the sheet background`);
	assert.doesNotMatch(footerClass, /\bsticky\b/, `${label}: footer is pinned, not sticky`);
	assert.match(form.slice(footerAt), new RegExp(`type="submit"[^>]*>(?:<!---->)?${submit}<`), `${label}: ${submit} in the footer`);
}

/** Source of a Catalog drawer: a right-side Sheet, full width on a phone, header with title and description, no Dialog. */
export function assertDrawerSource(source: string, label: string): void {
	assert.equal(source.includes("from '$lib/components/ui/dialog'"), false, `${label}: no Dialog import`);
	assert.equal(/<\/?Dialog\./.test(source), false, `${label}: no Dialog markup`);
	assert.match(source, /<Sheet\.Root bind:open/, label);
	assert.match(source, /<Sheet\.Content[\s\S]*?side="right"[\s\S]*?class="data-\[side=right\]:w-full data-\[side=right\]:sm:max-w-2xl"/, label);
	assert.match(source, /<Sheet\.Header class="pr-12 pb-0">\s*<Sheet\.Title[^>]*>[\s\S]*?<\/Sheet\.Title>\s*<Sheet\.Description>/, label);
}
