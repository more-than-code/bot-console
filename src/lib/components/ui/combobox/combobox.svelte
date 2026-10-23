<script lang="ts">
	import { Combobox as ComboboxPrimitive } from "bits-ui";
	import type { Snippet } from "svelte";
	import { setComboboxNav } from "./context.js";

	let {
		open = $bindable(false),
		disabled = false,
		onPick,
		children,
	}: {
		open?: boolean;
		disabled?: boolean;
		/** Called with the value of the option the user picked. The input text is the caller's to change. */
		onPick?: (value: string) => void;
		children?: Snippet;
	} = $props();

	const uid = $props.id();
	const listId = `${uid}-list`;
	let selected = $state("");
	let navigated = $state(false);

	setComboboxNav({
		listId,
		get open() {
			return open;
		},
		get navigated() {
			return navigated;
		},
		set navigated(value: boolean) {
			navigated = value;
		},
		show() {
			open = true;
		},
		close() {
			open = false;
		},
	});

	$effect(() => {
		if (!open) navigated = false;
	});

	// No selection is kept, so the same option can be picked again after the text changes.
	function onValueChange(value: string) {
		if (value === "") return;
		selected = "";
		onPick?.(value);
	}
</script>

<ComboboxPrimitive.Root type="single" bind:open bind:value={selected} {disabled} allowDeselect={false} {onValueChange}>
	{@render children?.()}
</ComboboxPrimitive.Root>
