import { present } from '$lib/server/redact';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = (event) => {
	const user = event.locals.user ? { id: event.locals.user.id, name: event.locals.user.name } : null;
	return present(event, {
		authEnabled: event.locals.authEnabled === true,
		user
	});
};
