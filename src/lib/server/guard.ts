import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import type { User } from '../api-types';
import { apiBaseUrl, NOT_CONFIGURED_MESSAGE } from './api';
import { signinLocation } from './session';

export function requireApi(): void {
	if (!apiBaseUrl()) error(503, NOT_CONFIGURED_MESSAGE);
}

export function requireUser(event: RequestEvent): User {
	requireApi();
	if (!event.locals.user) redirect(303, signinLocation(event.url));
	return event.locals.user;
}
