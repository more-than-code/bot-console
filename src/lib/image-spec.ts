import type { ImageOutcome, ImageRestart, ImageSpec, ImageWorkload } from '$lib/api-types';
import { ENV_KEY, byteLength, isCatalogName } from '$lib/catalog';

/** Shown beside the memory field. Blank still means no limit. */
export const SUGGESTED_MEMORY_MB = 256;

export const STILL_RUNNING = 'Still running on the host. Check the history in a minute.';

const LINE_BREAK = /[\u0000\n\r]/;
const SECRET_KEY = /password|passwd|token|secret|credential|api[_-]?key|private[_-]?key/i;
const RESERVED_ENV = new Set(['PATH', 'HOME']);
const DENY_EXACT = new Set([
	'NODE_OPTIONS',
	'NODE_PATH',
	'BASH_ENV',
	'ENV',
	'IFS',
	'PYTHONPATH',
	'PYTHONSTARTUP',
	'PERL5OPT',
	'PERL5LIB',
	'RUBYOPT',
	'RUBYLIB'
]);
const TAG = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const NAME_PART = /^[a-z0-9]+(?:(?:[._]|__|[-]*)[a-z0-9]+)*$/;
const SET_NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;
const FILE_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const VOLUME_NAME = SET_NAME;
const FILE_ROOTS = ['/proc', '/sys', '/dev'] as const;
const USER_NAME = /^[a-z_][a-z0-9_-]{0,31}$/;
const REGISTRY_HOST = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?$/;
const CONFIRMATION_ID = /^[A-Za-z0-9_-]{43}$/;

const ROLLBACK = new Set<ImageOutcome>(['succeeded', 'unchanged']);

export type ImageDraft = {
	name: string;
	workload: ImageWorkload;
	image: string;
	command: string[];
	entrypoint: string[];
	ports: Array<{ host: string; container: string; public: boolean }>;
	env: Array<{ key: string; value: string }>;
	envSets: string[];
	secrets: Array<{ key: string; set: string; name: string }>;
	volumes: Array<{ name: string; target: string; readOnly: boolean }>;
	files: Array<{ file: string; target: string }>;
	restart: ImageRestart;
	user: string;
	healthyAfter: string;
	timeoutSec: string;
	memoryMb: string;
};

export type KnownSet = { name: string; keys: readonly string[] };

export type ImageCheck =
	| { ok: true; spec: ImageSpec; name: string | null }
	| { ok: false; field: string; message: string };

export type DockerPrefill =
	| { ok: true; draft: Partial<ImageDraft>; unsupported: string[] }
	| { ok: false; message: string };

function fail(field: string, message: string): { ok: false; field: string; message: string } {
	return { ok: false, field, message };
}

function deniedEnvKey(key: string): boolean {
	return key.startsWith('LD_') || key.startsWith('DYLD_') || DENY_EXACT.has(key);
}

/** Entry names follow v1.6 and must not end with `-` or `-prev`. */
export function isImageEntryName(value: string): boolean {
	return isCatalogName(value) && !value.endsWith('-') && !value.endsWith('-prev');
}

export function cleanImageUser(value: string): string | null {
	if (value === '') return '';
	const parts = value.split(':');
	if (parts.length > 2) return null;
	for (const part of parts) {
		if (part === '' || part === 'root' || part === '0') return null;
		if (/^\d+$/.test(part)) {
			if (part.startsWith('0')) return null;
			const number = Number(part);
			if (!Number.isSafeInteger(number) || number <= 0) return null;
			continue;
		}
		if (!USER_NAME.test(part)) return null;
	}
	return value;
}

/** Absolute path, at most 255 bytes, no `.` or `..` segment. */
export function cleanVolumeTarget(value: string): string | null {
	const target = value.trim();
	if (!target.startsWith('/') || byteLength(target) > 255 || LINE_BREAK.test(target)) return null;
	const segments = target.split('/');
	if (segments.includes('.') || segments.includes('..')) return null;
	return target;
}

/** v1.9 file name. `.` and `..` do not match. */
export function isFileName(value: string): boolean {
	return FILE_NAME.test(value);
}

/**
 * v1.9 rule 13 target: absolute, ≤ 255 bytes, no empty / `.` / `..` segment,
 * no trailing slash, and not `/`, `/proc`, `/sys`, `/dev`, or under them.
 */
export function cleanFileTarget(value: string): string | null {
	const target = value.trim();
	if (target === '/' || !target.startsWith('/') || byteLength(target) > 255 || LINE_BREAK.test(target)) return null;
	const segments = target.split('/');
	if (segments.slice(1).some((part) => part === '' || part === '.' || part === '..')) return null;
	for (const root of FILE_ROOTS) {
		if (target === root || target.startsWith(`${root}/`)) return null;
	}
	return target;
}

