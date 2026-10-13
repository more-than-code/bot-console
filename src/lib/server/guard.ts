import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import type { User } from '../api-types';
import { authEnabled } from './api';
import { signinLocation } from './session';

export function requireApi(): void {
	if (!authEnabled()) error(404, 'Not found');
}

export function requireUser(event: RequestEvent): User {
	requireApi();
	if (!event.locals.user) redirect(303, signinLocation(event.url));
	return event.locals.user;
}
