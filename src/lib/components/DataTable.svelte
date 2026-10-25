<script lang="ts" generics="Row">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import ArrowUpDown from '@lucide/svelte/icons/arrow-up-down';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button';
	import * as Table from '$lib/components/ui/table';
	import {
		applyTable,
		ariaSort,
		DEFAULT_PAGE_SIZE,
		filterHref,
		filterRows,
		pagerVisible,
		readFilters,
		readServerTableQuery,
		readTableQuery,
		searchHiddenFields,
		serverPageBounds,
		serverPagerText,
		serverPagerVisible,
		serverSearchHiddenFields,
		serverSortHref,
		serverTableHref,
		sortHref,
		tableHref,
		tableParam,
		type ActiveFilter,
		type Column,
		type ServerTable,
		type SortDir
	} from '$lib/table';
	import { cn } from '$lib/utils';
	import SearchField from './SearchField.svelte';
	import TableFilter from './TableFilter.svelte';

	let {
		rows,
		columns,
		id,
		pageSize = DEFAULT_PAGE_SIZE,
		labelledBy,
		empty,
		row,
		rowKey,
		defaultSort = null,
		defaultDir = 'asc',
		searchLabel = '',
		server = null,
		emptyExtra
	}: {
		rows: readonly Row[];
		columns: Column<Row>[];
		id: string;
		pageSize?: number;
		labelledBy: string;
		empty: string;
		row: Snippet<[Row]>;
		emptyExtra?: Snippet;
		/** Keeps form controls on the same record when the page or sort changes. */
		rowKey?: (row: Row) => string | number;
		defaultSort?: string | null;
		defaultDir?: SortDir;
		searchLabel?: string;
		/** Rows are already paged. Sort, search, and the pager write namespaced URL params. */
		server?: ServerTable | null;
	} = $props();

	const serverMode = $derived(server != null);
	const clientQuery = $derived(readTableQuery(page.url.searchParams, id, columns, { sort: defaultSort, dir: defaultDir }));
	const serverQuery = $derived(
		serverMode
			? readServerTableQuery(page.url.searchParams, id, columns, { sort: defaultSort ?? 'name', dir: defaultDir })
			: null
	);
	/** Header filters narrow client rows only. A server table has none (its API would have to filter). */
	const filters = $derived(serverMode ? [] : readFilters(page.url.searchParams, id, columns));
	const clientView = $derived(
		serverMode ? null : applyTable(filterRows(rows, columns, filters), columns, clientQuery, pageSize)
	);
	const bounds = $derived(
		server ? serverPageBounds(server.total, rows.length, server.prevCursor, server.nextCursor) : null
	);
	const shown = $derived(serverMode ? rows : (clientView?.rows ?? []));
	const canSearch = $derived(serverMode || columns.some((column) => column.searchable));
	const active = $derived(serverQuery ? { q: serverQuery.q, sort: serverQuery.sort, dir: serverQuery.dir } : clientQuery);
	const showPager = $derived(
		server && serverQuery
			? serverPagerVisible(server.total, rows.length, serverQuery.q, server.prevCursor, server.nextCursor)
			: (clientView?.total ?? 0) > 0 && pagerVisible(clientView?.total ?? 0, pageSize, clientQuery.q)
	);
	const pagerText = $derived(
		bounds
			? serverPagerText(bounds.from, bounds.to, bounds.total)
			: clientView
				? serverPagerText(clientView.from, clientView.to, clientView.total)
				: ''
	);

	const labelText = $derived.by(() => {
		if (searchLabel) return searchLabel;
		const labels = columns.filter((column) => column.searchable).map((column) => column.label);
		if (labels.length <= 1) return `Search ${labels[0] ?? ''}`.trim();
		return `Search ${labels.slice(0, -1).join(', ')}, or ${labels[labels.length - 1]}`;
	});

	const hidden = $derived(
		serverMode ? serverSearchHiddenFields(page.url.searchParams, id) : searchHiddenFields(page.url.searchParams, id)
	);

	function hrefFor(next: string | null): string {
		if (serverMode) return serverTableHref(page.url, id, { q: next });
		return tableHref(page.url, id, { q: next, page: null });
	}

	function sortLink(column: Column<Row>): string {
		if (serverQuery) return serverSortHref(page.url, id, column, serverQuery);
		return sortHref(page.url, id, column, clientQuery);
	}

	function cursorHref(cursor: string): string {
		return serverTableHref(page.url, id, { cursor });
	}

	function filterOf(column: Column<Row>): ActiveFilter | null {
		return filters.find((item) => item.column === column.key) ?? null;
	}

	/** Clears every active filter, keeping the other params. */
	const clearFiltersHref = $derived.by(() => {
		let href = `${page.url.pathname}${page.url.search}`;
		for (const item of filters) href = filterHref(new URL(href, page.url), id, item.param, null);
		return href;
	});

	function sortName(column: Column<Row>): string {
		if (active.sort === column.key) return `Sorted by ${column.label}`;
		return `Sort by ${column.label}`;
	}
