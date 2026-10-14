import type { CreatedJoin, ProbeView } from '$lib/api-types';

export type ProjectScope = 'hosts' | 'services' | 'members' | 'tokens' | 'settings';

export type ProjectActionData = {
	scope: ProjectScope;
	message?: string;
	confirmHostId?: string;
	created?: CreatedJoin;
	probe?: ProbeView;
	probeServiceId?: string;
	renameServiceId?: string;
	displayName?: string;
};
