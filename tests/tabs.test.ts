import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render } from 'svelte/server';
import Tabs from '../src/lib/components/Tabs.svelte';

const items = [
	{ key: 'hosts', label: 'Hosts', href: '/projects/lab?tab=hosts' },
	{ key: 'services', label: 'Services', href: '/projects/lab?tab=services' },
	{ key: 'catalog', label: 'Catalog', href: '/projects/lab?tab=catalog' },
	{ key: 'members', label: 'Members', href: '/projects/lab?tab=members' },
	{ key: 'tokens', label: 'Join tokens', href: '/projects/lab?tab=tokens' },
	{ key: 'settings', label: 'Settings', href: '/projects/lab?tab=settings' }
];

test('each project section tab shows an icon after its label', () => {
	const html = render(Tabs, { props: { items, current: 'catalog', label: 'Project sections' } }).body;
	const icons = [
		['Hosts', 'lucide-server'],
		['Services', 'lucide-boxes'],
		['Catalog', 'lucide-library'],
		['Members', 'lucide-users'],
		['Join tokens', 'lucide-key-round'],
		['Settings', 'lucide-settings']
	] as const;
	for (const [label, icon] of icons) {
		const at = html.indexOf(`>${label}`);
		assert.ok(at >= 0, label);
		const link = html.slice(html.lastIndexOf('<a', at), html.indexOf('</a>', at));
		assert.equal(link.includes(icon), true, `${label} icon`);
		assert.equal(link.indexOf(label) < link.indexOf(icon), true, `${label} icon follows the label`);
	}
});
