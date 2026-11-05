<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import {
		DRAWER_DEFAULT_WIDTH,
		DRAWER_LABEL,
		WIDE_QUERY,
		WIDTH_MIN,
		clampWidth,
		clearWidth,
		keyWidth,
		maxWidth,
		readWidth,
		saveWidth,
		widthStorage,
		type DrawerType
	} from '$lib/drawer-width';

	/**
	 * The resize handle of a right-side drawer (umbrella `docs/spec-resizable-drawers.md`). Render it through
	 * `Sheet.Content`'s `after` snippet, so it is a direct child of the drawer and comes after the close button.
	 * From `md` up it sets the drawer's width inline; below `md` it is hidden and the drawer keeps its classes.
	 */
	let { type }: { type: DrawerType } = $props();

	let handle = $state<HTMLDivElement | null>(null);
	let wide = $state(false);
	let windowWidth = $state(0);
	/** The chosen width, not clamped to the window: clamping never rewrites what is saved. */
	let preferred = $state(untrack(() => DRAWER_DEFAULT_WIDTH[type]));
	let read = false;
	let drag: { pointerId: number; startX: number; startWidth: number; moved: boolean } | null = null;
	let bodyUserSelect = '';

	const max = $derived(windowWidth > 0 ? maxWidth(windowWidth) : Math.max(WIDTH_MIN, preferred));
	const width = $derived(windowWidth > 0 ? clampWidth(preferred, windowWidth) : preferred);

	onMount(() => {
		const media = window.matchMedia(WIDE_QUERY);
		function sync() {
			wide = media.matches;
			windowWidth = window.innerWidth;
			// Storage is read only once the window is wide, so a phone never touches it.
			if (wide && !read) {
				read = true;
				preferred = readWidth(widthStorage(), type);
			}
		}
		sync();
		media.addEventListener('change', sync);
		window.addEventListener('resize', sync);
		return () => {
			media.removeEventListener('change', sync);
			window.removeEventListener('resize', sync);
			endDrag();
		};
	});

	$effect(() => {
		const content = handle?.parentElement;
		if (!content) return;
		if (wide) {
			content.style.width = `${width}px`;
			content.style.maxWidth = 'none';
		} else {
			content.style.removeProperty('width');
			content.style.removeProperty('max-width');
		}
	});

	function onpointerdown(event: PointerEvent) {
		if (!wide || event.button !== 0) return;
		handle?.setPointerCapture(event.pointerId);
		drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: width, moved: false };
		bodyUserSelect = document.body.style.userSelect;
		document.body.style.userSelect = 'none';
	}

	function onpointermove(event: PointerEvent) {
		if (!drag || event.pointerId !== drag.pointerId) return;
		const next = clampWidth(drag.startWidth + (drag.startX - event.clientX), windowWidth);
		if (next !== width) drag.moved = true;
		preferred = next;
	}

	/** Ends a drag; the width is saved once, at the end, and only when it changed. */
	function endDrag() {
		if (!drag) return;
		const moved = drag.moved;
		drag = null;
		document.body.style.userSelect = bodyUserSelect;
		if (moved) saveWidth(widthStorage(), type, width);
	}

	function onkeydown(event: KeyboardEvent) {
		if (!wide) return;
		const next = keyWidth(event.key, event.shiftKey, width, windowWidth);
		if (next == null) return;
		event.preventDefault();
		preferred = next;
		saveWidth(widthStorage(), type, next);
	}

	function ondblclick() {
		if (!wide) return;
		preferred = DRAWER_DEFAULT_WIDTH[type];
		clearWidth(widthStorage(), type);
	}
</script>

<!-- A focusable separator is the WAI-ARIA window splitter, an interactive widget; Svelte's a11y table counts separator as static. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	bind:this={handle}
	data-slot="drawer-resize"
	role="separator"
	aria-orientation="vertical"
	aria-label="Resize {DRAWER_LABEL[type]} panel"
	aria-valuenow={width}
	aria-valuemin={WIDTH_MIN}
	aria-valuemax={max}
	tabindex="0"
	class="absolute inset-y-0 -left-[3px] z-10 hidden w-1.5 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 hover:after:bg-border focus-visible:after:bg-border focus-visible:ring-2 focus-visible:ring-ring md:block"
	{onpointerdown}
	{onpointermove}
	onpointerup={endDrag}
	onpointercancel={endDrag}
	onlostpointercapture={endDrag}
	{onkeydown}
	{ondblclick}
></div>
