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
src/lib/service-label.ts     service display label, rename rule, process link
src/lib/table.ts             client sort, search, and paging, plus server-mode table helpers
src/lib/url.ts               actionUrl, actionUrlFrom, and backTo for named form actions
src/lib/confirm.ts           confirm link, open state, and type-to-confirm match
src/lib/ranges.ts            1h / 6h / 24h / 7d → from/to
src/lib/format.ts            Pacific/Auckland and number formatting
src/lib/series.ts            merge helper kept for the old chart shape (not on the request path)
src/routes/+page.*           redirect / to /projects
src/routes/signin/           Google sign-in
src/routes/projects/         projects, hosts, services, members, join tokens, settings
src/routes/hosts/[id]/       overview and processes tabs
src/routes/device/           device-code approval
tests/                       node:test, import paths end in .ts
```

## Conventions

- Svelte 5 runes. No new UI library. Charts are SVG in `LineChart.svelte`.
- The browser never calls bot-api-server. Server loads and form actions do.
- `BOT_API_URL` must be an origin with no path, query, or userinfo. `https`, or `http` for loopback, or `http` elsewhere only when `BOT_API_ALLOW_INSECURE_HTTP=1`. Anything else is 503 `Console is not configured (BOT_API_URL)` on every route except static assets.
- Host ids are UUIDs. `/hosts/[id]?tab=overview|processes` (default overview) and `?range=1h|6h|24h|7d` (default 1h). Unknown tab or range falls back to those defaults. `?tab=services` redirects (303) to `/projects/<id>?tab=services&services.host=<host id>` when the caller is a member of the owning project. Otherwise it checks at most the first 20 `/v1/me` projects, in session order, and uses the first whose host list contains the host. Each check is one page (`limit=200`) and does not follow `next_cursor`. If none match, the host page renders Overview. Range becomes `from`/`to`. `step` is omitted. The redirect does not keep `range`.
- Overview metrics are seven parallel `GET /v1/hosts/{id}/metrics` calls (`cpu`, `mem`, `disk`, `net`, `diskio`, `system`, `temp`). A failed call sets that chart's message. The page still renders. Null points are gaps. The tab depends on `host:metrics` and invalidates it every 30 seconds while visible. Overview does not call `/services`.
- Project Services (`/projects/[id]?tab=services`, every member) calls `GET /v1/projects/{id}/services` with `q`, `host_id`, `sort`, `dir`, `limit=25`, and `cursor`. The host filter offers owned hosts and deploy shares only. A `services.host` that is not a UUID, or that is outside that set, is not sent, and the page shows a Notice. A cursor longer than 512 characters, or one with a control character, is not sent and shows a Notice. A search longer than 100 characters after trimming, or one that contains NUL, is not sent and shows a Notice. It is not treated as an empty search. `?services.edit=<id>` renders the rename form only when that row may be renamed. The health-check fan-out is at most 50 detail reads, concurrency 6, 10 second deadline. Rows carry `id="service-{id}"`. A bad envelope is a Notice and no rows.
- Processes calls `GET /v1/hosts/{id}/processes?sort=cpu|memory&limit=200` and `GET /v1/hosts/{id}/services` for labels. A 403 on that service list leaves the process rows up with no labels and no links. DataTable search (`processes.q`) filters pid, process, service, user, and cmdline on the loaded rows. It is not sent to the API. `processes.sort=cpu|memory` (or the legacy `sort` param when the table sort is absent) is the API `sort`. Any other column sorts those rows in the page and the request uses `cpu`. The Process cell shows `process_name`. The Service cell shows `serviceLabel` (or the word `service` when the id is unknown) and links to `/projects/<service project>?tab=services&services.host=<host>&services.q=<name>` only when that project is in the caller's `/v1/me` list. `services.q` is the discovered name, capped at 100 code points.
- `node --test` loads TypeScript directly. A value import from a module under test needs the `.ts` extension (`allowImportingTsExtensions`). Type-only imports are erased and can stay extensionless.
- Do not print, log, or commit `.env`. Log only a short redacted error line.
- Do not commit unless the user asks. Do not push or add a remote.

## Shared components

Route pages use the shared pieces below. Do not reimplement them under `src/routes/`. `tests/components-reuse.test.ts` fails if a route adds a `<table>`, a tab strip (`role="tablist"` or `class="nav tabs"`), `role="alert"`, `confirm(`, a `StatusText` import, or an `<h1` (the heading comes from `PageHeader`).

- `DataTable` — every table. Client sort, search, and paging are pure functions in `src/lib/table.ts`, driven by namespaced URL params (`<id>.q`, `<id>.sort`, `<id>.dir`, `<id>.page`) so they work without JavaScript. Server mode uses the same names plus `<id>.host` and `<id>.cursor`, and does not sort or page the rows in the browser. A column's `firstDir` is the direction used the first time that column is chosen (`asc` when omitted). Clicking the active column still toggles. Process CPU, RSS, memory, and threads open descending. Service `last_seen` opens descending. The processes table default is `defaultDir="desc"`.
- `Tabs` — host and project tab strips.
- `PageHeader` — breadcrumbs, title, optional subtitle and actions. Every routed page with an `h1`.
- `StatusBadge` — known status labels (`online`, `offline`, `asleep`, `revoked`, `up`, `down`, `unknown`). `StatusText` is gone.
- `Notice` — `error` (`role="alert"`), `info`, and `success` (`role="status"`).
- `ConfirmAction` — two-step destructive action. Without JavaScript the first control is a `?confirm=<id>` link; with JavaScript it toggles in place. Delete project sets `typeToConfirm` so the user types the project name. The server check stays the authority. No hidden field carries that name.
- `actionUrl`, `actionUrlFrom`, and `backTo` in `src/lib/url.ts` — named form actions, `?<params>&/<name>`. `actionUrlFrom` keeps the current query (including table state) and drops `confirm` and `/name` keys. Host and project forms use it. `actionUrl` builds a query when there is no current URL. `backTo` is the same path and query after a successful same-page action: it drops `confirm` and `/name` and does not append an action. Project revoke, member, join-token revoke, project rename, and service rename redirects use it. Service rename also drops `services.edit`. Delete project still redirects to `/projects`. Creating a project still redirects to the new project. Project probe and host snapshot do not redirect. The project `rename` action is shared: a `service_id` field patches the service; without it, the project name is patched.
