<script lang="ts">
	import { browser } from '$app/environment';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { untrack, type Snippet } from 'svelte';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import type { Host, ImageDeploy, ImageEntry } from '$lib/api-types';
	import { imageHostBlockReason, isCatalogHost, reuseIdempotencyKey } from '$lib/catalog';
	import { formatWhen } from '$lib/format';
	import { applyHistoryResponse, historyAfterSwitch, historyFetch, historyNotice, nextHistory, nextIdempotencyKey, nextRollbackKey, rollbackDigests, shortDigest } from '$lib/image-spec';
	import type { ImageDeployState } from '$lib/project-action';

	let {
		entry,
		hosts,
		deployAction,
		rollbackAction,
		removeAction,
		confirmAction,
		historyAction,
		result = null,
		active = true,
		historyInFlight = false,
		cancel
	}: {
		entry: ImageEntry;
		hosts: Host[];
		deployAction: string;
		rollbackAction: string;
		removeAction: string;
		confirmAction: string;
		historyAction: string;
		result?: ImageDeployState | null;
		active?: boolean;
		/** Initial history fetch. The dialog leaves this false; the effect sets it when the request starts. */
		historyInFlight?: boolean;
		cancel?: Snippet;
	} = $props();

	const eligible = $derived(hosts.filter((host) => isCatalogHost(host)));
	const waitSec = $derived(entry.spec.kind === 'job' ? entry.spec.timeout_sec : entry.spec.healthy_after_sec);
	const actionLabel = $derived(entry.spec.kind === 'job' ? 'Run job' : 'Deploy');

	function firstHost(): string {
		return eligible[0]?.id ?? '';
	}

	let hostId = $state(untrack(() => result?.hostId || firstHost()));
	let force = $state(false);
	let history = $state<ImageDeploy[]>(untrack(() => (result?.history == null ? [] : [...result.history])));
	let historyReady = $state(untrack(() => result?.history != null));
	let historyPending = $state(untrack(() => historyInFlight));
	let historyError = $state<string | null>(null);
	let historyListedFor = $state(untrack(() => (result?.history != null ? (result.hostId ?? '') : '')));
	let seen = $state<string | null>(untrack(() => result?.resultId ?? null));
	let deployKey = $state('');
	let confirmKey = $state('');
	let removeKey = $state('');
	let deployRequest = $state<{ hostId: string; force: boolean; key: string } | null>(null);
	let rollbackRequest = $state<Record<string, { hostId: string; key: string }>>({});
	let submitting = $state(false);
	let historyForm = $state<HTMLFormElement | null>(null);
	let historyHost = $state('');

	const selectedHost = $derived(eligible.find((host) => host.id === hostId) ?? null);
	const hostLabel = $derived(selectedHost?.name ?? '');
	const containerBlocked = $derived(selectedHost != null && imageHostBlockReason(selectedHost) != null);
	const notice = $derived(historyNotice({ hostCount: eligible.length, pending: historyPending, ready: historyReady, count: history.length }));
	const targets = $derived(entry.spec.kind === 'job' ? [] : rollbackDigests(history));
	const digest = $derived(shortDigest(result?.outcome?.digest ?? result?.status?.digest));

	$effect(() => {
		const id = result?.resultId ?? null;
		if (id == null || id === untrack(() => seen)) return;
		seen = id;
		const incoming = result?.history ?? null;
		history = nextHistory(untrack(() => history), incoming);
		if (incoming != null) {
			historyReady = true;
			historyError = null;
			historyPending = false;
			if (result?.hostId) historyListedFor = result.hostId;
		}
		if (result?.hostId) hostId = result.hostId;
	});

	$effect(() => {
		if (!browser || !active) {
			historyHost = '';
			return;
		}
		const step = historyFetch(hostId, historyHost, historyForm != null);
		if (!step.submit || historyForm == null) return;
		const next = historyAfterSwitch(historyListedFor, hostId, {
			history,
			ready: historyReady,
			pending: false,
			error: historyError
		});
		if (next.switched) {
			history = [...next.history];
			historyReady = next.ready;
			historyError = next.error;
		}
		historyPending = step.pending;
		historyHost = hostId;
		historyForm.requestSubmit();
	});

	$effect(() => {
		if (!browser) return;
		if (deployKey === '') deployKey = crypto.randomUUID();
		if (confirmKey === '') confirmKey = crypto.randomUUID();
		if (removeKey === '') removeKey = crypto.randomUUID();
	});

	function freshKey(): string {
		return crypto.randomUUID();
	}

	const deployEnhance: SubmitFunction = ({ formData, cancel }) => {
		if (submitting) {
			cancel();
			return async () => {};
		}
		submitting = true;
		const key = nextIdempotencyKey(deployRequest, { hostId, force }, freshKey());
		deployKey = key;
		deployRequest = { hostId, force, key };
		formData.set('idempotency_key', key);
		return async ({ result: actionResult, update }) => {
			try {
				await update({ reset: false });
			} finally {
				submitting = false;
				if (!reuseIdempotencyKey(actionResult.type)) {
					deployKey = freshKey();
					deployRequest = null;
				}
			}
		};
	};

	function rollbackEnhance(digestValue: string): SubmitFunction {
		return ({ formData, cancel }) => {
			if (submitting) {
				cancel();
				return async () => {};
			}
			submitting = true;
			const key = nextRollbackKey(rollbackRequest[digestValue] ?? null, hostId, freshKey());
			rollbackRequest = { ...rollbackRequest, [digestValue]: { hostId, key } };
			formData.set('idempotency_key', key);
			return async ({ result: actionResult, update }) => {
				try {
					await update({ reset: false });
				} finally {
					submitting = false;
					if (!reuseIdempotencyKey(actionResult.type)) {
						const next = { ...rollbackRequest };
						delete next[digestValue];
						rollbackRequest = next;
					}
				}
			};
		};
	}

	// The confirm body is only the idempotency key, so a host change does not rotate it.
	const confirmEnhance: SubmitFunction = ({ formData, cancel }) => {
		if (submitting) {
			cancel();
			return async () => {};
		}
		submitting = true;
		if (confirmKey === '') confirmKey = freshKey();
		formData.set('idempotency_key', confirmKey);
		return async ({ result: actionResult, update }) => {
			try {
				await update({ reset: false });
			} finally {
				submitting = false;
				if (!reuseIdempotencyKey(actionResult.type)) confirmKey = freshKey();
			}
		};
	};

	function takeHistory(data: Record<string, unknown> | null | undefined, ticket: string | null, requestedHost: string) {
		if ((result?.resultId ?? null) !== ticket) return;
		const deploy = data?.imageDeploy as ImageDeployState | undefined;
		const next = applyHistoryResponse(
			{ history, ready: historyReady, pending: historyPending, error: historyError, listedHost: historyListedFor },
			hostId,
			requestedHost,
			deploy?.hostId ?? null,
			deploy?.history ?? null,
			deploy?.message ?? null
		);
		history = [...next.history];
		historyReady = next.ready;
		historyPending = next.pending;
		historyError = next.error;
		historyListedFor = next.listedHost;
	}
