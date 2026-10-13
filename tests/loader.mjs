import { existsSync, statSync } from 'node:fs';
import { dirname, extname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolvePath(fileURLToPath(new URL('.', import.meta.url)), '..');

function fileUrl(abs) {
	return pathToFileURL(abs).href;
}

function withExtension(abs) {
	if (extname(abs) && existsSync(abs) && statSync(abs).isFile()) return fileUrl(abs);
	for (const suffix of ['.ts', '.js', '.svelte']) {
		const candidate = abs + suffix;
		if (existsSync(candidate) && statSync(candidate).isFile()) return fileUrl(candidate);
	}
	if (existsSync(abs) && statSync(abs).isDirectory()) {
		for (const index of ['index.ts', 'index.js']) {
			const candidate = resolvePath(abs, index);
			if (existsSync(candidate)) return fileUrl(candidate);
		}
	}
	return null;
}

export async function resolve(specifier, context, nextResolve) {
	if (specifier === '$env/dynamic/private') {
		return { url: fileUrl(resolvePath(root, 'tests/stubs/env-private.ts')), shortCircuit: true };
	}
	if (specifier.startsWith('$lib/')) {
		const url = withExtension(resolvePath(root, 'src/lib', specifier.slice('$lib/'.length)));
		if (!url) throw new Error(`Cannot resolve ${specifier}`);
		return { url, shortCircuit: true };
	}
	if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
		if (!extname(specifier)) {
			const abs = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
			const url = withExtension(abs);
			if (url) return { url, shortCircuit: true };
		}
	}
	return nextResolve(specifier, context);
}
