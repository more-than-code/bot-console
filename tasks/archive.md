## Host list from registry and recent metrics
**Tier:** 2  **Status:** complete  **Delegation:** in-harness  **Date:** 2026-10-11  **Archived:** 2026-10-11
### Spec
- Goal: Overview and `/pi/[host]` follow `metrics.hosts` plus recent metric-table hosts, with per-metric gaps shown as n/a or no data, and registry-only hosts shown stale.
- Changes: `src/lib/host.ts`, `src/lib/snapshot.ts`, `src/lib/pg-error.ts`, `src/lib/limits.ts`, `src/lib/server/metrics.ts`, overview empty copy, chart empty copy, tests, README.md, AGENTS.md.
- Acceptance criteria:
  1. No fixed pi1–pi4 inventory in server, routes, components, param validation, or tests.
  2. A name in either source renders; any other safe name is 404.
  3. A missing metric table, column, or empty result does not drop the host or blank other metrics.
  4. A `metrics.hosts` row with no metric timestamps is `online: false` and the overview card is stale.
### Progress
- [x] Exploration
- [x] Implementation
- [x] Verification
### Gates
- [x] Mandatory gates executed automatically post-implementation
- [x] Evidence logged (commands, exit codes, summary)
- [x] If failed: status set to blocked and rerun/fix loop tracked
### Evidence
- `pnpm test` exit 0 (15 tests)
- `pnpm check` exit 0 (0 errors, 0 warnings)
- `pnpm build` exit 0
- Live `node build` on 127.0.0.1:5198: four hosts online with every gauge present; `/pi/pi4` 200; `grok-bot-box`, `Mac.local`, and `ip-10-0-1-5` 404 Unknown host. No metric query errors. Stale red card not visible because every host had reported within a minute.
