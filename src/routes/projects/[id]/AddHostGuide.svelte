<script lang="ts">
	import CommandBlock from '$lib/components/CommandBlock.svelte';
	import * as Card from '$lib/components/ui/card';

	const RELEASES = 'https://github.com/more-than-code/bot-agent/releases/latest';
	const GUIDE = 'https://github.com/more-than-code/bot-agent/blob/main/docs/install.md';

	let { slug, open }: { slug: string; open: boolean } = $props();
	const projectsLine = $derived(`projects = ["${slug}"]`);
</script>

<Card.Root class="mb-4">
	<details class="grid gap-3 px-(--card-spacing)" {open}>
		<summary class="cursor-pointer text-base leading-snug font-medium">Add a host</summary>
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
			<li>The host appears on the Hosts tab as online.</li>
		</ol>
		<p>
			<a class="text-primary underline-offset-4 hover:underline" href={GUIDE} rel="noopener noreferrer" target="_blank">Full guide, including troubleshooting<span class="sr-only">{' (opens in a new tab)'}</span></a>
		</p>
	</details>
</Card.Root>
