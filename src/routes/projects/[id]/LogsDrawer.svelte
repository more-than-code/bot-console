<script lang="ts">
	import { browser } from '$app/environment';
	import { deserialize } from '$app/forms';
	import { goto } from '$app/navigation';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import { tick, untrack } from 'svelte';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import RowAction from '$lib/components/RowAction.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import * as Sheet from '$lib/components/ui/sheet';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Switch } from '$lib/components/ui/switch';
	import { formatTime } from '$lib/format';
	import { DEFAULT_LOG_LINES, TRUNCATED_NOTE, linesKept, pickerChoices, type LinesState } from '$lib/log-lines';
	import { LogsLoader, canCopy, chooseLines, emptyLogsView, logsText, switchLive, type LogsView } from '$lib/logs-load';
	import { atBottom, logsAnnouncement, logsInfoLine, scrollAfterUpdate } from '$lib/log-view';
	import { LIVE_TIMEOUT_NOTE, createLogsPoller, type LiveEnd, type LogsPoller } from '$lib/logs-poll';
	import { RUN_ICON, RUN_LABEL } from '$lib/run-actions';
	import { timeZoneSource } from '$lib/time-zone';

	let {
		entryName,
		entryKind = 'program',
		hostId,
		hostName,
		action,
		tip,
		initialOpen = false
	}: {
		entryName: string;
		entryKind?: 'program' | 'image';
		/** The Services row's host. */
		hostId: string;
		hostName: string;
		/** The `catalogLogs` form action URL. */
		action: string;
		/** Extra hover sentence on the row button. */
		tip?: string;
		/** Open on mount (the Catalog Deploy dialog's "View logs in Services" link). Read once. */
		initialOpen?: boolean;
	} = $props();

	const Icon = RUN_ICON.logs;
	const label = RUN_LABEL.logs;
	const ids = $props.id();
	const titleId = `${ids}-title`;
	const liveId = `${ids}-live`;
	const linesId = `${ids}-lines`;
	const zones = timeZoneSource();

	let open = $state(untrack(() => initialOpen));
	let view = $state<LogsView>(emptyLogsView());
	/** Live's only owner. The switch shows it; `onLive` and the poller's end change it. */
	let live = $state(false);
	/** The Lines picker: 200 on every open; while Live is on, at most 500 and the choice Live replaced. */
	let lines = $state<LinesState>({ choice: DEFAULT_LOG_LINES, beforeLive: null });
	let newBelow = $state(false);
	let viewEl = $state<HTMLPreElement | null>(null);
	let slotEl = $state<HTMLSpanElement | null>(null);
	let poller: LogsPoller | null = null;
	let loader: LogsLoader | null = null;

	const text = $derived(logsText(view));
	const source = $derived(view.logs == null ? null : 'unit' in view.logs ? view.logs.unit : view.logs.container);
	const firstLoad = $derived(view.loading && view.logs == null && !view.error && !view.endNote);
	const announcement = $derived(logsAnnouncement({ error: view.error, endNote: view.endNote, firstLoad }));
	const choices = $derived(pickerChoices(entryKind, live));
	const info = $derived(logsInfoLine({ live, updated: view.updatedAt ? formatTime(view.updatedAt, zones?.current) : null }));

	// Opening fetches at once; closing stops Live, drops any answer still on its way, and clears the view.
	$effect(() => {
		if (!browser || !open) return;
		const { current, polls } = untrack(() => {
			const current = new LogsLoader({
				fetch,
				deserialize,
				goto,
				origin: location.origin,
				form: { action, name: entryName, hostId, entryKind },
				onChange: onViewChange
			});
			const polls = createLogsPoller({ load: (manual) => current.load(manual), doc: document, onLiveEnd });
			loader = current;
			poller = polls;
			current.open();
			void polls.refresh(true);
			return { current, polls };
		});
		return () => {
			polls.dispose();
			current.close();
			poller = null;
			loader = null;
			live = false;
			lines = { choice: DEFAULT_LOG_LINES, beforeLive: null };
			newBelow = false;
		};
	});

	function onLive(on: boolean) {
		live = on;
		if (loader && poller) lines = switchLive({ loader, poller }, lines, on);
	}

	function onLines(value: string) {
		const next = Number(value);
		if (!choices.includes(next)) return;
		if (loader && poller) lines = chooseLines({ loader, poller }, next, live);
	}

	/** Live ended by itself: the picker keeps 500, and the user can pick again. */
	function onLiveEnd(reason: LiveEnd) {
		live = false;
		lines = linesKept(lines);
		if (reason === 'timeout') loader?.endLive(LIVE_TIMEOUT_NOTE);
	}

	/** New lines replace the view. The end stays in view when it was; otherwise the position is kept. */
	async function onViewChange(next: LogsView) {
		const wasAtBottom = viewEl == null || atBottom(viewEl);
		const changed = next.logs !== view.logs && logsText(next) !== text;
		view = next;
		if (next.logs == null) return;
		await tick();
		const move = scrollAfterUpdate(wasAtBottom, changed);
		if (move === 'follow') scrollToEnd();
		else if (move === 'notify') newBelow = true;
	}

	function scrollToEnd() {
		if (viewEl) viewEl.scrollTop = viewEl.scrollHeight;
		newBelow = false;
	}

	/** Focus moves to the log view before the button goes away. */
	function jumpToEnd() {
		viewEl?.focus();
		scrollToEnd();
	}

	function onRefresh(event: MouseEvent) {
		if (view.loading) {
			event.preventDefault();
			return;
		}
		void poller?.refresh(true);
	}

	function onScroll() {
		if (newBelow && viewEl && atBottom(viewEl)) newBelow = false;
	}

	function onOpenAutoFocus(event: Event) {
		event.preventDefault();
		document.getElementById(titleId)?.focus();
	}

	/** Back to this row's Logs button. */
	function onCloseAutoFocus(event: Event) {
		event.preventDefault();
		slotEl?.querySelector('button')?.focus();
	}
