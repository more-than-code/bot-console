import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Joe 2026-10-26 (spec-release-v0218 §2.5): https://deploybot.dev/llms.txt, served from static/.
const LLMS = readFileSync('static/llms.txt', 'utf8');

test('llms.txt starts with the Deploybot heading and the pitch', () => {
	assert.ok(LLMS.startsWith('# Deploybot\n\n> Deploybot lets any AI agent that speaks MCP run your own servers'));
	assert.ok(LLMS.includes('https://mcp.deploybot.dev/mcp'));
});

test('llms.txt names no retired hosts and claims no macOS support', () => {
	assert.doesNotMatch(LLMS, /api2\.|console2\.|macos|mac mini/i);
});
