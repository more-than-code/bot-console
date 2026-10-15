<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';

	let { status }: { status: string } = $props();

	const known = ['online', 'offline', 'asleep', 'revoked', 'up', 'down', 'unknown', 'stopped', 'gone'] as const;
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
		gone: 'text-status-unknown'
	};
</script>

<Badge variant="outline" class={tone[text] ?? 'text-status-unknown'}>
	<span class="size-1.5 rounded-full bg-current" aria-hidden="true"></span>
	{text}
</Badge>
