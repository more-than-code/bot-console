import { redirect } from '@sveltejs/kit';
import { safeNext } from '$lib/server/session';
import { parseTheme, THEME_COOKIE, themeCookieOptions } from '$lib/theme';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const theme = parseTheme(form.get('theme')?.toString());
		cookies.set(THEME_COOKIE, theme, themeCookieOptions(url));
		redirect(303, safeNext(form.get('next')?.toString(), '/'));
	}
};
