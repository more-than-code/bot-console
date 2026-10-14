import assert from 'node:assert/strict';
import { test } from 'node:test';
import { typeToConfirmMatches } from '../src/lib/confirm.ts';

test('type-to-confirm matches the expected text exactly', () => {
	assert.equal(typeToConfirmMatches('Lab', 'Lab'), true);
	assert.equal(typeToConfirmMatches('lab', 'Lab'), false);
	assert.equal(typeToConfirmMatches('Lab ', 'Lab'), false);
	assert.equal(typeToConfirmMatches('', 'Lab'), false);
});
