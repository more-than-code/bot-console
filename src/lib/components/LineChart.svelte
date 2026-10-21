<script lang="ts">
	import { formatTick } from '$lib/format';
	import { timeZoneSource } from '$lib/time-zone';

	type ChartSeries = {
		label: string;
		color: string;
		values: Array<number | null>;
	};

	let {
		title,
		subtitle = null,
		times,
		series,
		format,
		yMin = null,
		yMax = null,
		bucketMs = 0
	}: {
		title: string;
		subtitle?: string | null;
		times: string[];
		series: ChartSeries[];
		format: (value: number) => string;
		yMin?: number | null;
		yMax?: number | null;
		bucketMs?: number;
	} = $props();

	const VB_W = 640;
	const VB_H = 220;
	const pad = { l: 84, r: 12, t: 14, b: 28 };

	let hover = $state<number | null>(null);
	const zones = timeZoneSource();

	const chartText: Record<string, string> = {
		'var(--chart-1)': 'text-chart-1',
		'var(--chart-2)': 'text-chart-2',
		'var(--chart-3)': 'text-chart-3',
		'var(--chart-4)': 'text-chart-4',
		'var(--chart-5)': 'text-chart-5'
	};
	const chartBg: Record<string, string> = {
		'var(--chart-1)': 'bg-chart-1',
		'var(--chart-2)': 'bg-chart-2',
		'var(--chart-3)': 'bg-chart-3',
		'var(--chart-4)': 'bg-chart-4',
		'var(--chart-5)': 'bg-chart-5'
	};

	const layout = $derived.by(() => {
		const zone = zones?.current;
		const count = Math.min(times.length, ...series.map((item) => item.values.length));
		const finite: number[] = [];
		for (const item of series) {
			for (let i = 0; i < count; i += 1) {
				const value = item.values[i];
				if (value != null && Number.isFinite(value)) finite.push(value);
			}
		}
		if (count === 0 || finite.length === 0) return null;

		const dataMin = Math.min(...finite);
		const dataMax = Math.max(...finite);
		let min = yMin ?? dataMin;
		let max = yMax == null ? dataMax : Math.max(yMax, dataMax);
		if (yMin == null) min = dataMin;
		if (min === max) max = min + 1;
		if (yMin == null) min -= (max - min) * 0.08;
		if (yMax == null) max += (max - min) * 0.08;
		if (min === max) max = min + 1;

		const plotW = VB_W - pad.l - pad.r;
		const plotH = VB_H - pad.t - pad.b;
		const t0 = Date.parse(times[0] ?? '');
		const t1 = Date.parse(times[count - 1] ?? '');
		const span = Number.isFinite(t0) && Number.isFinite(t1) ? t1 - t0 : 0;

		function xAt(index: number): number {
			if (span <= 0) return pad.l + plotW / 2;
			const t = Date.parse(times[index] ?? '');
			if (!Number.isFinite(t)) return pad.l;
			return pad.l + ((t - t0) / span) * plotW;
		}

		function yAt(value: number): number {
			return pad.t + ((max - value) / (max - min)) * plotH;
		}

		const yTicks = [0, 1, 2, 3].map((step) => {
			const value = max - ((max - min) * step) / 3;
			return { value, y: pad.t + (plotH * step) / 3 };
		});

		const xIndex = count === 1 ? [0] : [0, Math.floor((count - 1) / 2), count - 1];
		const xTicks = [...new Set(xIndex)].map((index) => ({
			x: xAt(index),
			label: formatTick(times[index] ?? '', span, zone)
		}));

		const drawn = series.map((item) => {
			const segments: Array<Array<{ x: number; y: number }>> = [];
			let current: Array<{ x: number; y: number }> = [];
			let prevT: number | null = null;
			for (let i = 0; i < count; i += 1) {
				const value = item.values[i];
				const t = Date.parse(times[i] ?? '');
				if (value == null || !Number.isFinite(value) || !Number.isFinite(t)) {
					if (current.length) segments.push(current);
					current = [];
					prevT = null;
					continue;
				}
				if (prevT != null && bucketMs > 0 && t - prevT > bucketMs * 2.5) {
					if (current.length) segments.push(current);
					current = [];
				}
				current.push({ x: xAt(i), y: yAt(value) });
				prevT = t;
			}
			if (current.length) segments.push(current);
			let latest: number | null = null;
			for (let i = count - 1; i >= 0; i -= 1) {
				const value = item.values[i];
				if (value != null && Number.isFinite(value)) {
					latest = value;
					break;
				}
			}
			return {
				label: item.label,
				color: item.color,
				segments,
				latestText: latest == null ? 'n/a' : format(latest)
			};
		});

		return { count, span, yTicks, xTicks, drawn, xAt, yAt };
	});

	const hoverDetail = $derived.by(() => {
		const zone = zones?.current;
		if (hover == null || !layout) return null;
		const index = hover;
		if (index < 0 || index >= layout.count) return null;
		return {
			label: formatTick(times[index] ?? '', layout.span, zone),
			x: layout.xAt(index),
			rows: series.map((item) => ({
				label: item.label,
				color: item.color,
				text: item.values[index] == null || !Number.isFinite(item.values[index])
					? 'n/a'
					: format(item.values[index] as number)
			}))
		};
	});

	function pointer(event: PointerEvent) {
		if (!layout) return;
		const svg = event.currentTarget as SVGSVGElement;
		const rect = svg.getBoundingClientRect();
		if (rect.width === 0) return;
		const viewX = ((event.clientX - rect.left) / rect.width) * VB_W;
		let nearest = 0;
		let best = Number.POSITIVE_INFINITY;
		for (let i = 0; i < layout.count; i += 1) {
			const distance = Math.abs(layout.xAt(i) - viewX);
			if (distance < best) {
				best = distance;
				nearest = i;
			}
		}
		hover = nearest;
	}
