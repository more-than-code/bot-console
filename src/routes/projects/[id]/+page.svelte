<script lang="ts">
	import Notice from '$lib/components/Notice.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Tabs from '$lib/components/Tabs.svelte';
	import { servicesRenameView, type ProjectActionData, type ProjectScope } from '$lib/project-action';
	import HostsSection from './HostsSection.svelte';
	import MembersSection from './MembersSection.svelte';
	import ServicesSection from './ServicesSection.svelte';
	import SettingsSection from './SettingsSection.svelte';
	import TokensSection from './TokensSection.svelte';

	let { data, form } = $props();
	const action = $derived((form ?? null) as ProjectActionData | null);
	const scope = $derived<ProjectScope>(action?.scope ?? data.tab ?? 'hosts');
	const sectionMessage = $derived(action?.scope === scope ? (action.message ?? null) : null);
	const rename = $derived(servicesRenameView(action));

	const tabs = $derived(
		data.project
			? [
					{ key: 'hosts', label: 'Hosts', href: `/projects/${data.project.id}?tab=hosts` },
					{ key: 'services', label: 'Services', href: `/projects/${data.project.id}?tab=services` },
					{ key: 'members', label: 'Members', href: `/projects/${data.project.id}?tab=members` },
					...(data.canAdmin
						? [{ key: 'tokens', label: 'Join tokens', href: `/projects/${data.project.id}?tab=tokens` }]
						: []),
					...(data.canOwner
						? [{ key: 'settings', label: 'Settings', href: `/projects/${data.project.id}?tab=settings` }]
						: [])
				]
			: []
	);
</script>

<svelte:head>
	<title>{data.project ? data.project.name : 'Project'} · deploybot</title>
</svelte:head>

{#if !data.project}
	<PageHeader title="Project" breadcrumbs={[{ label: 'Projects', href: '/projects' }, { label: 'Project' }]} />
	<Notice kind="error">{data.message ?? 'This project is not available.'}</Notice>
{:else}
	<PageHeader
		title={data.project.name}
		subtitle="{data.project.slug} · your role {data.project.role}"
		breadcrumbs={[{ label: 'Projects', href: '/projects' }, { label: data.project.name }]}
	/>
	<Tabs label="Project sections" current={scope} items={tabs} />

	{#if scope === 'hosts'}
		<HostsSection
			hosts={data.hosts}
			omitted={data.hostsOmitted}
			truncated={data.hostsTruncated}
			canAdmin={data.canAdmin}
			message={sectionMessage ?? data.hostsMessage}
		/>
	{:else if scope === 'services'}
		<ServicesSection
			projectId={data.project.id}
			projectName={data.project.name}
			hosts={data.hosts}
			canAdmin={data.canAdmin}
			rows={data.services}
			total={data.servicesTotal}
			prevCursor={data.servicesPrev}
			nextCursor={data.servicesNext}
			omitted={data.servicesOmitted}
			message={sectionMessage ?? data.servicesMessage}
			probe={action?.scope === 'services' ? (action.probe ?? null) : null}
			probeServiceId={action?.scope === 'services' ? (action.probeServiceId ?? null) : null}
			renameServiceId={rename.renameServiceId}
			typedName={rename.typedName}
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
			invites={data.invites}
			invitesOmitted={data.invitesOmitted}
			invitesTruncated={data.invitesTruncated}
			invitesMessage={data.invitesMessage}
			inviteUrl={action?.scope === 'members' ? (action.inviteUrl ?? null) : null}
			inviteRole={action?.scope === 'members' ? (action.inviteRole ?? null) : null}
			inviteMessage={action?.scope === 'members' ? (action.inviteMessage ?? null) : null}
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
