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
		'conflict',
		'auto_restarted',
		'auto_rolled_back',
		'auto_gave_up',
		'auto_failed'
	] as const;
	const text = $derived(known.includes(status as (typeof known)[number]) ? status : 'unknown');

	/** Words for statuses whose wire value does not read well. Others show as sent. */
	const label: Record<string, string> = {
		auto_restarted: 'Automatic restart',
		auto_rolled_back: 'Automatic rollback',
		auto_gave_up: 'Automatic: gave up',
		auto_failed: 'Automatic action failed'
	};

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
		conflict: 'text-status-offline',
		auto_restarted: 'text-status-asleep',
		auto_rolled_back: 'text-status-asleep',
		auto_gave_up: 'text-status-down',
		auto_failed: 'text-status-down'
	};
</script>

{#snippet badge()}
	<Badge variant="outline" class={tone[text] ?? 'text-status-unknown'}>
		<span class="size-1.5 rounded-full bg-current" aria-hidden="true"></span>
		{label[text] ?? text}
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
