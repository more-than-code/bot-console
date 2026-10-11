import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isWholeDisk } from '../src/lib/disk.ts';
import { isHostName } from '../src/lib/host.ts';
import { parseRange } from '../src/lib/ranges.ts';

test('host name shape is not a fixed node list', () => {
	for (const name of ['pi1', 'a', 'grok-bot-box', 'ip-10-0-1-5', 'mac.local', 'Mac.local', 'pi_1']) {
		assert.equal(isHostName(name), true, name);
	}
	assert.equal(isHostName('a'.repeat(63)), true);
	assert.equal(isHostName('a'.repeat(253)), true);
	assert.equal(isHostName(''), false);
	assert.equal(isHostName('a-'), false);
	assert.equal(isHostName('-a'), false);
	assert.equal(isHostName('a'.repeat(254)), false);
	assert.equal(isHostName('../pi1'), false);
	assert.equal(isHostName('a..b'), false);
	assert.equal(isHostName('has space'), false);
	assert.equal(isHostName('a/b'), false);
});

test('ranges', () => {
	assert.equal(parseRange(null), null);
	assert.equal(parseRange('1h'), '1h');
	assert.equal(parseRange('1d'), '1d');
	assert.equal(parseRange('1w'), '1w');
	assert.equal(parseRange('2d'), null);
	assert.equal(parseRange('1h;drop'), null);
});

test('whole disks', () => {
	assert.equal(isWholeDisk('mmcblk0'), true);
	assert.equal(isWholeDisk('mmcblk0p1'), false);
	assert.equal(isWholeDisk('mmcblk0p2'), false);
	assert.equal(isWholeDisk('nvme0n1'), true);
	assert.equal(isWholeDisk('nvme0n1p1'), false);
	assert.equal(isWholeDisk('sda'), true);
	assert.equal(isWholeDisk('sda1'), false);
	assert.equal(isWholeDisk('vda'), true);
	assert.equal(isWholeDisk('loop0'), false);
	assert.equal(isWholeDisk('dm-0'), false);
});
