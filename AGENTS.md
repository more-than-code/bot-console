# bot-console

Design v2 (2026-10-13): `docs/design.md`. The console is a BFF for bot-api-server. `BOT_API_URL` is required. There is no Postgres login. Cross-repo design: umbrella `docs/design-bot-agent-deploy.md`. The frozen HTTP contract is `docs/contracts/api-v1.md` (do not edit the copy).

SvelteKit dashboard for deploybot. Umbrella: `/home/joe/workspace/deploybot`.

Do not apply SQL, install or reload Telegraf, restart systemd units, or change pi4 from an agent session. Do not print `.env`.

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
src/hooks.server.ts          security headers, no-store, required BOT_API_URL, session gate, / → /projects
src/lib/server/api.ts        bot-api-server client (Bearer, envelope, 35s timeout)
src/lib/server/session.ts    bot_session cookie, safe next path, public routes
src/lib/server/guard.ts      503 when BOT_API_URL is missing or invalid; require a user
src/lib/host-view.ts         host tabs, metric series names, service and process columns, chart alignment
src/lib/table.ts             client sort, search, and paging for DataTable
src/lib/url.ts               actionUrl, actionUrlFrom, and backTo for named form actions
src/lib/confirm.ts           confirm link, open state, and type-to-confirm match
src/lib/ranges.ts            1h / 6h / 24h / 7d → from/to
src/lib/format.ts            Pacific/Auckland and number formatting
src/lib/series.ts            merge helper kept for the old chart shape (not on the request path)
src/routes/+page.*           redirect / to /projects
src/routes/signin/           Google sign-in
src/routes/projects/         projects, hosts, members, join tokens, settings
src/routes/hosts/[id]/       overview, services, and processes tabs
src/routes/device/           device-code approval
tests/                       node:test, import paths end in .ts
```

## Conventions

- Svelte 5 runes. No new UI library. Charts are SVG in `LineChart.svelte`.
- The browser never calls bot-api-server. Server loads and form actions do.
- `BOT_API_URL` must be an origin with no path, query, or userinfo. `https`, or `http` for loopback, or `http` elsewhere only when `BOT_API_ALLOW_INSECURE_HTTP=1`. Anything else is 503 `Console is not configured (BOT_API_URL)` on every route except static assets.
- Host ids are UUIDs. `/hosts/[id]?tab=overview|services|processes` (default overview) and `?range=1h|6h|24h|7d` (default 1h). Unknown tab or range falls back to those defaults. Range becomes `from`/`to`. `step` is omitted.
- Overview metrics are seven parallel `GET /v1/hosts/{id}/metrics` calls (`cpu`, `mem`, `disk`, `net`, `diskio`, `system`, `temp`). A failed call sets that chart's message. The page still renders. Null points are gaps. The tab depends on `host:metrics` and invalidates it every 30 seconds while visible.
- Services keeps the health-check fan-out: at most 50 detail reads, concurrency 6, 10 second deadline. Rows carry `id="service-{id}"`.
- Processes calls `GET /v1/hosts/{id}/processes?sort=cpu|memory&limit=200`. DataTable search (`processes.q`) filters pid, process, user, and cmdline on the loaded rows. It is not sent to the API. `processes.sort=cpu|memory` (or the legacy `sort` param when the table sort is absent) is the API `sort`. Any other column sorts those rows in the page and the request uses `cpu`. `service_id` links to `?tab=services#service-{id}`.
- `node --test` loads TypeScript directly. A value import from a module under test needs the `.ts` extension (`allowImportingTsExtensions`). Type-only imports are erased and can stay extensionless.
- Do not print, log, or commit `.env`. Log only a short redacted error line.
- Do not commit unless the user asks. Do not push or add a remote.

## Shared components

Route pages use the shared pieces below. Do not reimplement them under `src/routes/`. `tests/components-reuse.test.ts` fails if a route adds a `<table>`, a tab strip (`role="tablist"` or `class="nav tabs"`), `role="alert"`, `confirm(`, a `StatusText` import, or an `<h1` (the heading comes from `PageHeader`).

- `DataTable` — every table. Sort, search, and paging are pure functions in `src/lib/table.ts`, driven by namespaced URL params (`<id>.q`, `<id>.sort`, `<id>.dir`, `<id>.page`) so they work without JavaScript. A column's `firstDir` is the direction used the first time that column is chosen (`asc` when omitted). Clicking the active column still toggles. Process CPU, RSS, memory, and threads open descending. The processes table default is `defaultDir="desc"`.
- `Tabs` — host and project tab strips.
- `PageHeader` — breadcrumbs, title, optional subtitle and actions. Every routed page with an `h1`.
- `StatusBadge` — known status labels (`online`, `offline`, `asleep`, `revoked`, `up`, `down`, `unknown`). `StatusText` is gone.
- `Notice` — `error` (`role="alert"`), `info`, and `success` (`role="status"`).
- `ConfirmAction` — two-step destructive action. Without JavaScript the first control is a `?confirm=<id>` link; with JavaScript it toggles in place. Delete project sets `typeToConfirm` so the user types the project name. The server check stays the authority. No hidden field carries that name.
- `actionUrl`, `actionUrlFrom`, and `backTo` in `src/lib/url.ts` — named form actions, `?<params>&/<name>`. `actionUrlFrom` keeps the current query (including table state) and drops `confirm` and `/name` keys. Host and project forms use it. `actionUrl` builds a query when there is no current URL. `backTo` is the same path and query after a successful same-page action: it drops `confirm` and `/name` and does not append an action. Project revoke, member, join-token revoke, and rename redirects use it. Delete project still redirects to `/projects`. Creating a project still redirects to the new project. Host probe and snapshot do not redirect.
