<script lang="ts">
	import { browser } from '$app/environment';
	import { invalidate } from '$app/navigation';
	import Notice from '$lib/components/Notice.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Tabs from '$lib/components/Tabs.svelte';
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

	const tabs = $derived([
		{ key: 'overview', label: 'Overview', href: `?tab=overview&range=${data.range}` },
		{ key: 'services', label: 'Services', href: '?tab=services' },
		{ key: 'processes', label: 'Processes', href: `?tab=processes&sort=${data.processSort}` }
	]);

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

<PageHeader title={data.host ? data.host.name : 'Host'} breadcrumbs={crumbs} />
{#if !data.host}
	<Notice kind="error">{data.message ?? 'This host is not available.'}</Notice>
{:else}
	{#if data.message || form?.message}
		<Notice kind="error">{form?.message ?? data.message}</Notice>
	{/if}
	<Tabs label="Host sections" current={data.tab} items={tabs} />

	{#if data.tab === 'overview'}
		<OverviewTab host={data.host} range={data.range} metrics={data.metrics} snapshot={form?.snapshot ?? null} />
	{:else if data.tab === 'services'}
		<ServicesTab services={data.services} omitted={data.omitted} probe={form?.probe ?? null} />
	{:else}
		<ProcessesTab sort={data.processSort} processes={data.processes} message={data.processesMessage} />
	{/if}
{/if}
