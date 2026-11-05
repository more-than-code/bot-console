<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import Fingerprint from '@lucide/svelte/icons/fingerprint';
	import type { Host, ProbeView, ProjectServiceRow, ServiceRuntime } from '$lib/api-types';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import { COPY_FAILED_NOTE, COPY_FAILURE_MS, COPIED_NOTE, copyText, shownDigestFailure } from '$lib/copy-text';
	import { canEditHealthChecks } from '$lib/health-checks';
	import { serviceDomId } from '$lib/host-view';
	import type { CatalogRunState } from '$lib/project-action';
	import { runtimeDetail, UNKNOWN_RUNTIME, type ServiceControls } from '$lib/service-actions';
	import { renameStartValue, serviceLabel } from '$lib/service-label';
	import { copyOfText, healthSourceLabel, imageDigestText } from '$lib/service-view';
	import {
		CATALOG_CELL,
		COPY_STATE_TEXT,
		copyDetailText,
		copyUptime,
		healthNote,
		NO_STATUS_TIP,
		portsText,
		SERVICES_CELL,
		type CopyState
	} from '$lib/catalog-copies';
	import RowMenu from '$lib/components/RowMenu.svelte';
	import { shortDigest } from '$lib/image-spec';
	import { copyMenuItems, type MenuKey } from '$lib/row-menu';
	import { UNREAD_HEALTH_CHECKS } from '$lib/health-checks';
	import { actionUrlFrom } from '$lib/url';
	import HealthChecks from './HealthChecks.svelte';
	import RenameService from './RenameService.svelte';
	import RuntimeBadge from './RuntimeBadge.svelte';
	import ServiceRowActions from './ServiceRowActions.svelte';

	let {
		copy,
		projectId,
		hosts,
		canAdmin,
		controls,
		runtime,
		state: copyState,
		now = Date.now(),
		selected = false,
		logsOpen = false,
		message = null,
		renameServiceId = null,
		typedName = null,
		healthServiceId = null,
		healthField = null,
		healthIndex = null,
		healthMessage = null,
		probe = null,
		probeServiceId = null,
		editorProbe = false,
		probeIndex = null,
		probeMessage = null,
		onHealthSaved,
		runResult = null
	}: {
		/** One running copy of the entry above it: an owned service row of this project. */
		copy: ProjectServiceRow;
		projectId: string;
		hosts: Host[];
		canAdmin: boolean;
		/** Null: no actions (no grant on the entry). 'checking': its container state is still being read. */
		controls: ServiceControls | 'checking' | null;
		/** The copy's state, or null while it is still being read. */
		runtime: ServiceRuntime | null;
		/** The badge word (see `copyState`). */
		state: CopyState;
		/** One clock for the Uptime column. */
		now?: number;
		/** Highlighted by the Deploy drawer's "View logs" link. */
		selected?: boolean;
		/** Open the Logs drawer (the "View logs" link). */
		logsOpen?: boolean;
		message?: string | null;
		renameServiceId?: string | null;
		typedName?: string | null;
		healthServiceId?: string | null;
		healthField?: string | null;
		healthIndex?: number | null;
		healthMessage?: string | null;
		probe?: ProbeView | null;
		probeServiceId?: string | null;
		editorProbe?: boolean;
		probeIndex?: number | null;
		probeMessage?: string | null;
		onHealthSaved?: (serviceId: string) => void;
		/** The last catalog action posted from this tab. Shown only on its own copy. */
		runResult?: CatalogRunState | null;
	} = $props();

	const label = $derived(serviceLabel(copy));
	const digest = $derived(imageDigestText(copy.image_digest));
	const renameAllowed = $derived(
		canEditHealthChecks({
			canAdmin,
			projectId,
			serviceProjectId: copy.project_id,
			hostOwnerProjectId: hosts.find((item) => item.id === copy.host_id)?.project_id ?? null
		})
	);
	const typed = $derived(renameServiceId === copy.id && typedName != null ? typedName : renameStartValue(copy));
	const liveDetail = $derived(
		controls && controls !== 'checking' ? (runtimeDetail(runtime ?? UNKNOWN_RUNTIME, copy.host_status) ?? '') : ''
	);
	/** "No status" says why first; the live details and Last seen follow. */
	const note = $derived(healthNote(copy, copyState));
	const detail = $derived(
		copyState === 'noStatus'
			? `${NO_STATUS_TIP}. ${liveDetail}`.trim()
			: note
				? `${liveDetail} ${note}.`.trim()
				: liveDetail
	);
	const badgeTone = $derived(
		copyState === 'running' ? 'up' : copyState === 'unhealthy' ? 'down' : copyState === 'stopped' ? 'stopped' : 'unknown'
	);
	const badgeText = $derived(copyState === 'loading' ? null : COPY_STATE_TEXT[copyState]);
	const short = $derived(shortDigest(digest));
	const uptime = $derived(copyUptime(copyState, runtime, now));
	/** The phone's second line: "port N · sha256:short · up 3h 2m". */
	const phoneLine = $derived([copyDetailText(copy.ports, short), uptime === '—' ? '' : `up ${uptime}`].filter(Boolean).join(' · '));

	// The ⋯ menu: Health checks and Rename always; below `sm` also Start/Stop, Restart and Logs.
	const menuId = $derived(`copy-menu-${copy.id}`);
	const live = $derived(controls != null && controls !== 'checking' ? controls : null);
	const menuItems = $derived(
		copyMenuItems({
			entry: copy.catalog_entry ?? '',
			host: copy.host_name,
			state:
				live && (live.stateAction || live.blockedReason)
					? {
							label: live.stateAction === 'stop' ? 'Stop' : 'Start',
							disabledReason: live.stateAction ? null : live.blockedReason
						}
					: null,
			restart: live?.restart ?? false,
			logs: live?.logs ?? false,
			health: renameAllowed ? { disabledReason: copy.checksMessage != null ? UNREAD_HEALTH_CHECKS : null } : null,
			rename: renameAllowed,
			label,
			digest: digest != null
		})
	);
	let requests = $state<Record<MenuKey, number>>({
		deploy: 0,
		edit: 0,
		permissions: 0,
		delete: 0,
		state: 0,
		restart: 0,
		logs: 0,
		digest: 0,
		health: 0,
		rename: 0
	});

	function onMenu(key: MenuKey) {
		if (key === 'digest') {
			if (digest == null) return;
			const value = digest;
			void copyText(value, (text) => navigator.clipboard.writeText(text)).then((note) => onDigestResult(value, note));
			return;
		}
		requests[key] += 1;
	}

	type DigestFailure = { value: string; failedAt: number };
	let digestFailure = $state<DigestFailure | null>(null);

	function onDigestResult(value: string, note: string) {
		if (note === COPIED_NOTE) digestFailure = null;
		else if (note === COPY_FAILED_NOTE) digestFailure = { value, failedAt: Date.now() };
	}

	$effect(() => {
		if (!browser || digestFailure == null) return;
		const failure = digestFailure;
		const timer = setTimeout(
			() => {
				if (digestFailure !== failure) return;
				if (shownDigestFailure(failure.value, failure.failedAt, Date.now()) != null) return;
				digestFailure = null;
			},
			Math.max(0, failure.failedAt + COPY_FAILURE_MS - Date.now())
		);
		return () => clearTimeout(timer);
	});
