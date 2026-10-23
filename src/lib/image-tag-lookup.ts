import { byteLength } from '$lib/catalog';
import {
	DIGEST_PATTERN,
	PIN_FAILED,
	TAG_DEBOUNCE_MS,
	imageRepository,
	pinnedLine,
	pinnedRef,
	taggedRef,
	type ImageDigestResult,
	type ImageTagsResult,
	type TagLookup,
	type TagLookupError
} from '$lib/image-tags';

/** A stored image reference is at most 255 bytes, so a longer pinned value is not written. */
const IMAGE_MAX_BYTES = 255;

/** Answers worth asking again: rate limits, timeouts, unreachable registries, malformed answers. Never cached. */
const RETRYABLE = new Set<TagLookupError>(['failed', 'unreachable']);

export type TagLookupDeps = {
	schedule: (run: () => void, ms: number) => unknown;
	cancel: (handle: unknown) => void;
	/** Posts the tags request. The answer comes back through `takeTags(repo, …)`. */
	requestTags: (repo: string) => void;
	/** Posts the digest request. The answer comes back through `takeDigest(…, ref, …)`. */
	requestDigest: (ref: string) => void;
	/** Called after any change the view shows. */
	onChange: () => void;
};

/**
 * Registry tags and tag digests for one open Image field (api-v1 v1.16). No runes: the form
 * re-reads it after `onChange`. Results are kept per repository while the form is open, except
 * retryable errors, which stay visible until the next focus (or a change back to that repository) asks again.
 */
export class ImageTagLookup {
	private readonly deps: TagLookupDeps;
	private readonly cache = new Map<string, TagLookup>();
	/** Last retryable error per repository. Shown, but not a reason to skip a request. */
	private readonly errors = new Map<string, TagLookupError>();
	private lastRepo: string | null = null;
	private pendingRepo: string | null = null;
	private timer: unknown = null;
	private supported = true;
	private pinned: { image: string; digest: string } | null = null;
	private pinFailedFor: string | null = null;

	constructor(deps: TagLookupDeps) {
		this.deps = deps;
	}

	/** Call when the field's value or focus changes. A lookup starts 400 ms after the repository last changed. */
	update(value: string, focused: boolean): void {
		if (!focused) {
			this.clearTimer();
			// The next focus asks again for a repository whose last answer was retryable.
			this.lastRepo = null;
			return;
		}
		const repo = imageRepository(value);
		if (!this.supported || repo == null) {
			this.clearTimer();
			return;
		}
		if (repo === this.lastRepo || repo === this.pendingRepo) return;
		this.clearTimer();
		this.pendingRepo = repo;
		this.timer = this.deps.schedule(() => {
			this.timer = null;
			this.pendingRepo = null;
			this.fetch(repo);
		}, TAG_DEBOUNCE_MS);
	}

	dispose(): void {
		this.clearTimer();
	}

	/** The state shown for a value's repository. */
	lookup(value: string): TagLookup | undefined {
		if (!this.supported) return undefined;
		const repo = imageRepository(value);
		if (repo == null) return undefined;
		const cached = this.cache.get(repo);
		if (cached) return cached;
		const error = this.errors.get(repo);
		return error ? { state: error } : undefined;
	}

	takeTags(repo: string, result: ImageTagsResult | null): void {
		const state = result?.state ?? 'failed';
		this.errors.delete(repo);
		if (state === 'ready') {
			this.cache.set(repo, { state: 'ready', tags: result?.tags ?? [], truncated: result?.truncated ?? false });
		} else if (RETRYABLE.has(state)) {
			this.cache.delete(repo);
			this.errors.set(repo, state);
		} else {
			if (state === 'unsupported') this.supported = false;
			this.cache.set(repo, { state });
		}
		this.deps.onChange();
	}

	/** Picking a tag gives `<repo>:<tag>` (any digest dropped) and asks for its digest. Returns the new value. */
	pick(value: string, tag: string): string | null {
		const repo = imageRepository(value);
		if (repo == null) return null;
		const next = taggedRef(repo, tag);
		this.pinned = null;
		this.pinFailedFor = null;
		if (this.supported) this.deps.requestDigest(next);
		this.deps.onChange();
		return next;
	}

	/**
	 * A digest answer for the picked `requested`. Returns the pinned value to write, or null.
	 * A stale answer (the field changed since the pick) changes nothing.
	 */
	takeDigest(current: string, requested: string, result: ImageDigestResult | null): string | null {
		if (current !== requested || result?.state === 'unsupported') return null;
		const digest = result?.state === 'ready' ? result.digest : null;
		const value = digest != null && DIGEST_PATTERN.test(digest) ? pinnedRef(requested, digest) : null;
		if (value == null || digest == null || byteLength(value) > IMAGE_MAX_BYTES) {
			this.pinFailedFor = requested;
			this.deps.onChange();
			return null;
		}
		this.pinned = { image: value, digest };
		this.deps.onChange();
		return value;
	}

	/** "Pinned to …" or the pin failure line, only while the field holds that value. */
	pinLine(value: string): string | null {
		if (this.pinned && this.pinned.image === value) return pinnedLine(this.pinned.digest);
		if (this.pinFailedFor === value) return PIN_FAILED;
		return null;
	}

	private fetch(repo: string): void {
		this.lastRepo = repo;
		if (this.cache.has(repo)) return;
		this.errors.delete(repo);
		this.cache.set(repo, { state: 'loading' });
		this.deps.requestTags(repo);
		this.deps.onChange();
	}

	private clearTimer(): void {
		if (this.timer != null) this.deps.cancel(this.timer);
		this.timer = null;
		this.pendingRepo = null;
	}
}
