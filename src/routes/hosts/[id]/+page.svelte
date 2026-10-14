<script lang="ts">
	import { browser } from '$app/environment';
	import { invalidate } from '$app/navigation';
	import Breadcrumbs from '$lib/components/Breadcrumbs.svelte';
	import { METRIC_REFRESH_MS } from '$lib/host-view';
	import OverviewTab from './OverviewTab.svelte';
	import ProcessesTab from './ProcessesTab.svelte';
	import ServicesTab from './ServicesTab.svelte';

	let { data, form } = $props();

	const crumbs = $derived(
		data.host
			? [
					{ label: 'Projects', href: '/projects' },
					{
						label: data.projectName ?? 'Project',
						href: `/projects/${data.host.project_id}`
					},
					{ label: data.host.name }
				]
			: [
					{ label: 'Projects', href: '/projects' },
					{ label: 'Host' }
				]
	);

	$effect(() => {
		if (!browser || data.tab !== 'overview' || !data.host) return;
		let timer: ReturnType<typeof setInterval> | undefined;
		const stop = () => {
			if (timer) clearInterval(timer);
			timer = undefined;
		};
		const start = () => {
			stop();
			timer = setInterval(() => {
				void invalidate('host:metrics');
			}, METRIC_REFRESH_MS);
		};
		const onVisibility = () => {
			if (document.visibilityState === 'hidden') stop();
			else start();
		};
		if (document.visibilityState !== 'hidden') start();
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			stop();
			document.removeEventListener('visibilitychange', onVisibility);
		};
	});
</script>

<svelte:head>
	<title>{data.host ? data.host.name : 'Host'} · deploybot</title>
</svelte:head>

<Breadcrumbs items={crumbs} />
{#if !data.host}
	<h1>Host</h1>
	<p class="error" role="alert">{data.message ?? 'This host is not available.'}</p>
{:else}
	<h1>{data.host.name}</h1>
	{#if data.message || form?.message}
		<p class="error" role="alert">{form?.message ?? data.message}</p>
	{/if}
	<nav class="nav tabs" aria-label="Host sections">
		<a href="?tab=overview&range={data.range}" aria-current={data.tab === 'overview' ? 'page' : undefined}>Overview</a>
		<a href="?tab=services" aria-current={data.tab === 'services' ? 'page' : undefined}>Services</a>
		<a
			href="?tab=processes&sort={data.processSort}"
			aria-current={data.tab === 'processes' ? 'page' : undefined}
		>Processes</a>
	</nav>

	{#if data.tab === 'overview'}
		<OverviewTab host={data.host} range={data.range} metrics={data.metrics} snapshot={form?.snapshot ?? null} />
	{:else if data.tab === 'services'}
		<ServicesTab services={data.services} omitted={data.omitted} probe={form?.probe ?? null} range={data.range} />
	{:else}
		<ProcessesTab
			hostId={data.host.id}
			range={data.range}
			sort={data.processSort}
			processes={data.processes}
			message={data.processesMessage}
		/>
	{/if}
{/if}
