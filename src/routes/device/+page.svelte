<script lang="ts">
	import { enhance } from '$app/forms';
	import Notice from '$lib/components/Notice.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { formatWhen } from '$lib/format';
	import { actionUrl } from '$lib/url';

	let { data, form } = $props();

	const statusText: Record<string, string> = {
		pending: 'Waiting for your decision.',
		approved: 'This code is already approved.',
		denied: 'This code was denied.',
		expired: 'This code has expired. Start sign-in on the device again.'
	};
</script>

<svelte:head>
	<title>Device · deploybot</title>
</svelte:head>

<PageHeader title="Device approval" />
{#if form?.message || data.message}
	<Notice kind="error">{form?.message ?? data.message}</Notice>
{/if}

{#if data.device}
	<p>
		<strong>{data.device.client_name}</strong> acts as you, with your project roles.
	</p>
	<p class="sub">Code {data.device.user_code}. Expires {formatWhen(data.device.expires_at)}.</p>
	<p class="sub">{statusText[data.device.status] ?? 'This code cannot be used.'}</p>
	{#if data.device.status === 'pending'}
		<div class="actions">
			<form method="POST" action={actionUrl('approve', { code: data.code || undefined })} use:enhance>
				<input type="hidden" name="code" value={data.code} />
				<button type="submit">Approve</button>
			</form>
			<form method="POST" action={actionUrl('deny', { code: data.code || undefined })} use:enhance>
				<input type="hidden" name="code" value={data.code} />
				<button type="submit" class="danger">Deny</button>
			</form>
		</div>
	{/if}
{:else}
	<form method="GET" class="panel">
		<label class="field">
			Device code
			<input name="code" value={data.code} autocomplete="off" autocapitalize="off" spellcheck="false" required />
		</label>
		<button type="submit">Continue</button>
	</form>
{/if}
