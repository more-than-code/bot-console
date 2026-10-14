<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Monitor from '@lucide/svelte/icons/monitor';
	import Moon from '@lucide/svelte/icons/moon';
	import Sun from '@lucide/svelte/icons/sun';
	import { untrack } from 'svelte';
	import type { Component } from 'svelte';
	import { Input } from '$lib/components/ui/input';
	import * as ToggleGroup from '$lib/components/ui/toggle-group';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { applyThemeClass, type ThemeChoice } from '$lib/theme';

	let { value }: { value: ThemeChoice } = $props();

	let current = $state<ThemeChoice>(untrack(() => value));
	let formEl = $state<HTMLFormElement | null>(null);
	let themeInput = $state<HTMLInputElement | null>(null);

	const next = $derived(`${page.url.pathname}${page.url.search}`);

	const choices: Array<{ value: ThemeChoice; label: string; icon: Component }> = [
		{ value: 'system', label: 'System', icon: Monitor },
		{ value: 'light', label: 'Light', icon: Sun },
		{ value: 'dark', label: 'Dark', icon: Moon }
	];

	function choose(nextTheme: string) {
		if (nextTheme !== 'system' && nextTheme !== 'light' && nextTheme !== 'dark') return;
		current = nextTheme;
		applyThemeClass(nextTheme);
		if (themeInput) themeInput.value = nextTheme;
		formEl?.requestSubmit();
	}
</script>

<Tooltip.Provider>
	<form
		method="POST"
		action="/theme"
		class="flex items-center"
		bind:this={formEl}
		use:enhance={() => async () => {}}
	>
		<Input type="hidden" name="next" value={next} />
		<Input type="hidden" name="theme" value={current} bind:ref={themeInput} />
		<ToggleGroup.Root
			type="single"
			value={current}
			onValueChange={choose}
			variant="outline"
			size="sm"
			aria-label="Theme"
		>
			{#each choices as choice (choice.value)}
				{@const Icon = choice.icon}
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<ToggleGroup.Item
								{...props}
								value={choice.value}
								name="theme"
								aria-label={choice.label}
								aria-current={choice.value === current ? 'true' : undefined}
							>
								<Icon class="size-4" />
								<span class="max-[640px]:hidden">{choice.label}</span>
							</ToggleGroup.Item>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>{choice.label}</Tooltip.Content>
				</Tooltip.Root>
			{/each}
		</ToggleGroup.Root>
	</form>
</Tooltip.Provider>
