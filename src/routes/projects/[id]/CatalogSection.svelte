<script lang="ts">
	import { browser } from '$app/environment';
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { tick, untrack } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import DataTable from '$lib/components/DataTable.svelte';
	import LocalTime from '$lib/components/LocalTime.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import type { CatalogEntry, Host, Member, ProbeView, ProjectServiceRow, ServiceRuntime } from '$lib/api-types';
	import {
		CATALOG_KIND_OPTIONS,
		catalogDefaultSort,
		catalogKindInfo,
		catalogKindOf,
		LAST_DEPLOYED_SORT,
		lastDeployedValue
	} from '$lib/catalog';
	import {
		CATALOG_CELL,
		catalogEmptyText,
		catalogRows,
		chosenHost,
		COPIES_CAPPED_NOTE,
		copySearchText,
		copyState,
		copySummary,
		hostChoices,
		type CopyState,
		rowsOnHost,
		STATUS_CAPPED_NOTE,
		type CatalogRow
	} from '$lib/catalog-copies';
	import { formatLatency } from '$lib/format';
	import { serviceDomId } from '$lib/host-view';
	import {
		canOpen,
		forcedNames,
		isEntryOpen,
		NO_CHOICES,
		openableNames,
		openReducer,
		readOpen,
		visitStorage,
		writeOpen,
		type OpenAction,
		type OpenState
	} from '$lib/catalog-open';
	import { catalogEntryMenuId } from '$lib/row-menu';
	import type {
		CatalogEditorState,
		CatalogPermissionsState,
		CatalogRunState,
		ImageDeployState,
		ImageEditorState
	} from '$lib/project-action';
	import {
		entryRef,
		ownerEntry,
		serviceControls,
		UNKNOWN_RUNTIME,
		type NotRunningPair,
		type ServiceControls
	} from '$lib/service-actions';
	import { serviceLabel } from '$lib/service-label';
	import {
		CATALOG_LOGS_PARAM,
		dropServiceLogs,
		serviceFilterKey,
		serviceLogsEntry,
		serviceLogsMissingNote,
		serviceLogsRow,
		serviceLogsStep
	} from '$lib/service-view';
	import {
		CATALOG_TABLE_ID,
		DEFAULT_PAGE_SIZE,
		hostFilterHiddenFields,
		pageHrefKeepingAll,
		filterHref,
		readFilters,
		readSearch,
		rowPage,
		visibleRows,
		tableParam,
		type Column
	} from '$lib/table';
	import { timeZoneSource } from '$lib/time-zone';
	import { actionUrlFrom, permissionsCloseHrefFor } from '$lib/url';
	import ServicesTable from './ServicesTable.svelte';
	import CatalogEntryRow from './CatalogEntryRow.svelte';
	import CatalogPermissions from './CatalogPermissions.svelte';

	const permissionsCloseHref = $derived(permissionsCloseHrefFor(page.url));

	/** The row under an entry that holds its services table. */
	function servicesRowId(entryId: string): string {
		return `services-${entryId}`;
	}

	const HOST_PARAM = tableParam(CATALOG_TABLE_ID, 'host');

	let {
		canOwner,
		canAdmin = false,
		entries,
		omitted,
		truncated,
		message,
		hosts,
		members,
		editor = null,
		permissions = null,
		imageEditor = null,
		imageDeploy = null,
		onImageSaved,
		projectId = '',
		copies = {},
		copiesComplete = true,
		copiesOmitted = 0,
		copiesMessage = null,
		statusCapped = false,
		initialOpen = [],
		notRunning = [],
		notRunningKnown = true,
		serviceStates = null,
		runResult = null,
		probe = null,
		probeServiceId = null,
		editorProbe = false,
		renameServiceId = null,
		typedName = null,
		healthServiceId = null,
		healthField = null,
		healthIndex = null,
		healthMessage = null,
		probeIndex = null,
		probeMessage = null,
		onHealthSaved
	}: {
		canOwner: boolean;
		canAdmin?: boolean;
		entries: CatalogEntry[];
		omitted: number;
		truncated: boolean;
		message: string | null;
		hosts: Host[];
		members: Member[];
		editor?: CatalogEditorState | null;
		permissions?: CatalogPermissionsState | null;
		imageEditor?: ImageEditorState | null;
		imageDeploy?: ImageDeployState | null;
		onImageSaved?: (name: string) => void;
		/** Copies of other projects never match it; also the Deploy drawer's "View logs" link. */
		projectId?: string;
		/** Running copies by entry name, in host-name order. */
		copies?: Record<string, ProjectServiceRow[]>;
		/** False when the copies could not be read: no entry then says it is not deployed. */
		copiesComplete?: boolean;
		copiesOmitted?: number;
		copiesMessage?: string | null;
		/** More container copies than the status read cap: the rest show an unknown state. */
		statusCapped?: boolean;
		/**
		 * Entries open on the first render, before the browser's stored choices are read (the server has no
		 * per-tab storage). The page passes none; tests use it to render open entries.
		 */
		initialOpen?: string[];
		/** Programs that never ran on a host that can run them. */
		notRunning?: NotRunningPair[];
		notRunningKnown?: boolean;
		/** Streamed container states by service id (see the load). Copies without one show "checking…". */
		serviceStates?: Promise<Record<string, ServiceRuntime>> | Record<string, ServiceRuntime> | null;
		/** The last start, stop, restart or logs action posted from this tab. */
		runResult?: CatalogRunState | null;
		probe?: ProbeView | null;
		probeServiceId?: string | null;
		editorProbe?: boolean;
		renameServiceId?: string | null;
		typedName?: string | null;
		healthServiceId?: string | null;
		healthField?: string | null;
		healthIndex?: number | null;
		healthMessage?: string | null;
		probeIndex?: number | null;
		probeMessage?: string | null;
		onHealthSaved?: (serviceId: string) => void;
	} = $props();

	const columns: Column<CatalogRow>[] = [
		// The arrow that shows the entry's services.
		{ key: 'toggle', label: 'Expand', srLabel: true },
		{
			key: 'name',
			label: 'Name',
			sortable: true,
			searchable: true,
			value: (row) => row.entry.name,
			// A copy's host or label finds its entry, which is then shown with all its copies.
			searchValue: (row) => `${row.entry.name}\n${copySearchText(row)}`
		},
		{
			key: 'kind',
			label: 'Kind',
			sortable: true,
			searchable: true,
			// Program, Service, Job, then by name.
			value: (row) => `${catalogKindInfo(row.entry).order}:${row.entry.name}`,
			searchValue: (row) => catalogKindInfo(row.entry).label,
			hideBelowSm: true,
			filter: { param: 'kind', label: 'Kind', options: CATALOG_KIND_OPTIONS, value: (row) => catalogKindOf(row.entry) }
		},
		{ key: 'command', label: 'Command', sortable: true, searchable: true, hideBelowSm: true, value: (row) => row.entry.command_display },
		// The copies' summary: not sortable (it changes as the states stream in).
		{ key: 'services', label: 'Services', hideBelowSm: true },
		{
			key: LAST_DEPLOYED_SORT,
			label: 'Last deployed',
			sortable: true,
			hideBelowSm: true,
			firstDir: 'desc',
			value: (row) => lastDeployedValue(row.entry)
		},
		{ key: 'actions', label: 'Actions', srLabel: true }
	];

	const sortableKeys = columns.filter((column) => column.sortable).map((column) => column.key);
	const tableDefaults = $derived(
		catalogDefaultSort(entries, page.url.searchParams.get(tableParam(CATALOG_TABLE_ID, 'sort')), sortableKeys)
	);

	const zones = timeZoneSource();
	/** One clock for every row, read again whenever the entries reload. */
	const now = $derived.by(() => {
		void entries;
		return Date.now();
	});

	const permissionEntry = $derived(permissions ? (entries.find((item) => item.name === permissions.name) ?? null) : null);

	// Host filter (`catalog.host`): owned hosts and deploy shares. Anything else is ignored with a notice.
	const serviceHosts = $derived(hostChoices(hosts));
	const hostFilter = $derived(chosenHost(page.url.searchParams.get(HOST_PARAM), serviceHosts));
	const selectedHost = $derived(hostFilter.hostId);
	const hostChosen = $derived(selectedHost != null);
	const hostNotice = $derived(hostFilter.notice);
	const hostHidden = $derived(hostFilterHiddenFields(page.url.searchParams, CATALOG_TABLE_ID));
	let hostValue = $state(untrack(() => (hostChosen && selectedHost ? selectedHost : 'all')));
	const hostLabel = $derived(
		hostValue === 'all' ? 'All hosts' : (serviceHosts.find((host) => host.id === hostValue)?.name ?? 'All hosts')
	);

	$effect(() => {
		hostValue = hostChosen && selectedHost ? selectedHost : 'all';
	});

	let filterForm = $state<HTMLFormElement | null>(null);

	// The phone Kind select writes the same `catalog.kind` as the Kind header filter.
	const kindFilter = $derived(readFilters(page.url.searchParams, CATALOG_TABLE_ID, columns).find((item) => item.param === 'kind') ?? null);
	const kindValue = $derived(kindFilter?.value ?? 'all');
	const kindLabel = $derived(kindFilter?.label ?? 'All kinds');

	function applyKind(value: string) {
		void goto(filterHref(page.url, CATALOG_TABLE_ID, 'kind', value === 'all' ? null : value), { keepFocus: true, noScroll: true });
	}

	// The host filter applies as soon as it changes. Wait for the hidden field to take the new value first.
	async function applyHost() {
		await tick();
		filterForm?.requestSubmit();
	}

	const refs = $derived(entries.map(entryRef).filter((entry) => entry.my_actions.length > 0));
	const rows = $derived(rowsOnHost(catalogRows(entries, copies, notRunning), selectedHost));

	const allCopies = $derived(Object.values(copies).flat());

	/**
	 * Last resolved states and the load they came from. A reload keeps them until the new read answers, so
	 * open dialogs stay put; a copy missing from them while the new read is pending shows a spinner.
	 */
	let states = $state<Record<string, ServiceRuntime> | null>(null);
	let statesFrom = $state.raw<unknown>(undefined);
	const statesPending = $derived(statesFrom !== serviceStates);
	/** One polite line for screen readers when the states have been read. */
	let statesNote = $state('');

	$effect(() => {
		const source = serviceStates;
		let live = true;
		const settle = (value: Record<string, ServiceRuntime>) => {
			if (!live) return;
			states = value;
			statesFrom = source;
			if (Object.keys(value).length > 0) statesNote = 'Service states updated.';
		};
		Promise.resolve(source ?? {}).then(settle, () => settle({}));
		return () => {
			live = false;
		};
	});

	/** The copy's state: from the row, or the streamed read once it answers. Null while still reading. */
	function runtimeOf(copy: ProjectServiceRow): ServiceRuntime | null {
		const known = copy.runtime ?? states?.[copy.id];
		if (known) return known;
		return statesPending ? null : UNKNOWN_RUNTIME;
	}

	/** Null: no actions (no grant on the entry). 'checking': its container state is still being read. */
	function controlsFor(copy: ProjectServiceRow): ServiceControls | 'checking' | null {
		const entry = ownerEntry(copy, projectId, refs);
		if (entry == null) return null;
		const runtime = runtimeOf(copy);
		if (runtime == null) return 'checking';
		return serviceControls(entry, copy.host_status, runtime);
	}

	/** The copy's badge word. A copy of an entry without a grant has no state read (`undefined`). */
	function copyStateOf(copy: ProjectServiceRow): CopyState {
		const read = ownerEntry(copy, projectId, refs) != null;
		return copyState(copy, read ? runtimeOf(copy) : (copy.runtime ?? undefined));
	}

	// Which entries are open (collapsed by default). The user's own choices are kept for the visit (per-tab
	// storage, per project); entries a filter or the "View logs" link opens are derived, never stored.
	const searchText = $derived(readSearch(page.url.searchParams.get(tableParam(CATALOG_TABLE_ID, 'q'))));
	let choices = $state.raw<OpenState>(untrack(() => openReducer(NO_CHOICES, { type: 'expand', names: initialOpen })));
	let storageRead = false;
	let choiceFilters = untrack(() => serviceFilterKey(page.url.searchParams));
	const entryNames = $derived(new Set(entries.map((entry) => entry.name)));

	function dispatch(action: OpenAction) {
		choices = openReducer(choices, action);
		writeOpen(visitStorage(), projectId, choices.open, entryNames);
	}

	$effect(() => {
		if (!browser || storageRead) return;
		storageRead = true;
		untrack(() => (choices = openReducer(choices, { type: 'restore', stored: readOpen(visitStorage(), projectId) })));
	});

	// A new search, host or Kind filter forgets which filter-opened entries the user closed.
	$effect(() => {
		const key = filterKey;
		if (key === choiceFilters) return;
		choiceFilters = key;
		untrack(() => (choices = openReducer(choices, { type: 'filters-changed' })));
	});

	// The Deploy drawer's "View logs" link (`catalog.logs`): highlight that copy and open its Logs once.
	const logsEntry = $derived(serviceLogsEntry(page.url.searchParams.get(CATALOG_LOGS_PARAM)));
	/**
	 * The navigation whose link was used: the copy was found and its controls were read. `replaceState`
	 * leaves `page.url` as it was, and a new navigation (even to the same link) gives a new one.
	 */
	let logsUsedOn = $state.raw<URL | null>(null);
	const logsDone = $derived(logsUsedOn === page.url);
	/** The highlighted copy and the filters it was chosen under. A new search, host, page or Kind drops it. */
	let selected = $state<{ id: string; filters: string } | null>(null);
	const filterKey = $derived(serviceFilterKey(page.url.searchParams));
	let dropTimer: ReturnType<typeof setTimeout> | null = null;
	const logsRequest = $derived(
		!logsDone && logsEntry != null && hostChosen && selectedHost ? { entry: logsEntry, hostId: selectedHost } : null
	);
	const logsTarget = $derived(logsRequest ? serviceLogsRow(allCopies, logsRequest, projectId) : null);

	const forced = $derived(forcedNames(rows, searchText, hostChosen, logsTarget?.catalog_entry ?? null));

	function isOpenEntry(name: string): boolean {
		return isEntryOpen(choices, name, forced);
	}

	function toggler(name: string): () => void {
		return () => dispatch({ type: 'toggle', name, forced: forced.has(name) });
	}

	// Expand all / Collapse all act on the entries on view (search, Kind filter, host filter and page).
	const shownNames = $derived(
		openableNames(visibleRows(rows, columns, page.url.searchParams, CATALOG_TABLE_ID, tableDefaults, DEFAULT_PAGE_SIZE))
	);
	const allOpen = $derived(shownNames.length > 0 && shownNames.every((name) => isOpenEntry(name)));

	function toggleAll() {
		dispatch({ type: allOpen ? 'collapse' : 'expand', names: shownNames });
	}

	/** The table page that shows the target's entry (null when the Kind filter or the search hides it). */
	const logsPage = $derived(
		logsTarget
			? rowPage(rows, columns, page.url.searchParams, CATALOG_TABLE_ID, tableDefaults, DEFAULT_PAGE_SIZE, (row) =>
					row.copies.some((copy) => copy.id === logsTarget.id)
				)
			: null
	);
	const currentId = $derived(
		selected != null && selected.filters === filterKey ? selected.id : (logsTarget?.id ?? null)
	);
	const logsMissing = $derived(
		logsRequest != null && (logsTarget == null || logsPage?.page == null) && message == null && copiesMessage == null
			? serviceLogsMissingNote(logsRequest.entry)
			: null
	);

	// Once the copy's controls are read (its drawer is open), keep the highlight, scroll to it, and drop
	// `catalog.logs` so a reload or Back does not open it again.
	$effect(() => {
		const copy = logsTarget;
		const request = logsRequest;
		if (!browser || request == null) return;
		const where = logsPage;
		// Re-run when entries open, since the copy's row shows only once its entry is open.
		void choices;
		void forced;
		const step = serviceLogsStep({
			done: logsDone,
			rowId: copy?.id ?? null,
			controls: copy ? controlsFor(copy) : null,
			page: where?.page ?? null,
			currentPage: where?.current ?? 1,
			// Effects run after the DOM update, so the row is there (and shown) once its entry is open.
			rendered: copy != null && isShown(document.getElementById(serviceDomId(copy.id)))
		});
		// The link opens its entry first (`forcedNames`), then selects the copy once its row shows.
		if (step === 'go-to-page' && where?.page != null) {
			// Keep `catalog.logs`: the request is used once the copy's row is on screen.
			const target = where.page;
			untrack(() => void goto(pageHrefKeepingAll(page.url, CATALOG_TABLE_ID, target), { replaceState: true, keepFocus: true, noScroll: true }));
			return;
		}
		if (step !== 'open-and-clear' || copy == null) return;
		untrack(() => {
			selected = { id: copy.id, filters: filterKey };
			logsUsedOn = page.url;
			document.getElementById(serviceDomId(copy.id))?.scrollIntoView({ block: 'center' });
			const pathname = page.url.pathname;
			// A macrotask, so the router has started when this runs during hydration.
			if (dropTimer != null) clearTimeout(dropTimer);
			dropTimer = setTimeout(() => {
				dropTimer = null;
				dropServiceLogs(new URL(location.href), pathname, request.entry, (href) => replaceState(href, page.state));
			}, 0);
		});
	});

	$effect(() => () => {
		if (dropTimer != null) clearTimeout(dropTimer);
	});

	/** In the page and not inside a collapsed (hidden) services row. */
	function isShown(element: HTMLElement | null): boolean {
		return element != null && element.closest('[hidden]') == null;
	}

	// Tailwind `sm`; the server renders the wide cell. The colspans are fixed (one cell per layout, see the
	// services row); this only picks which cell holds the table after the page has loaded.
	const wideQuery = new MediaQuery('min-width: 40rem', true);
	const wideSpan = columns.length - 1;
	const narrowSpan = columns.filter((column) => !column.hideBelowSm).length - 1;

	const probed = $derived(allCopies.find((copy) => copy.id === probeServiceId) ?? null);
	const emptyText = $derived(
		catalogEmptyText({
			hostChosen,
			searching: readSearch(page.url.searchParams.get(tableParam(CATALOG_TABLE_ID, 'q'))) !== '',
			kindFiltered: readFilters(page.url.searchParams, CATALOG_TABLE_ID, columns).length > 0,
			entries: entries.length
		})
	);
