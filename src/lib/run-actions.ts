import Play from '@lucide/svelte/icons/play';
import RotateCw from '@lucide/svelte/icons/rotate-cw';
import ScrollText from '@lucide/svelte/icons/scroll-text';
import Square from '@lucide/svelte/icons/square';
import { APPROVAL_WAIT } from '$lib/catalog';
import type { CatalogRunKind, CatalogRunState } from '$lib/project-action';

/** Button and form label for each catalog action on a Services row. `run` is shown as Start. */
export const RUN_LABEL: Record<CatalogRunKind, string> = {
	run: 'Start',
	stop: 'Stop',
	restart: 'Restart',
	logs: 'Logs'
};

/** Result dialog title word once the action answered. */
export const RUN_DONE: Record<CatalogRunKind, string> = {
	run: 'Started',
	stop: 'Stopped',
	restart: 'Restarted',
	logs: 'Logs'
};

export const RUN_ICON = { run: Play, stop: Square, restart: RotateCw, logs: ScrollText } as const;

/** Named form action in `+page.server.ts`. */
export const RUN_FORM_ACTION: Record<CatalogRunKind, string> = {
	run: 'catalogRun',
	stop: 'catalogStop',
	restart: 'catalogRestart',
	logs: 'catalogLogs'
};

/** Title of a result view: what ran, and whether it worked. */
export function runResultTitle(state: CatalogRunState, fallbackName: string): string {
	const name = state.name || fallbackName;
	if (state.message === APPROVAL_WAIT) return `${RUN_LABEL[state.kind]} ${name}: waiting for approval`;
	if (state.message) return `${RUN_LABEL[state.kind]} ${name} failed`;
	return `${RUN_DONE[state.kind]} ${name}`;
}
