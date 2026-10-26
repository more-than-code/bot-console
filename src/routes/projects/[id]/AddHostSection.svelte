<script lang="ts">
	import { untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import AddHostGuide from './AddHostGuide.svelte';
	import CommandBlock from '$lib/components/CommandBlock.svelte';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import LocalTime from '$lib/components/LocalTime.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import { createEnrolPoller, enrolStatus } from '$lib/add-host';
	import type { CreatedJoin, Host, JoinToken } from '$lib/api-types';
	import { actionUrlFrom } from '$lib/url';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	let {
		tokens,
		hosts,
		created,
		slug,
		open
	}: {
		/** Join tokens, read only to see whether the created token was used. */
		tokens: JoinToken[];
		hosts: Host[];
		created: CreatedJoin | null;
		slug: string;
		/** Initial state of the guide. */
		open: boolean;
	} = $props();

	const ENROL_POLL_MS = 5000;
	let startedAt = $state(Date.now());
	let now = $state(Date.now());
	const enrolment = $derived(created ? enrolStatus(created, tokens, hosts, now, startedAt) : null);

	// While the created-token card is shown and the tab is visible, reload tokens and hosts until the host enrols.
	// Only the load data changes; the token comes from the action result and stays put.
	// `now` moves only after a refresh lands, so the status is always read from data at least that new.
	$effect(() => {
		if (!browser || !created) return;
		startedAt = now = Date.now();
		const poller = createEnrolPoller({
			isWaiting: () => untrack(() => enrolment?.kind === 'waiting'),
			refresh: async () => {
				await invalidate('project:enrol');
				now = Date.now();
			},
			doc: document,
			intervalMs: ENROL_POLL_MS
		});
		poller.start();
		return () => poller.dispose();
	});

	const PLACEHOLDER_SERVER = '<your server URL>';
	// The agent accepts ws:// only for a loopback dev server, and only with --insecure-dev.
	function loopbackWs(server: string | null): boolean {
		if (!server) return false;
		try {
			const url = new URL(server);
			return url.protocol === 'ws:' && !url.username && !url.password && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
		} catch {
			return false;
		}
	}
	const enrol = $derived(
		created
			? `sudo ./install.sh enroll --server '${created.server ?? PLACEHOLDER_SERVER}' --runner${loopbackWs(created.server) ? ' --insecure-dev' : ''}`
			: ''
	);
</script>

<div id="new-host">
	{#if created}
		<Card.Root class="mb-4" translate="no">
			<Card.Content class="grid gap-2">
				<Notice kind="success">Copy this now. It is shown once and is not saved in this browser.</Notice>
				<p class="text-muted-foreground text-sm">Join token</p>
				<p class="font-mono text-sm break-all">{created.token}</p>
				<CopyButton value={created.token} label="Copy token" />
				<p class="text-muted-foreground text-sm">Next: enrol the host</p>
				<CommandBlock command={enrol} label="Copy enrol command" ariaLabel="Enrol command" />
				<p class="text-sm">Paste the join token at the hidden prompt. Do not put it on the command line.</p>
				<p class="text-sm" aria-live="polite">
					{#if enrolment?.kind === 'enrolled'}
						Enrolled: {enrolment.name} is {enrolment.status}.
					{:else if enrolment?.kind === 'ended'}
						{enrolment.reason === 'revoked' ? 'This token was revoked.' : 'This token has expired. Create a new one.'}
					{:else if enrolment?.kind === 'timeout'}
						Stopped checking after 15 minutes. Look for the new host in the list below.
					{:else}
						Waiting for the host to enrol…
					{/if}
				</p>
				{#if enrolment?.kind === 'timeout' && enrolment.expiresAt}
					<p class="text-sm">The token expires at <LocalTime iso={enrolment.expiresAt} />.</p>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}
	<AddHostGuide {slug} {open} />
	<Card.Root class="mb-4">
		<Card.Header>
			<Card.Title>Create a join token</Card.Title>
		</Card.Header>
		<Card.Content>
			<form method="POST" action={actionUrlFrom(page.url, 'createToken')} class="grid gap-3" use:enhance>
				<Label class="grid gap-1.5" for="host-name-hint">
					Host name hint
					<Input id="host-name-hint" name="host_name_hint" maxlength={80} autocomplete="off" />
				</Label>
				<Label class="grid gap-1.5" for="token-expiry">
					Expiry in seconds
					<Input id="token-expiry" name="expires_in_sec" inputmode="numeric" min="300" max="604800" />
				</Label>
				<p class="text-muted-foreground text-sm">Leave expiry blank for 24 hours. The minimum is 300 and the maximum is 604800.</p>
				<div>
					<Button type="submit">Create join token</Button>
				</div>
			</form>
		</Card.Content>
	</Card.Root>
</div>
