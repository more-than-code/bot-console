import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildPitchDiagram, OUTPUT, readSources } from '../scripts/build-pitch-diagram.mjs';

test('PitchDiagram.svelte matches design/pitch-diagram*.svg (run pnpm build:diagram after editing them)', () => {
	assert.equal(readFileSync(OUTPUT, 'utf8'), buildPitchDiagram(...readSources()));
});

test('the diagram build refuses scripts, links and unknown classes', () => {
	const [landscape, portrait] = readSources();
	assert.throws(() => buildPitchDiagram(landscape.replace('</svg>', '<script>x</script></svg>'), portrait), /<script/);
	assert.throws(() => buildPitchDiagram(landscape, portrait.replace('</svg>', '<a href="x"/></svg>')), /href/);
	assert.throws(() => buildPitchDiagram(landscape.replace('class="ink"', 'class="loud"'), portrait), /unknown class/);
});
