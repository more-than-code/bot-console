<script lang="ts">
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleXIcon from '@lucide/svelte/icons/circle-x';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import ShieldIcon from '@lucide/svelte/icons/shield';
	import UsersIcon from '@lucide/svelte/icons/users';
	import { GITHUB_URL, INSTALL_GUIDE_URL, REPO_URL, SIGN_IN_URL } from './links';
	import PitchDiagram from './PitchDiagram.svelte';

	const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
	const primaryButton = `bg-primary text-primary-foreground hover:bg-primary/80 inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium ${focus}`;
	const outlineButton = `bg-background hover:bg-muted inline-flex h-10 items-center rounded-lg border px-4 text-sm font-medium ${focus}`;
	const linkClass = `text-primary underline-offset-4 hover:underline ${focus}`;
	const capture = 'bg-muted rounded-lg p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap sm:text-sm';

	// Spec §3.4: the three ways, cell text exact. The highlighted approach is Deploybot.
	const aspects = [
		{ key: 'can', label: 'What the AI can do' },
		{ key: 'safeguard', label: 'Safeguard' },
		{ key: 'ports', label: 'Ports and keys' },
		{ key: 'unattended', label: 'When nobody is watching' },
		{ key: 'best', label: 'Best for' }
	] as const;
	const approaches = [
		{
			name: 'AI in a terminal (SSH)',
			can: 'Any shell command',
			safeguard: 'Approving each command',
			ports: 'SSH open, keys on a laptop',
			unattended: 'Nothing runs',
			best: 'Debugging one box',
			highlight: false
		},
		{
			name: 'AI with your cloud tokens',
			can: 'Anything the token allows',
			safeguard: 'Hoping the agent behaves',
			ports: 'Long-lived token in a file',
			unattended: 'Nothing runs',
			best: 'Throwaway projects',
			highlight: false
		},
		{
			name: 'Deploybot',
			can: 'Only your catalog',
			safeguard: 'Limited by design, acts as you, confirm step',
			ports: 'Hosts dial out; no open ports; the AI never holds host keys',
			unattended: 'Health checks; a failed deploy rolls back (later failures: your policy)',
			best: 'Running production, teams',
			highlight: true
		}
	];

	// The four former diagram panels, with the same facts.
	const features = [
		{
			title: 'Security',
			icon: ShieldIcon,
			body: 'On top of acting as you, catalog only and the confirm step:',
			items: [
				{ text: "Each host's own allowlist of images and projects" },
				{ text: 'Secrets encrypted at rest', note: 'env sets, files and registry logins' },
				{ text: 'Changes recorded in an audit log' }
			]
		},
		{
			title: 'Resilience',
			icon: HistoryIcon,
			body: 'Deploys wait for health, and you can go back in one step.',
			items: [
				{ text: 'Deploys wait for health: Docker or HTTP/TCP checks' },
				{ text: 'An unhealthy deploy rolls back automatically' },
				{ text: 'One-step rollback to an earlier image digest' },
				{ text: 'A health failure policy per service' },
				{ text: 'Programs run as systemd units and survive reboot' }
			]
		},
		{
			title: 'Visibility',
			icon: EyeIcon,
			body: 'See what runs on each host and how it is doing.',
			items: [
				{ text: 'Host metrics with history' },
				{ text: 'Running processes and discovered services' },
				{ text: 'Health check history for each service' },
				{ text: 'Container logs with secrets redacted' },
				{ text: 'Container logs capped at 10 MB × 3' }
			]
		},
		{
			title: 'Teams',
			icon: UsersIcon,
			body: 'Share projects and hosts with the right level of access.',
			items: [
				{ text: 'Owner, admin and viewer roles per project' },
				{ text: 'Invite links that expire (single-use by default)' },
				{ text: 'Per-entry rights to run, stop, restart or deploy' },
				{ text: 'Share a host with other projects (metrics or deploy)' },
				{ text: 'One-time join tokens for adding hosts (admins)' }
			]
		}
	];

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

	const startSteps = [
		{ title: 'Sign in' },
		{ title: 'Install the agent on a host', href: INSTALL_GUIDE_URL },
		{ title: 'Deploy your first catalog entry' }
	];
</script>

