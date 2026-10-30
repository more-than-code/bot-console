<script lang="ts">
	import Notice from '$lib/components/Notice.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Tabs from '$lib/components/Tabs.svelte';
	import { servicesHealthView } from '$lib/health-checks';
	import { servicesRenameView, type ProjectActionData, type ProjectScope } from '$lib/project-action';
	import { toastHealthSaved, toastImageSaved } from '$lib/success-toast';
	import { actionUrlFrom } from '$lib/url';
	import CatalogEntryDialog from './CatalogEntryDialog.svelte';
	import CatalogImageDialog from './CatalogImageDialog.svelte';
	import AddHostSection from './AddHostSection.svelte';
	import CatalogSection from './CatalogSection.svelte';
	import HostsSection from './HostsSection.svelte';
	import { page } from '$app/state';
	import MembersSection from './MembersSection.svelte';
	import ServicesSection from './ServicesSection.svelte';
	import SettingsSection from './SettingsSection.svelte';
	import TokensSection from './TokensSection.svelte';

	let { data, form } = $props();

	const action = $derived((form ?? null) as ProjectActionData | null);
	const scope = $derived<ProjectScope>(action?.scope ?? data.tab ?? 'hosts');
	// A dialog form's message (createToken, addMember) shows in its dialog, not on the page.
	const sectionMessage = $derived(action?.scope === scope && !action.field ? (action.message ?? null) : null);
	const createTokenMessage = $derived(action?.field === 'createToken' ? (action.message ?? null) : null);
	const addMemberMessage = $derived(action?.field === 'addMember' ? (action.message ?? null) : null);
	const rename = $derived(servicesRenameView(action));
	const healthEditor = $derived(servicesHealthView(action));
	const catalogEditor = $derived(action?.scope === 'catalog' ? (action.catalogEditor ?? null) : null);
	const serviceRun = $derived(action?.scope === 'services' ? (action.catalogAction ?? null) : null);
	const imageEditor = $derived(action?.scope === 'catalog' ? (action.imageEditor ?? null) : null);
	const imageDeploy = $derived(action?.scope === 'catalog' ? (action.imageDeploy ?? null) : null);
	const catalogPermissions = $derived(
		action?.scope === 'catalog' && action.permissions ? action.permissions : (data.permissions ?? null)
	);
	const catalogMessage = $derived.by(() => {
		if (catalogEditor || imageEditor || imageDeploy || (action?.scope === 'catalog' && action.permissions)) return data.catalogMessage ?? null;
		return sectionMessage ?? data.catalogMessage ?? null;
	});

	const tabs = $derived(
		data.project
			? [
					{ key: 'hosts', label: 'Hosts', href: `/projects/${data.project.id}?tab=hosts` },
					// No hover preload: the Services load reads container status from the hosts.
					{ key: 'services', label: 'Services', href: `/projects/${data.project.id}?tab=services`, preload: 'off' as const },
					{ key: 'catalog', label: 'Catalog', href: `/projects/${data.project.id}?tab=catalog` },
					{ key: 'members', label: 'Members', href: `/projects/${data.project.id}?tab=members` },
					...(data.canAdmin
						? [{ key: 'tokens', label: 'Join tokens', href: `/projects/${data.project.id}?tab=tokens` }]
						: []),
					...(data.canAdmin
						? [{ key: 'settings', label: 'Settings', href: `/projects/${data.project.id}?tab=settings` }]
						: [])
				]
			: []
	);
</script>

<svelte:head>
	<title>{data.project ? data.project.name : 'Project'} · Deploybot</title>
</svelte:head>

