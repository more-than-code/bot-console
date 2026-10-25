import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile, compileModule } from 'svelte/compiler';

const root = resolvePath(fileURLToPath(new URL('.', import.meta.url)), '..');

function fileUrl(abs) {
	return pathToFileURL(abs).href;
}

function withExtension(abs) {
	if (extname(abs) && existsSync(abs) && statSync(abs).isFile()) return fileUrl(abs);
	// shadcn-svelte imports use a .js suffix for TypeScript sources.
	if (abs.endsWith('.js')) {
		const ts = abs.slice(0, -3) + '.ts';
		if (existsSync(ts) && statSync(ts).isFile()) return fileUrl(ts);
		const svelte = abs.slice(0, -3) + '.svelte';
		if (existsSync(svelte) && statSync(svelte).isFile()) return fileUrl(svelte);
	}
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
	if (specifier === '$app/state') {
		return { url: fileUrl(resolvePath(root, 'tests/stubs/app-state.ts')), shortCircuit: true };
	}
	if (specifier === '$app/forms') {
		return { url: fileUrl(resolvePath(root, 'tests/stubs/app-forms.ts')), shortCircuit: true };
	}
	if (specifier === '$app/navigation') {
		return { url: fileUrl(resolvePath(root, 'tests/stubs/app-navigation.ts')), shortCircuit: true };
	}
	if (specifier === '$app/environment') {
		return { url: fileUrl(resolvePath(root, 'tests/stubs/app-environment.ts')), shortCircuit: true };
	}
	if (specifier.startsWith('$lib/')) {
		const url = withExtension(resolvePath(root, 'src/lib', specifier.slice('$lib/'.length)));
		if (!url) throw new Error(`Cannot resolve ${specifier}`);
		return { url, shortCircuit: true };
	}
	if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
		const abs = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
		const url = withExtension(abs);
		if (url) return { url, shortCircuit: true };
	}
	return nextResolve(specifier, context);
}

/** Compile route and component modules so `svelte/server` `render` can load them. */
export async function load(url, context, nextLoad) {
	// Stylesheet imports (the root layout's app.css) have no effect on server render.
	if (url.startsWith('file:') && url.endsWith('.css')) {
		return { format: 'module', source: '', shortCircuit: true };
	}
	if (url.startsWith('file:') && (url.endsWith('.svelte') || url.endsWith('.svelte.js') || url.endsWith('.svelte.ts'))) {
		const filename = fileURLToPath(url);
		const source = readFileSync(filename, 'utf8');
		const compiled = url.endsWith('.svelte')
			? compile(source, { filename, generate: 'server', css: 'external' })
			: compileModule(source, { filename, generate: 'server' });
		return { format: 'module', source: compiled.js.code, shortCircuit: true };
	}
	return nextLoad(url, context);
}
