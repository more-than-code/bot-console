import type { HealthCheck } from './api-types';
import { canRenameService } from './service-label';

/** api-v1 HealthCheck: at most 10, interval 30–300 (default 60), expect 200–399. */
export const HEALTH_CHECK_LIMIT = 10;
export const INTERVAL_MIN = 30;
export const INTERVAL_MAX = 300;
export const INTERVAL_DEFAULT = 60;
export const EXPECT_MIN = 200;
export const EXPECT_MAX = 399;
export const EXPECT_DEFAULT_MIN = 200;
export const EXPECT_DEFAULT_MAX = 399;
export const PATH_MAX_BYTES = 512;

export const SAVED_HEALTH_CHECKS = 'Saved health checks.';
export const UNREAD_HEALTH_CHECKS = 'Health checks could not be read.';
export const HEALTH_NEEDS_CONFIRMATION =
	'This change needs a confirmation; save it from the console session.';
/** Same wait the catalog image dialog uses when bits-ui never reports the close. */
export const HEALTH_CLOSE_FALLBACK_MS = 1000;
export const HEALTH_CHECK_NOTE =
	'Checks run on the host against 127.0.0.1:<port>. HTTPS and virtual hosts are not supported yet.';

export const HEALTH_FORM = {
	protocol: 'hc_protocol',
	port: 'hc_port',
	path: 'hc_path',
	interval: 'hc_interval',
	expectMin: 'hc_expect_min',
	expectMax: 'hc_expect_max',
	enabled: 'hc_enabled'
} as const;

