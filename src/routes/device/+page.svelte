<script lang="ts">
	import { enhance } from '$app/forms';
	import Notice from '$lib/components/Notice.svelte';
	import LocalTime from '$lib/components/LocalTime.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { actionUrl } from '$lib/url';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	let { data, form } = $props();

	const statusText: Record<string, string> = {
		pending: 'Waiting for your decision.',
		approved: 'This code is already approved.',
		denied: 'This code was denied.',
		expired: 'This code has expired. Start sign-in on the device again.'
	};
</script>

<svelte:head>
	<title>Device · Deploybot</title>
</svelte:head>

<PageHeader title="Device approval" />
{#if form?.message || data.message}
	<Notice kind="error">{form?.message ?? data.message}</Notice>
{/if}

{#if data.device}
	<p>
		<strong>{data.device.client_name}</strong> acts as you, with your project roles.
	</p>
	<p class="text-muted-foreground text-sm">Code <span class="text-foreground font-mono">{data.device.user_code}</span>. Expires <LocalTime iso={data.device.expires_at} />.</p>
	<p class="text-muted-foreground mb-4 text-sm">{statusText[data.device.status] ?? 'This code cannot be used.'}</p>
	{#if data.device.status === 'pending'}
		<div class="flex flex-wrap gap-2">
			<form method="POST" action={actionUrl('approve', { code: data.code || undefined })} use:enhance>
				<Input type="hidden" name="code" value={data.code} />
				<Button type="submit">Approve</Button>
			</form>
			<form method="POST" action={actionUrl('deny', { code: data.code || undefined })} use:enhance>
				<Input type="hidden" name="code" value={data.code} />
				<Button type="submit" variant="destructive">Deny</Button>
			</form>
		</div>
	{/if}
{:else}
	<Card.Root>
		<Card.Content>
			<form method="GET" class="grid gap-3">
				<Label class="grid gap-1.5" for="device-code">
					Device code
					<Input
						id="device-code"
						class="font-mono"
						name="code"
						value={data.code}
						autocomplete="off"
						autocapitalize="off"
						spellcheck="false"
						required
					/>
				</Label>
				<div>
					<Button type="submit">Continue</Button>
				</div>
			</form>
		</Card.Content>
	</Card.Root>
{/if}
