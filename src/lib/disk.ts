/**
 * Whole-disk names only. Partitions (mmcblk0p1, sda1, nvme0n1p1) are excluded
 * so read/write rates are not double-counted.
 */
export const WHOLE_DISK_PATTERN =
	'^(sd[a-z]+|vd[a-z]+|hd[a-z]+|xvd[a-z]+|mmcblk[0-9]+|nvme[0-9]+n[0-9]+)$';

const WHOLE_DISK = new RegExp(WHOLE_DISK_PATTERN);

export function isWholeDisk(name: string): boolean {
	return WHOLE_DISK.test(name);
}
