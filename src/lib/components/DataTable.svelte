<script lang="ts">
	import type { Snippet } from 'svelte';

	type Column = {
		key: string;
		label: string;
		numeric?: boolean;
		/** Set on columns the API can sort. Others render as plain headers. */
		href?: string | null;
	};

	let {
		columns,
		sort,
		labelledBy,
		children
	}: {
		columns: Column[];
		sort: string | null;
		labelledBy: string;
		children: Snippet;
	} = $props();

	function sortName(column: Column): string {
		if (sort === column.key) return `Sorted by ${column.label}`;
		return `Sort by ${column.label}`;
	}
</script>

<div class="table-wrap">
	<table class="data" aria-labelledby={labelledBy}>
		<thead>
			<tr>
				{#each columns as column (column.key)}
					<th
						scope="col"
						class:num={column.numeric}
						aria-sort={column.href ? (sort === column.key ? 'other' : 'none') : undefined}
					>
						{#if column.href}
							<a class="sort" href={column.href} aria-label={sortName(column)}>{column.label}</a>
						{:else}
							{column.label}
						{/if}
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{@render children()}
		</tbody>
	</table>
</div>
