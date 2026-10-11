## Host memory and disk capacity
**Tier:** 3  **Status:** complete  **Delegation:** in-harness  **Date:** 2026-10-11  **Archived:** 2026-10-11
**Approval:** User request is the spec (2026-10-11). No operator in this session to re-confirm.
### Spec
- Goal: `/pi/[host]` shows used/total capacity beside memory and disk percent, from the latest Telegraf sample, without breaking the existing API.
- Approach: Additive flat fields on `HostSnapshot`. Separate latest-byte queries so a missing byte column blanks only the new fields. One binary byte formatter (1024, labels B–PB) and one used/total/percent helper.
- Contract diff: `HostSnapshot` gains `memoryUsedBytes`, `memoryTotalBytes`, `memoryAvailableBytes`, `diskUsedBytes`, `diskTotalBytes`, `diskFreeBytes`, each `number | null`. Existing fields unchanged. Overview JSON includes them; overview cards stay percent-only.
- Changes: `src/lib/types.ts`, `src/lib/format.ts`, `src/lib/snapshot.ts`, `src/lib/server/metrics.ts`, `src/lib/components/LineChart.svelte`, `src/routes/pi/[host=host]/+page.svelte`, `src/app.css`, `tests/format.test.ts`, `tests/snapshot.test.ts`, `README.md`, `AGENTS.md`, `../docs/api-contract.md`.
- Acceptance criteria:
  1. Latest `metrics.mem` (`used`, `total`, `available`) and `metrics.disk` path `/` (`used`, `total`, `free`) ride on the host snapshot as bytes, same 7-day `DISTINCT ON` window as the gauges.
  2. Detail stat cards and Memory / Disk chart headers show `used / total UNIT (percent)` when total is present, percent alone when total is missing, and `n/a` when all three are missing. Charts stay percent.
  3. Null, 0, NaN, and huge values do not throw or render NaN.
  4. `pnpm check`, `pnpm test`, and `pnpm build` pass with zero errors and warnings.
- Rollback: revert the working tree. No schema or service change.
### Progress
- [x] Exploration
- [x] Implementation
- [x] Verification
### Gates
- [x] Mandatory gates executed automatically post-implementation
- [x] Evidence logged (commands, exit codes, summary)
- [x] If failed: status set to blocked and rerun/fix loop tracked
### Evidence
- `pnpm test` exit 0 (24 tests)
- `pnpm check` exit 0 (svelte-check 0 errors, 0 warnings)
- `pnpm build` exit 0
- Live `node build` on 127.0.0.1:5191 stopped afterwards. Overview HTML contained no `GB`. `/api/pi/pi1` and `/api/pi/grok-bot-box` returned the six byte fields. Stat cards and Memory / Disk chart subtitles rendered used/total. grok-bot-box temperature stayed `n/a`. Port 5180 was left running.

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
