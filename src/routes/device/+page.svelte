<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatWhen } from '$lib/format';

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

<h1>Device approval</h1>
{#if form?.message || data.message}
	<p class="error" role="alert">{form?.message ?? data.message}</p>
{/if}

{#if data.device}
	<p>
		<strong>{data.device.client_name}</strong> acts as you, with your project roles.
	</p>
	<p class="sub">Code {data.device.user_code}. Expires {formatWhen(data.device.expires_at)}.</p>
	<p class="sub">{statusText[data.device.status] ?? 'This code cannot be used.'}</p>
	{#if data.device.status === 'pending'}
		<div class="actions">
			<form method="POST" action="?/approve" use:enhance>
				<input type="hidden" name="code" value={data.code} />
				<button type="submit">Approve</button>
			</form>
			<form method="POST" action="?/deny" use:enhance>
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
