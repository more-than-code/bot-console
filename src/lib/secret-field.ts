/** Blank a secret field, then apply the action result. Success and failure both clear it. */
export async function clearSecretField(assign: (value: string) => void, update: () => Promise<void>): Promise<void> {
	assign('');
	await update();
}