<section class="py-10 sm:py-16" aria-labelledby="hero-title">
	<h1 id="hero-title" class="text-4xl font-semibold tracking-tight sm:text-5xl">
		Let AI run your servers, without the keys.
	</h1>
	<p class="text-muted-foreground mt-4 max-w-2xl text-lg">
		Let any AI agent that speaks MCP run your own servers, without handing it SSH keys or a cloud token. It can
		only deploy what your catalog allows, as you, after a confirm step.
	</p>
	<div class="mt-8 flex flex-wrap gap-3">
		<a class={primaryButton} href={SIGN_IN_URL} data-sveltekit-reload>Get started</a>
		<a class={outlineButton} href={GITHUB_URL} rel="noopener noreferrer" target="_blank"
			>View on GitHub<span class="sr-only">{' (opens in a new tab)'}</span></a
		>
	</div>
	<p class="text-muted-foreground mt-3 text-sm">Agent for Linux amd64 and arm64 · Open source</p>
</section>

<section class="py-8" aria-labelledby="visual-title">
	<h2 id="visual-title" class="text-2xl font-semibold tracking-tight">See it work</h2>
	<div class="mt-4 grid gap-6">
		<figure class="min-w-0">
			<img
				class="h-auto w-full rounded-lg border"
				src="/brand/about-deploy-result.webp"
				width="1152"
				height="784"
				loading="lazy"
				decoding="async"
				alt="The console deploy dialog after a deploy: the health rule (roll back if the deploy fails), a succeeded badge with the sha256 digest, the container log ending with the health check's GET / request answered 200, and the deploy history."
			/>
			<figcaption class="text-muted-foreground mt-2 text-sm">
				Deploy from the console: the agent waits for the health check, then reports.
			</figcaption>
		</figure>
		<div class="grid gap-6 sm:grid-cols-2">
			<figure class="min-w-0" data-capture="confirm">
				<div class="space-y-3 rounded-lg border p-3">
					<div>
						<p class="text-muted-foreground mb-1 text-xs font-medium">Call (arguments shortened)</p>
						<pre class={capture}><code>deploy_entry  entry=web  host=pi3-2</code></pre>
					</div>
					<div>
						<p class="text-muted-foreground mb-1 text-xs font-medium">Response (id shortened)</p>
						<pre class={capture}><code
								>"plan": "will deploy web (docker.io/library/nginx:alpine) on pi3-2"
"confirmation_id": "…"</code
							></pre>
					</div>
				</div>
				<figcaption class="text-muted-foreground mt-2 text-sm">
					An AI agent asks to deploy. Deploybot answers with a plan, and nothing runs until you confirm.
				</figcaption>
			</figure>
			<figure class="min-w-0" data-capture="refusal">
				<div class="space-y-3 rounded-lg border p-3">
					<div>
						<p class="text-muted-foreground mb-1 text-xs font-medium">Call (arguments shortened)</p>
						<pre class={capture}><code>deploy_entry  entry=root-shell  host=pi3-2</code></pre>
					</div>
					<div>
						<p class="text-muted-foreground mb-1 text-xs font-medium">Response</p>
						<pre class={capture}><code class="text-destructive">not_found: not found</code></pre>
					</div>
				</div>
				<figcaption class="text-muted-foreground mt-2 text-sm">An entry that isn't in your catalog is refused.</figcaption>
			</figure>
		</div>
	</div>
</section>

<section class="py-8" aria-labelledby="flow-title">
	<h2 id="flow-title" class="text-2xl font-semibold tracking-tight">From your AI agent to your servers</h2>
	<div class="mt-4">
		<PitchDiagram />
	</div>
</section>

