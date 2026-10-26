<script lang="ts">
	import { REPO_URL, SIGN_IN_URL } from './links';
	import PitchDiagram from './PitchDiagram.svelte';

	const components = [
		{
			repo: 'bot-agent',
			role: 'Runs on each host, dials out, deploys and reports',
			stack: 'Go, one static binary; Linux (amd64/arm64) with systemd; Docker only for container entries',
			licence: 'Apache-2.0'
		},
		{
			repo: 'bot-api-server',
			role: 'Google sign-in, projects and roles, catalog, audit log, OAuth for MCP clients',
			stack: 'Go, PostgreSQL with TimescaleDB',
			licence: 'AGPL-3.0-only'
		},
		{
			repo: 'bot-mcp-server',
			role: 'Standard MCP endpoint for AI agents',
			stack: 'Go, MCP over Streamable HTTP',
			licence: 'AGPL-3.0-only'
		},
		{ repo: 'bot-console', role: 'The web console', stack: 'SvelteKit (Node.js)', licence: 'AGPL-3.0-only' }
	];

	const steps = [
		{ title: 'Enrol a host', body: 'Install the agent and join the host to a project.' },
		{ title: 'Add a catalog entry', body: 'Describe the program or container you want to run.' },
		{ title: 'Deploy and watch', body: 'Deploy it to your hosts and view its health and logs.' }
	];
</script>

<section class="py-10 sm:py-16" aria-labelledby="hero-title">
	<h1 id="hero-title" class="text-4xl font-semibold tracking-tight sm:text-5xl">Deploybot</h1>
	<p class="text-muted-foreground mt-4 max-w-2xl text-lg">
		Let any AI agent that speaks MCP run your own servers, without handing it SSH keys or a cloud token. It can
		only deploy what your catalog allows, as you, after a confirm step.
	</p>
	<a
		class="bg-primary text-primary-foreground hover:bg-primary/80 mt-8 inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
		href={SIGN_IN_URL}
		data-sveltekit-reload>Sign in</a
	>
	<div class="mt-10">
		<PitchDiagram />
	</div>
</section>

<section class="py-8" aria-labelledby="how-title">
	<h2 id="how-title" class="text-2xl font-semibold tracking-tight">How it works</h2>
	<p class="text-muted-foreground mt-2">Three steps from a new host to a running service.</p>
	<ol class="mt-4 grid gap-4 sm:grid-cols-3">
		{#each steps as step, index (step.title)}
			<li class="rounded-xl border p-5">
				<p class="text-muted-foreground text-sm font-medium">Step {index + 1}</p>
				<h3 class="mt-1 font-semibold">{step.title}</h3>
				<p class="text-muted-foreground mt-2 text-sm">{step.body}</p>
			</li>
		{/each}
	</ol>
</section>

<section class="py-8" aria-labelledby="source-title">
	<h2 id="source-title" class="text-2xl font-semibold tracking-tight">Open source</h2>
	<p class="text-muted-foreground mt-2">Use Deploybot hosted, or run all of it yourself from these four repos.</p>
	<table class="mt-4 w-full text-left text-sm max-sm:block">
		<thead class="max-sm:sr-only">
			<tr class="border-b">
				<th scope="col" class="py-2 pr-4 font-medium">Component</th>
				<th scope="col" class="py-2 pr-4 font-medium">What it does</th>
				<th scope="col" class="py-2 pr-4 font-medium">Built with</th>
				<th scope="col" class="py-2 font-medium">Licence</th>
			</tr>
		</thead>
		<tbody class="max-sm:grid max-sm:gap-4">
			{#each components as component (component.repo)}
				<tr class="border-b align-top max-sm:block max-sm:rounded-xl max-sm:border max-sm:p-4">
					<th scope="row" class="py-2 pr-4 font-medium whitespace-nowrap max-sm:block max-sm:p-0">
						<a
							class="text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
							href={REPO_URL(component.repo)}
							rel="noopener noreferrer"
							target="_blank">{component.repo}<span class="sr-only">{' (opens in a new tab)'}</span></a
						>
					</th>
					<td class="py-2 pr-4 max-sm:block max-sm:p-0 max-sm:pt-2">{component.role}</td>
					<td class="text-muted-foreground py-2 pr-4 max-sm:block max-sm:p-0 max-sm:pt-1">
						<span class="font-medium sm:hidden">Built with:{' '}</span>{component.stack}
					</td>
					<td class="text-muted-foreground py-2 whitespace-nowrap max-sm:block max-sm:p-0 max-sm:pt-1">
						<span class="font-medium sm:hidden">Licence:{' '}</span>{component.licence}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
	<p class="text-muted-foreground mt-4 text-sm">
		To self-host you need a Linux server, PostgreSQL 18 with TimescaleDB, a Google OAuth client, a TLS reverse proxy
		(agents connect over wss://) and a secrets key file for encrypted values. Each repo's README has the steps.
	</p>
</section>
