/** A host with no metric row newer than this is stale. */
export const STALE_AFTER = '2 minutes';

/** Same window as STALE_AFTER, compared in JS against database timestamps. */
export const STALE_AFTER_MS = 2 * 60 * 1000;

/**
 * Metric-table hosts older than this are listed only when metrics.hosts has a row.
 * Matches raw retention so expired series do not keep a node on the overview.
 */
export const RECENT_HOST_WINDOW = '7 days';

/** Extra history so the first rate sample inside the window has a previous counter. */
export const RATE_LOOKBACK = '2 minutes';

/** Client poll interval for the overview, per-host, services, and processes pages. */
export const POLL_MS = 15_000;

/**
 * Procstat rows older than this, relative to that host's newest row, are not
 * the current sample. Wider than the 60s Telegraf period so a service series
 * and the topk flush still meet.
 */
export const PROCESS_SAMPLE_WINDOW = '90 seconds';

/**
 * How far services queries look back for the latest procstat, unit, or HTTP row.
 * The 7-day retention window is not scanned on each poll.
 */
export const SERVICE_LOOKBACK = '10 minutes';

/** Process rows shown per host before declared service processes are added back. */
export const PROCESS_CAP = 40;
