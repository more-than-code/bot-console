import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

type RGB = [number, number, number];

/** CSS Color 4: OKLCH → OKLab → linear sRGB. Channels may sit slightly outside 0..1. */
export function oklchToLinearSrgb(L: number, C: number, H: number): RGB {
	const radians = (H * Math.PI) / 180;
	const a = C * Math.cos(radians);
	const b = C * Math.sin(radians);
	const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
	const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
	const s_ = L - 0.0894841775 * a - 1.291485548 * b;
	const l = l_ ** 3;
	const m = m_ ** 3;
	const s = s_ ** 3;
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
	];
}

function clamp01(channel: number): number {
	return Math.min(1, Math.max(0, channel));
}

/** WCAG relative luminance from linear sRGB, with out-of-gamut channels clipped. */
export function relativeLuminance(rgb: RGB): number {
	const [r, g, b] = rgb.map(clamp01);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: number, b: number): number {
	const [lighter, darker] = a > b ? [a, b] : [b, a];
	return (lighter + 0.05) / (darker + 0.05);
}

function srgbEncode(channel: number): number {
	const c = clamp01(channel);
	return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function srgbDecode(channel: number): number {
	return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** Painted `ring-ring/50`: the ring colour at 50% alpha, composited in sRGB over the surface. */
export function compositeSrgb(foreground: RGB, background: RGB, alpha: number): RGB {
	return foreground.map((channel, index) => {
		const under = background[index] ?? 0;
		return srgbDecode(srgbEncode(channel) * alpha + srgbEncode(under) * (1 - alpha));
	}) as RGB;
}

type Tokens = Record<string, RGB>;

function block(css: string, selector: ':root' | '.dark'): string {
	const pattern = selector === ':root' ? /(?:^|\n):root\s*\{/ : /(?:^|\n)\.dark\s*\{/;
	const start = pattern.exec(css);
	assert.ok(start, `missing ${selector}`);
	const open = css.indexOf('{', start.index);
	let depth = 0;
	for (let i = open; i < css.length; i += 1) {
		if (css[i] === '{') depth += 1;
		else if (css[i] === '}') {
			depth -= 1;
			if (depth === 0) return css.slice(open + 1, i);
		}
	}
	throw new Error(`unclosed ${selector}`);
}

function tokensIn(css: string, selector: ':root' | '.dark'): Tokens {
	const tokens: Tokens = {};
	const source = block(css, selector);
	for (const match of source.matchAll(/--([a-z0-9-]+):\s*oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*\)/g)) {
		const name = match[1];
		const l = Number(match[2]);
		const c = Number(match[3]);
		const h = Number(match[4]);
		assert.ok(name);
		tokens[name] = oklchToLinearSrgb(l, c, h);
	}
	return tokens;
}

function y(tokens: Tokens, name: string): number {
	const rgb = tokens[name];
	assert.ok(rgb, `missing --${name}`);
	return relativeLuminance(rgb);
}

function assertAtLeast(ratio: number, minimum: number, label: string): void {
	assert.ok(ratio + 1e-9 >= minimum, `${label} is ${ratio.toFixed(2)}:1, need ${minimum}:1`);
}

const TEXT = ['foreground', 'card-foreground', 'muted-foreground'] as const;
const STATUS = ['status-online', 'status-offline', 'status-asleep', 'status-revoked', 'status-up', 'status-down', 'status-unknown'] as const;
const SURFACES = ['background', 'card', 'popover', 'muted'] as const;

test('oklch white and black are the sRGB endpoints', () => {
	const white = relativeLuminance(oklchToLinearSrgb(1, 0, 0));
	const black = relativeLuminance(oklchToLinearSrgb(0, 0, 0));
	assert.ok(Math.abs(white - 1) < 1e-9, String(white));
	assert.ok(Math.abs(black) < 1e-9, String(black));
	assert.ok(Math.abs(contrastRatio(white, black) - 21) < 1e-9);
});

test('sRGB red survives the oklch conversion', () => {
	const [r, g, b] = oklchToLinearSrgb(0.627955, 0.257683, 29.2339);
	assert.ok(Math.abs(r - 1) < 1e-3, String(r));
	assert.ok(Math.abs(g) < 1e-3, String(g));
	assert.ok(Math.abs(b) < 1e-3, String(b));
});

test('theme tokens keep their contrast floors', () => {
	const css = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');
	for (const selector of [':root', '.dark'] as const) {
		const tokens = tokensIn(css, selector);
		for (const text of TEXT) {
			for (const surface of ['background', 'card'] as const) {
				assertAtLeast(contrastRatio(y(tokens, text), y(tokens, surface)), 4.5, `${selector} ${text} on ${surface}`);
			}
		}
		for (const status of STATUS) {
			assertAtLeast(contrastRatio(y(tokens, status), y(tokens, 'background')), 4.5, `${selector} ${status} on background`);
		}
		for (const surface of ['background', 'card'] as const) {
			assertAtLeast(contrastRatio(y(tokens, 'input'), y(tokens, surface)), 3, `${selector} input on ${surface}`);
		}
		// Toasts (and menus) paint popover-foreground on popover.
		assertAtLeast(contrastRatio(y(tokens, 'popover-foreground'), y(tokens, 'popover')), 4.5, `${selector} popover-foreground on popover`);
		const ring = tokens.ring;
		assert.ok(ring);
		for (const surface of SURFACES) {
			const under = tokens[surface];
			assert.ok(under, surface);
			const painted = relativeLuminance(compositeSrgb(ring, under, 0.5));
			assertAtLeast(contrastRatio(painted, relativeLuminance(under)), 3, `${selector} focus ring on ${surface}`);
		}
	}
});
