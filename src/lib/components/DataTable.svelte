<script lang="ts" generics="Row">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import {
		applyTable,
		ariaSort,
		DEFAULT_PAGE_SIZE,
		pagerVisible,
		readTableQuery,
		searchHiddenFields,
		sortHref,
		tableHref,
		tableParam,
		type Column,
		type SortDir
	} from '$lib/table';
	import SearchField from './SearchField.svelte';

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
		searchLabel = ''
	}: {
		rows: readonly Row[];
		columns: Column<Row>[];
		id: string;
		pageSize?: number;
		labelledBy: string;
		empty: string;
		row: Snippet<[Row]>;
		/** Keeps form controls on the same record when the page or sort changes. */
		rowKey?: (row: Row) => string | number;
		defaultSort?: string | null;
		defaultDir?: SortDir;
		searchLabel?: string;
	} = $props();

	const query = $derived(readTableQuery(page.url.searchParams, id, columns, { sort: defaultSort, dir: defaultDir }));
	const view = $derived(applyTable(rows, columns, query, pageSize));
	const canSearch = $derived(columns.some((column) => column.searchable));
	const showPager = $derived(view.total > 0 && pagerVisible(view.total, pageSize, query.q));

	const labelText = $derived.by(() => {
		if (searchLabel) return searchLabel;
		const labels = columns.filter((column) => column.searchable).map((column) => column.label);
		if (labels.length <= 1) return `Search ${labels[0] ?? ''}`.trim();
		return `Search ${labels.slice(0, -1).join(', ')}, or ${labels[labels.length - 1]}`;
	});

	const hidden = $derived(searchHiddenFields(page.url.searchParams, id));

	function hrefFor(next: string | null): string {
		return tableHref(page.url, id, { q: next, page: null });
	}

	function sortName(column: Column<Row>): string {
		if (query.sort === column.key) return `Sorted by ${column.label}`;
		return `Sort by ${column.label}`;
	}
</script>

{#if canSearch}
	<SearchField
		q={query.q === '' ? null : query.q}
		label={labelText}
		name={tableParam(id, 'q')}
		action={page.url.pathname}
		{hidden}
		{hrefFor}
	/>
{/if}
{#if view.total === 0}
	<p class="empty">{empty}</p>
{:else}
	<div class="table-wrap">
		<table class="data" aria-labelledby={labelledBy}>
			<thead>
				<tr>
					{#each columns as column (column.key)}
						<th scope="col" class:num={column.numeric} aria-sort={ariaSort(column, query)}>
							{#if column.sortable}
								<a class="sort" href={sortHref(page.url, id, column, query)} aria-label={sortName(column)}>
									{#if column.srLabel}<span class="sr">{column.label}</span>{:else}{column.label}{/if}
								</a>
							{:else if column.srLabel}
								<span class="sr">{column.label}</span>
							{:else}
								{column.label}
							{/if}
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each view.rows as item, index (rowKey ? rowKey(item) : index)}
					{@render row(item)}
				{/each}
			</tbody>
		</table>
	</div>
	{#if showPager}
		<nav class="pager" aria-label="Pagination">
			<span>Showing {view.from}–{view.to} of {view.total}</span>
			{#if view.page > 1}
				<a href={tableHref(page.url, id, { page: view.page - 1 })}>Prev</a>
			{:else}
				<span class="pager-muted">Prev</span>
			{/if}
			{#if view.page < view.pages}
				<a href={tableHref(page.url, id, { page: view.page + 1 })}>Next</a>
			{:else}
				<span class="pager-muted">Next</span>
			{/if}
		</nav>
	{/if}
{/if}
