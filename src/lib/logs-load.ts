import type { ActionResult } from '@sveltejs/kit';
import type { ImageLogs, ProgramLogs } from '$lib/api-types';
import { DEFAULT_LOG_LINES, linesOnLiveOff, linesOnLiveOn, type LinesState } from '$lib/log-lines';
import { LOGS_FAILED, logsOutcome, sameOriginPath } from '$lib/log-view';
import type { LogsPoller } from '$lib/logs-poll';

/** What the drawer shows. */
export type LogsView = {
	logs: ProgramLogs | ImageLogs | null;
	/** The last fetch failed. Lines from an earlier answer stay. */
	error: string | null;
	/** Why Live turned itself off. Cleared by the next answer with lines. */
	endNote: string | null;
	/** A request is running. Refresh ignores clicks. */
	loading: boolean;
	/** A request the user asked for (open or Refresh) is running. A Live poll does not spin the button. */
	spinning: boolean;
	updatedAt: Date | null;
};

export function emptyLogsView(): LogsView {
	return { logs: null, error: null, endNote: null, loading: false, spinning: false, updatedAt: null };
}

/** Copy is offered only with lines on view. */
export function canCopy(view: LogsView): boolean {
	return (view.logs?.lines.length ?? 0) > 0;
}

/** Exactly the lines on view, as Copy puts them on the clipboard. */
export function logsText(view: LogsView): string {
	return view.logs?.lines.join('\n') ?? '';
}

export type LogsForm = { action: string; name: string; hostId: string; entryKind: 'program' | 'image' };

export type LogsLoaderDeps = {
	fetch: typeof fetch;
	deserialize: (text: string) => ActionResult;
	goto: (path: string) => Promise<unknown>;
	/** `location.origin`, for redirects. */
	origin: string;
	form: LogsForm;
	/** Called after any change to `view`, before the page shows it. */
	onChange: (view: LogsView) => void;
	now?: () => Date;
};

/**
 * Posts the existing `catalogLogs` action for one drawer and keeps what it shows. No runes: the
 * drawer copies `view` in `onChange`. Closing aborts the request in flight and drops any late answer.
 */
export class LogsLoader {
	view: LogsView = emptyLogsView();
	private readonly deps: LogsLoaderDeps;
	private request: AbortController | null = null;
	/** The Lines choice, sent with every fetch. */
	private lines = DEFAULT_LOG_LINES;
	/** Bumped by open and close, so an answer for an earlier opening is dropped. */
	private generation = 0;

	constructor(deps: LogsLoaderDeps) {
		this.deps = deps;
	}

	/** A fresh view for a new opening. The caller then fetches. */
	open(): void {
		this.generation += 1;
		this.set(emptyLogsView());
	}

	close(): void {
		this.generation += 1;
		this.request?.abort();
		this.request = null;
		this.set(emptyLogsView());
	}

	/** The next fetch asks for this choice. */
	setLines(lines: number): void {
		this.lines = lines;
	}

	endLive(note: string | null): void {
		this.set({ ...this.view, endNote: note });
	}

	/** Resolves true when lines arrived. Ignored (false) while a request runs. Never rejects. `manual` is false only for a Live poll. */
	async load(manual: boolean): Promise<boolean> {
		if (this.request) return false;
		const generation = this.generation;
		const controller = new AbortController();
		this.request = controller;
		this.set({ ...this.view, loading: true, spinning: manual });
		const current = () => generation === this.generation && !controller.signal.aborted;
		let ok = false;
		/** A redirect off this site, or an unreadable answer, shows the generic error. */
		let error: string | null = LOGS_FAILED;
		try {
			const { action, name, hostId, entryKind } = this.deps.form;
			const body = new FormData();
			body.set('name', name);
			body.set('host_id', hostId);
			if (entryKind === 'image') body.set('entry_kind', 'image');
			body.set('lines', String(this.lines));
			const response = await this.deps.fetch(action, {
				method: 'POST',
				body,
				headers: { accept: 'application/json', 'x-sveltekit-action': 'true' },
				signal: controller.signal
			});
			const outcome = logsOutcome(this.deps.deserialize(await response.text()));
			if (!current()) return false;
			if (outcome.kind === 'logs') {
				ok = true;
				this.set({ ...this.view, logs: outcome.logs, error: null, endNote: null, updatedAt: (this.deps.now ?? (() => new Date()))() });
			} else if (outcome.kind === 'redirect') {
				const path = sameOriginPath(outcome.location, this.deps.origin);
				if (path != null) {
					error = null;
					await this.deps.goto(path);
				}
			} else {
				error = outcome.message;
			}
		} catch {
			// A network failure or an unreadable answer shows the generic error.
		} finally {
			if (this.request === controller) this.request = null;
		}
		if (!current()) return false;
		this.set({ ...this.view, loading: false, spinning: false, error: ok ? null : error });
		return ok;
	}

	private set(view: LogsView): void {
		this.view = view;
		this.deps.onChange(view);
	}
}

type LinesTargets = { loader: Pick<LogsLoader, 'setLines'>; poller: Pick<LogsPoller, 'fetchSoon' | 'setLive'> };

/**
 * The user picked a value: every later fetch asks for it, and one fetch shows it now, or right after a running one.
 * While Live is on that fetch counts as a Live poll.
 */
export function chooseLines({ loader, poller }: LinesTargets, choice: number, live: boolean): LinesState {
	loader.setLines(choice);
	poller.fetchSoon(!live);
	return { choice, beforeLive: null };
}

/**
 * The Live switch. On: a choice above 500 becomes 500 before the first poll. Off: the choice Live replaced
 * comes back and is fetched once; with nothing replaced, no fetch.
 */
export function switchLive({ loader, poller }: LinesTargets, state: LinesState, on: boolean): LinesState {
	if (on) {
		const next = linesOnLiveOn(state.choice);
		loader.setLines(next.choice);
		poller.setLive(true);
		return next;
	}
	const off = linesOnLiveOff(state);
	loader.setLines(off.state.choice);
	poller.setLive(false);
	if (off.fetch) poller.fetchSoon(true);
	return off.state;
}
