<script lang="ts">
	import { SIGN_IN_URL } from './links';

	const features = [
		{
			title: 'Hosts dial out',
			body: 'A small agent on each host connects out to Deploybot. You do not need to open inbound ports.'
		},
		{
			title: 'Secrets encrypted at rest',
			body: 'Secret values in env sets, files and registry credentials are stored encrypted.'
		},
		{
			title: 'AI agents over MCP',
			body: 'Connect an MCP client and it acts with your own access, no more.'
		}
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
		Let Claude, Codex or Grok run your own servers, without handing them SSH or a cloud token. They can only
		deploy what your catalog allows, as you, after a confirm step.
	</p>
	<a
		class="bg-primary text-primary-foreground hover:bg-primary/80 mt-8 inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
		href={SIGN_IN_URL}
		data-sveltekit-reload>Sign in</a
	>
</section>

<section class="py-8" aria-labelledby="features-title">
	<h2 id="features-title" class="sr-only">Features</h2>
	<ul class="grid gap-4 sm:grid-cols-3">
		{#each features as feature (feature.title)}
			<li class="bg-card text-card-foreground rounded-xl border p-5">
				<h3 class="font-semibold">{feature.title}</h3>
				<p class="text-muted-foreground mt-2 text-sm">{feature.body}</p>
			</li>
		{/each}
	</ul>
</section>

<section class="py-8" aria-labelledby="how-title">
	<h2 id="how-title" class="text-2xl font-semibold tracking-tight">How it works</h2>
	<p class="text-muted-foreground mt-2">Catalog, deploy and watch services on your own hosts through a small agent.</p>
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
