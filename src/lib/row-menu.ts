/**
 * The "⋯" row menus of the Catalog & services tab (spec §10). From `sm` up an entry shows [Deploy] [Edit]
 * [ ] [⋯] and a copy [Start/Stop] [Restart] [Logs] [⋯]; below `sm` only the ⋯ menu shows, so it then also
 * holds the icon actions (`phoneOnly`). Menu items are in a fixed order, destructive last.
 */
export type MenuKey = 'deploy' | 'edit' | 'permissions' | 'delete' | 'state' | 'restart' | 'logs' | 'digest' | 'health' | 'rename';

export type MenuItem = {
	key: MenuKey;
	label: string;
	/** Shown only below `sm`, where the row's icons are hidden. */
	phoneOnly: boolean;
	destructive?: boolean;
	/** Why it cannot run now (the item is disabled and says so). */
	disabledReason?: string | null;
};

/** The entry row's menu, by what the caller may do. */
export function entryMenuItems(input: { name: string; deploy: boolean; edit: boolean; owner: boolean }): MenuItem[] {
	const items: MenuItem[] = [];
	if (input.deploy) items.push({ key: 'deploy', label: `Deploy ${input.name}`, phoneOnly: true });
	if (input.edit) items.push({ key: 'edit', label: `Edit ${input.name}`, phoneOnly: true });
	if (input.owner) {
		items.push({ key: 'permissions', label: `Permissions ${input.name}`, phoneOnly: false });
		items.push({ key: 'delete', label: `Delete ${input.name}`, phoneOnly: false, destructive: true });
	}
	return items;
}

/** A copy row's menu. `state` is Start or Stop (or a blocked Start with its reason). */
export function copyMenuItems(input: {
	entry: string;
	host: string;
	state: { label: 'Start' | 'Stop'; disabledReason: string | null } | null;
	restart: boolean;
	logs: boolean;
	health: { disabledReason: string | null } | null;
	rename: boolean;
	label: string;
	/** The copy has an image digest: below `sm` (where the Digest column hides) the menu can copy it. */
	digest?: boolean;
}): MenuItem[] {
	const on = `${input.entry} on ${input.host}`;
	const items: MenuItem[] = [];
	if (input.state) items.push({ key: 'state', label: `${input.state.label} ${on}`, phoneOnly: true, disabledReason: input.state.disabledReason });
	if (input.restart) items.push({ key: 'restart', label: `Restart ${on}`, phoneOnly: true });
	if (input.logs) items.push({ key: 'logs', label: `Logs ${on}`, phoneOnly: true });
	if (input.digest) items.push({ key: 'digest', label: 'Copy digest', phoneOnly: true });
	if (input.health) items.push({ key: 'health', label: `Health checks ${input.label}`, phoneOnly: false, disabledReason: input.health.disabledReason });
	if (input.rename) items.push({ key: 'rename', label: `Rename ${input.label}`, phoneOnly: false });
	return items;
}

/** The ⋯ button shows on a wide screen only when some item is not phone-only. */
export function menuOnWide(items: readonly MenuItem[]): boolean {
	return items.some((item) => !item.phoneOnly);
}

/** The entry row's ⋯ button id: dialogs opened from its menu, and the Permissions drawer, return focus here. */
export function catalogEntryMenuId(entryId: string): string {
	return `catalog-menu-${entryId}`;
}
