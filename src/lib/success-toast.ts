import { toast } from 'svelte-sonner';
import { SAVED_HEALTH_CHECKS } from './health-checks';

// Success confirmations show as a toast at the bottom of the window (the Toaster in
// the root layout). Errors stay inline. Each runs once, after its dialog has finished
// closing, so the toast is not announced from inside the dialog.

/** "Saved {entry}." after an image save. `imageSaveView` has already trimmed the name and dropped a blank one. */
export function toastImageSaved(name: string): void {
	toast.success(`Saved ${name}.`);
}

/** "Saved health checks." after a health-check save. */
export function toastHealthSaved(): void {
	toast.success(SAVED_HEALTH_CHECKS);
}

/** "Added {email}." after the Add member dialog succeeds. */
export function toastMemberAdded(email: string): void {
	toast.success(`Added ${email}.`);
}
