import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withQuery } from '../src/lib/table-href.ts';
import { compareValues, slicePage } from '../src/lib/table-query.ts';

test('compareValues keeps nulls last in both directions', () => {
	assert.equal(compareValues(1, null, 'asc'), -1);
	assert.equal(compareValues(null, 1, 'desc'), 1);
	assert.equal(compareValues(1, 2, 'desc'), 1);
	assert.equal(compareValues('b', 'A', 'asc'), 1);
});

test('slicePage returns the requested window and an empty page past the end', () => {
	assert.deepEqual(slicePage(['a', 'b', 'c'], null, null), ['a', 'b', 'c']);
	assert.deepEqual(slicePage(['a', 'b', 'c'], 2, 2), ['c']);
	assert.deepEqual(slicePage(['a', 'b', 'c'], 4, 2), []);
});

test('withQuery omits empty values and keeps a stable key order', () => {
	assert.equal(withQuery('/services', { host: null, q: null }), '/services');
	assert.equal(
		withQuery('/processes', { page: '2', host: 'pi1', q: 'node' }, { page: null }),
		'/processes?host=pi1&q=node'
	);
});