const PATH_FORBIDDEN = /[@\\?#\s]/;
const CONTROL = /[\u0000-\u001F\u007F]/;
const STRICT_INT = /^(0|[1-9]\d{0,5})$/;
const utf8 = new TextEncoder();

export type CheckProtocol = 'tcp' | 'http';

export type CheckField = 'path' | 'port' | 'interval' | 'expect' | 'checks' | 'protocol' | 'form';

/** One unsaved row. `key` stays put when another row is removed. */
export type CheckDraft = {
	key: string;
	protocol: CheckProtocol;
	port: number | null;
	path: string;
	intervalSec: number | null;
	expectMin: number | null;
	expectMax: number | null;
	enabled: boolean;
};

export type CheckIssue = {
	index: number | null;
	field: CheckField;
	message: string;
};

export type DraftChange = {
	drafts: CheckDraft[];
	notice: string | null;
};

export type HealthCheckWrite = {
	protocol: CheckProtocol;
	port: number;
	path: string | null;
	interval_sec: number;
	expect_status_min: number;
	expect_status_max: number;
	enabled: boolean;
};

export type HealthSaveOutcome = 'success' | 'bad_request' | 'failure' | 'idle';

export type HealthSaveView = {
	/** Success closes. A bad request or other failure stays open. */
	close: boolean;
	notice: string | null;
	field: string | null;
	message: string | null;
};

export type HealthNoticeSeen = {
	projectId: string;
	tab: string;
};

const MISSING_PATH = 'Enter a path that starts with /.';
const BAD_PATH = 'Enter a path that starts with a single / and has no spaces or @ \\ ? #.';
const LONG_PATH = 'Path must be at most 512 bytes.';
const BAD_PORT = 'Choose a port on this service.';
const TOO_MANY = 'At most 10 health checks.';
const BAD_INTERVAL = 'Interval must be between 30 and 300 seconds.';
const BAD_EXPECT = 'Expected status must be between 200 and 399.';
const EXPECT_ORDER = 'Expected status min must be at most the max.';
const BAD_PROTOCOL = 'Choose TCP or HTTP.';
const BAD_FORM = UNREAD_HEALTH_CHECKS;

/** Same gate as Rename: admin+, and a deploy share only for its own project's services. */
export function canEditHealthChecks(input: Parameters<typeof canRenameService>[0]): boolean {
	return canRenameService(input);
}

export function replacedTcpNotice(port: number): string {
	return `Replaced the TCP check on ${port} (HTTP covers it).`;
}

export function tcpSuggestionLabel(port: number): string {
	return `Add TCP check on ${port}`;
}

export function blankCheck(protocol: CheckProtocol, port: number, key: string): CheckDraft {
	return {
		key,
		protocol,
		port,
		path: '',
		intervalSec: INTERVAL_DEFAULT,
		expectMin: EXPECT_DEFAULT_MIN,
		expectMax: EXPECT_DEFAULT_MAX,
		enabled: true
	};
}

export function draftFromChecks(
	checks: ReadonlyArray<
		Pick<HealthCheck, 'id' | 'protocol' | 'port' | 'path' | 'enabled'> & {
			interval_sec?: number;
			expect_status_min?: number;
			expect_status_max?: number;
		}
	>
): CheckDraft[] {
	return checks.map((check) => ({
		key: check.id,
		protocol: check.protocol,
		port: check.port,
		path: check.path ?? '',
		intervalSec: integerOr(check.interval_sec, INTERVAL_DEFAULT),
		expectMin: integerOr(check.expect_status_min, EXPECT_DEFAULT_MIN),
		expectMax: integerOr(check.expect_status_max, EXPECT_DEFAULT_MAX),
		enabled: check.enabled
	}));
}

/**
 * A port with any check is not suggested. An HTTP check is a check, so it
 * does not get a TCP suggestion either. No ports means no suggestions.
 */
export function tcpSuggestions(ports: readonly number[], drafts: readonly CheckDraft[]): number[] {
	const taken = new Set<number>();
	for (const draft of drafts) {
		if (draft.port != null) taken.add(draft.port);
	}
	const suggested: number[] = [];
	const seen = new Set<number>();
	for (const port of ports) {
		if (seen.has(port) || taken.has(port)) continue;
		seen.add(port);
		suggested.push(port);
	}
	return suggested;
}

export function addTcpCheck(drafts: readonly CheckDraft[], port: number, key: string): DraftChange {
	if (drafts.length >= HEALTH_CHECK_LIMIT) return { drafts: [...drafts], notice: null };
	return { drafts: [...drafts, blankCheck('tcp', port, key)], notice: null };
}

/** Adding an HTTP row drops a TCP row on that port. A TCP row on another port stays. */
export function addHttpCheck(drafts: readonly CheckDraft[], port: number, key: string): DraftChange {
	if (drafts.length >= HEALTH_CHECK_LIMIT) return { drafts: [...drafts], notice: null };
	const next = [...drafts, blankCheck('http', port, key)];
	return withoutRedundantTcp(next, next.length - 1, false);
}

export function removeCheck(drafts: readonly CheckDraft[], index: number): CheckDraft[] {
	return drafts.filter((_, i) => i !== index);
}

/**
 * Switching a row to HTTP on a port that has a TCP row removes that TCP row.
 * Switching the TCP row itself to HTTP is the same replacement.
 */
export function setCheckProtocol(drafts: readonly CheckDraft[], index: number, protocol: CheckProtocol): DraftChange {
	const current = drafts[index];
	if (!current || current.protocol === protocol) return { drafts: [...drafts], notice: null };
	const replacedSelf = current.protocol === 'tcp' && protocol === 'http' && current.port != null;
	const next = drafts.map((row, i) => {
		if (i !== index) return row;
		return { ...row, protocol, path: protocol === 'tcp' ? '' : row.path };
	});
	if (protocol !== 'http') return { drafts: next, notice: null };
	return withoutRedundantTcp(next, index, replacedSelf);
}

/** Moving an HTTP row onto a port that has a TCP row removes that TCP row. */
export function setCheckPort(drafts: readonly CheckDraft[], index: number, port: number): DraftChange {
	const current = drafts[index];
	if (!current) return { drafts: [...drafts], notice: null };
	const next = drafts.map((row, i) => (i === index ? { ...row, port } : row));
	if (current.protocol !== 'http') return { drafts: next, notice: null };
	return withoutRedundantTcp(next, index, false);
}

export function validateHealthChecks(drafts: readonly CheckDraft[], ports: readonly number[]): CheckIssue[] {
	const issues: CheckIssue[] = [];
	if (drafts.length > HEALTH_CHECK_LIMIT) {
		issues.push({ index: null, field: 'checks', message: TOO_MANY });
	}
	const allowed = new Set(ports);
	drafts.forEach((draft, index) => {
		if (draft.protocol !== 'tcp' && draft.protocol !== 'http') {
			issues.push({ index, field: 'protocol', message: BAD_PROTOCOL });
		}
		if (draft.port == null || !allowed.has(draft.port)) {
			issues.push({ index, field: 'port', message: BAD_PORT });
		}
		if (draft.protocol === 'http') {
			const path = pathIssue(draft.path);
			if (path) issues.push({ index, field: 'path', message: path });
			const expect = expectIssue(draft.expectMin, draft.expectMax);
			if (expect) issues.push({ index, field: 'expect', message: expect });
		}
		if (draft.intervalSec == null || draft.intervalSec < INTERVAL_MIN || draft.intervalSec > INTERVAL_MAX) {
			issues.push({ index, field: 'interval', message: BAD_INTERVAL });
		}
	});
	return issues;
}

export function healthCheckPayload(drafts: readonly CheckDraft[]): HealthCheckWrite[] {
	return drafts.map((row) => ({
		protocol: row.protocol,
		port: row.port ?? 0,
		path: row.protocol === 'http' ? row.path : null,
		interval_sec: row.intervalSec ?? INTERVAL_DEFAULT,
		// TCP has no status fields in the dialog. A leftover HTTP range must not be stored.
		expect_status_min: row.protocol === 'http' ? (row.expectMin ?? EXPECT_DEFAULT_MIN) : EXPECT_DEFAULT_MIN,
		expect_status_max: row.protocol === 'http' ? (row.expectMax ?? EXPECT_DEFAULT_MAX) : EXPECT_DEFAULT_MAX,
		enabled: row.enabled
	}));
}

export function healthFormRows(drafts: readonly CheckDraft[]): Array<{
	protocol: string;
	port: string;
	path: string;
	interval: string;
	expectMin: string;
	expectMax: string;
	enabled: string;
}> {
	return drafts.map((row) => ({
		protocol: row.protocol,
		port: row.port == null ? '' : String(row.port),
		path: row.protocol === 'http' ? row.path : '',
		interval: row.intervalSec == null ? '' : String(row.intervalSec),
		expectMin: row.expectMin == null ? '' : String(row.expectMin),
		expectMax: row.expectMax == null ? '' : String(row.expectMax),
		enabled: row.enabled ? '1' : '0'
	}));
}

/** Read at most 11 rows so a huge form cannot build a large draft. */
export function draftsFromForm(form: {
	getAll: (name: string) => unknown[];
}): { ok: true; drafts: CheckDraft[] } | { ok: false; field: CheckField; index: number | null; message: string } {
	const protocols = formStrings(form, HEALTH_FORM.protocol);
	const ports = formStrings(form, HEALTH_FORM.port);
	const paths = formStrings(form, HEALTH_FORM.path);
	const intervals = formStrings(form, HEALTH_FORM.interval);
	const expectMins = formStrings(form, HEALTH_FORM.expectMin);
	const expectMaxes = formStrings(form, HEALTH_FORM.expectMax);
	const enabled = formStrings(form, HEALTH_FORM.enabled);
	const columns = [protocols, ports, paths, intervals, expectMins, expectMaxes, enabled];
	if (columns.some((column) => column == null)) {
		return { ok: false, field: 'form', index: null, message: BAD_FORM };
	}
	const count = protocols?.length ?? 0;
	if (columns.some((column) => column?.length !== count)) {
		return { ok: false, field: 'form', index: null, message: BAD_FORM };
	}
	if (count > HEALTH_CHECK_LIMIT) {
		return { ok: false, field: 'checks', index: null, message: TOO_MANY };
	}
	const drafts: CheckDraft[] = [];
	for (let index = 0; index < count; index += 1) {
		const protocol = protocols?.[index];
		const flag = enabled?.[index];
		if ((protocol !== 'tcp' && protocol !== 'http') || (flag !== '0' && flag !== '1')) {
			return { ok: false, field: 'form', index, message: BAD_FORM };
		}
		drafts.push({
			key: `form-${index}`,
			protocol,
			port: strictInt(ports?.[index] ?? ''),
			path: paths?.[index] ?? '',
			intervalSec: strictInt(intervals?.[index] ?? ''),
			expectMin: strictInt(expectMins?.[index] ?? ''),
			expectMax: strictInt(expectMaxes?.[index] ?? ''),
			enabled: flag === '1'
		});
	}
	return { ok: true, drafts };
}

/**
 * Editor probe body. `ports` is the service's port list and is required.
 * A missing list refuses every port. TCP sends `path: null`.
 */
export function probeRequestBody(input: {
	protocol: string;
	port: string;
	path: string;
	ports: readonly number[];
}):
	| { ok: true; body: { protocol: CheckProtocol; port: number; path: string | null } }
	| { ok: false; field: 'protocol' | 'port' | 'path'; message: string } {
	if (input.protocol !== 'tcp' && input.protocol !== 'http') {
		return { ok: false, field: 'protocol', message: BAD_PROTOCOL };
	}
	const port = strictInt(input.port);
	if (port == null || port < 1 || port > 65535) {
		return { ok: false, field: 'port', message: BAD_PORT };
	}
	if (!input.ports?.includes(port)) {
		return { ok: false, field: 'port', message: BAD_PORT };
	}
	if (input.protocol === 'tcp') {
		return { ok: true, body: { protocol: 'tcp', port, path: null } };
	}
	const path = pathIssue(input.path);
	if (path) return { ok: false, field: 'path', message: path };
	return { ok: true, body: { protocol: 'http', port, path: input.path } };
}

/** Success closes and names the notice. `bad_request` stays open with the message on the field. */
export function healthChecksSaveState(input: {
	outcome: HealthSaveOutcome;
	message?: string | null;
	field?: string | null;
}): HealthSaveView {
	if (input.outcome === 'success') {
		return { close: true, notice: SAVED_HEALTH_CHECKS, field: null, message: null };
	}
	if (input.outcome === 'bad_request') {
		const field = input.field && input.field !== '' ? input.field : 'form';
		return { close: false, notice: null, field, message: input.message ?? '' };
	}
	if (input.outcome === 'failure') {
		return { close: false, notice: null, field: input.field ?? null, message: input.message ?? null };
	}
	return { close: false, notice: null, field: null, message: null };
}

/** Leave Services or switch projects and the saved line does not come back. */
export function healthNoticeOnView(
	notice: string | null,
	seen: HealthNoticeSeen | null,
	next: HealthNoticeSeen
): { notice: string | null; seen: HealthNoticeSeen } {
	if (seen == null) return { notice: next.tab === 'services' ? notice : null, seen: next };
	if (seen.projectId !== next.projectId) return { notice: null, seen: next };
	if (seen.tab === 'services' && next.tab !== 'services') return { notice: null, seen: next };
	return { notice, seen: next };
}

/** Any named action except the save itself clears the line. A cancelled save is not a new action name. */
export function healthNoticeOnAction(notice: string | null, action: string | null): string | null {
	if (action == null || action === 'saveHealthChecks') return notice;
	return null;
}

/** Opening the dialog clears the line. Closing it does not. */
export function healthNoticeOnDialog(notice: string | null, wasOpen: boolean, open: boolean): string | null {
	if (!wasOpen && open) return null;
	return notice;
}

/** Announce only after the dialog has finished closing, so the line is not read from inside it. */
export function healthNoticeOnCloseComplete(
	pending: string | null,
	open: boolean
): { pending: string | null; announce: string | null } {
	if (open || pending == null) return { pending, announce: null };
	return { pending: null, announce: pending };
}

/** If the dialog never reports the close, `run` announces the save anyway. */
export function scheduleHealthCloseFallback(
	run: () => void,
	schedule: (fn: () => void, ms: number) => void = (fn, ms) => {
		setTimeout(fn, ms);
	}
): void {
	schedule(run, HEALTH_CLOSE_FALLBACK_MS);
}

/** A 2xx body that still carries `confirmation_id` did not save. Console sessions do not confirm it. */
export function payloadHasConfirmation(value: unknown): boolean {
	if (value == null || typeof value !== 'object') return false;
	const id = (value as { confirmation_id?: unknown }).confirmation_id;
	return typeof id === 'string' && id !== '';
}

export function servicesHealthView(action: {
	scope?: string;
	healthServiceId?: string | null;
	healthField?: string | null;
	healthIndex?: number | null;
	healthMessage?: string | null;
	editorProbe?: boolean;
} | null): {
	serviceId: string | null;
	field: string | null;
	index: number | null;
	message: string | null;
	editorProbe: boolean;
} {
	if (action?.scope !== 'services') {
		return { serviceId: null, field: null, index: null, message: null, editorProbe: false };
	}
	return {
		serviceId: action.healthServiceId ?? null,
		field: action.healthField ?? null,
		index: action.healthIndex ?? null,
		message: action.healthMessage ?? null,
		editorProbe: action.editorProbe === true
	};
}

/** Put an API `bad_request` on the field the text names. Anything else stays on the form. */
export function fieldForHealthMessage(message: string): CheckField {
	const text = message.toLowerCase();
	if (text.includes('path')) return 'path';
	if (text.includes('interval')) return 'interval';
	if (text.includes('expect') || text.includes('status')) return 'expect';
	if (text.includes('port')) return 'port';
	if (text.includes('10') || text.includes('at most')) return 'checks';
	return 'form';
}

export function healthFailureOutcome(data: unknown): 'bad_request' | 'failure' {
	if (data != null && typeof data === 'object' && 'healthField' in data) {
		const field = (data as { healthField?: unknown }).healthField;
		if (typeof field === 'string' && field !== '') return 'bad_request';
	}
	return 'failure';
}

/**
 * HTTP already proves the TCP connect, so the draft drops the TCP row on this port.
 * Nothing is saved here. A TCP row on a different port is kept.
 */
function withoutRedundantTcp(drafts: CheckDraft[], httpIndex: number, replacedSelf: boolean): DraftChange {
	const http = drafts[httpIndex];
	if (!http || http.protocol !== 'http' || http.port == null) return { drafts, notice: null };
	const port = http.port;
	let removed = false;
	const kept = drafts.filter((row, index) => {
		if (index === httpIndex) return true;
		if (row.protocol === 'tcp' && row.port === port) {
			removed = true;
			return false;
		}
		return true;
	});
	if (!removed && !replacedSelf) return { drafts: kept, notice: null };
	return { drafts: kept, notice: replacedTcpNotice(port) };
}

function pathIssue(path: string): string | null {
	if (path === '' || !path.startsWith('/')) return MISSING_PATH;
	if (path.startsWith('//') || PATH_FORBIDDEN.test(path) || CONTROL.test(path)) return BAD_PATH;
	if (utf8.encode(path).byteLength > PATH_MAX_BYTES) return LONG_PATH;
	return null;
}

function expectIssue(min: number | null, max: number | null): string | null {
	if (min == null || max == null || min < EXPECT_MIN || min > EXPECT_MAX || max < EXPECT_MIN || max > EXPECT_MAX) {
		return BAD_EXPECT;
	}
	if (min > max) return EXPECT_ORDER;
	return null;
}

function integerOr(value: number | undefined, fallback: number): number {
	if (typeof value === 'number' && Number.isInteger(value)) return value;
	return fallback;
}

function strictInt(value: string): number | null {
	if (!STRICT_INT.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Cap each column at 11. A non-string value is a bad form. */
function formStrings(form: { getAll: (name: string) => unknown[] }, name: string): string[] | null {
	const values = form.getAll(name).slice(0, HEALTH_CHECK_LIMIT + 1);
	const texts: string[] = [];
	for (const value of values) {
		if (typeof value !== 'string') return null;
		texts.push(value);
	}
	return texts;
}
