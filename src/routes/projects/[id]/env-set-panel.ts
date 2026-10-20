/** Open/add state for one env set. Collapse only flips `open`, so an edit draft stays. */

export type EnvSetPanel = {
	open: boolean;
	adding: boolean;
	addKey: string;
	addPlain: string;
	addSecret: boolean;
};

export function initialEnvSetPanel(): EnvSetPanel {
	return { open: true, adding: false, addKey: '', addPlain: '', addSecret: true };
}

export function envSetKeyCount(count: number): string {
	return count === 1 ? '1 key' : `${count} keys`;
}

export function toggleEnvSet(panel: EnvSetPanel): EnvSetPanel {
	return { ...panel, open: !panel.open };
}

/** Show the new row and expand the set. A draft already on screen is kept. */
export function beginAddVariable(panel: EnvSetPanel): EnvSetPanel {
	return { ...panel, open: true, adding: true };
}

export function cancelAddVariable(panel: EnvSetPanel): EnvSetPanel {
	return { ...panel, adding: false, addKey: '', addPlain: '', addSecret: true };
}

/** Flip the new-row secret flag. The typed value stays in `addPlain`. */
export function setAddSecret(panel: EnvSetPanel, secret: boolean): EnvSetPanel {
	return { ...panel, addSecret: secret };
}
