<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { confirmHref, confirmIsOpen, typeToConfirmMatches } from '$lib/confirm';

	type TypeToConfirm = {
		name: string;
		expected: string;
		label: string;
	};

	let {
		id,
		action,
		label,
		confirmLabel,
		message,
		hidden = [],
		typeToConfirm = null
	}: {
		id: string;
		action: string;
		label: string;
		confirmLabel: string;
		message: string;
		hidden?: Array<{ name: string; value: string }>;
		/** Visible text the user must type. Nothing hidden carries `expected`. */
		typeToConfirm?: TypeToConfirm | null;
	} = $props();

	let opened = $state(false);
	let dismissed = $state(false);
	let typed = $state('');
	let js = $state(false);
	let confirmButton = $state<HTMLButtonElement | null>(null);
	let confirmInput = $state<HTMLInputElement | null>(null);

	const showing = $derived(confirmIsOpen(opened, page.url.searchParams.get('confirm'), id, dismissed));
	const confirmLink = $derived(confirmHref(page.url, id));
	const matched = $derived(typeToConfirm == null || typeToConfirmMatches(typed, typeToConfirm.expected));

	const cancelHref = $derived.by(() => {
		const params = new URLSearchParams(page.url.searchParams);
		params.delete('confirm');
		const qs = params.toString();
		return qs ? `${page.url.pathname}?${qs}` : page.url.pathname;
	});

	function plainClick(event: MouseEvent): boolean {
		return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
	}

	function open(event: MouseEvent) {
		if (!plainClick(event)) return;
		event.preventDefault();
		typed = '';
		dismissed = false;
		opened = true;
	}

	function close(event: MouseEvent) {
		if (!plainClick(event)) return;
		event.preventDefault();
		typed = '';
		opened = false;
		dismissed = true;
	}

	$effect(() => {
		js = true;
	});

	$effect(() => {
		if (!opened) return;
		if (typeToConfirm) confirmInput?.focus();
		else confirmButton?.focus();
	});
</script>

{#if showing}
	<form method="POST" {action} use:enhance>
		<p>{message}</p>
		{#each hidden as field (field.name)}
			<input type="hidden" name={field.name} value={field.value} />
		{/each}
		{#if typeToConfirm}
			<label class="field">
				{typeToConfirm.label}
				<input name={typeToConfirm.name} autocomplete="off" bind:value={typed} bind:this={confirmInput} />
			</label>
		{/if}
		<div class="actions">
			<button
				type="submit"
				class="danger"
				disabled={js && typeToConfirm != null && !matched}
				bind:this={confirmButton}
			>{confirmLabel}</button>
			<a href={cancelHref} onclick={close}>Cancel</a>
		</div>
	</form>
{:else}
	<a class="button danger" href={confirmLink} onclick={open}>{label}</a>
{/if}
