<script lang="ts">
	import { untrack } from 'svelte';
	import CommandBlock from '$lib/components/CommandBlock.svelte';
	import * as Card from '$lib/components/ui/card';

	const RELEASES = 'https://github.com/more-than-code/bot-agent/releases/latest';
	const GUIDE = 'https://github.com/more-than-code/bot-agent/blob/main/docs/install.md';

	let { slug, open }: { slug: string; open: boolean } = $props();
	// Initial state only: a later host count change (the token card polls) must not collapse or expand it.
	const startOpen = untrack(() => open);
	// Policy flags need bundle v0.2.7+; <pattern> stays for the admin to fill in.
	const policyFlags = $derived(`--runner --project ${slug} --image '<pattern>' --enable`);
</script>

<Card.Root class="mb-4">
	<details class="grid gap-3 px-(--card-spacing)" open={startOpen}>
		<summary class="cursor-pointer text-base leading-snug font-medium">Add a host</summary>
		<p>Create a join token to get instructions for your AI agent. It stops for your agreement before installing, and you run the enrol command yourself.</p>
		<p>Run the commands below on the host you are adding (for example over ssh -t).</p>
		<ol class="list-decimal pl-5 [&_li+li]:mt-3">
			<li>
				Download the
				<a class="text-primary underline-offset-4 hover:underline" href={RELEASES} rel="noopener noreferrer" target="_blank">latest bot-agent release<span class="sr-only">{' (opens in a new tab)'}</span></a>
				and verify it (sha256sum -c …).
			</li>
			<li>
				<p>Replace &lt;pattern&gt; with the image registries this host may run, for example docker.io/library/*. Repeat --image for more. Needs bot-agent v0.2.7 or later.</p>
				<CommandBlock command={`sudo ./install.sh check ${policyFlags}`} label="Copy check command" ariaLabel="Check command" />
			</li>
			<li>
				<CommandBlock command={`sudo ./install.sh install ${policyFlags}`} label="Copy runner install command" ariaLabel="Runner install command" />
			</li>
			<li>For programs, or a policy the flags can't express, install with --runner only and edit /etc/bot-agent/runner.toml by hand (see the full guide).</li>
			<li>Create a join token with the button below. Run the enrol command from the install output's <code>next:</code> line, with the server URL shown with the token. The token is typed at the prompt.</li>
			<li>The host appears in the list below as online.</li>
		</ol>
		<p>
			<a class="text-primary underline-offset-4 hover:underline" href={GUIDE} rel="noopener noreferrer" target="_blank">Full guide, including troubleshooting<span class="sr-only">{' (opens in a new tab)'}</span></a>
		</p>
	</details>
</Card.Root>
