<script lang="ts">
	import { browser } from '$app/environment';
	import { enhance } from '$app/forms';
	import Activity from '@lucide/svelte/icons/activity';
	import HeartPulse from '@lucide/svelte/icons/heart-pulse';
	import { tick, untrack } from 'svelte';
	import type { DockerCheckView, Health, HealthCheck, ProbeView } from '$lib/api-types';
	import LocalTime from '$lib/components/LocalTime.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import RowAction from '$lib/components/RowAction.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import { formDialogOutcome } from '$lib/dialog-open';
	import { formatLatency } from '$lib/format';
	import DockerHealthNote from './DockerHealthNote.svelte';
	import {
		HEALTH_CHECK_LIMIT,
		HEALTH_CHECK_NOTE,
		HEALTH_FORM,
		UNREAD_HEALTH_CHECKS,
		addCheckLabel,
		addablePorts,
		addTcpCheck,
		draftFromChecks,
		emptyChecksText,
		healthChecksSaveState,
		healthFailureOutcome,
		healthFormRows,
		healthNoticeOnCloseComplete,
		probeRequestBody,
		removeCheck,
		scheduleHealthCloseFallback,
		setCheckPort,
		setCheckProtocol,
		validateHealthChecks,
		type CheckDraft,
		type CheckField,
		type CheckIssue
	} from '$lib/health-checks';

	let {
		action,
		probeAction,
		serviceId,
		rowLabel,
		ports,
		checks,
		checksMessage = null,
		health,
		catalogEntry = null,
		dockerCheck = null,
		failed = false,
		serverField = null,
		serverIndex = null,
		serverMessage = null,
		probe = null,
		probeIndex = null,
		probeMessage = null,
		showProbe = false,
		onSaved,
		onOpened
	}: {
		action: string;
		probeAction: string;
		serviceId: string;
		rowLabel: string;
		ports: number[];
		checks: HealthCheck[];
		/** Set when this row's checks could not be read. The control stays disabled. */
		checksMessage?: string | null;
		health: Health | null;
		/** This project's catalog entry for the row, or null (another project's row gets null). */
		catalogEntry?: string | null;
		/** What Docker runs, when the row has Docker health and the catalog was read. */
		dockerCheck?: DockerCheckView;
		failed?: boolean;
		serverField?: string | null;
		serverIndex?: number | null;
		serverMessage?: string | null;
		probe?: ProbeView | null;
		probeIndex?: number | null;
		probeMessage?: string | null;
		showProbe?: boolean;
		onSaved?: (serviceId: string | null) => void;
		onOpened?: () => void;
	} = $props();

	let open = $state(untrack(() => failed));
	let wasOpen = $state(false);
	let drafts = $state<CheckDraft[]>(untrack(() => draftFromChecks(checks)));
	let issues = $state<CheckIssue[]>([]);
	let redundancy = $state<string | null>(null);
	let ignoreServer = $state(false);
	let nextKey = $state(1);
	let pendingSaved = $state<string | null>(null);
	let sawProbe = $state(false);
	let dismissedProbeText = $state<string | null>(null);
	// Resolved when bits-ui finishes closing, so the notice is not inside the dialog.
	let closeWait: (() => void) | null = null;

	const formRows = $derived(healthFormRows(drafts));
	const suggestions = $derived(addablePorts(ports, drafts));
	const emptyText = $derived(emptyChecksText(ports, drafts));
	const checksIssue = $derived(shown(null, 'checks'));
	const unread = $derived(checksMessage != null);

	$effect(() => {
		const now = open;
		const previous = untrack(() => wasOpen);
		if (!previous && now) {
			if (!untrack(() => failed)) {
				drafts = draftFromChecks(untrack(() => checks));
				issues = [];
				redundancy = null;
				ignoreServer = true;
			}
			onOpened?.();
		}
		wasOpen = now;
	});

	// A new editor probe opens the dialog once. Closing it stays closed while that result is still current.
	$effect(() => {
		const show = showProbe;
		if (show && !untrack(() => sawProbe)) open = true;
		sawProbe = show;
	});

	$effect(() => {
		if (!showProbe || probe == null || probeIndex == null || !browser) return;
		document.getElementById(fieldId(probeIndex, 'probe'))?.scrollIntoView({ block: 'nearest' });
	});

	function shown(index: number | null, field: CheckField): string | null {
		const local = issues.find((issue) => issue.field === field && issue.index === index);
		if (local) return local.message;
		if (ignoreServer || !failed || !serverMessage || serverField !== field) return null;
		if (serverIndex == null) return index === firstIndex(field) ? serverMessage : null;
		return serverIndex === index ? serverMessage : null;
	}

	function firstIndex(field: CheckField): number | null {
		if (field === 'checks' || field === 'form') return null;
		if (field === 'path' || field === 'expect') {
			const http = drafts.findIndex((row) => row.protocol === 'http');
			return http === -1 ? 0 : http;
		}
		return 0;
	}

	function touch() {
		issues = [];
		ignoreServer = true;
		dismissedProbeText = probeMessage;
	}

	function apply(next: { drafts: CheckDraft[]; notice: string | null }) {
		drafts = next.drafts;
		if (next.notice) redundancy = next.notice;
		touch();
	}

	function onProtocol(index: number, value: string | undefined) {
		if (value !== 'tcp' && value !== 'http') return;
		apply(setCheckProtocol(drafts, index, value));
	}

	function onPort(index: number, value: string | undefined) {
		if (value == null || !/^(0|[1-9]\d{0,5})$/.test(value)) return;
		apply(setCheckPort(drafts, index, Number(value)));
	}

	function patch(index: number, partial: Partial<CheckDraft>) {
		drafts = drafts.map((row, i) => (i === index ? { ...row, ...partial } : row));
		touch();
	}

	function typedInt(raw: string): number | null {
		if (raw === '') return null;
		if (!/^(0|[1-9]\d{0,5})$/.test(raw)) return null;
		return Number(raw);
	}

	function addSuggested(port: number) {
		const key = `new-${nextKey}`;
		nextKey += 1;
		apply(addTcpCheck(drafts, port, key));
	}

	function removeAt(index: number) {
		drafts = removeCheck(drafts, index);
		touch();
	}

	function finishClose(isOpen: boolean) {
		const next = healthNoticeOnCloseComplete(pendingSaved, isOpen);
		pendingSaved = next.pending;
		if (next.announce != null) onSaved?.(next.announce);
		if (!isOpen) {
			closeWait?.();
			closeWait = null;
		}
	}

	function fieldId(index: number, name: string): string {
		return `hc-${serviceId}-${index}-${name}`;
	}

	function errorId(index: number | null, field: string): string {
		return index == null ? `hc-${serviceId}-${field}-error` : `hc-${serviceId}-${index}-${field}-error`;
	}

	function describedBy(index: number, field: CheckField): string | undefined {
		return shown(index, field) ? errorId(index, field) : undefined;
	}

	function firstInvalidTarget(): string | null {
		for (let index = 0; index < drafts.length; index += 1) {
			if (shown(index, 'protocol')) return fieldId(index, 'protocol');
			if (shown(index, 'port')) return ports.length === 0 ? errorId(index, 'port') : fieldId(index, 'port');
			if (shown(index, 'path')) return fieldId(index, 'path');
			if (shown(index, 'interval')) return fieldId(index, 'interval');
			if (shown(index, 'expect')) return fieldId(index, 'expect-min');
		}
		if (checksIssue) return errorId(null, 'checks');
		if (shown(null, 'form')) return errorId(null, 'form');
		return null;
	}

	async function focusInvalid() {
		await tick();
		if (!browser) return;
		const id = firstInvalidTarget();
		if (!id) return;
		const node = document.getElementById(id) ?? document.getElementById(`${id}-error`);
		node?.focus();
		node?.scrollIntoView({ block: 'nearest' });
	}

	function textField(data: unknown, key: 'healthMessage' | 'healthField'): string | null {
		if (data == null || typeof data !== 'object' || !(key in data)) return null;
		const value = (data as Record<string, unknown>)[key];
		return typeof value === 'string' ? value : null;
	}