</script>

<Sheet.Root bind:open>
	<span bind:this={slotEl} class="inline-flex" data-logs-slot>
		<RowAction label="{label} {entryName} on {hostName}" {tip} icon={Icon}>
			{#snippet trigger(props)}
				<Sheet.Trigger {...props}>
					<Icon class="size-4" />
				</Sheet.Trigger>
			{/snippet}
		</RowAction>
	</span>
	<Sheet.Content side="right" class="data-[side=right]:w-full data-[side=right]:sm:max-w-2xl" {onOpenAutoFocus} {onCloseAutoFocus}>
		<Sheet.Header class="pr-12 pb-0">
			<Sheet.Title id={titleId} tabindex={-1} class="break-all focus-visible:outline-none">{label} {entryName}</Sheet.Title>
			<Sheet.Description class="break-all">
				On {hostName}.
				{#if source}<span class="font-mono">{source}</span>{/if}
			</Sheet.Description>
		</Sheet.Header>
		<div class="flex flex-wrap items-center gap-3 px-4">
			<CopyButton value={text} label="Copy" disabled={!canCopy(view)} />
			<Button
				type="button"
				variant="outline"
				size="sm"
				aria-disabled={view.loading ? 'true' : undefined}
				aria-busy={view.spinning ? 'true' : undefined}
				onclick={onRefresh}
			>
				<RefreshCw class="size-4 {view.spinning ? 'motion-safe:animate-spin' : ''}" />Refresh
			</Button>
			<div class="flex items-center gap-2">
				<Label for={linesId}>Lines</Label>
				<Select.Root type="single" value={String(lines.choice)} onValueChange={onLines}>
					<Select.Trigger id={linesId} size="sm" class="w-24">
						<Select.Value>{lines.choice}</Select.Value>
					</Select.Trigger>
					<Select.Content>
						{#each choices as choice (choice)}
							<Select.Item value={String(choice)}>{choice}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			<div class="flex items-center gap-2">
				<Switch id={liveId} checked={live} onCheckedChange={onLive} />
				<Label for={liveId}>Live</Label>
			</div>
		</div>
		<div class="grid gap-1 px-4 text-sm">
			<!-- Always present, so screen readers hear each change. The first-load message is for them only. -->
			<p role="status" class="break-words {view.error ? '' : 'text-muted-foreground'}">
				{#if firstLoad}
					<span class="sr-only">{announcement}</span>
				{:else}
					{announcement}
				{/if}
			</p>
			<p class="text-muted-foreground min-h-5" data-logs-info>{info}</p>
		</div>
		<div class="relative flex min-h-0 flex-1 flex-col gap-2 px-4 pb-4" translate="no">
			{#if view.logs == null}
				{#if !view.error}
					<div class="grid gap-2" aria-hidden="true" data-logs-skeleton>
						{#each [0, 1, 2, 3, 4, 5] as row (row)}
							<Skeleton class="h-4 w-full" />
						{/each}
					</div>
				{/if}
			{:else if view.logs.lines.length === 0}
				<p class="text-muted-foreground text-sm">No log lines.</p>
			{:else}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<pre
					bind:this={viewEl}
					role="region"
					tabindex="0"
					aria-label="Log lines"
					onscroll={onScroll}
					class="bg-muted min-h-0 flex-1 overflow-auto rounded-lg p-2 font-mono text-xs break-all whitespace-pre-wrap focus-visible:ring-3 focus-visible:ring-ring">{text}</pre>
				{#if newBelow}
					<Button type="button" size="sm" class="absolute right-8 bottom-8" onclick={jumpToEnd}>
						<ArrowDown class="size-4" />New lines below
					</Button>
				{/if}
			{/if}
			{#if view.logs?.truncated}
				<p class="text-muted-foreground text-sm">{TRUNCATED_NOTE}</p>
			{/if}
		</div>
	</Sheet.Content>
</Sheet.Root>
