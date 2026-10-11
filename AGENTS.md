# pim-webapp

SvelteKit dashboard for Pi Monitor. Reads `cluster_metrics.metrics` with the read-only login in `.env`. Umbrella: `/home/joe/workspace/pi-monitor`.

This pass is Telegraf host metrics only: `/` and `/pi/[host]`. Services, databases, and ops are coming-soon routes. Do not build them unless asked. Do not touch Telegraf, database roles, systemd units, `~/pgdata`, or `../pim-agent`.

## Commands

Always put user-local Node 24 on `PATH`. `/usr/bin/node` is v18. Do not change it.

```bash
export PATH="$HOME/.local/opt/node/bin:$PATH"
pnpm install
pnpm check
pnpm test
pnpm build
PORT=5180 HOST=0.0.0.0 node build
```

`pnpm dev` and `pnpm preview` bind `0.0.0.0:5180` with `strictPort`. Do not leave a dev server running. If you need a temporary server, use a port other than 5180 and 5176 and stop it.

SvelteKit 2 (not 3): config stays in `svelte.config.js`, imports use `$lib`, and private env is `$env/dynamic/private`. Adapter is `@sveltejs/adapter-node`.

## Layout

```
src/hooks.server.ts          security headers, no-store on pages and /api
src/lib/server/db.ts         postgres.js pool, .env fallback, read-only session
src/lib/server/metrics.ts    overview and series SQL
src/lib/server/errors.ts     log a redacted line, return 503
src/lib/format.ts            Pacific/Auckland and number formatting
src/lib/ranges.ts            1h / 1d / 1w windows and time_bucket widths
src/lib/series.ts            merge bucketed series
src/lib/host.ts              host-name shape, not a node list
src/lib/snapshot.ts          merge registry rows and metric samples
src/lib/pg-error.ts          missing table or column (42P01, 42703)
src/lib/disk.ts              whole-disk name pattern
src/params/host.ts           route matcher
src/routes/+page.*           cluster cards
src/routes/pi/[host=host]/   charts
src/routes/api/              JSON polled by the pages
tests/                       node:test, import paths end in .ts
```

## Conventions

- Svelte 5 runes. No new UI library. Charts are SVG in `LineChart.svelte`.
- Database access stays in `src/lib/server/`. The client polls same-origin `/api` routes.
- Queries are parameterized. `isHostName` checks shape only. A host is known when it is in `metrics.hosts` or in `cpu`, `mem`, `disk`, `temp`, `system`, `net`, or `diskio` within `RECENT_HOST_WINDOW` (7 days). `/pi/[host]` is 404 otherwise. Range is `1h`, `1d`, or `1w`.
- Each metric query is isolated. `42P01` or `42703` blanks that metric and is remembered until restart. Empty rows stay `null` (`n/a` on a card, `No data` on a chart) and do not drop the host.
- A host is stale when it has no cpu, memory, disk, temperature, load, or uptime timestamp in the last 2 minutes (`STALE_AFTER` / `STALE_AFTER_MS`). A registry row with no metric rows is stale, and its card is red. Pages poll every 15 seconds (`POLL_MS`).
- `metrics.time` is timestamp without time zone holding UTC. Compare with `now() AT TIME ZONE 'UTC'`. Send `value AT TIME ZONE 'UTC'` to Node so it is a real instant. Session `TimeZone` is UTC.
- Gauge charts use `time_bucket`: 30 seconds, 5 minutes, 30 minutes.
- Net and diskio are counters. Rate is a positive per-series delta over elapsed seconds, averaged in the bucket, then summed. Drop negative deltas. Skip interface `lo`. Disk names must match `WHOLE_DISK_PATTERN`.
- System load and uptime are separate rows. Read the latest non-null row of each.
- Do not print, log, or commit `.env` or `PGPASSWORD`. Log only a short redacted error line.
- Do not commit unless the user asks. Do not push or add a remote.