</script>

{#if unread}
	<RowAction label={UNREAD_HEALTH_CHECKS} icon={HeartPulse} disabled />
{:else}
<Dialog.Root bind:open onOpenChangeComplete={finishClose}>
	<RowAction label="Health checks {rowLabel}" icon={HeartPulse}>
		{#snippet trigger(props)}
			<Dialog.Trigger {...props}>
				<HeartPulse class="size-4" />
			</Dialog.Trigger>
		{/snippet}
	</RowAction>
	<Dialog.Content class="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-xl">
		<Dialog.Header class="shrink-0 pr-8">
			<Dialog.Title>Health checks</Dialog.Title>
			<Dialog.Description>{HEALTH_CHECK_NOTE}</Dialog.Description>
		</Dialog.Header>
		<div class="grid min-h-0 gap-3 overflow-y-auto">
			{#if health?.source === 'docker'}
				<p class="text-sm">Docker reports this container's health; the checks below are used only when Docker has none.</p>
				<DockerHealthNote {dockerCheck} {catalogEntry} onNavigate={() => (open = false)} />
			{/if}
			<p class="text-sm">
				Latest result
				<StatusBadge status={health?.status ?? 'unknown'} />
				<span class="text-muted-foreground"><LocalTime iso={health?.last_checked_at ?? null} /></span>
				{#if health?.latency_ms != null}
					<span class="text-muted-foreground">{formatLatency(health.latency_ms)}</span>
				{/if}
			</p>
			{#if redundancy}
				<Notice kind="info">{redundancy}</Notice>
			{/if}
			{#if checksIssue || shown(null, 'form')}
				<Notice kind="error">
					{#if checksIssue}
						<span id={errorId(null, 'checks')} tabindex="-1" class="focus-visible:ring-3 focus-visible:ring-ring">{checksIssue}</span>
					{/if}
					{#if shown(null, 'form')}
						<span id={errorId(null, 'form')} tabindex="-1" class="focus-visible:ring-3 focus-visible:ring-ring">{shown(null, 'form')}</span>
					{/if}
				</Notice>
			{/if}
			{#if emptyText}
				<p class={ports.length === 0 ? 'text-sm' : 'text-muted-foreground text-sm'}>{emptyText}</p>
			{/if}
			{#each drafts as row, index (row.key)}
				<div class="grid gap-2 rounded-lg border border-border p-2">
					<div class="grid gap-2 sm:grid-cols-2">
						<div class="grid gap-1.5">
							<Label for={fieldId(index, 'protocol')}>Protocol</Label>
							<Select.Root type="single" value={row.protocol} onValueChange={(value) => onProtocol(index, value)}>
								<Select.Trigger
									id={fieldId(index, 'protocol')}
									class="w-full"
									aria-invalid={shown(index, 'protocol') != null ? true : undefined}
									aria-describedby={describedBy(index, 'protocol')}
								>
									<Select.Value>{row.protocol === 'http' ? 'HTTP' : 'TCP'}</Select.Value>
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="tcp">TCP</Select.Item>
									<Select.Item value="http">HTTP</Select.Item>
								</Select.Content>
							</Select.Root>
							{#if shown(index, 'protocol')}
								<Notice kind="error"><span id={errorId(index, 'protocol')}>{shown(index, 'protocol')}</span></Notice>
							{/if}
						</div>
						<div class="grid gap-1.5">
							<Label for={fieldId(index, 'port')}>Port</Label>
							{#if ports.length === 0}
								<span class="text-muted-foreground text-sm">This service has no ports.</span>
							{:else}
								<Select.Root
									type="single"
									value={row.port == null ? '' : String(row.port)}
									onValueChange={(value) => onPort(index, value)}
								>
									<Select.Trigger
										id={fieldId(index, 'port')}
										class="w-full"
										aria-invalid={shown(index, 'port') != null ? true : undefined}
										aria-describedby={describedBy(index, 'port')}
									>
										<Select.Value placeholder="Port">{row.port ?? 'Port'}</Select.Value>
									</Select.Trigger>
									<Select.Content>
										{#each ports as port, portIndex (`${port}-${portIndex}`)}
											<Select.Item value={String(port)}>{port}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							{/if}
							{#if shown(index, 'port')}
								<Notice kind="error"><span id={errorId(index, 'port')}>{shown(index, 'port')}</span></Notice>
							{/if}
						</div>
					</div>
					{#if row.protocol === 'http'}
						<Label class="grid gap-1.5" for={fieldId(index, 'path')}>
							Path
							<Input
								id={fieldId(index, 'path')}
								type="text"
								autocomplete="off"
								value={row.path}
								aria-invalid={shown(index, 'path') != null ? true : undefined}
								aria-describedby={describedBy(index, 'path')}
								oninput={(event) => patch(index, { path: event.currentTarget.value })}
							/>
						</Label>
						{#if shown(index, 'path')}
							<Notice kind="error"><span id={errorId(index, 'path')}>{shown(index, 'path')}</span></Notice>
						{/if}
					{/if}
					<Label class="grid gap-1.5" for={fieldId(index, 'interval')}>
						Interval (seconds)
						<Input
							id={fieldId(index, 'interval')}
							type="text"
							inputmode="numeric"
							autocomplete="off"
							value={row.intervalSec == null ? '' : String(row.intervalSec)}
							aria-invalid={shown(index, 'interval') != null ? true : undefined}
							aria-describedby={describedBy(index, 'interval')}
							oninput={(event) => patch(index, { intervalSec: typedInt(event.currentTarget.value) })}
						/>
					</Label>
					{#if shown(index, 'interval')}
						<Notice kind="error"><span id={errorId(index, 'interval')}>{shown(index, 'interval')}</span></Notice>
					{/if}
					{#if row.protocol === 'http'}
						<div class="grid gap-2 sm:grid-cols-2">
							<Label class="grid gap-1.5" for={fieldId(index, 'expect-min')}>
								Expected status min
								<Input
									id={fieldId(index, 'expect-min')}
									type="text"
									inputmode="numeric"
									autocomplete="off"
									value={row.expectMin == null ? '' : String(row.expectMin)}
									aria-invalid={shown(index, 'expect') != null ? true : undefined}
									aria-describedby={describedBy(index, 'expect')}
									oninput={(event) => patch(index, { expectMin: typedInt(event.currentTarget.value) })}
								/>
							</Label>
							<Label class="grid gap-1.5" for={fieldId(index, 'expect-max')}>
								Expected status max
								<Input
									id={fieldId(index, 'expect-max')}
									type="text"
									inputmode="numeric"
									autocomplete="off"
									value={row.expectMax == null ? '' : String(row.expectMax)}
									aria-invalid={shown(index, 'expect') != null ? true : undefined}
									aria-describedby={describedBy(index, 'expect')}
									oninput={(event) => patch(index, { expectMax: typedInt(event.currentTarget.value) })}
								/>
							</Label>
						</div>
						{#if shown(index, 'expect')}
							<Notice kind="error"><span id={errorId(index, 'expect')}>{shown(index, 'expect')}</span></Notice>
						{/if}
					{/if}
					{#if probeMessage && probeMessage !== dismissedProbeText && probeIndex === index}
						<Notice kind="error"><span id={fieldId(index, 'probe-error')}>{probeMessage}</span></Notice>
					{/if}
					{#if showProbe && probe && probeIndex === index}
						<Notice kind="info">
							<div id={fieldId(index, 'probe')}>
								<dl class="grid gap-2 sm:grid-cols-2">
									<div><dt class="text-muted-foreground text-sm">Service</dt><dd>{probe.service ?? 'n/a'}</dd></div>
									<div><dt class="text-muted-foreground text-sm">Protocol</dt><dd>{probe.protocol ?? 'n/a'}</dd></div>
									<div><dt class="text-muted-foreground text-sm">Port</dt><dd>{probe.port ?? 'n/a'}</dd></div>
									<div><dt class="text-muted-foreground text-sm">Path</dt><dd>{probe.path ?? 'n/a'}</dd></div>
									<div><dt class="text-muted-foreground text-sm">Result</dt><dd>{probe.result ?? 'n/a'}</dd></div>
									<div><dt class="text-muted-foreground text-sm">HTTP</dt><dd>{probe.http_status ?? 'n/a'}</dd></div>
									<div><dt class="text-muted-foreground text-sm">Latency</dt><dd>{formatLatency(probe.latency_ms)}</dd></div>
									<div><dt class="text-muted-foreground text-sm">Checked</dt><dd><LocalTime iso={probe.checked_at} /></dd></div>
								</dl>
							</div>
						</Notice>
					{/if}
					<Label class="flex items-center gap-2">
						<Checkbox checked={row.enabled} onCheckedChange={(value) => patch(index, { enabled: value === true })} />
						Enabled
					</Label>
					<form
						method="POST"
						action={probeAction}
						use:enhance={({ cancel }) => {
							const built = probeRequestBody({
								protocol: row.protocol,
								port: row.port == null ? '' : String(row.port),
								path: row.path,
								ports
							});
							if (!built.ok) {
								issues = [{ index, field: built.field, message: built.message }];
								cancel();
								void focusInvalid();
								return;
							}
							return async ({ result, update }) => {
								if (result.type === 'failure') {
									issues = [];
									ignoreServer = false;
									dismissedProbeText = null;
								}
								await update({ reset: false });
							};
						}}
					>
						<Input type="hidden" name="service_id" value={serviceId} />
						<Input type="hidden" name="probe_index" value={String(index)} />
						<Input type="hidden" name="protocol" value={row.protocol} />
						<Input type="hidden" name="port" value={row.port ?? ''} />
						<Input type="hidden" name="path" value={row.protocol === 'http' ? row.path : ''} />
						<RowAction type="submit" label="Probe draft {row.protocol} {row.port ?? ''}" icon={Activity} />
					</form>
					<Button type="button" variant="outline" onclick={() => removeAt(index)}>Remove</Button>
				</div>
			{/each}
			{#if suggestions.length > 0}
				<div class="flex flex-wrap gap-2">
					{#each suggestions as port (port)}
						<Button type="button" variant="outline" disabled={drafts.length >= HEALTH_CHECK_LIMIT} onclick={() => addSuggested(port)}>
							{addCheckLabel(port)}
						</Button>
					{/each}
				</div>
			{/if}
		</div>
		<form
			method="POST"
			{action}
			class="flex shrink-0 flex-wrap items-center gap-2 border-t border-border pt-3"
			use:enhance={({ cancel }) => {
					const found = validateHealthChecks(drafts, ports);
					if (found.length > 0) {
						issues = found;
						cancel();
						void focusInvalid();
						return;
					}
					issues = [];
					return async ({ result, update }) => {
						const data = result.type === 'failure' ? result.data : null;
						const outcome = formDialogOutcome(result.type);
						const view = healthChecksSaveState({
							outcome: outcome === 'success' ? 'success' : outcome === 'failure' ? healthFailureOutcome(data) : 'idle',
							message: textField(data, 'healthMessage'),
							field: textField(data, 'healthField')
						});
						if (view.notice == null) {
							ignoreServer = false;
							onSaved?.(null);
							await update({ reset: false });
							await focusInvalid();
							return;
						}
						open = false;
						pendingSaved = serviceId;
						await new Promise<void>((resolve) => {
							closeWait = resolve;
							scheduleHealthCloseFallback(() => {
								if (closeWait === resolve) finishClose(false);
							});
						});
						await update({ reset: false });
					};
				}}
			>
				<Input type="hidden" name="service_id" value={serviceId} />
				{#each formRows as row, index (drafts[index]?.key ?? index)}
					<Input type="hidden" name={HEALTH_FORM.protocol} value={row.protocol} />
					<Input type="hidden" name={HEALTH_FORM.port} value={row.port} />
					<Input type="hidden" name={HEALTH_FORM.path} value={row.path} />
					<Input type="hidden" name={HEALTH_FORM.interval} value={row.interval} />
					<Input type="hidden" name={HEALTH_FORM.expectMin} value={row.expectMin} />
					<Input type="hidden" name={HEALTH_FORM.expectMax} value={row.expectMax} />
					<Input type="hidden" name={HEALTH_FORM.enabled} value={row.enabled} />
				{/each}
				<Button type="submit">Save</Button>
				<Dialog.Close type="button">Cancel</Dialog.Close>
			</form>
	</Dialog.Content>
</Dialog.Root>
{/if}
