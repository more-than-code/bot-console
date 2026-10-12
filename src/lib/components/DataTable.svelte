<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { SortDir } from '$lib/table-query';

	type Column = {
		key: string;
		label: string;
		numeric?: boolean;
		/** Direction used the first time this column is chosen. */
		defaultDir?: SortDir;
	};

	let {
		columns,
		sort,
		dir,
		page,
		pageSize,
		total,
		labelledBy,
		sortHref,
		pageHref,
		body
	}: {
		columns: Column[];
		sort: string;
		dir: SortDir;
		page: number;
		pageSize: number;
		total: number;
		labelledBy: string;
		sortHref: (key: string, dir: SortDir) => string;
		pageHref: (page: number) => string;
		body: Snippet;
	} = $props();

	const from = $derived(total === 0 || (page - 1) * pageSize >= total ? 0 : (page - 1) * pageSize + 1);
	const to = $derived(from === 0 ? 0 : Math.min(page * pageSize, total));
	const pages = $derived(Math.max(1, Math.ceil(total / pageSize)));

	function nextDir(column: Column): SortDir {
		if (sort !== column.key) return column.defaultDir ?? 'asc';
		return dir === 'asc' ? 'desc' : 'asc';
	}

	function sortName(column: Column, next: SortDir): string {
		const direction = next === 'asc' ? 'ascending' : 'descending';
		if (sort !== column.key) return `Sort by ${column.label}, ${direction}`;
		const current = dir === 'asc' ? 'ascending' : 'descending';
		return `Sort by ${column.label}, ${current}. Activate to sort ${direction}.`;
	}
</script>

<div class="table-wrap">
	<table class="data" aria-labelledby={labelledBy}>
		<thead>
			<tr>
				{#each columns as column (column.key)}
					{@const next = nextDir(column)}
					<th
						scope="col"
						class:num={column.numeric}
						aria-sort={sort === column.key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
					>
						<a class="sort" href={sortHref(column.key, next)} aria-label={sortName(column, next)}>
							{column.label}
							{#if sort === column.key}
								<span aria-hidden="true">{dir === 'asc' ? '▲' : '▼'}</span>
							{/if}
						</a>
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{@render body()}
		</tbody>
	</table>
</div>
<nav class="pager" aria-label="Pagination">
	{#if page > 1}
		<a href={pageHref(page - 1)}>Previous</a>
	{:else}
		<span class="pager-muted">Previous</span>
	{/if}
	<span>Showing {from}–{to} of {total}</span>
	{#if page < pages}
		<a href={pageHref(page + 1)}>Next</a>
	{:else}
		<span class="pager-muted">Next</span>
	{/if}
</nav>
