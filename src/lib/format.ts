const formatters = new Map<string, Intl.DateTimeFormat>();

function dateFormat(kind: 'when' | 'clock' | 'time' | 'day', timeZone: string | undefined): Intl.DateTimeFormat {
	const key = `${kind}:${timeZone ?? ''}`;
	const cached = formatters.get(key);
	if (cached) return cached;
	const options: Intl.DateTimeFormatOptions = { hourCycle: 'h23' };
	if (timeZone) options.timeZone = timeZone;
	if (kind === 'when') {
		options.day = '2-digit';
		options.month = 'short';
		options.year = 'numeric';
		options.hour = '2-digit';
		options.minute = '2-digit';
		options.second = '2-digit';
		options.timeZoneName = 'short';
	} else if (kind === 'clock') {
		options.hour = '2-digit';
		options.minute = '2-digit';
	} else if (kind === 'time') {
		options.hour = '2-digit';
		options.minute = '2-digit';
		options.second = '2-digit';
	} else {
		options.day = 'numeric';
		options.month = 'short';
		options.hour = '2-digit';
		options.minute = '2-digit';
	}
	try {
		const format = new Intl.DateTimeFormat('en-NZ', options);
		formatters.set(key, format);
		return format;
	} catch {
		// A bad zone name throws. Fall back to the runtime zone instead of blanking the page.
		if (timeZone) return dateFormat(kind, undefined);
		throw new Error('could not format a time');
	}
}

/** `timeZone` is an IANA name. Omit it to use the runtime zone. */
export function formatWhen(iso: string | null, timeZone?: string): string {
	if (!iso) return 'n/a';
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return 'n/a';
	return dateFormat('when', timeZone || undefined).format(date);
}

/** `hh:mm:ss`. `timeZone` is an IANA name. Omit it to use the runtime zone. */
export function formatTime(date: Date, timeZone?: string): string {
	if (Number.isNaN(date.getTime())) return '';
	return dateFormat('time', timeZone || undefined).format(date);
}

/** `timeZone` is an IANA name. Omit it to use the runtime zone. */
export function formatTick(iso: string, spanMs: number, timeZone?: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return '';
	const kind = spanMs > 36 * 60 * 60 * 1000 ? 'day' : 'clock';
	return dateFormat(kind, timeZone || undefined).format(date);
}

export function formatPercent(value: number | null | undefined): string {
	if (value == null || !Number.isFinite(value)) return 'n/a';
	return `${value.toFixed(1)}%`;
}

// 1024-based so memory and disk match the kernel totals. Labels stay GB/TB, the same words formatRate uses, not GiB/TiB.
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

function byteUnit(bytes: number): { scale: number; label: (typeof BYTE_UNITS)[number] } {
	let scale = 1;
	let index = 0;
	while (bytes >= scale * 1024 && index < BYTE_UNITS.length - 1) {
		scale *= 1024;
		index += 1;
	}
	return { scale, label: BYTE_UNITS[index] };
}

function formatScaled(amount: number): string {
	const digits = Math.abs(amount) >= 100 ? 0 : 1;
	const text = amount.toFixed(digits);
	return text.endsWith('.0') ? text.slice(0, -2) : text;
}

export function formatBytes(value: number | null | undefined): string {
	if (value == null || !Number.isFinite(value) || value < 0) return 'n/a';
	const { scale, label } = byteUnit(value);
	return `${formatScaled(value / scale)} ${label}`;
}

/**
 * Used and total share the unit of total. No total falls back to the percent
 * alone. Nothing usable is `n/a`.
 */
export function formatCapacity(
	used: number | null | undefined,
	total: number | null | undefined,
	percent: number | null | undefined
): string {
	const totalOk = total != null && Number.isFinite(total) && total >= 0;
	if (!totalOk) return formatPercent(percent);
	const usedOk = used != null && Number.isFinite(used) && used >= 0;
	const { scale, label } = byteUnit(total);
	const usedText = usedOk ? formatScaled(used / scale) : 'n/a';
	const totalText = formatScaled(total / scale);
	const body = `${usedText} / ${totalText} ${label}`;
	if (percent == null || !Number.isFinite(percent)) return body;
	return `${body} (${formatPercent(percent)})`;
}

export function formatTemp(value: number | null): string {
	if (value == null || !Number.isFinite(value)) return 'n/a';
	return `${value.toFixed(1)}°C`;
}

export function formatLoad(value: number | null): string {
	if (value == null || !Number.isFinite(value)) return 'n/a';
	return value.toFixed(2);
}

export function formatUptime(seconds: number | null): string {
	if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return 'n/a';
	const total = Math.floor(seconds);
	const days = Math.floor(total / 86_400);
	const hours = Math.floor((total % 86_400) / 3_600);
	const minutes = Math.floor((total % 3_600) / 60);
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

const RATE_UNITS = ['B/s', 'KB/s', 'MB/s', 'GB/s'] as const;

export function formatLatency(ms: number | null | undefined): string {
	if (ms == null || !Number.isFinite(ms) || ms < 0) return 'n/a';
	if (ms < 10) return `${ms.toFixed(1)} ms`;
	return `${Math.round(ms)} ms`;
}

/** RSS and, when present, that process's share of host RAM. */
export function formatProcessMemory(
	bytes: number | null | undefined,
	percent: number | null | undefined
): string {
	const size = formatBytes(bytes);
	const share = formatPercent(percent);
	if (size === 'n/a' && share === 'n/a') return 'n/a';
	if (size === 'n/a') return share;
	if (share === 'n/a') return size;
	return `${size} (${share})`;
}

export function formatRate(value: number | null): string {
	if (value == null || !Number.isFinite(value) || value < 0) return 'n/a';
	let amount = value;
	let unit = 0;
	while (amount >= 1000 && unit < RATE_UNITS.length - 1) {
		amount /= 1000;
		unit += 1;
	}
	if (unit === 0) return `${Math.round(amount)} B/s`;
	const digits = amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
	return `${amount.toFixed(digits)} ${RATE_UNITS[unit]}`;
}
