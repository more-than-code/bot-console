export const THEME_COOKIE = 'bot_theme';
export const THEME_MAX_AGE = 31536000;

export const THEME_CHOICES = ['system', 'light', 'dark'] as const;

export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** Allowlisted cookie value. Anything else, including a missing cookie, is system. */
export function parseTheme(value: string | null | undefined): ThemeChoice {
	if (value === 'light' || value === 'dark' || value === 'system') return value;
	return 'system';
}

/** Exactly one marker. Light adds nothing. The raw cookie is never included. */
export function themeMarker(theme: ThemeChoice): string {
	if (theme === 'dark') return ' class="dark"';
	if (theme === 'system') return ' data-theme="system"';
	return '';
}

/** Insert the marker on the first `<html` tag. */
export function applyThemeMarker(html: string, theme: ThemeChoice): string {
	return html.replace('<html', `<html${themeMarker(theme)}`);
}

export function themeCookieOptions(url: URL): {
	httpOnly: true;
	sameSite: 'lax';
	path: '/';
	maxAge: number;
	secure: boolean;
} {
	return {
		httpOnly: true,
		sameSite: 'lax',
		path: '/',
		maxAge: THEME_MAX_AGE,
		secure: url.protocol === 'https:'
	};
}

/** Apply a choice on the document element. No-op during SSR. */
export function applyThemeClass(theme: ThemeChoice): void {
	if (typeof document === 'undefined') return;
	const root = document.documentElement;
	const prefersDark =
		typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
	root.classList.toggle('dark', theme === 'dark' || (theme === 'system' && prefersDark));
	if (theme === 'system') root.setAttribute('data-theme', 'system');
	else root.removeAttribute('data-theme');
}
