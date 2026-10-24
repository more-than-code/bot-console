/** The avatar URL to show, or null. Only https URLs are used; anything else falls back to the initial. */
export function avatarSrc(url: string | null | undefined): string | null {
	if (!url) return null;
	try {
		return new URL(url).protocol === 'https:' ? url : null;
	} catch {
		return null;
	}
}

/** The first letter of the name, upper-cased, for the avatar fallback. */
export function avatarInitial(name: string | null | undefined): string {
	const first = (name ?? '').trim().charAt(0);
	return first ? first.toLocaleUpperCase() : '?';
}