</script>

<!-- One row of the entry's services table: Host | Status | Port | Digest | Uptime | actions.
     Below `sm`: host and status, then port, digest and uptime; actions only in the ⋯ menu. -->
<tr
	id={serviceDomId(copy.id)}
	class="hover:bg-muted/50 data-[state=selected]:bg-muted border-b last:border-b-0"
	data-copy="{copy.catalog_entry} {copy.host_id}"
	data-state={selected ? 'selected' : undefined}
	aria-current={selected ? 'true' : undefined}
>
	<!-- The selected service also gets a bar on its left edge, so it does not rely on colour alone. -->
	<td
		class="{SERVICES_CELL.host} {selected ? 'shadow-[inset_3px_0_0_var(--primary)]' : ''}"
		data-selected-bar={selected ? '' : undefined}
	>
		<div class="flex min-w-0 flex-wrap items-center gap-x-2">
			<!-- Screen readers hear which entry this service belongs to. -->
			<span class="sr-only">{copyOfText(copy.catalog_entry ?? '')}</span>
			<a class="text-primary min-w-0 truncate underline-offset-4 hover:underline" href="/hosts/{copy.host_id}">{copy.host_name}</a>
			<span class="sm:hidden" data-phone-status>
				<RuntimeBadge
					status={badgeTone}
					text={badgeText}
					loading={copyState === 'loading'}
					{detail}
					hint={healthSourceLabel(copy)}
					lastSeen={copy.last_seen_at}
				/>
			</span>
		</div>
		<div class="text-muted-foreground min-w-0">
			<span class="sr-only">{'Label '}</span>
			<span
				class="inline-block max-w-48 min-w-0 truncate align-bottom text-xs"
				title={copy.kind === 'container' && copy.container_name && copy.container_name !== label
					? `${label} (container ${copy.container_name})`
					: label}>{label}</span
			>
		</div>
		{#if phoneLine}
			<div class="text-muted-foreground font-mono text-xs sm:hidden" data-phone-detail>{phoneLine}</div>
		{/if}
		{#if digestFailure}
			<div class="mt-1 grid gap-1">
				<p class="font-mono text-sm break-all select-text">{digestFailure.value}</p>
				<p class="text-muted-foreground text-sm" role="status">{COPY_FAILED_NOTE}</p>
			</div>
		{/if}
	</td>
	<td class={SERVICES_CELL.status}>
		<RuntimeBadge
			status={badgeTone}
			text={badgeText}
			loading={copyState === 'loading'}
			{detail}
			hint={healthSourceLabel(copy)}
			lastSeen={copy.last_seen_at}
		/>
	</td>
	<td class={SERVICES_CELL.port} data-ports>{portsText(copy.ports)}</td>
	<td class={SERVICES_CELL.digest}>
		{#if digest}
			<span class="inline-flex items-center gap-1">
				<span class="font-mono text-xs" data-digest>{short ?? digest}</span>
				<CopyButton value={digest} label="Image digest {digest}" icon={Fingerprint} iconOnly onResult={(note) => onDigestResult(digest, note)} />
			</span>
		{/if}
	</td>
	<td class={SERVICES_CELL.uptime} data-uptime>{uptime}</td>
	<!-- Actions: [Start/Stop] [Restart] [Logs] [⋯ Health checks, Rename], right-aligned in the entry's icon grid.
	     "checking…" sits inline, so the ⋯ menu keeps its place when the state arrives. -->
	<td class={SERVICES_CELL.actions}>
		<ServiceRowActions
			class={CATALOG_CELL.actionsGroup}
			{controls}
			hostId={copy.host_id}
			hostName={copy.host_name}
			serviceId={copy.id}
			{runResult}
			{logsOpen}
			extra={copyActions}
			stateRequest={requests.state}
			restartRequest={requests.restart}
			logsRequest={requests.logs}
			fallbackFocusId={menuId}
		/>
	</td>
</tr>

{#snippet copyActions()}
	<RowMenu id={menuId} label="More actions for {label} on {copy.host_name}" items={menuItems} onSelect={onMenu} />
	{#if renameAllowed}
		<RenameService
			action={actionUrlFrom(page.url, 'rename')}
			serviceId={copy.id}
			rowLabel={label}
			value={typed}
			failed={renameServiceId === copy.id}
			{message}
			showTrigger={false}
			openRequest={requests.rename}
			fallbackFocusId={menuId}
		/>
		<HealthChecks
			action={actionUrlFrom(page.url, 'saveHealthChecks')}
			probeAction={actionUrlFrom(page.url, 'probe')}
			serviceId={copy.id}
			rowLabel={label}
			ports={copy.ports}
			checks={copy.checks}
			checksMessage={copy.checksMessage}
			health={copy.health}
			catalogEntry={copy.catalog_entry}
			dockerCheck={copy.dockerCheck ?? null}
			failed={healthServiceId === copy.id}
			serverField={healthServiceId === copy.id ? healthField : null}
			serverIndex={healthServiceId === copy.id ? healthIndex : null}
			serverMessage={healthServiceId === copy.id ? healthMessage : null}
			{probe}
			{probeIndex}
			{probeMessage}
			showProbe={editorProbe && probeServiceId === copy.id}
			onSaved={onHealthSaved}
			showTrigger={false}
			openRequest={requests.health}
			fallbackFocusId={menuId}
		/>
	{/if}
{/snippet}
