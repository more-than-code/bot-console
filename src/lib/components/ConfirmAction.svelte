<script lang="ts">
	import Ban from '@lucide/svelte/icons/ban';
	import ShieldOff from '@lucide/svelte/icons/shield-off';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import UserMinus from '@lucide/svelte/icons/user-minus';
	import { tick, type Component } from 'svelte';
	import ConfirmForm from '$lib/components/ConfirmForm.svelte';
	import RowAction from '$lib/components/RowAction.svelte';
	import { confirmIsDestructive } from '$lib/confirm';
	import { confirmSettle } from '$lib/dialog-open';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { buttonVariants } from '$lib/components/ui/button';

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
		typeToConfirm = null,
		rowLabel = null,
		disabled = false,
		closeOnFailure = false,
		messageClass = '',
		icon = null,
		failureFocusId = null,
		onSuccess
	}: {
		id: string;
		action: string;
		label: string;
		confirmLabel: string;
		message: string;
		hidden?: Array<{ name: string; value: string }>;
		/** Visible text the user must type. Nothing hidden carries `expected`. */
		typeToConfirm?: TypeToConfirm | null;
		/** Set on a table row. The trigger is then icon-only. */
		rowLabel?: string | null;
		/** The text trigger does not open. Row triggers ignore this. */
		disabled?: boolean;
		/** A failure closes the dialog instead of leaving it open over the page. */
		closeOnFailure?: boolean;
		messageClass?: string;
		/** Trigger icon. Defaults to one picked from the label. */
		icon?: Component | null;
		/** With `closeOnFailure`: focus and scroll to this notice after a failure. */
		failureFocusId?: string | null;
		/**
		 * Called on success with the submitted form. It runs even when the reload has removed this
		 * component (a row action), so the caller moves focus itself.
		 */
		onSuccess?: (form: FormData) => void | Promise<void>;
	} = $props();

	let open = $state(false);
	let sawFailure = $state(false);
	let typed = $state('');
	// Set when a failure closes the dialog: its close focus goes to the notice instead of the trigger.
	let focusNoticeOnClose = false;

	function focusNotice(): boolean {
		const notice = failureFocusId ? document.getElementById(failureFocusId) : null;
		if (!notice) return false;
		notice.focus();
		notice.scrollIntoView({ block: 'nearest' });
		return true;
	}

	async function settle(resultType: string, form: FormData) {
		const next = confirmSettle({ open, sawFailure }, resultType, closeOnFailure, failureFocusId);
		focusNoticeOnClose = next.focusNotice === 'on-close';
		open = next.open;
		sawFailure = next.sawFailure;
		if (next.resetDraft) typed = '';
		if (next.outcome === 'success') await onSuccess?.(form);
		if (next.focusNotice === 'now') {
			await tick();
			focusNotice();
		}
	}

	function onCloseAutoFocus(event: Event) {
		if (!focusNoticeOnClose) return;
		focusNoticeOnClose = false;
		if (focusNotice()) event.preventDefault();
	}

	const destructive = $derived(confirmIsDestructive(label));

	function rowIcon(text: string): Component {
		if (/credential/i.test(text)) return ShieldOff;
		if (/remove/i.test(text)) return UserMinus;
		if (/delete/i.test(text)) return Trash2;
		return Ban;
	}

	const Icon = $derived(icon ?? rowIcon(rowLabel ?? label));
</script>

<AlertDialog.Root bind:open>
	{#if rowLabel}
		<RowAction label={rowLabel} icon={Icon} {destructive} {disabled}>
			{#snippet trigger(props)}
				<AlertDialog.Trigger {...props}>
					<Icon class="size-4" />
				</AlertDialog.Trigger>
			{/snippet}
		</RowAction>
	{:else}
		<AlertDialog.Trigger class={buttonVariants({ variant: destructive ? 'destructive' : 'outline', size: 'sm' })} disabled={disabled}>
			<Icon class="size-4" />
			{label}
		</AlertDialog.Trigger>
	{/if}
	<AlertDialog.Content {onCloseAutoFocus}>
		<AlertDialog.Header>
			<AlertDialog.Title>{confirmLabel}</AlertDialog.Title>
			<AlertDialog.Description class={messageClass}>{message}</AlertDialog.Description>
		</AlertDialog.Header>
		<ConfirmForm {id} {action} {confirmLabel} {destructive} {hidden} {typeToConfirm} bind:typed onSettled={settle}>
			{#snippet cancel()}
				<AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
			{/snippet}
		</ConfirmForm>
	</AlertDialog.Content>
</AlertDialog.Root>