</script>

<form
	bind:this={historyForm}
	method="POST"
	action={historyAction}
	class="hidden"
	use:enhance={() => {
		const ticket = result?.resultId ?? null;
		const requestedHost = hostId;
		return async ({ result: actionResult }) => {
			if (actionResult.type !== 'success' && actionResult.type !== 'failure') return;
			takeHistory(actionResult.data as Record<string, unknown>, ticket, requestedHost);
		};
	}}
>
	<Input type="hidden" name="name" value={entry.name} />
	<Input type="hidden" name="host_id" value={hostId} />
	<Input type="hidden" name="workload" value={entry.spec.kind} />
	<Input type="hidden" name="wait_sec" value={String(waitSec)} />
</form>

<form method="POST" action={deployAction} class="grid gap-3" use:enhance={deployEnhance}>
	<Input type="hidden" name="name" value={entry.name} />
	<Input type="hidden" name="workload" value={entry.spec.kind} />
	<Input type="hidden" name="wait_sec" value={String(waitSec)} />
	<Input type="hidden" name="idempotency_key" value={deployKey} />
	<div class="grid min-w-0 gap-1.5">
		<Label id="deploy-{entry.name}-host">Host</Label>
		<div role="radiogroup" aria-labelledby="deploy-{entry.name}-host" class="grid min-w-0 gap-1">
			{#each eligible as host (host.id)}
				<Button
					type="button"
					role="radio"
					variant={hostId === host.id ? 'secondary' : 'outline'}
					aria-checked={hostId === host.id}
					class="h-auto w-full min-w-0 justify-start text-left whitespace-normal break-all"
					onclick={() => (hostId = host.id)}>{host.name}</Button>
			{/each}
		</div>
		<Input type="hidden" name="host_id" value={hostId} />
		{#each eligible as host (host.id)}
			{@const reason = imageHostBlockReason(host)}
			{#if reason}
				<p class="text-muted-foreground text-sm">{host.name}: {reason}</p>
			{/if}
		{/each}
	</div>
	<Label class="flex items-center gap-2">
		<Checkbox name="force" value="1" bind:checked={force} />
		Force
	</Label>
	{#if result?.message}
		<div class="max-w-full min-w-0 break-words">
			<Notice kind="error">{result.message}</Notice>
		</div>
	{/if}
	{#if result?.outcome}
		<div class="flex flex-wrap items-center gap-2" role="status">
			<StatusBadge status={result.outcome.outcome} />
			{#if digest}
				<span class="font-mono text-sm">{digest}</span>
			{/if}
			<span class="text-sm">{result.outcome.exit_code == null ? 'exit none' : `exit ${result.outcome.exit_code}`}</span>
		</div>
	{/if}
	{#if result?.status && (result.status.state === 'unknown' || !result.outcome)}
		<p role="status" class="flex flex-wrap items-center gap-2 text-sm">
			{result.status.container ?? 'unnamed'}
			{#if result.status.state === 'unknown'}
				<StatusBadge status="unknown" />
			{:else}
				{result.status.state}
			{/if}
		</p>
	{/if}
	{#if result && result.lines.length > 0}
		<pre class="bg-muted max-h-40 overflow-auto rounded-lg p-2 font-mono text-xs whitespace-pre-wrap" aria-label="Deploy log">{result.lines.join('\n')}</pre>
	{/if}
	<div class="flex flex-wrap items-center gap-2">
		<Button type="submit" disabled={submitting || hostId === '' || containerBlocked}>{actionLabel}</Button>
		{#if cancel}
			{@render cancel()}
		{/if}
	</div>
</form>

{#if result?.confirmation && result.confirmKind}
	<form method="POST" action={confirmAction} class="mt-3 grid gap-3" use:enhance={confirmEnhance}>
		<Input type="hidden" name="name" value={entry.name} />
		<Input type="hidden" name="host_id" value={hostId} />
		<Input type="hidden" name="workload" value={entry.spec.kind} />
		<Input type="hidden" name="wait_sec" value={String(waitSec)} />
		<Input type="hidden" name="confirmation_id" value={result.confirmation.confirmation_id} />
		<Input type="hidden" name="confirm_kind" value={result.confirmKind} />
		<Input type="hidden" name="idempotency_key" value={confirmKey} />
		<div class="max-w-full min-w-0 break-words">
			<Notice kind="info">{result.confirmation.plan}</Notice>
		</div>
		<div>
			<Button type="submit" disabled={submitting}>Confirm</Button>
		</div>
	</form>
{/if}

<div class="mt-4 grid gap-2">
	<h3 class="text-sm font-medium">History</h3>
	{#if historyError}
		<div class="max-w-full min-w-0 break-words">
			<Notice kind="error">{historyError}</Notice>
		</div>
	{/if}
	{#if historyError || historyPending || (result?.message && result.history == null && !historyReady)}
		<div>
			<Button type="button" variant="outline" onclick={() => historyForm?.requestSubmit()}>Retry</Button>
		</div>
	{/if}
	{#if notice === 'empty'}
		<p class="text-muted-foreground text-sm">No deploys yet.</p>
	{:else if notice === 'list'}
		<ul class="grid gap-2">
			{#each history as item (item.id)}
				<li class="flex flex-wrap items-center gap-2 text-sm">
					<StatusBadge status={item.outcome} />
					<span class="font-mono">{shortDigest(item.digest) ?? 'no digest'}</span>
					<span class="text-muted-foreground">{formatWhen(item.finished_at ?? item.started_at)}</span>
				</li>
			{/each}
		</ul>
	{:else if notice === 'no-hosts'}
		<p class="text-muted-foreground text-sm">No hosts in this project.</p>
	{:else if notice === 'loading'}
		<p class="text-muted-foreground text-sm">Loading history…</p>
	{/if}
	{#if historyReady}
		{#each targets as item (item)}
			<form method="POST" action={rollbackAction} class="flex flex-wrap items-center gap-2" use:enhance={rollbackEnhance(item)}>
				<Input type="hidden" name="name" value={entry.name} />
				<Input type="hidden" name="host_id" value={hostId} />
				<Input type="hidden" name="workload" value={entry.spec.kind} />
				<Input type="hidden" name="wait_sec" value={String(waitSec)} />
				<Input type="hidden" name="digest" value={item} />
				<Button type="submit" variant="outline" disabled={submitting || hostId === '' || containerBlocked}>Roll back to {shortDigest(item) ?? item}</Button>
				<span class="font-mono text-sm">{shortDigest(item) ?? item}</span>
			</form>
		{/each}
	{/if}
	{#if hostId !== '' && hostLabel !== ''}
		<div class="mt-2">
			<ConfirmAction
				id="remove-image-{entry.name}"
				action={removeAction}
				label="Remove"
				confirmLabel="Remove"
				disabled={containerBlocked}
				message="Remove {entry.name} from {hostLabel}?"
				hidden={[
					{ name: 'name', value: entry.name },
					{ name: 'host_id', value: hostId },
					{ name: 'workload', value: entry.spec.kind },
					{ name: 'wait_sec', value: String(waitSec) },
					{ name: 'idempotency_key', value: removeKey }
				]}
			/>
		</div>
	{/if}
</div>
