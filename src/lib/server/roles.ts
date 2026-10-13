import type { Role } from '../api-types';

const RANK: Record<Role, number> = { viewer: 1, admin: 2, owner: 3 };

export function isRole(value: unknown): value is Role {
	return value === 'owner' || value === 'admin' || value === 'viewer';
}

export function roleAtLeast(role: Role | null | undefined, minimum: Role): boolean {
	if (!role || !isRole(role)) return false;
	return RANK[role] >= RANK[minimum];
}

/** Hide a control unless every source agrees the caller has it. */
export function uiRole(localsRole: Role | null, payloadRole: Role | null): Role | null {
	if (localsRole && payloadRole) return RANK[localsRole] <= RANK[payloadRole] ? localsRole : payloadRole;
	return payloadRole ?? localsRole;
}