</script>

{#if message}
	<Notice kind="error">{message}</Notice>
{/if}
{#if copiesMessage}
	<Notice kind={copiesMessage === COPIES_CAPPED_NOTE ? 'info' : 'error'}>{copiesMessage}</Notice>
{/if}
{#if hostNotice}
	<Notice kind="error">{hostNotice}</Notice>
{/if}
{#if statusCapped}
	<Notice kind="info">{STATUS_CAPPED_NOTE}</Notice>
{/if}
<p class="sr-only" role="status" data-states-note>{statesNote}</p>
{#if logsMissing}
	<p class="text-muted-foreground mb-2 text-sm" role="status" data-logs-missing>{logsMissing}</p>
{/if}
{#if probe}
	<Card.Root class="mb-4" role="status">
		<Card.Header>
			<Card.Title>Probe</Card.Title>
		</Card.Header>
		<Card.Content>
			<dl class="grid gap-2 sm:grid-cols-2">
				<div><dt class="text-muted-foreground text-sm">Service</dt><dd>{probed ? serviceLabel(probed) : (probe.service ?? 'n/a')}</dd></div>
				<div><dt class="text-muted-foreground text-sm">Host</dt><dd>{probed?.host_name ?? 'n/a'}</dd></div>
				<div><dt class="text-muted-foreground text-sm">Check</dt><dd class="font-mono">{probe.protocol ?? 'n/a'} {probe.port ?? ''} {probe.path ?? ''}</dd></div>
				<div><dt class="text-muted-foreground text-sm">Result</dt><dd>{probe.result ?? 'n/a'}</dd></div>
				<div><dt class="text-muted-foreground text-sm">HTTP</dt><dd>{probe.http_status ?? 'n/a'}</dd></div>
				<div><dt class="text-muted-foreground text-sm">Latency</dt><dd>{formatLatency(probe.latency_ms)}</dd></div>
				<div><dt class="text-muted-foreground text-sm">Checked</dt><dd><LocalTime iso={probe.checked_at} /></dd></div>
			</dl>
		</Card.Content>
	</Card.Root>
{/if}
{#if omitted > 0}
	<p class="text-muted-foreground mb-2 text-sm">{omitted} more {omitted === 1 ? 'row' : 'rows'} left out.</p>
{/if}
{#if truncated}
	<p class="text-muted-foreground mb-2 text-sm">More items not shown</p>
{/if}
{#if copiesOmitted > 0}
	<p class="text-muted-foreground mb-2 text-sm">{copiesOmitted} more running {copiesOmitted === 1 ? 'copy' : 'copies'} left out.</p>
{/if}
{#if !notRunningKnown}
	<p class="text-muted-foreground mb-2 text-sm">Hosts a program never ran on could not be listed.</p>
{/if}
<h2 id="catalog-heading" class="sr-only">Catalog & services</h2>
<DataTable
	{rows}
	{columns}
	id={CATALOG_TABLE_ID}
	labelledBy="catalog-heading"
	empty={emptyText}
	rowKey={(row) => row.entry.id}
	searchLabel="Search name, kind, command, host or label"
	defaultSort={tableDefaults.sort}
	defaultDir={tableDefaults.dir}
>
	{#snippet toolbar()}
		<!-- Beside the search, on one wrapping row. A filter applies as soon as it changes. -->
		<form class="mb-3 grid min-w-0 basis-full gap-1.5 sm:w-56 sm:basis-auto" method="GET" action={page.url.pathname} bind:this={filterForm}>
			{#each hostHidden as field, index (index)}
				<Input type="hidden" name={field.name} value={field.value} />
			{/each}
			<Input type="hidden" name={HOST_PARAM} value={hostValue === 'all' ? '' : hostValue} />
			<Label for="catalog-host">Host</Label>
			<Select.Root type="single" bind:value={hostValue} onValueChange={applyHost}>
				<Select.Trigger id="catalog-host" class="w-full min-w-0">
					<Select.Value class="min-w-0 truncate" placeholder="All hosts">{hostLabel}</Select.Value>
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="all">All hosts</Select.Item>
					{#each serviceHosts as host (host.id)}
						<Select.Item value={host.id}>{host.name}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</form>
		<!-- Below sm the Kind column (and its header filter) hides, so the same filter is a select here. -->
		<div class="mb-3 grid min-w-0 basis-full gap-1.5 sm:hidden" data-kind-select>
			<Label for="catalog-kind">Kind</Label>
			<Select.Root type="single" value={kindValue} onValueChange={applyKind}>
				<Select.Trigger id="catalog-kind" class="w-full min-w-0">
					<Select.Value class="min-w-0 truncate" placeholder="All kinds">{kindLabel}</Select.Value>
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="all">All kinds</Select.Item>
					{#each CATALOG_KIND_OPTIONS as option (option.value)}
						<Select.Item value={option.value}>{option.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
		{#if shownNames.length > 0}
			<Button type="button" variant="outline" class="mb-3 max-sm:min-h-11" onclick={toggleAll} data-expand-all>
				{allOpen ? 'Collapse all' : 'Expand all'}
			</Button>
		{/if}
	{/snippet}
	{#snippet row(catalogRow)}
		{@const entry = catalogRow.entry}
		{@const opens = canOpen(catalogRow)}
		{@const isOpen = opens && isOpenEntry(entry.name)}
		<CatalogEntryRow
			{entry}
			summary={copySummary(catalogRow, copyStateOf)}
			{opens}
			{isOpen}
			controlsId={servicesRowId(entry.id)}
			onToggle={toggler(entry.name)}
			{canOwner}
			{canAdmin}
			{hosts}
			{projectId}
			{copiesComplete}
			editor={editor?.mode === 'edit' && editor.name === entry.name ? editor : null}
			imageEditor={imageEditor?.mode === 'edit' && imageEditor.name === entry.name ? imageEditor : null}
			imageDeploy={imageDeploy?.name === entry.name ? imageDeploy : null}
			{onImageSaved}
			{now}
			timeZone={zones?.current}
		/>
		{#if opens}
			<!-- The entry's services: one row, kept in the page (hidden) while collapsed so the arrow's aria-controls
			     always names it. Two cells: the wide one spans every column after the arrow and hides below sm; the
			     narrow one spans the columns shown below sm, so neither adds empty columns. The table renders in
			     one of them, and only while the entry is open. -->
			<tr id={servicesRowId(entry.id)} hidden={!isOpen} data-services-row={entry.name}>
				<td class={CATALOG_CELL.toggle}></td>
				<td colspan={wideSpan} class="px-2 pt-0 pb-3 align-top max-sm:hidden" data-services-cell="wide">
					{#if isOpen && wideQuery.current}{@render servicesOf(catalogRow)}{/if}
				</td>
				<td colspan={narrowSpan} class="px-2 pt-0 pb-3 align-top sm:hidden" data-services-cell="narrow">
					{#if isOpen && !wideQuery.current}{@render servicesOf(catalogRow)}{/if}
				</td>
			</tr>
		{/if}
	{/snippet}
</DataTable>
{#snippet servicesOf(catalogRow: CatalogRow)}
	<ServicesTable
		label="Services of {catalogRow.entry.name}"
		entry={catalogRow.entry.name}
		entryId={catalogRow.entry.id}
		busy={catalogRow.copies.some((copy) => copyStateOf(copy) === 'loading')}
		entryRef={refs.find((item) => item.name === catalogRow.entry.name) ?? null}
		copies={catalogRow.copies}
		idle={catalogRow.idle}
		{controlsFor}
		{runtimeOf}
		stateOf={copyStateOf}
		selectedId={currentId}
		logsOpenId={logsTarget?.id ?? null}
		{now}
		shared={{
			projectId,
			hosts,
			canAdmin,
			message,
			renameServiceId,
			typedName,
			healthServiceId,
			healthField,
			healthIndex,
			healthMessage,
			probe,
			probeServiceId,
			editorProbe,
			probeIndex,
			probeMessage,
			onHealthSaved,
			runResult
		}}
	/>
{/snippet}
{#if permissions}
	<CatalogPermissions
		action={actionUrlFrom(page.url, 'catalogPermissions')}
		name={permissions.name}
		grants={permissions.grants}
		{members}
		message={permissions.message}
		loaded={permissions.loaded}
		closeHref={permissionsCloseHref}
		returnFocusId={permissionEntry ? catalogEntryMenuId(permissionEntry.id) : null}
		includeDeploy={permissionEntry?.kind === 'image'}
	/>
{/if}
