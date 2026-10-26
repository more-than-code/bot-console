<script lang="ts">
	import { untrack } from 'svelte';
	import CommandBlock from '$lib/components/CommandBlock.svelte';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import { agentPrompt } from '$lib/add-host';
	import * as Card from '$lib/components/ui/card';

	const RELEASES = 'https://github.com/more-than-code/bot-agent/releases/latest';
	const GUIDE = 'https://github.com/more-than-code/bot-agent/blob/dev/docs/install.md';

	let { slug, open }: { slug: string; open: boolean } = $props();
	// Initial state only: a later host count change (the token card polls) must not collapse or expand it.
	const startOpen = untrack(() => open);
	const projectsLine = $derived(`projects = ["${slug}"]`);
	const prompt = $derived(agentPrompt(slug));
</script>

<Card.Root class="mb-4">
	<details class="grid gap-3 px-(--card-spacing)" open={startOpen}>
		<summary class="cursor-pointer text-base leading-snug font-medium">Add a host</summary>
		<p>An AI agent can run these steps for you. It stops for your agreement before installing, and you run the enrol command yourself.</p>
		<div>
			<CopyButton value={prompt} label="Copy instructions for your AI agent" />
		</div>
		<p>Run the commands below on the host you are adding (for example over ssh -t).</p>
		<ol class="list-decimal pl-5 [&_li+li]:mt-3">
			<li>
				Download the
				<a class="text-primary underline-offset-4 hover:underline" href={RELEASES} rel="noopener noreferrer" target="_blank">latest bot-agent release<span class="sr-only">{' (opens in a new tab)'}</span></a>
				and verify it (sha256sum -c …).
			</li>
			<li>
				<CommandBlock command="sudo ./install.sh check --runner" label="Copy check command" ariaLabel="Check command" />
			</li>
			<li>
				<CommandBlock command="sudo ./install.sh install --runner" label="Copy runner install command" ariaLabel="Runner install command" />
			</li>
			<li>
				<p>Review /etc/bot-agent/runner.toml: images, projects, and enabled = true.</p>
				<CommandBlock command={projectsLine} label="Copy projects line" ariaLabel="runner.toml projects" />
			</li>
			<li>Create a join token below, then run the enrol command shown after creation. The token is typed at the prompt.</li>
			<li>The host appears in the list below as online.</li>
		</ol>
		<p>
			<a class="text-primary underline-offset-4 hover:underline" href={GUIDE} rel="noopener noreferrer" target="_blank">Full guide, including troubleshooting<span class="sr-only">{' (opens in a new tab)'}</span></a>
		</p>
	</details>
</Card.Root>
