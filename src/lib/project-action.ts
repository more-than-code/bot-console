import type { CreatedJoin } from '$lib/api-types';

export type ProjectScope = 'hosts' | 'members' | 'tokens' | 'settings';

export type ProjectActionData = {
	scope: ProjectScope;
	message?: string;
	confirmHostId?: string;
	created?: CreatedJoin;
};