<section class="py-8" aria-labelledby="compare-title">
	<h2 id="compare-title" class="text-2xl font-semibold tracking-tight">Three ways to let AI run your servers</h2>
	<!-- From sm up: the comparison table. On phones: one card per approach (the table is hidden there). -->
	<table class="mt-4 w-full text-left text-sm max-sm:hidden" aria-labelledby="compare-title">
		<thead>
			<tr class="border-b">
				<th scope="col" class="py-2 pr-4"><span class="sr-only">Aspect</span></th>
				{#each approaches as approach (approach.name)}
					<th
						scope="col"
						class={[
							'px-3 py-2 align-bottom font-medium',
							approach.highlight && 'bg-primary/5 text-primary border-primary rounded-t-lg border-t-2'
						]}>{approach.name}</th
					>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each aspects as aspect (aspect.key)}
				<tr class="border-b align-top">
					<th scope="row" class="py-2 pr-4 font-medium">{aspect.label}</th>
					{#each approaches as approach (approach.name)}
						<td class={['px-3 py-2', approach.highlight ? 'bg-primary/5' : 'text-muted-foreground']}
							>{approach[aspect.key]}</td
						>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
	<ul class="mt-4 grid gap-4 sm:hidden">
		{#each approaches as approach (approach.name)}
			<li
				class={[
					'rounded-xl border p-4',
					approach.highlight && 'bg-primary/5 border-primary border-t-2'
				]}
			>
				<h3 class={['font-semibold', approach.highlight && 'text-primary']}>{approach.name}</h3>
				<dl class="mt-2 space-y-2 text-sm">
					{#each aspects as aspect (aspect.key)}
						<div>
							<dt class="font-medium">{aspect.label}</dt>
							<dd class="text-muted-foreground">{approach[aspect.key]}</dd>
						</div>
					{/each}
				</dl>
			</li>
		{/each}
	</ul>
</section>

<section class="py-8" aria-labelledby="features-title">
	<h2 id="features-title" class="text-2xl font-semibold tracking-tight">What you get</h2>
	<div class="mt-4 grid gap-4 md:grid-cols-2">
		{#each features as feature (feature.title)}
			<div class="rounded-xl border p-5">
				<div class="flex items-center gap-2">
					<feature.icon class="text-primary size-5 shrink-0" aria-hidden="true" />
					<h3 class="font-semibold">{feature.title}</h3>
				</div>
				<p class="text-muted-foreground mt-2 text-sm">{feature.body}</p>
				<ul class="mt-3 list-disc space-y-1 pl-5 text-sm marker:text-primary">
					{#each feature.items as item (item.text)}
						<li>
							{item.text}{#if item.note}<span class="text-muted-foreground">{` (${item.note})`}</span>{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	</div>
</section>

<section class="py-8" aria-labelledby="ai-title">
	<h2 id="ai-title" class="text-2xl font-semibold tracking-tight">What the AI can and can't do</h2>
	<div class="mt-4 grid gap-4 md:grid-cols-2">
		<div class="rounded-xl border p-5">
			<div class="flex items-center gap-2">
				<CircleCheckIcon class="text-primary size-5 shrink-0" aria-hidden="true" />
				<h3 class="font-semibold">Can</h3>
			</div>
			<p class="text-muted-foreground mt-2 text-sm">
				Deploy, roll back, run, stop and restart catalog entries; read logs, status and metrics; add or change image catalog
				entries and their health checks. Every change shows a plan first and waits for your confirm, within your role and
				per-entry rights.
			</p>
		</div>
		<div class="rounded-xl border p-5">
			<div class="flex items-center gap-2">
				<CircleXIcon class="text-destructive size-5 shrink-0" aria-hidden="true" />
				<h3 class="font-semibold">Can't</h3>
			</div>
			<p class="text-muted-foreground mt-2 text-sm">
				Open a shell, see secret values, edit hosts, or act beyond your role.
			</p>
		</div>
	</div>
	<p class="mt-4 text-sm">
		<a class={linkClass} href="/llms.txt" data-sveltekit-reload>Read the full list for AI agents</a>
	</p>
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
							class={linkClass}
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

<section class="py-8" aria-labelledby="start-title">
	<h2 id="start-title" class="text-2xl font-semibold tracking-tight">Get started</h2>
	<ol class="mt-4 grid gap-4 sm:grid-cols-3">
		{#each startSteps as step, index (step.title)}
			<li class="rounded-xl border p-5">
				<p class="text-muted-foreground text-sm font-medium">Step {index + 1}</p>
				<p class="mt-1 font-semibold">
					{#if step.href}
						<a class={linkClass} href={step.href} rel="noopener noreferrer" target="_blank"
							>{step.title}<span class="sr-only">{' (opens in a new tab)'}</span></a
						>
					{:else}
						{step.title}
					{/if}
				</p>
			</li>
		{/each}
	</ol>
	<a class={`${primaryButton} mt-6`} href={SIGN_IN_URL} data-sveltekit-reload>Get started</a>
</section>