/** True when one path is strictly inside the other. Equal paths are not nested. */
export function fileTargetNests(left: string, right: string): boolean {
	return left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function registryHostOk(host: string): boolean {
	if (!REGISTRY_HOST.test(host) || host.length > 255) return false;
	const colon = host.lastIndexOf(':');
	if (colon === -1) return true;
	const port = Number(host.slice(colon + 1));
	return port >= 1 && port <= 65535;
}

function pathOk(path: string): boolean {
	if (path === '' || /[A-Z]/.test(path) || path.includes('//')) return false;
	const parts = path.split('/');
	let start = 0;
	const first = parts[0] ?? '';
	if (first === 'localhost' || first.includes('.') || first.includes(':')) {
		if (!registryHostOk(first)) return false;
		start = 1;
	}
	if (start >= parts.length) return false;
	for (let index = start; index < parts.length; index += 1) {
		const part = parts[index] ?? '';
		if (!NAME_PART.test(part)) return false;
	}
	return true;
}

/** A Docker reference. A name with neither tag nor digest is stored with `:latest`. */
export function normalizeImageRef(raw: string): { ok: true; image: string } | { ok: false; message: string } {
	const image = raw.trim();
	if (image === '' || byteLength(image) > 255 || /[\s\u0000]/.test(image)) {
		return { ok: false, message: 'Enter an image reference (at most 255 bytes).' };
	}
	let name = image;
	let digest = '';
	const at = image.lastIndexOf('@');
	if (at !== -1) {
		digest = image.slice(at + 1);
		name = image.slice(0, at);
		if (!DIGEST.test(digest)) return { ok: false, message: 'An image digest must be sha256 and 64 hex digits.' };
	}
	const slash = name.lastIndexOf('/');
	const colon = name.lastIndexOf(':');
	let path = name;
	let tag = '';
	if (colon > slash) {
		path = name.slice(0, colon);
		tag = name.slice(colon + 1);
		if (!TAG.test(tag)) return { ok: false, message: 'That image tag is not valid.' };
	}
	if (!pathOk(path)) return { ok: false, message: 'The image path must be lowercase.' };
	if (!tag && !digest) return { ok: true, image: `${image}:latest` };
	return { ok: true, image };
}

function cleanArgv(rows: readonly string[], field: string, label: string): { ok: true; argv: string[] | null } | { ok: false; field: string; message: string } {
	const argv: string[] = [];
	for (const row of rows) {
		if (row === '') continue;
		if (LINE_BREAK.test(row) || byteLength(row) > 4096) return fail(field, `${label} arguments must be one line, at most 4096 bytes.`);
		argv.push(row);
	}
	if (argv.length > 32) return fail(field, `${label} accepts at most 32 arguments.`);
	return { ok: true, argv: argv.length === 0 ? null : argv };
}

function cleanInlineEnv(rows: ImageDraft['env']): { ok: true; env: Record<string, string> } | { ok: false; field: string; message: string } {
	const env: Record<string, string> = {};
	for (const row of rows) {
		const key = row.key.trim();
		if (key === '' && row.value === '') continue;
		if (key === '') return fail('env', 'An environment value needs a key.');
		if (!ENV_KEY.test(key)) return fail('env', 'Environment keys use A-Z, digits, and underscore.');
		if (RESERVED_ENV.has(key)) return fail('env', `${key} is reserved.`);
		if (SECRET_KEY.test(key)) return fail('env', `${key}: use secret_env.`);
		if (deniedEnvKey(key)) return fail('env', 'This variable changes what the program runs.');
		if (LINE_BREAK.test(row.value) || byteLength(row.value) > 4096) {
			return fail('env', 'An environment value is too long or contains a newline.');
		}
		if (Object.hasOwn(env, key)) return fail('env', 'Each environment key can appear once.');
		if (Object.keys(env).length >= 64) return fail('env', 'At most 64 environment variables.');
		env[key] = row.value;
	}
	return { ok: true, env };
}

function cleanPorts(rows: ImageDraft['ports']): { ok: true; ports: ImageSpec['ports'] } | { ok: false; field: string; message: string } {
	const ports: ImageSpec['ports'] = [];
	const seen = new Set<number>();
	for (const row of rows) {
		const hostText = row.host.trim();
		const containerText = row.container.trim();
		if (hostText === '' && containerText === '') continue;
		if (!/^[0-9]+$/.test(hostText) || !/^[0-9]+$/.test(containerText)) {
			return fail('ports', 'Ports must be from 1 to 65535.');
		}
		const host = Number(hostText);
		const container = Number(containerText);
		if (host < 1 || host > 65535 || container < 1 || container > 65535) return fail('ports', 'Ports must be from 1 to 65535.');
		if (seen.has(host)) return fail('ports', 'Each host port can appear once.');
		seen.add(host);
		ports.push({ host, container, public: row.public === true });
	}
	if (ports.length > 16) return fail('ports', 'At most 16 ports.');
	return { ok: true, ports };
}

function cleanVolumes(rows: ImageDraft['volumes']): { ok: true; volumes: ImageSpec['volumes'] } | { ok: false; field: string; message: string } {
	const volumes: ImageSpec['volumes'] = [];
	const targets = new Set<string>();
	for (const row of rows) {
		const name = row.name.trim();
		const targetRaw = row.target.trim();
		if (name === '' && targetRaw === '') continue;
		if (!VOLUME_NAME.test(name)) return fail('volumes', 'Volume names use lowercase letters, digits, and hyphens.');
		const target = cleanVolumeTarget(targetRaw);
		if (!target) return fail('volumes', 'A volume target must be an absolute path, at most 255 bytes, with no . or .. segment.');
		if (targets.has(target)) return fail('volumes', 'Each volume target can appear once.');
		targets.add(target);
		volumes.push({ name, target, read_only: row.readOnly });
	}
	if (volumes.length > 8) return fail('volumes', 'At most 8 volumes.');
	return { ok: true, volumes };
}

function cleanFiles(
	rows: ImageDraft['files'],
	volumeTargets: readonly string[],
	knownFiles?: readonly string[]
): { ok: true; files: ImageSpec['files'] } | { ok: false; field: string; message: string } {
	const files: ImageSpec['files'] = [];
	const names = new Set<string>();
	const targets = new Set<string>(volumeTargets);
	for (const row of rows) {
		const name = row.file.trim();
		const targetRaw = row.target.trim();
		if (name === '' && targetRaw === '') continue;
		if (!isFileName(name)) return fail('files', 'File names use lowercase letters, digits, dots, underscores, and hyphens.');
		if (names.has(name)) return fail('files', 'Each file can appear once.');
		if (knownFiles && !knownFiles.includes(name)) return fail('files', `Unknown file ${name}.`);
		const target = cleanFileTarget(targetRaw);
		if (!target) {
			return fail('files', 'A file target must be an absolute path, at most 255 bytes, with no empty, . or .. segment, and not /, /proc, /sys, /dev, or under them.');
		}
		if (targets.has(target)) return fail('files', 'Each file and volume target can appear once.');
		if (volumeTargets.some((other) => fileTargetNests(target, other))) {
			return fail('files', 'A file target cannot sit inside a volume target, or the other way around.');
		}
		names.add(name);
		targets.add(target);
		files.push({ file: name, target });
	}
	if (files.length > 16) return fail('files', 'At most 16 files.');
	return { ok: true, files };
}

function integerIn(raw: string, min: number, max: number): number | null | undefined {
	const trimmed = raw.trim();
	if (trimmed === '') return null;
	if (!/^[0-9]+$/.test(trimmed)) return undefined;
	const value = Number(trimmed);
	if (!Number.isInteger(value) || value < min || value > max) return undefined;
	return value;
}

/**
 * Map a container form onto an ImageSpec. Empty command and entrypoint lists become null.
 * A job's restart is always `no`. A port is public only when the draft says so.
 */
export function imageSpecFromDraft(
	draft: ImageDraft,
	knownSets?: readonly KnownSet[],
	includeName = false,
	knownFiles?: readonly string[]
): ImageCheck {
	let name: string | null = null;
	if (includeName) {
		if (!isImageEntryName(draft.name)) {
			return fail('name', 'Name must start with a letter or digit, use lowercase letters, digits, and hyphens, and must not end with - or -prev.');
		}
		name = draft.name;
	}
	const image = normalizeImageRef(draft.image);
	if (!image.ok) return fail('image', image.message);
	const command = cleanArgv(draft.command, 'command', 'Command');
	if (!command.ok) return command;
	const entrypoint = cleanArgv(draft.entrypoint, 'entrypoint', 'Entrypoint');
	if (!entrypoint.ok) return entrypoint;
	const ports = cleanPorts(draft.ports);
	if (!ports.ok) return ports;
	const env = cleanInlineEnv(draft.env);
	if (!env.ok) return env;
	if (draft.envSets.length > 8) return fail('env_sets', 'At most 8 env sets.');
	const envSets: string[] = [];
	for (const setName of draft.envSets) {
		if (!SET_NAME.test(setName)) return fail('env_sets', 'Env set names use lowercase letters, digits, and hyphens.');
		if (envSets.includes(setName)) return fail('env_sets', 'Each env set can appear once.');
		if (knownSets && !knownSets.some((set) => set.name === setName)) return fail('env_sets', `Unknown env set ${setName}.`);
		envSets.push(setName);
	}
	const secretEnv: Record<string, string> = {};
	for (const row of draft.secrets) {
		const key = row.key.trim();
		const setName = row.set.trim();
		const secretName = row.name.trim();
		if (key === '' && setName === '' && secretName === '') continue;
		if (!ENV_KEY.test(key)) return fail('secret_env', 'Secret env keys use A-Z, digits, and underscore.');
		if (deniedEnvKey(key) || RESERVED_ENV.has(key)) return fail('secret_env', 'This variable changes what the program runs.');
		if (!SET_NAME.test(setName) || !ENV_KEY.test(secretName)) return fail('secret_env', 'Pick a set and a key from that set.');
		const reference = `${setName}.${secretName}`;
		if (Object.hasOwn(secretEnv, key)) return fail('secret_env', 'Each secret env key can appear once.');
		if (Object.keys(secretEnv).length >= 64) return fail('secret_env', 'At most 64 secret env keys.');
		if (knownSets) {
			const set = knownSets.find((item) => item.name === setName);
			if (!set || !set.keys.includes(secretName)) return fail('secret_env', `Unknown secret ${reference}.`);
		}
		secretEnv[key] = reference;
	}
	const volumes = cleanVolumes(draft.volumes);
	if (!volumes.ok) return volumes;
	const files = cleanFiles(draft.files, volumes.volumes.map((volume) => volume.target), knownFiles);
	if (!files.ok) return files;
	const user = cleanImageUser(draft.user.trim());
	if (user === null) return fail('user', 'User must be empty, a name, a positive uid, or name:group. Root and leading zeros are refused.');
	const memory = integerIn(draft.memoryMb, 16, 65536);
	if (memory === undefined) return fail('memory_mb', 'Memory must be blank or from 16 to 65536 MB.');
	const workload = draft.workload === 'job' ? 'job' : 'service';
	let restart: ImageRestart = draft.restart;
	if (workload === 'job') restart = 'no';
	else if (restart !== 'no' && restart !== 'on-failure' && restart !== 'unless-stopped') {
		return fail('restart', 'Choose a restart policy.');
	}
	let healthy = 30;
	let timeout = 600;
	if (workload === 'service') {
		const parsed = integerIn(draft.healthyAfter, 5, 600);
		if (parsed === undefined) return fail('healthy_after_sec', 'Healthy wait must be from 5 to 600 seconds.');
		healthy = parsed ?? 30;
	} else {
		const parsed = integerIn(draft.timeoutSec, 10, 3600);
		if (parsed === undefined) return fail('timeout_sec', 'Job timeout must be from 10 to 3600 seconds.');
		timeout = parsed ?? 600;
	}
	const spec: ImageSpec = {
		kind: workload,
		image: image.image,
		command: command.argv,
		entrypoint: entrypoint.argv,
		ports: ports.ports,
		env: env.env,
		env_sets: envSets,
		secret_env: secretEnv,
		volumes: volumes.volumes,
		files: files.files,
		restart,
		user,
		healthy_after_sec: healthy,
		memory_mb: memory,
		timeout_sec: timeout
	};
	return { ok: true, spec, name };
}

/** Deploy and rollback wait for the host. 300s plus the spec wait plus 90s. */
export function deployTimeoutMs(workload: ImageWorkload, seconds: number): number {
	const wait = Number.isFinite(seconds) ? seconds : workload === 'job' ? 600 : 30;
	return (300 + wait + 90) * 1000;
}

/** Twelve hex digits after `sha256:`. Anything else is not shown as a digest. */
export function shortDigest(digest: string | null | undefined): string | null {
	if (!digest) return null;
	const match = /^sha256:([0-9a-f]{64})$/.exec(digest);
	if (!match) return null;
	return `sha256:${match[1].slice(0, 12)}`;
}

export type RollbackChoice = {
	digest: string;
	/** Current digest, offered when that image was deployed more than once in the window. */
	sameImage: boolean;
};

/**
 * Service rollback targets, newest first.
 * History is newest first. The walk still stops at three distinct succeeded or
 * unchanged digests. The newest of those is current. It is included, first, only
 * when that digest occurs at least twice in the window, so a content-only
 * redeploy can swap back to the kept container. One occurrence is still dropped.
 */
export function rollbackChoices(items: readonly { outcome: string; digest: string | null }[]): RollbackChoice[] {
	const distinct: string[] = [];
	const counts = new Map<string, number>();
	for (const item of items) {
		if (!ROLLBACK.has(item.outcome as ImageOutcome) || !item.digest) continue;
		if (!distinct.includes(item.digest)) distinct.push(item.digest);
		counts.set(item.digest, (counts.get(item.digest) ?? 0) + 1);
		if (distinct.length === 3) break;
	}
	const current = distinct[0];
	if (current == null) return [];
	const older = distinct.slice(1).map((digest) => ({ digest, sameImage: false }));
	if ((counts.get(current) ?? 0) >= 2) return [{ digest: current, sameImage: true }, ...older];
	return older;
}

/** Digests a service Roll back button may target, newest first. */
export function rollbackDigests(items: readonly { outcome: string; digest: string | null }[]): string[] {
	return rollbackChoices(items).map((choice) => choice.digest);
}

function shellQuote(value: string): string {
	if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) return value;
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Catalog and deploy label. A public port reads `8080:80 public`; a loopback port stays `9090:90`. */
export function imagePortText(port: { host: number | string; container: number | string; public?: boolean }): string {
	const pair = `${port.host}:${port.container}`;
	return port.public === true ? `${pair} public` : pair;
}

/** One port row. bits-ui passes true, false, or 'indeterminate'; only true publishes that row. */
export function setPortPublic(row: { public: boolean }, value: boolean | 'indeterminate'): void {
	row.public = value === true;
}

/** Read-only `docker run` line. Every env source is `-e KEY` with no value. */
export function dockerRunPreview(input: {
	name: string;
	image: string;
	command: readonly string[];
	entrypoint: readonly string[];
	ports: readonly { host: number; container: number; public?: boolean }[];
	envKeys: readonly string[];
	volumes: readonly { name: string; target: string; readOnly: boolean }[];
	files?: readonly { file: string; target: string }[];
	restart: string;
	user: string;
	memoryMb: number | null;
}): string {
	const parts = ['docker run'];
	if (input.name) parts.push('--name', shellQuote(input.name));
	if (input.restart) parts.push('--restart', input.restart);
	for (const port of input.ports) {
		const binding = port.public === true ? `${port.host}:${port.container}` : `127.0.0.1:${port.host}:${port.container}`;
		parts.push('-p', binding);
	}
	const seen = new Set<string>();
	for (const key of input.envKeys) {
		if (!key || seen.has(key)) continue;
		seen.add(key);
		parts.push('-e', key);
	}
	for (const volume of input.volumes) {
		const suffix = volume.readOnly ? ':ro' : '';
		parts.push('-v', `${volume.name}:${volume.target}${suffix}`);
	}
	for (const file of input.files ?? []) {
		parts.push('-v', shellQuote(`${file.file}:${file.target}:ro`));
	}
	if (input.user) parts.push('--user', shellQuote(input.user));
	if (input.memoryMb != null) parts.push('--memory', `${input.memoryMb}m`);
	if (input.entrypoint.length === 1) parts.push('--entrypoint', shellQuote(input.entrypoint[0] ?? ''));
	else if (input.entrypoint.length > 1) {
		parts.push('entrypoint');
		for (const arg of input.entrypoint) parts.push(shellQuote(arg));
	}
	parts.push(input.image ? shellQuote(input.image) : '<image>');
	for (const arg of input.command) parts.push(shellQuote(arg));
	return parts.join(' ');
}

function splitWords(line: string): string[] | null {
	const words: string[] = [];
	let current = '';
	let quote: "'" | '"' | null = null;
	for (let index = 0; index < line.length; index += 1) {
		const ch = line[index] ?? '';
		if (quote) {
			if (ch === quote) {
				quote = null;
				continue;
			}
			if (ch === '\\' && quote === '"') {
				const next = line[index + 1];
				if (!next) return null;
				current += next;
				index += 1;
				continue;
			}
			current += ch;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			continue;
		}
		if (ch === '\\') {
			const next = line[index + 1];
			if (!next) return null;
			current += next;
			index += 1;
			continue;
		}
		if (ch === ' ' || ch === '\t') {
			if (current) {
				words.push(current);
				current = '';
			}
			continue;
		}
		if (ch === '\n' || ch === '\r' || ch === '\0') return null;
		current += ch;
	}
	if (quote) return null;
	if (current) words.push(current);
	return words;
}

function flagName(word: string): { name: string; inline: string | null } {
	const eq = word.indexOf('=');
	if (eq === -1) return { name: word, inline: null };
	return { name: word.slice(0, eq), inline: word.slice(eq + 1) };
}

const TAKES_VALUE = new Set([
	'--name',
	'--restart',
	'-p',
	'--publish',
	'-e',
	'--env',
	'-v',
	'--volume',
	'--mount',
	'-u',
	'--user',
	'--entrypoint',
	'--env-file',
	'--network',
	'--net',
	'--pid',
	'--cap-add',
	'--device'
]);

const OUTRIGHT = new Set(['--privileged', '--cap-add', '--device', '--env-file']);

function publishPorts(spec: string, ports: ImageDraft['ports']): string | null {
	const bits = spec.split(':');
	let host = '';
	let container = '';
	let isPublic = false;
	if (bits.length === 2) {
		host = bits[0] ?? '';
		container = bits[1] ?? '';
		isPublic = true;
	} else if (bits.length === 3) {
		const bind = bits[0] ?? '';
		if (bind === '127.0.0.1' || bind === 'localhost') isPublic = false;
		else if (bind === '0.0.0.0') isPublic = true;
		else return 'Only 127.0.0.1 or all interfaces (0.0.0.0) can be bound.';
		host = bits[1] ?? '';
		container = bits[2] ?? '';
	} else return `not supported: publish ${spec}`;
	ports.push({ host, container, public: isPublic });
	return null;
}

function volumeFrom(spec: string, volumes: ImageDraft['volumes']): string | null {
	const bits = spec.split(':');
	if (bits.length < 2 || bits.length > 3) return `not supported: volume ${spec}`;
	const name = bits[0] ?? '';
	const target = bits[1] ?? '';
	if (name.startsWith('/') || name.startsWith('.') || name.startsWith('~')) return 'Bind mounts are refused.';
	const mode = bits[2] ?? '';
	if (mode !== '' && mode !== 'ro' && mode !== 'rw') return `not supported: volume ${spec}`;
	volumes.push({ name, target, readOnly: mode === 'ro' });
	return null;
}

function mountFrom(spec: string, volumes: ImageDraft['volumes']): string | null {
	const fields = new Map<string, string>();
	for (const part of spec.split(',')) {
		const eq = part.indexOf('=');
		if (eq === -1) continue;
		fields.set(part.slice(0, eq), part.slice(eq + 1));
	}
	const type = fields.get('type') ?? '';
	if (type === 'bind') return 'Bind mounts are refused.';
	if (type !== 'volume') return `not supported: mount ${spec}`;
	const name = fields.get('source') ?? fields.get('src') ?? '';
	const target = fields.get('target') ?? fields.get('destination') ?? fields.get('dst') ?? '';
	if (!name || !target) return `not supported: mount ${spec}`;
	volumes.push({ name, target, readOnly: fields.has('readonly') || fields.get('ro') === 'true' });
	return null;
}

function userRefused(value: string): boolean {
	return cleanImageUser(value) === null && value !== '';
}

const IGNORED_LONG = new Set(['--detach', '--interactive', '--tty']);

/** A short cluster of only detach, interactive, and tty, such as `-d` or `-it`. */
function ignoredShort(name: string): boolean {
	if (!name.startsWith('-') || name.startsWith('--') || name.length < 2) return false;
	return [...name.slice(1)].every((ch) => ch === 'd' || ch === 'i' || ch === 't');
}

/**
 * Prefill a container form from `docker run`.
 * Detach, name, tty, interactive, and `--rm` are ignored and listed. `--rm` is quiet on a job.
 * Any other unknown flag refuses the whole paste and names that flag.
 * Privileged, capabilities, devices, env files, host network, host pid, and root are refused.
 */
export function parseDockerRun(line: string, workload: ImageWorkload = 'service'): DockerPrefill {
	const words = splitWords(line.trim());
	if (!words || words.length < 2 || words[0] !== 'docker' || words[1] !== 'run') {
		return { ok: false, message: 'Paste a docker run command.' };
	}
	const unsupported: string[] = [];
	const draft: Partial<ImageDraft> = {
		command: [],
		entrypoint: [],
		ports: [],
		env: [],
		volumes: [],
		restart: 'unless-stopped'
	};
	const ports = draft.ports ?? [];
	const env = draft.env ?? [];
	const volumes = draft.volumes ?? [];
	let image = '';
	const command: string[] = [];
	for (let index = 2; index < words.length; index += 1) {
		const word = words[index] ?? '';
		if (image) {
			command.push(word);
			continue;
		}
		if (!word.startsWith('-')) {
			image = word;
			continue;
		}
		const flag = flagName(word);
		let value = flag.inline;
		const needsValue = value === null && TAKES_VALUE.has(flag.name);
		if (needsValue) {
			const next = words[index + 1];
			if (!next || next.startsWith('-')) return { ok: false, message: `${flag.name} needs a value.` };
			value = next;
			index += 1;
		}
		if (OUTRIGHT.has(flag.name)) return { ok: false, message: `${flag.name} is not supported.` };
		if ((flag.name === '--network' || flag.name === '--net') && value === 'host') {
			return { ok: false, message: 'Host networking is not supported.' };
		}
		if (flag.name === '--pid' && value === 'host') return { ok: false, message: 'Host pid is not supported.' };
		if ((flag.name === '-u' || flag.name === '--user') && value != null && (value === 'root' || value === '0' || value.startsWith('0:') || value.endsWith(':0') || value.includes('root'))) {
			return { ok: false, message: 'Running as root is refused.' };
		}
		if (flag.name === '--name') {
			unsupported.push('--name');
			continue;
		}
		if (flag.name === '--rm') {
			if (workload !== 'job') unsupported.push('--rm');
			continue;
		}
		if (IGNORED_LONG.has(flag.name) || ignoredShort(flag.name)) {
			unsupported.push(flag.name);
			continue;
		}
		if (flag.name === '--restart' && value) {
			if (value === 'no' || value === 'on-failure' || value === 'unless-stopped') draft.restart = value;
			else return { ok: false, message: `${flag.name} is not supported.` };
			continue;
		}
		if ((flag.name === '-p' || flag.name === '--publish') && value) {
			const problem = publishPorts(value, ports);
			if (problem) return { ok: false, message: problem.startsWith('not supported') ? `${flag.name} is not supported.` : problem };
			continue;
		}
		if ((flag.name === '-e' || flag.name === '--env') && value) {
			const eq = value.indexOf('=');
			if (eq === -1) env.push({ key: value, value: '' });
			else env.push({ key: value.slice(0, eq), value: value.slice(eq + 1) });
			continue;
		}
		if ((flag.name === '-v' || flag.name === '--volume') && value) {
			const problem = volumeFrom(value, volumes);
			if (problem) return { ok: false, message: problem.startsWith('not supported') ? `${flag.name} is not supported.` : problem };
			continue;
		}
		if (flag.name === '--mount' && value) {
			const problem = mountFrom(value, volumes);
			if (problem) return { ok: false, message: problem.startsWith('not supported') ? `${flag.name} is not supported.` : problem };
			continue;
		}
		if ((flag.name === '-u' || flag.name === '--user') && value) {
			if (userRefused(value)) return { ok: false, message: 'Running as root is refused.' };
			draft.user = value;
			continue;
		}
		if (flag.name === '--entrypoint' && value) {
			draft.entrypoint = [value];
			continue;
		}
		return { ok: false, message: `${flag.name} is not supported.` };
	}
	if (!image) return { ok: false, message: 'The docker run command has no image.' };
	draft.image = image;
	draft.command = command;
	draft.ports = ports;
	draft.env = env;
	draft.volumes = volumes;
	return { ok: true, draft, unsupported };
}

/** Copy a parsed `docker run` onto the form. File rows are left as they are. */
export function applyDockerPaste(draft: ImageDraft, parsed: Extract<DockerPrefill, { ok: true }>): ImageDraft {
	const next = parsed.draft;
	return {
		...draft,
		image: next.image ?? draft.image,
		command: next.command && next.command.length > 0 ? next.command : [''],
		entrypoint: next.entrypoint && next.entrypoint.length > 0 ? next.entrypoint : draft.entrypoint,
		ports: next.ports ?? [],
		env: next.env ?? [],
		volumes: next.volumes ?? [],
		restart: next.restart ? next.restart : draft.restart,
		user: next.user != null ? next.user : draft.user
	};
}

/**
 * Drop a submitted secret from an API message.
 * A piece of at least 8 characters matches inside a longer word. A shorter piece matches only as its own token.
 */
export function redactSubmitted(message: string, secrets: readonly string[]): string {
	const list = [...new Set(secrets.filter((secret) => secret !== ''))].sort((left, right) => right.length - left.length);
	let out = message;
	for (const secret of list) {
		const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const pattern = secret.length >= 8 ? escaped : `(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`;
		out = out.replace(new RegExp(pattern, 'g'), '[redacted]');
	}
	return out;
}

/** Strip `KEY=value` assignments so a confirmation plan cannot show an env value. */
export function redactAssignments(text: string): string {
	return text.replace(/(^|[^\w])([A-Za-z_][A-Za-z0-9_]{0,63})=[^\s]+/g, '$1$2');
}

/** Keep the list already on screen when a deploy action did not load a new one. */
export function nextHistory<T>(current: readonly T[], incoming: readonly T[] | null): T[] {
	return incoming == null ? [...current] : [...incoming];
}

/** Reuse the key only while host and force are unchanged. */
export function nextIdempotencyKey(
	previous: { hostId: string; force: boolean; key: string } | null,
	next: { hostId: string; force: boolean },
	fresh: string
): string {
	if (previous && previous.key !== '' && previous.hostId === next.hostId && previous.force === next.force) return previous.key;
	return fresh;
}

/** Reuse a rollback key only while the host for that digest is unchanged. */
export function nextRollbackKey(previous: { hostId: string; key: string } | null, hostId: string, fresh: string): string {
	if (previous && previous.key !== '' && previous.hostId === hostId) return previous.key;
	return fresh;
}

/** Whether a history response belongs to the host now selected. */
export function acceptHostHistory(currentHost: string, requestedHost: string, responseHost: string | null): 'ignore' | 'missing' | 'accept' {
	if (currentHost === '' || requestedHost !== currentHost) return 'ignore';
	if (responseHost == null || responseHost === '') return 'missing';
	if (responseHost !== currentHost) return 'ignore';
	return 'accept';
}

/** True when the user moved from one host to another. The first load is not a switch. */
export function switchedHistoryHost(previousHost: string, nextHost: string): boolean {
	return previousHost !== '' && nextHost !== '' && previousHost !== nextHost;
}

export type HistoryView<T> = {
	history: readonly T[];
	ready: boolean;
	pending: boolean;
	error: string | null;
	listedHost: string;
};

/**
 * History section copy.
 * Loading is only while a fetch is in flight. No hosts replaces that line.
 * A ready list wins, including an empty one.
 */
export function historyNotice(input: { hostCount: number; pending: boolean; ready: boolean; count: number }): 'empty' | 'list' | 'no-hosts' | 'loading' | 'quiet' {
	if (input.ready && input.count === 0) return 'empty';
	if (input.ready) return 'list';
	if (input.hostCount === 0) return 'no-hosts';
	if (input.pending) return 'loading';
	return 'quiet';
}

/** Read history when a host is selected and this selection has not been requested yet. */
export function historyFetch(hostId: string, requestedHost: string, formReady: boolean): { submit: boolean; pending: boolean } {
	if (!formReady || hostId === '' || hostId === requestedHost) return { submit: false, pending: false };
	return { submit: true, pending: true };
}

/** Drop the on-screen list when the selected host changes. The first load is not a switch. */
export function historyAfterSwitch<T>(listedHost: string, nextHost: string, view: Omit<HistoryView<T>, 'listedHost'>): HistoryView<T> & { switched: boolean } {
	if (!switchedHistoryHost(listedHost, nextHost)) {
		return { history: [...view.history], ready: view.ready, pending: view.pending, error: view.error, listedHost, switched: false };
	}
	return { history: [], ready: false, pending: true, error: null, listedHost, switched: true };
}

/** Apply a history response only when it is for the host now selected. A late reply for another host is left untouched. */
export function applyHistoryResponse<T>(
	view: HistoryView<T>,
	currentHost: string,
	requestedHost: string,
	responseHost: string | null,
	incoming: readonly T[] | null,
	message: string | null
): HistoryView<T> {
	const decision = acceptHostHistory(currentHost, requestedHost, responseHost);
	if (decision === 'ignore') {
		return { history: [...view.history], ready: view.ready, pending: view.pending, error: view.error, listedHost: view.listedHost };
	}
	if (decision === 'missing') {
		return { history: [...view.history], ready: view.ready, pending: false, error: 'History could not be loaded.', listedHost: view.listedHost };
	}
	if (incoming != null) {
		return { history: [...incoming], ready: true, pending: false, error: null, listedHost: currentHost };
	}
	return {
		history: [...view.history],
		ready: view.ready,
		pending: false,
		error: message && message !== '' ? message : view.error,
		listedHost: view.listedHost
	};
}

export function isConfirmationId(value: string): boolean {
	return CONFIRMATION_ID.test(value);
}

export function isRegistryHost(value: string): boolean {
	return registryHostOk(value);
}

export function isSetName(value: string): boolean {
	return SET_NAME.test(value);
}

export function isFullDigest(value: string): boolean {
	return DIGEST.test(value);
}

export function isSecretLookingKey(key: string): boolean {
	return SECRET_KEY.test(key);
}

/** Blank secret-looking inline values before a draft is sent back to the browser. */
export function draftForBrowser(draft: ImageDraft): ImageDraft {
	return {
		...draft,
		env: draft.env.map((row) => (isSecretLookingKey(row.key.trim()) ? { key: row.key, value: '' } : row))
	};
}

export function blankImageDraft(): ImageDraft {
	return {
		name: '',
		workload: 'service',
		image: '',
		command: [''],
		entrypoint: [''],
		ports: [],
		env: [],
		envSets: [],
		secrets: [],
		volumes: [],
		files: [],
		restart: 'unless-stopped',
		user: '',
		healthyAfter: '',
		timeoutSec: '',
		memoryMb: ''
	};
}

/** Create/replace body. The inapplicable timing field is omitted. */
export function imageRequestBody(spec: ImageSpec, name: string | null): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		kind: spec.kind,
		image: spec.image,
		command: spec.command,
		entrypoint: spec.entrypoint,
		ports: spec.ports,
		env: spec.env,
		env_sets: spec.env_sets,
		secret_env: spec.secret_env,
		volumes: spec.volumes,
		files: spec.files,
		restart: spec.restart,
		user: spec.user,
		memory_mb: spec.memory_mb
	};
	if (spec.kind === 'service') payload.healthy_after_sec = spec.healthy_after_sec;
	else payload.timeout_sec = spec.timeout_sec;
	const body: Record<string, unknown> = { kind: 'image', spec: payload };
	if (name) body.name = name;
	return body;
}

