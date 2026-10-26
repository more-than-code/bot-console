<script lang="ts">
	import CommandBlock from '$lib/components/CommandBlock.svelte';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import LocalTime from '$lib/components/LocalTime.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import { agentPrompt, enrolCommand, type EnrolStatus } from '$lib/add-host';
	import type { CreatedJoin } from '$lib/api-types';

	let {
		created,
		slug,
		enrolment,
		message = null,
		copyId
	}: {
		/** From the createToken action result only. The token is shown here once. */
		created: CreatedJoin;
		slug: string;
		enrolment: EnrolStatus | null;
		/** A note that came with the created token, such as a server URL that could not be shown. */
		message?: string | null;
		/** Id of the copy-instructions button, which gets focus when this view appears. */
		copyId: string;
	} = $props();

	const prompt = $derived(agentPrompt(slug, created.server));
	const enrol = $derived(enrolCommand(created.server));
</script>

<div class="grid min-w-0 gap-2" translate="no">
	{#if message}
		<div class="max-w-full min-w-0 break-words">
			<Notice kind="info">{message}</Notice>
		</div>
	{/if}
	<p class="text-sm">Your AI agent can install the host. The instructions do not contain the token.</p>
	<div>
		<CopyButton id={copyId} value={prompt} label="Copy instructions for your AI agent" class="h-auto py-1 text-left whitespace-normal" />
	</div>
	<Notice kind="success">Copy this now. It is not saved in this browser.</Notice>
	<p class="text-muted-foreground text-sm">Join token</p>
	<p class="font-mono text-sm break-all">{created.token}</p>
	<div>
		<CopyButton value={created.token} label="Copy token" />
	</div>
	<p class="text-muted-foreground text-sm">Or enrol the host yourself:</p>
	<CommandBlock command={enrol} label="Copy enrol command" ariaLabel="Enrol command" />
	<p class="text-sm">Paste the join token at the hidden prompt. Do not put it on the command line.</p>
	<p class="text-sm" aria-live="polite">
		{#if enrolment?.kind === 'enrolled'}
			Enrolled: {enrolment.name} is {enrolment.status}.
		{:else if enrolment?.kind === 'ended'}
			{enrolment.reason === 'revoked' ? 'This token was revoked.' : 'This token has expired. Create a new one.'}
		{:else if enrolment?.kind === 'timeout'}
			Stopped checking after 15 minutes. Look for the new host in the hosts list.
		{:else}
			Waiting for the host to enrol…
		{/if}
	</p>
	{#if enrolment?.kind === 'timeout' && enrolment.expiresAt}
		<p class="text-sm">The token expires at <LocalTime iso={enrolment.expiresAt} />.</p>
	{/if}
</div>
