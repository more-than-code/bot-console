import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** The hook redirects first. This keeps `/` in the route manifest for client navigation. */
export const load: PageServerLoad = () => {
	redirect(303, '/projects');
};
