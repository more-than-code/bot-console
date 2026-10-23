<script lang="ts">
	import { enhance } from '$app/forms';

	/** A hidden form that posts one `image` value to a named action and hands the answer back with that value. */
	let {
		action,
		onResult
	}: {
		action: string;
		onResult: (image: string, data: Record<string, unknown>) => void;
	} = $props();

	let form = $state<HTMLFormElement | null>(null);
	let pending = '';

	export function send(image: string): void {
		pending = image;
		form?.requestSubmit();
	}
</script>

<form
	bind:this={form}
	method="POST"
	{action}
	class="hidden"
	use:enhance={({ formData }) => {
		// Captured now, so overlapping answers each go back with their own request.
		const requested = pending;
		formData.set('image', requested);
		return async ({ result }) => {
			const data = result.type === 'success' || result.type === 'failure' ? result.data : null;
			onResult(requested, data != null && typeof data === 'object' ? (data as Record<string, unknown>) : {});
		};
	}}
></form>
