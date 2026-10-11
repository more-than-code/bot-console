import { isHostName } from '$lib/host';

/** Shape check only. A name is known only if the database still has it. */
export function match(param: string): boolean {
	return isHostName(param);
}
