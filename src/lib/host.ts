/**
 * Shape of a Telegraf host tag or a metrics.hosts name.
 * This is not an inventory of nodes. Dots and mixed case are allowed.
 * Slashes, spaces, and ".." are not.
 */
const HOST_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

export function isHostName(name: string): boolean {
	return name.length <= 253 && !name.includes('..') && HOST_NAME.test(name);
}
