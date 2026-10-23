import { normalizeImageRef } from '$lib/image-spec';

/** Registry tags and tag digests for the Image field (api-v1 v1.16). Pure helpers, shared by the form and the actions. */

export const TAG_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
export const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
/** Options shown at once. The rest is reached by typing after the `:`. */
export const TAG_OPTION_CAP = 50;
export const TAG_DEBOUNCE_MS = 400;

/** Why a lookup gave no tags. `unsupported` is an older API (404): the field stays a plain input with no message. */
export type TagLookupError = 'unsupported' | 'not_allowed' | 'auth_failed' | 'not_found' | 'unreachable' | 'failed';
export type TagLookup = { state: 'loading' } | { state: 'ready'; tags: string[]; truncated: boolean } | { state: TagLookupError };

/** Action result for `?/catalogImageTags`. */
export type ImageTagsResult = { state: 'ready' | TagLookupError; tags: string[]; truncated: boolean };
/** Action result for `?/catalogImageDigest`. */
export type ImageDigestResult = { state: 'ready' | TagLookupError; digest: string | null };

export const TAG_MESSAGES: Record<Exclude<TagLookupError, 'unsupported'>, string> = {
	not_allowed: "Tags are only listed for known registries and this project's registries.",
	auth_failed: 'The registry refused the stored credentials.',
	not_found: 'Image not found in the registry, or it is private.',
	unreachable: 'Could not reach the registry.',
	failed: 'Could not load tags.'
};

export const PIN_FAILED = 'Could not pin a digest; the tag will be used.';
export const TAGS_LOADING = 'Loading tags…';

/** The value without its `@digest` and `:tag`. */
function splitRef(value: string): { repo: string; tag: string | null; digest: string | null } {
	const trimmed = value.trim();
	const at = trimmed.indexOf('@');
	const name = at === -1 ? trimmed : trimmed.slice(0, at);
	const digest = at === -1 ? null : trimmed.slice(at + 1);
	const slash = name.lastIndexOf('/');
	const colon = name.lastIndexOf(':');
	if (colon > slash) return { repo: name.slice(0, colon), tag: name.slice(colon + 1), digest };
	return { repo: name, tag: null, digest };
}

/** The repository part of an Image value, or null when it is not a valid reference. A `host:port` prefix is kept. */
export function imageRepository(value: string): string | null {
	const { repo } = splitRef(value);
	if (repo === '' || !normalizeImageRef(repo).ok) return null;
	return repo;
}

/** The text after the tag `:`, used to filter the options. Empty when there is none. */
export function tagQuery(value: string): string {
	return splitRef(value).tag ?? '';
}

/** True for `<repo>:<tag>` with a valid tag and no digest: the only shape the digest route accepts. */
export function isTaggedRef(value: string): boolean {
	if (value !== value.trim() || value.includes('@')) return false;
	const { repo, tag } = splitRef(value);
	return tag != null && TAG_PATTERN.test(tag) && imageRepository(repo) === repo;
}

/** Tags containing the query (case-insensitive), in API order, at most `cap`, and how many more matched. */
export function filterTags(tags: readonly string[], query: string, cap = TAG_OPTION_CAP): { shown: string[]; more: number } {
	const needle = query.toLowerCase();
	const matched = needle === '' ? [...tags] : tags.filter((tag) => tag.toLowerCase().includes(needle));
	return { shown: matched.slice(0, cap), more: Math.max(0, matched.length - cap) };
}

export function moreLabel(count: number): string {
	return `${count} more, type to filter`;
}

/** Picking a tag gives `<repo>:<tag>` and drops any digest. */
export function taggedRef(repo: string, tag: string): string {
	return `${repo}:${tag}`;
}

export function pinnedRef(tagged: string, digest: string): string {
	return `${tagged}@${digest}`;
}

/** `sha256:` and the first 12 hex digits. */
export function shortDigest(digest: string): string {
	return `${digest.slice(0, 'sha256:'.length + 12)}…`;
}

export function pinnedLine(digest: string): string {
	return `Pinned to ${shortDigest(digest)}`;
}

/** Maps an API failure to a message key. `reason` is `payload.reason` of `registry_unavailable`. */
export function tagLookupError(status: number, code: string, msg: string, reason: unknown): TagLookupError {
	if (status === 404) return 'unsupported';
	if (code === 'bad_request' && msg === 'registry not allowed') return 'not_allowed';
	if (code === 'registry_unavailable' && (reason === 'auth_failed' || reason === 'not_found' || reason === 'unreachable')) return reason;
	return 'failed';
}

/** The line under the field for a lookup, or null (loading, ready, or an older API). */
export function tagLookupMessage(lookup: TagLookup | undefined): string | null {
	if (!lookup || lookup.state === 'loading' || lookup.state === 'ready' || lookup.state === 'unsupported') return null;
	return TAG_MESSAGES[lookup.state];
}

/** Ids of the lines under the Image field. */
export function imageNoteIds(fieldId: string): { tags: string; pin: string } {
	return { tags: `${fieldId}-image-tags`, pin: `${fieldId}-image-pin` };
}

/** `aria-describedby` for the Image field: the validation error, then the tags line, then the pin line, each only when shown. */
export function imageDescribedBy(fieldId: string, shown: { error: boolean; tags: boolean; pin: boolean }): string | undefined {
	const notes = imageNoteIds(fieldId);
	const ids = [shown.error ? `${fieldId}-error` : null, shown.tags ? notes.tags : null, shown.pin ? notes.pin : null].filter((id) => id != null);
	return ids.length > 0 ? ids.join(' ') : undefined;
}

export function tagCountLabel(count: number): string {
	return count === 1 ? '1 tag' : `${count} tags`;
}

/** Text for the polite live region: the pin line when there is one, else the lookup state. Empty when there is nothing to say. `shown` is the number of options listed. */
export function tagAnnouncement(lookup: TagLookup | undefined, pinLine: string | null, shown?: number): string {
	if (pinLine) return pinLine;
	if (lookup?.state === 'loading') return TAGS_LOADING;
	if (lookup?.state === 'ready') {
		const total = tagCountLabel(lookup.tags.length);
		// `shown` is passed only when the list is capped at 50.
		return shown != null && shown < lookup.tags.length ? `${total}, ${shown} shown; type to filter` : total;
	}
	return tagLookupMessage(lookup) ?? '';
}
