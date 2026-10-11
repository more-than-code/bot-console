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

/** Client poll interval for the overview and per-host pages. */
export const POLL_MS = 15_000;