{#if !data.project}
	<PageHeader title="Project" breadcrumbs={[{ label: 'Projects', href: '/projects' }, { label: 'Project' }]} />
	<Notice kind="error">{data.message ?? 'This project is not available.'}</Notice>
{:else}
	<PageHeader
		title={data.project.name}
		subtitle="{data.project.slug} · your role {data.project.role}"
		breadcrumbs={[{ label: 'Projects', href: '/projects' }, { label: data.project.name }]}
	>
		{#snippet actions()}
			{#if scope === 'catalog' && data.canOwner}
				<CatalogEntryDialog
					mode="create"
					hosts={data.hosts ?? []}
					saveAction={actionUrlFrom(page.url, 'catalogCreate')}
					parseAction={actionUrlFrom(page.url, 'catalogParse')}
					revealed={catalogEditor?.mode === 'create'}
					editor={catalogEditor?.mode === 'create' ? catalogEditor : null}
				/>
				<CatalogImageDialog
					mode="create"
					saveAction={actionUrlFrom(page.url, 'catalogCreate')}
					setsAction={actionUrlFrom(page.url, 'catalogEnvSets')}
					filesAction={actionUrlFrom(page.url, 'catalogFiles')}
					tagsAction={actionUrlFrom(page.url, 'catalogImageTags')}
					digestAction={actionUrlFrom(page.url, 'catalogImageDigest')}
					revealed={imageEditor?.mode === 'create'}
					editor={imageEditor?.mode === 'create' ? imageEditor : null}
					onSaved={toastImageSaved}
				/>
			{/if}
		{/snippet}
	</PageHeader>
	<Tabs label="Project sections" current={scope} items={tabs} />

	{#if scope === 'hosts'}
		<HostsSection
			hosts={data.hosts}
			omitted={data.hostsOmitted}
			truncated={data.hostsTruncated}
			canAdmin={data.canAdmin}
			message={sectionMessage ?? data.hostsMessage}
			hostsMessage={data.hostsMessage}
		>
			{#if data.canAdmin}
				<AddHostSection
					tokens={data.tokens}
					hosts={data.hosts}
					created={action?.scope === 'hosts' ? (action.created ?? null) : null}
					slug={data.project.slug}
					open={data.hosts.length === 0 && !data.hostsMessage}
					message={createTokenMessage}
				/>
			{/if}
		</HostsSection>
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
			editorProbe={healthEditor.editorProbe}
			renameServiceId={rename.renameServiceId}
			typedName={rename.typedName}
			healthServiceId={healthEditor.serviceId}
			healthField={healthEditor.field}
			healthIndex={healthEditor.index}
			healthMessage={healthEditor.message}
			probeIndex={action?.scope === 'services' ? (action.probeIndex ?? null) : null}
			probeMessage={action?.scope === 'services' ? (action.probeMessage ?? null) : null}
			onHealthSaved={toastHealthSaved}
			entries={data.serviceEntries ?? []}
			entriesMessage={data.serviceEntriesMessage ?? null}
			notRunning={data.notRunning ?? []}
			notRunningKnown={data.notRunningKnown ?? true}
			serviceStates={data.serviceStates ?? null}
			runResult={serviceRun}
		/>
	{:else if scope === 'catalog'}
		<CatalogSection
			canOwner={data.canOwner}
			canAdmin={data.canAdmin}
			entries={data.catalog ?? []}
			omitted={data.catalogOmitted ?? 0}
			truncated={data.catalogTruncated ?? false}
			message={catalogMessage}
			hosts={data.hosts ?? []}
			members={data.members ?? []}
			editor={catalogEditor?.mode === 'edit' ? catalogEditor : null}
			permissions={catalogPermissions}
			imageEditor={imageEditor?.mode === 'edit' ? imageEditor : null}
			imageDeploy={imageDeploy}
			onImageSaved={toastImageSaved}
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
			{addMemberMessage}
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
			message={sectionMessage ?? data.tokensMessage}
		/>
	{:else if scope === 'settings'}
		<SettingsSection
			project={data.project}
			canOwner={data.canOwner}
			canAdmin={data.canAdmin}
			message={sectionMessage}
			settingsField={action?.scope === 'settings' ? (action.settingsField ?? null) : null}
			envSets={data.envSets ?? []}
			envSetsMessage={data.envSetsMessage ?? null}
			files={data.files ?? []}
			filesMessage={data.filesMessage ?? null}
			viewedFile={action?.scope === 'settings' ? (action.viewedFile ?? null) : null}
			settingsName={action?.scope === 'settings' ? (action.settingsName ?? null) : null}
			registries={data.registries ?? []}
			registriesMessage={data.registriesMessage ?? null}
		/>
	{/if}
{/if}
