<script lang="ts">
	import { Combobox as ComboboxPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
	import { comboboxNav } from "./context.js";
	import { comboboxKeyAction } from "./keys.js";

	let {
		ref = $bindable(null),
		value = $bindable(""),
		class: className,
		...restProps
	}: Omit<WithoutChildrenOrChild<ComboboxPrimitive.InputProps>, "type"> & { value?: string } = $props();

	const nav = comboboxNav();
	type Handler = ((event: Event) => void) | undefined;

	/** Applies `comboboxKeyAction`. Enter with nothing the user moved to closes the list and submits the typed text. */
	function keydown(event: KeyboardEvent, inner: Handler, hasHighlight: boolean) {
		const action = comboboxKeyAction(event.key, { open: nav.open, navigated: nav.navigated, hasHighlight });
		if (action === "caret") return;
		if (action === "submit") {
			nav.close();
			return;
		}
		if (action === "reveal" || action === "end") {
			event.preventDefault();
			nav.navigated = true;
			if (action === "end") inner?.(new KeyboardEvent("keydown", { key: "End" }));
			return;
		}
		if (action === "navigate") nav.navigated = true;
		inner?.(event);
	}

	function input(event: Event & { currentTarget: HTMLInputElement }, inner: Handler) {
		value = event.currentTarget.value;
		nav.navigated = false;
		// Text that arrives without a key press (dictation, autofill) opens the list too.
		if (!nav.open) nav.show();
		inner?.(event);
	}
</script>

<ComboboxPrimitive.Input bind:ref {...restProps}>
	{#snippet child({ props })}
		<input
			{...props}
			type="text"
			data-slot="combobox-input"
			{value}
			aria-controls={nav.listId}
			aria-activedescendant={nav.navigated ? (props["aria-activedescendant"] as string | undefined) : undefined}
			onkeydown={(event) => keydown(event, props.onkeydown as Handler, props["aria-activedescendant"] != null)}
			oninput={(event) => input(event, props.oninput as Handler)}
			class={cn(
				"dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 disabled:bg-input/50 dark:disabled:bg-input/80 h-8 rounded-lg border bg-transparent px-2.5 py-1 text-base transition-colors focus-visible:ring-3 aria-invalid:ring-3 md:text-sm w-full min-w-0 outline-none placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
				className
			)}
		/>
	{/snippet}
</ComboboxPrimitive.Input>
