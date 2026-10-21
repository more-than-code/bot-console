import { present } from '$lib/server/redact';
import { parseTheme, THEME_COOKIE } from '$lib/theme';
import { parseTimeZone, systemTimeZone, TIME_ZONE_COOKIE } from '$lib/time-zone';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = (event) => {
	const user = event.locals.user ? { id: event.locals.user.id, name: event.locals.user.name } : null;
	const timeZone = parseTimeZone(event.cookies.get(TIME_ZONE_COOKIE)) ?? systemTimeZone();
	return present(event, { user, theme: parseTheme(event.cookies.get(THEME_COOKIE)), timeZone });
};
