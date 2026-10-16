/** Blank a secret field, then apply the action result. Success and failure both clear it. */
export async function clearSecretField(assign: (value: string) => void, update: () => Promise<void>): Promise<void> {
	assign('');
	await update();
}

export type FileSaveState = {
	content: string;
	name: string;
	secret: boolean;
	saved: string | null;
};

/** Blank the paste before the result is applied. Name and secret reset only after a successful redirect. */
export async function settleFileSave(
	assign: (next: FileSaveState) => void,
	current: { name: string; secret: boolean },
	submittedName: string,
	update: () => Promise<void>,
	resultType: string
): Promise<void> {
	await clearSecretField((value) => {
		assign({ content: value, name: current.name, secret: current.secret, saved: null });
	}, update);
	if (resultType === 'redirect') assign({ content: '', name: '', secret: true, saved: submittedName });
}

/** Move focus to the viewed file after the action result is on the page. */
export async function showViewedFile(update: () => Promise<void>, focus: () => void): Promise<void> {
	await update();
	focus();
}
