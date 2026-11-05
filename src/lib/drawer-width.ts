/**
 * Resizable drawers (umbrella `docs/spec-resizable-drawers.md`): one remembered width per drawer type.
 * From `md` up the drawer's left edge can be dragged; the width is kept in localStorage as whole pixels,
 * one key per type. Nothing else is stored; the auth-session test allows this one file to use localStorage.
 */

export const DRAWER_TYPES = ['logs', 'deploy', 'program', 'container', 'permissions'] as const;
export type DrawerType = (typeof DRAWER_TYPES)[number];

/** Width when nothing valid is stored, in px. */
export const DRAWER_DEFAULT_WIDTH: Record<DrawerType, number> = {
	logs: 720,
	deploy: 672,
	program: 560,
	container: 560,
	permissions: 560
};

/** The name in the handle's label, "Resize {name} panel". */
export const DRAWER_LABEL: Record<DrawerType, string> = {
	logs: 'Logs',
	deploy: 'Deploy',
	program: 'Program',
	container: 'Container',
	permissions: 'Permissions'
};

export const WIDTH_MIN = 360;
/** The drawer is at most this share of the window width. */
export const WIDTH_MAX_SHARE = 0.9;
/** A stored value above this is junk, whatever the window. */
export const STORED_WIDTH_MAX = 10000;
export const KEY_STEP = 16;
export const KEY_STEP_LARGE = 64;
/** Tailwind's `md` breakpoint: below it the drawer is full width with no handle, and nothing is read or saved. */
export const WIDE_QUERY = '(min-width: 48rem)';

type WidthStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function widthKey(type: DrawerType): string {
	return `deploybot.drawer.width.${type}`;
}

export function maxWidth(windowWidth: number): number {
	return Math.max(WIDTH_MIN, Math.floor(windowWidth * WIDTH_MAX_SHARE));
}

/** A whole number of px between the minimum and 90% of the window. */
export function clampWidth(width: number, windowWidth: number): number {
	return Math.round(Math.min(Math.max(width, WIDTH_MIN), maxWidth(windowWidth)));
}

/** A stored value as px, or null when it is missing, not a whole number, or out of range. */
export function parseWidth(raw: string | null | undefined): number | null {
	if (raw == null || !/^\d{1,6}$/.test(raw)) return null;
	const width = Number(raw);
	return width >= WIDTH_MIN && width <= STORED_WIDTH_MAX ? width : null;
}

/** The browser's localStorage, or null on the server or when it is blocked. */
export function widthStorage(): WidthStorage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

/** The saved width for a type (not clamped to the window), or its default. */
export function readWidth(storage: WidthStorage | null, type: DrawerType): number {
	try {
		return parseWidth(storage?.getItem(widthKey(type))) ?? DRAWER_DEFAULT_WIDTH[type];
	} catch {
		return DRAWER_DEFAULT_WIDTH[type];
	}
}

export function saveWidth(storage: WidthStorage | null, type: DrawerType, width: number): void {
	const value = Math.round(width);
	if (parseWidth(String(value)) == null) return;
	try {
		storage?.setItem(widthKey(type), String(value));
	} catch {
		// Blocked or full storage: the width just is not remembered.
	}
}

export function clearWidth(storage: WidthStorage | null, type: DrawerType): void {
	try {
		storage?.removeItem(widthKey(type));
	} catch {
		// Nothing to do.
	}
}

/**
 * The width after a key on the handle, or null for any other key. The handle is the drawer's left edge,
 * so Left widens and Right narrows; Shift makes the step larger; Home is the maximum and End the minimum.
 */
export function keyWidth(key: string, shift: boolean, width: number, windowWidth: number): number | null {
	const step = shift ? KEY_STEP_LARGE : KEY_STEP;
	switch (key) {
		case 'ArrowLeft':
			return clampWidth(width + step, windowWidth);
		case 'ArrowRight':
			return clampWidth(width - step, windowWidth);
		case 'Home':
			return maxWidth(windowWidth);
		case 'End':
			return WIDTH_MIN;
		default:
			return null;
	}
}
