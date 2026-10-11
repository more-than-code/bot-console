const aucklandWhen = new Intl.DateTimeFormat('en-NZ', {
	timeZone: 'Pacific/Auckland',
	day: '2-digit',
	month: 'short',
	year: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit',
	hourCycle: 'h23',
	timeZoneName: 'short'
});

const aucklandClock = new Intl.DateTimeFormat('en-NZ', {
	timeZone: 'Pacific/Auckland',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23'
});

const aucklandDayClock = new Intl.DateTimeFormat('en-NZ', {
	timeZone: 'Pacific/Auckland',
	day: 'numeric',
	month: 'short',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23'
});

export function formatWhen(iso: string | null): string {
	if (!iso) return 'n/a';
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return 'n/a';
	return aucklandWhen.format(date);
}

export function formatTick(iso: string, spanMs: number): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return '';
	const formatter = spanMs > 36 * 60 * 60 * 1000 ? aucklandDayClock : aucklandClock;
	return formatter.format(date);
}

export function formatPercent(value: number | null): string {
	if (value == null || !Number.isFinite(value)) return 'n/a';
	return `${value.toFixed(1)}%`;
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
