<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import * as Tooltip from '$lib/components/ui/tooltip';

	let { status, hint = null }: { status: string; hint?: string | null } = $props();

	const known = [
		'online',
		'offline',
		'asleep',
		'revoked',
		'up',
		'down',
		'unknown',
		'stopped',
		'gone',
		'succeeded',
		'unchanged',
		'failed',
		'timeout',
		'rolled_back',
		'rollback_failed',
		'image_unavailable',
		'forbidden_spec',
		'conflict'
	] as const;
	const text = $derived(known.includes(status as (typeof known)[number]) ? status : 'unknown');

	const tone: Record<string, string> = {
		online: 'text-status-online',
		offline: 'text-status-offline',
		asleep: 'text-status-asleep',
		revoked: 'text-status-revoked',
		up: 'text-status-up',
		down: 'text-status-down',
		unknown: 'text-status-unknown',
		stopped: 'text-status-offline',
		gone: 'text-status-unknown',
		succeeded: 'text-status-up',
		unchanged: 'text-status-up',
		failed: 'text-status-down',
		timeout: 'text-status-down',
		rolled_back: 'text-status-asleep',
		rollback_failed: 'text-status-down',
		image_unavailable: 'text-status-down',
		forbidden_spec: 'text-status-revoked',
		conflict: 'text-status-offline'
	};
</script>

{#snippet badge()}
	<Badge variant="outline" class={tone[text] ?? 'text-status-unknown'}>
		<span class="size-1.5 rounded-full bg-current" aria-hidden="true"></span>
		{text}
	</Badge>
{/snippet}
{#if hint}
	<Tooltip.Provider>
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<span {...props} title={hint}>{@render badge()}</span>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content>{hint}</Tooltip.Content>
		</Tooltip.Root>
	</Tooltip.Provider>
{:else}
	{@render badge()}
{/if}
