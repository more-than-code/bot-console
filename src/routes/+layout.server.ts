import { present } from '$lib/server/redact';
import { parseTheme, THEME_COOKIE } from '$lib/theme';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = (event) => {
	const user = event.locals.user ? { id: event.locals.user.id, name: event.locals.user.name } : null;
	return present(event, { user, theme: parseTheme(event.cookies.get(THEME_COOKIE)) });
};
