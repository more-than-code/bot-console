<script lang="ts">
	import Breadcrumbs from '$lib/components/Breadcrumbs.svelte';
	import type { ProjectActionData, ProjectScope } from '$lib/project-action';
	import HostsSection from './HostsSection.svelte';
	import MembersSection from './MembersSection.svelte';
	import SettingsSection from './SettingsSection.svelte';
	import TokensSection from './TokensSection.svelte';

	let { data, form } = $props();
	const action = $derived((form ?? null) as ProjectActionData | null);
	const scope = $derived<ProjectScope>(action?.scope ?? data.tab ?? 'hosts');
	const sectionMessage = $derived(action?.scope === scope ? (action.message ?? null) : null);
</script>

<svelte:head>
	<title>{data.project ? data.project.name : 'Project'} · deploybot</title>
</svelte:head>

{#if !data.project}
	<Breadcrumbs items={[{ label: 'Projects', href: '/projects' }, { label: 'Project' }]} />
	<h1>Project</h1>
	<p class="error" role="alert">{data.message ?? 'This project is not available.'}</p>
{:else}
	<Breadcrumbs items={[{ label: 'Projects', href: '/projects' }, { label: data.project.name }]} />
	<h1>{data.project.name}</h1>
	<p class="sub">{data.project.slug} · your role {data.project.role}</p>
	<nav class="nav tabs" aria-label="Project sections">
		<a href="/projects/{data.project.id}?tab=hosts" aria-current={scope === 'hosts' ? 'page' : undefined}>Hosts</a>
		<a href="/projects/{data.project.id}?tab=members" aria-current={scope === 'members' ? 'page' : undefined}>Members</a>
		{#if data.canAdmin}
			<a href="/projects/{data.project.id}?tab=tokens" aria-current={scope === 'tokens' ? 'page' : undefined}>Join tokens</a>
		{/if}
		{#if data.canOwner}
			<a href="/projects/{data.project.id}?tab=settings" aria-current={scope === 'settings' ? 'page' : undefined}>Settings</a>
		{/if}
	</nav>

	{#if scope === 'hosts'}
		<HostsSection
			projectId={data.project.id}
			hosts={data.hosts}
			omitted={data.hostsOmitted}
			truncated={data.hostsTruncated}
			canAdmin={data.canAdmin}
			confirmHostId={action?.scope === 'hosts' ? (action.confirmHostId ?? null) : null}
			message={sectionMessage ?? data.hostsMessage}
		/>
	{:else if scope === 'members'}
		<MembersSection
			members={data.members}
			omitted={data.membersOmitted}
			truncated={data.membersTruncated}
			canAdmin={data.canAdmin}
			canOwner={data.canOwner}
			currentUserId={data.userId ?? null}
			message={sectionMessage ?? data.membersMessage}
		/>
	{:else if scope === 'tokens'}
		<TokensSection
			tokens={data.tokens}
			omitted={data.tokensOmitted}
			truncated={data.tokensTruncated}
			canAdmin={data.canAdmin}
			created={action?.scope === 'tokens' ? (action.created ?? null) : null}
			message={sectionMessage ?? data.tokensMessage}
		/>
	{:else if scope === 'settings'}
		<SettingsSection project={data.project} canOwner={data.canOwner} message={sectionMessage} />
	{/if}
{/if}