</script>

<figure class="bg-card relative min-w-0 rounded-xl p-3 ring-1 ring-foreground/10">
	<div class="mb-2 flex min-w-0 flex-wrap items-start justify-between gap-2">
		<div>
			<h2 class="text-base font-medium">{title}</h2>
			{#if subtitle}<p class="text-muted-foreground font-mono text-sm">{subtitle}</p>{/if}
		</div>
		<p class="flex flex-wrap gap-x-3 gap-y-1 text-sm">
			{#each layout?.drawn ?? [] as item (item.label)}
				<span class="inline-flex items-center gap-1.5">
					<span class="size-2 rounded-sm {chartBg[item.color] ?? 'bg-foreground'}"></span>
					{item.label}
					<span class="font-mono">{item.latestText}</span>
				</span>
			{/each}
		</p>
	</div>
	{#if !layout}
		<p class="text-muted-foreground text-sm">No data</p>
	{:else}
		<svg
			class="h-auto w-full"
			viewBox="0 0 {VB_W} {VB_H}"
			role="img"
			aria-label={title}
			onpointermove={pointer}
			onpointerleave={() => (hover = null)}
		>
			{#each layout.yTicks as tick (tick.y)}
				<line
					x1={pad.l}
					x2={VB_W - pad.r}
					y1={tick.y}
					y2={tick.y}
					stroke="var(--border)"
					stroke-width="1"
				/>
				<text x={pad.l - 8} y={tick.y + 4} text-anchor="end" fill="var(--muted-foreground)" font-size="12">
					{format(tick.value)}
				</text>
			{/each}
			{#each layout.drawn as item (item.label)}
				{#each item.segments as segment, segIndex (segIndex)}
					{#if segment.length === 1}
						<circle cx={segment[0].x} cy={segment[0].y} r="3.5" fill={item.color} />
					{:else}
						<polyline
							points={segment.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')}
							fill="none"
							stroke={item.color}
							stroke-width="2"
							stroke-linejoin="round"
							stroke-linecap="round"
						/>
					{/if}
				{/each}
			{/each}
			{#if hoverDetail}
				<line
					x1={hoverDetail.x}
					x2={hoverDetail.x}
					y1={pad.t}
					y2={VB_H - pad.b}
					stroke="var(--muted-foreground)"
					stroke-dasharray="3 3"
				/>
			{/if}
			{#each layout.xTicks as tick, index (index)}
				<text x={tick.x} y={VB_H - 8} text-anchor="middle" fill="var(--muted-foreground)" font-size="12">
					{tick.label}
				</text>
			{/each}
		</svg>
		{#if hoverDetail}
			<div
				class="bg-popover text-popover-foreground pointer-events-none absolute z-10 rounded-md px-2 py-1 text-xs shadow-md ring-1 ring-foreground/10"
				style="left: {Math.min(78, Math.max(18, (hoverDetail.x / VB_W) * 100))}%; top: 3.2rem"
			>
				<strong>{hoverDetail.label}</strong>
				{#each hoverDetail.rows as row (row.label)}
					<span class="block {chartText[row.color] ?? 'text-foreground'}">{row.label} {row.text}</span>
				{/each}
			</div>
		{/if}
	{/if}
</figure>
