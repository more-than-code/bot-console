import type { Project, User } from '$lib/api-types';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			authEnabled: boolean;
			user: User | null;
			projects: Project[];
			sessionUnavailable: boolean;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