function stringList(form: FormData, name: string, cap: number): { values: string[]; bad: boolean } {
	const all = form.getAll(name);
	if (all.length > cap) return { values: [], bad: true };
	const values: string[] = [];
	for (const item of all) {
		if (typeof item !== 'string') return { values: [], bad: true };
		values.push(item);
	}
	return { values, bad: false };
}

/** Read a container form. Over-long values are dropped so a failure cannot echo them. */
export function imageDraftFromForm(form: FormData): { draft: ImageDraft; message: string | null; field: string | null } {
	const command = stringList(form, 'command', 40);
	const entrypoint = stringList(form, 'entrypoint', 40);
	const portHost = stringList(form, 'port_host', 20);
	const portContainer = stringList(form, 'port_container', 20);
	const portPublic = stringList(form, 'port_public', 20);
	const envKey = stringList(form, 'env_key', 80);
	const envValue = stringList(form, 'env_value', 80);
	const envSets = stringList(form, 'env_set', 12);
	const secretKey = stringList(form, 'secret_key', 80);
	const secretSet = stringList(form, 'secret_set', 80);
	const secretName = stringList(form, 'secret_name', 80);
	const volumeName = stringList(form, 'volume_name', 12);
	const volumeTarget = stringList(form, 'volume_target', 12);
	const volumeRo = stringList(form, 'volume_ro', 12);
	const fileName = stringList(form, 'file_name', 20);
	const fileTarget = stringList(form, 'file_target', 20);
	const lists = [command, entrypoint, portHost, portContainer, portPublic, envKey, envValue, envSets, secretKey, secretSet, secretName, volumeName, volumeTarget, volumeRo, fileName, fileTarget];
	const draft = blankImageDraft();
	draft.name = formText(form, 'name').slice(0, 48);
	draft.workload = formText(form, 'workload') === 'job' ? 'job' : 'service';
	draft.image = formText(form, 'image').slice(0, 255);
	const restartRaw = formText(form, 'restart');
	draft.restart = restartRaw === 'no' || restartRaw === 'on-failure' || restartRaw === 'unless-stopped' ? restartRaw : 'unless-stopped';
	draft.user = formText(form, 'user').slice(0, 64);
	draft.healthyAfter = formText(form, 'healthy_after_sec').slice(0, 4);
	draft.timeoutSec = formText(form, 'timeout_sec').slice(0, 5);
	draft.memoryMb = formText(form, 'memory_mb').slice(0, 6);
	if (lists.some((list) => list.bad)) return { draft, message: 'That form is too large.', field: null };
	if (portHost.values.length !== portContainer.values.length) return { draft, message: 'Each port needs a host and a container port.', field: 'ports' };
	if (envKey.values.length !== envValue.values.length) return { draft, message: 'An environment value needs a key.', field: 'env' };
	if (secretKey.values.length !== secretSet.values.length || secretKey.values.length !== secretName.values.length) {
		return { draft, message: 'Each secret env row needs a key, a set, and a name.', field: 'secret_env' };
	}
	if (volumeName.values.length !== volumeTarget.values.length || volumeName.values.length !== volumeRo.values.length) {
		return { draft, message: 'Each volume needs a name and a target.', field: 'volumes' };
	}
	if (fileName.values.length !== fileTarget.values.length) {
		return { draft, message: 'Each file needs a name and a target.', field: 'files' };
	}
	let message: string | null = null;
	let field: string | null = null;
	draft.command = command.values.map((item) => clip(item, 4096, () => {
		message = 'A command argument is too long.';
		field = 'command';
	}));
	draft.entrypoint = entrypoint.values.map((item) => clip(item, 4096, () => {
		message = 'An entrypoint argument is too long.';
		field = 'entrypoint';
	}));
	draft.ports = portHost.values.map((host, index) => ({
		host: host.slice(0, 5),
		container: (portContainer.values[index] ?? '').slice(0, 5),
		public: portPublic.values[index] === '1'
	}));
	draft.env = envKey.values.map((key, index) => {
		const raw = envValue.values[index] ?? '';
		return { key: key.slice(0, 64), value: clip(raw, 4096, () => {
			message = 'An environment value is too long.';
			field = 'env';
		}) };
	});
	draft.envSets = envSets.values.map((name) => name.slice(0, 48));
	draft.secrets = secretKey.values.map((key, index) => ({
		key: key.slice(0, 64),
		set: (secretSet.values[index] ?? '').slice(0, 48),
		name: (secretName.values[index] ?? '').slice(0, 64)
	}));
	draft.volumes = volumeName.values.map((name, index) => ({
		name: name.slice(0, 48),
		target: (volumeTarget.values[index] ?? '').slice(0, 255),
		readOnly: volumeRo.values[index] === '1'
	}));
	draft.files = fileName.values.map((name, index) => {
		const target = fileTarget.values[index] ?? '';
		let file = name;
		let shown = target;
		if (name.length > 64) {
			file = '';
			if (message == null) {
				message = 'File names use lowercase letters, digits, dots, underscores, and hyphens.';
				field = 'files';
			}
		}
		if (byteLength(target) > 255) {
			shown = '';
			if (message == null) {
				message = 'A file target must be an absolute path, at most 255 bytes, with no empty, . or .. segment, and not /, /proc, /sys, /dev, or under them.';
				field = 'files';
			}
		}
		return { file, target: shown };
	});
	return { draft, message, field };
}

function formText(form: FormData, name: string): string {
	const value = form.get(name);
	return typeof value === 'string' ? value : '';
}

function clip(value: string, maxBytes: number, onClip: () => void): string {
	if (byteLength(value) <= maxBytes && value.length <= maxBytes) return value;
	onClip();
	return '';
}

export function submittedSecrets(draft: ImageDraft): string[] {
	return draft.env.map((row) => row.value).filter((value) => value !== '');
}