</script>

{#snippet heading(column: Column<Row>)}
	{#if column.sortable}
		<Button
			href={sortLink(column)}
			variant="ghost"
			size="sm"
			class={column.numeric ? '-mr-2' : '-ml-2'}
			aria-label={sortName(column)}
		>
			{#if column.srLabel}<span class="sr-only">{column.label}</span>{:else}{column.label}{/if}
			{#if active.sort !== column.key}
				<ArrowUpDown class="text-muted-foreground size-3.5" aria-hidden="true" data-sort-icon="none" />
			{:else if active.dir === 'asc'}
				<ArrowUp class="size-3.5" aria-hidden="true" data-sort-icon="asc" />
			{:else}
				<ArrowDown class="size-3.5" aria-hidden="true" data-sort-icon="desc" />
			{/if}
		</Button>
	{:else if column.srLabel}
		<span class="sr-only">{column.label}</span>
	{:else}
		{column.label}
	{/if}
{/snippet}
{#snippet chips()}
	{#each filters as item (item.param)}
		<a
			href={filterHref(page.url, id, item.param, null)}
			class="border-border text-foreground hover:bg-muted focus-visible:ring-ring/50 inline-flex h-7 items-center gap-1 rounded-4xl border px-2.5 text-xs font-medium outline-none focus-visible:ring-3"
			>Filtered: {item.label}<span class="sr-only">{' (clear filter)'}</span><X class="size-3.5" aria-hidden="true" /></a
		>
	{/each}
{/snippet}
{#if canSearch}
	<SearchField
		q={active.q === '' ? null : active.q}
		label={labelText}
		name={tableParam(id, 'q')}
		action={page.url.pathname}
		{hidden}
		{hrefFor}
		extra={filters.length > 0 ? chips : undefined}
	/>
{/if}
{#if shown.length === 0 && filters.length === 0}
	<p class="text-muted-foreground text-sm">{empty}{#if emptyExtra}{@render emptyExtra()}{/if}</p>
{:else}
	<Table.Root aria-labelledby={labelledBy}>
		<Table.Header>
			<Table.Row>
				{#each columns as column (column.key)}
					<Table.Head
						scope="col"
						class={cn(column.numeric ? 'text-right' : undefined, column.hideBelowSm && 'max-sm:hidden') || undefined}
						aria-sort={ariaSort(column, active)}
					>
						{#if column.filter && !serverMode}
							<span class="inline-flex items-center">
								{@render heading(column)}
								<TableFilter
									label={column.filter.label}
									options={column.filter.options}
									current={filterOf(column)}
									hrefFor={(value) => filterHref(page.url, id, column.filter?.param ?? '', value)}
								/>
							</span>
						{:else}
							{@render heading(column)}
						{/if}
					</Table.Head>
				{/each}
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each shown as item, index (rowKey ? rowKey(item) : index)}
				{@render row(item)}
			{:else}
				<Table.Row>
					<Table.Cell colspan={columns.length} class="text-muted-foreground">
						No entries match this filter.
						<a class="text-primary underline-offset-4 hover:underline" href={clearFiltersHref}>Clear filter</a>
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
	{#if showPager}
		<nav class="pager mt-3 flex flex-wrap items-center gap-2 text-sm" aria-label="Pagination">
			<span>{pagerText}</span>
			{#if server}
				{#if server.prevCursor}
					<Button href={cursorHref(server.prevCursor)} variant="outline" size="sm">Prev</Button>
				{:else}
					<Button variant="outline" size="sm" disabled>Prev</Button>
				{/if}
				{#if server.nextCursor}
					<Button href={cursorHref(server.nextCursor)} variant="outline" size="sm">Next</Button>
				{:else}
					<Button variant="outline" size="sm" disabled>Next</Button>
				{/if}
			{:else if clientView}
				{#if clientView.page > 1}
					<Button href={tableHref(page.url, id, { page: clientView.page - 1 })} variant="outline" size="sm">Prev</Button>
				{:else}
					<Button variant="outline" size="sm" disabled>Prev</Button>
				{/if}
				{#if clientView.page < clientView.pages}
					<Button href={tableHref(page.url, id, { page: clientView.page + 1 })} variant="outline" size="sm">Next</Button>
				{:else}
					<Button variant="outline" size="sm" disabled>Next</Button>
				{/if}
			{/if}
		</nav>
	{/if}
{/if}
