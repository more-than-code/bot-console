# bot-console

Design v2 (2026-10-13): `docs/design.md`. The console is a BFF for bot-api-server. `BOT_API_URL` is required. There is no Postgres login. Cross-repo design: umbrella `docs/design-bot-agent-deploy.md`. The frozen HTTP contract is `docs/contracts/api-v1.md` (do not edit the copy).

SvelteKit dashboard for Deploybot. Umbrella: `/home/joe/workspace/deploybot`.

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
src/lib/server/api.ts        bot-api-server client (Bearer, envelope, 35s timeout; deploy and rollback pass a longer one)
src/lib/server/session.ts    bot_session cookie, safe next path, public routes
src/lib/server/guard.ts      503 when BOT_API_URL is missing or invalid; require a user
src/lib/host-view.ts         host tabs, metric series names, service and process columns, chart alignment
src/lib/service-label.ts     service display label, rename rule, process link
src/lib/service-view.ts      copy status word, badge tooltip text, `catalog.logs` deep-link helpers
src/lib/catalog-copies.ts    group service rows under catalog entries, host filter, copy search text
src/lib/table.ts             client sort, search, filters, and paging
src/lib/url.ts               actionUrl, actionUrlFrom, and backTo for named form actions
src/lib/confirm.ts           type-to-confirm match and submit disabled state
src/lib/theme.ts             bot_theme cookie, html marker, class apply
src/lib/components/ui/       shadcn-svelte primitives (generated; import only)
src/lib/ranges.ts            1h / 6h / 24h / 7d → from/to
src/lib/format.ts            viewer time zone and number formatting
src/lib/time-zone.ts         bot_tz cookie and the viewer zone shared with LocalTime
src/lib/series.ts            merge helper kept for the old chart shape (not on the request path)
src/routes/+page.*           redirect / to /projects
src/routes/signin/           Google sign-in
src/routes/projects/         projects, hosts, catalog & services, members, join tokens, settings
src/routes/hosts/[id]/       overview and processes tabs
src/routes/device/           device-code approval
src/routes/oauth/consent/    MCP consent (Allow / Deny)
src/routes/account/apps/     Connected apps and revoke
src/routes/theme/            public POST /theme sets bot_theme
tests/                       node:test, import paths end in .ts
```

## Conventions

- Svelte 5 runes. UI stack: Tailwind CSS v4, shadcn-svelte (`components.json` style `nova`, baseColor `neutral`, iconLibrary `lucide`), bits-ui, and `@lucide/svelte`. `cn()` is `src/lib/utils.ts`. Do not edit `src/lib/components/ui/**` and do not add a dependency for a one-off widget.
- `svelte-sonner` (pinned 1.2.1) is the shadcn-svelte dependency for `ui/sonner`. `ui/sonner/sonner.svelte` is adapted: its theme follows the console's `dark` class on `<html>` (`toasterTheme` in `src/lib/theme.ts`) instead of mode-watcher, which the console does not use. Like the adapted `ui/tabs`, keep that change when re-adding the component. Charts stay SVG in `LineChart.svelte` and use `var(--chart-n)`, `--border`, and `--muted-foreground`.
- Colours are tokens in `src/app.css` only (light on `:root`, dark on `.dark`, plus `--status-*`). No `#hex`, `rgb(`, `oklch(`, or `color-mix(in oklch` literal in a `.svelte` file outside `src/lib/components/ui/**`, and no inline colour style (`style=` or `style:`). Do not pass `forceMount` or `portalProps` outside that folder. Table-row actions are icon-only (`RowAction`).
- JavaScript is required. Dialogs, the theme switch, and chart refresh need it. URL state (search, sort, page, tab, filter) and server form actions stay. Do not add a `?confirm=` or `?catalog.edit=` path.
- The browser never calls bot-api-server. Server loads and form actions do.
- `BOT_API_URL` must be an origin with no path, query, or userinfo. `https`, or `http` for loopback, or `http` elsewhere only when `BOT_API_ALLOW_INSECURE_HTTP=1`. Anything else is 503 `Console is not configured (BOT_API_URL)` on every route except static assets.
- Host ids are UUIDs. `/hosts/[id]?tab=overview|processes` (default overview) and `?range=1h|6h|24h|7d` (default 1h). Unknown tab or range falls back to those defaults. `?tab=services` redirects (303) to `/projects/<id>?tab=catalog&catalog.host=<host id>` when the caller is a member of the owning project. Otherwise it checks at most the first 20 `/v1/me` projects, in session order, and uses the first whose host list contains the host. Each check is one page (`limit=200`) and does not follow `next_cursor`. If none match, the host page renders Overview. Range becomes `from`/`to`. `step` is omitted. The redirect does not keep `range`.
- Overview metrics are seven parallel `GET /v1/hosts/{id}/metrics` calls (`cpu`, `mem`, `disk`, `net`, `diskio`, `system`, `temp`). A failed call sets that chart's message. The page still renders. Null points are gaps. The tab depends on `host:metrics` and invalidates it every 30 seconds while visible. Overview does not call `/services`.
- Project Catalog & services (`/projects/[id]?tab=catalog`, every member) lists the catalog and, nested under each entry, its running copies: owned rows of this project from `GET /v1/projects/{id}/services?view=deploybot&include=health_checks&limit=200`, following `next_cursor` for at most 5 pages (then a notice). Discovered rows and other projects' rows are not shown; there is no Show select and no Project column. `?tab=services` redirects (303) to `?tab=catalog` with `services.q`, `services.host` and `services.logs` mapped to `catalog.*` and the old sort, cursor, page and `show` dropped. Sort, search (`catalog.q`, also matching a copy's host or label), the Kind filter and paging (25 entries, never splitting an entry) run in the browser. The host filter (`catalog.host`) offers owned hosts and deploy shares only; any other value is ignored and the page shows a Notice. Rename is a dialog on a copy that may be renamed. It posts `display_name` (max 64) to the `rename` action. A failure shows a Notice and keeps the typed value. A row with no `health_checks` key (an API older than v1.18) shows "Health checks need API v1.18 or later."; a malformed one shows "Health checks could not be read." Copy rows carry `id="service-{id}"`. A copy with `gone_at` set shows a stopped badge. Container states are read for at most 100 copies per load (then an info notice). Entries are collapsed by default (open state per project in per-tab storage, through `src/lib/catalog-open.ts` only); the Services column summarizes the copies by state, and an open entry shows a nested services table (`ServicesTable`: Host | Status | Port | Digest | Uptime | actions). An entry with no copy rows shows "Not deployed" only when the copy list was read completely; a program gets a "Not started" row per eligible host it never ran on, with Start only. Row actions sit in fixed slots with a "⋯" menu (`RowMenu`); below `sm` only the menu shows.
- Processes calls `GET /v1/hosts/{id}/processes?sort=cpu|memory&limit=200` and `GET /v1/hosts/{id}/services` for labels. A 403 on that service list leaves the process rows up with no labels and no links. DataTable search (`processes.q`) filters pid, process, service, user, and cmdline on the loaded rows. It is not sent to the API. `processes.sort=cpu|memory` (or the legacy `sort` param when the table sort is absent) is the API `sort`. Any other column sorts those rows in the page and the request uses `cpu`. The Process cell shows `process_name`. The Service cell shows `serviceLabel` (or the word `service` when the id is unknown) and, for an owned service with a catalog entry, links to `/projects/<service project>?tab=catalog&catalog.host=<host>&catalog.q=<entry>` only when that project is in the caller's `/v1/me` list. `catalog.q` is capped at 100 code points.
- `node --test` loads TypeScript directly. A value import from a module under test needs the `.ts` extension (`allowImportingTsExtensions`). Type-only imports are erased and can stay extensionless.
- Do not print, log, or commit `.env`. Log only a short redacted error line.
- Do not commit unless the user asks. Do not push or add a remote.

## Shared components

Route pages use the shared pieces below and the primitives in `src/lib/components/ui/`. Do not reimplement them under `src/routes/`. `tests/components-reuse.test.ts` fails if a route adds a `<table>`, a tab strip (`role="tablist"` or `class="nav tabs"`), `role="alert"`, `confirm(`, a `StatusText` import, or an `<h1` (the heading comes from `PageHeader`). It also fails on a colour literal or an inline colour style outside `src/lib/components/ui/**`, on `forceMount` or `portalProps` outside that folder, on a text-labelled button inside a DataTable `{#snippet row}`, and on a raw `<button` or `<input` outside `src/lib/components/ui/**` and `src/lib/components/*.svelte`.

The app shell header is the product name, the Projects link, `ThemeSwitch`, and (when signed in) the user's name (an account menu linking to Connected apps at `/account/apps`) and Sign out. The signed-in row wraps, and the account trigger shrinks so a long name truncates instead of widening the page. At 640 px and below the theme switch is icons only (each item has an `aria-label` and a tooltip) and sits on the next header line. Wide tables scroll inside the table container. Dialogs use the generated portal and mount only while open.

- `DataTable` — every table, on the shadcn `table`. Sort headers and the pager are `button` links. Client sort, search, filters, and paging are pure functions in `src/lib/table.ts`, driven by namespaced URL params (`<id>.q`, `<id>.sort`, `<id>.dir`, `<id>.page`, `<id>.<filter>`). The one-shot `<id>.logs` is never carried on by table links or forms. A column's `firstDir` is the direction used the first time that column is chosen (`asc` when omitted). Clicking the active column still toggles. Process CPU, RSS, memory, and threads open descending. The processes table default is `defaultDir="desc"`.
- `Tabs` — host and project link strips (`aria-current="page"`), with a Lucide icon beside the label. Not a `tablist`.
- `PageHeader` — breadcrumbs (`breadcrumb`), title, optional subtitle and actions. Every routed page with an `h1`.
- `StatusBadge` — `badge` plus a CSS dot. Known labels: `online`, `offline`, `asleep`, `revoked`, `up`, `down`, `unknown`, `stopped`, `gone`, `succeeded`, `unchanged`, `failed`, `timeout`, `rolled_back`, `rollback_failed`, `image_unavailable`, `forbidden_spec`, `conflict`. `stopped` uses the offline token and `gone` uses the unknown token. `succeeded` and `unchanged` use the up token, `failed`, `timeout`, `rollback_failed`, and `image_unavailable` use the down token, `rolled_back` uses the asleep token, `forbidden_spec` uses the revoked token, and `conflict` uses the offline token. Anything else renders as `unknown`. `StatusText` is gone.
- `Notice` — shadcn `alert`. `error` stays `role="alert"`. `info` and `success` are `role="status"`.
- `Toaster` — `ui/sonner`, mounted once at `bottom-center` in the root layout's app shell (never on site pages). Success confirmations only, through `src/lib/success-toast.ts`, fired after the dialog has finished closing (`Saved <name>.`, `Saved health checks.`, `Added {email}.`). Errors and info stay inline as `Notice`.
- `SearchField` — shadcn `input` and `button`. The label is visually hidden.
- `CopyButton` — shadcn `button` with the Copy and Check icons. It stays a text button on the join-token card.
- `RowAction` — ghost icon button for every action inside a table row, with an `aria-label` and a tooltip (`"<Action> <row label>"`). Catalog Run on a container and Deploy append one sentence to that tooltip. Destructive rows use the destructive text colour. Rename is `Pencil`, probe `Activity`, revoke credential `ShieldOff`, remove member `UserMinus`, change role `UserCog`, revoke join token `Ban`, delete `Trash2`.
- `RowMenu` — a row's "⋯" menu on the vendored `dropdown-menu`: one fixed action slot, items from `src/lib/row-menu.ts` (phone-only items for actions whose icons hide below `sm`), a 44 px button below `sm`. Items bump a counter that opens the row's dialog (`openRequest`); dialogs opened from it return focus to the ⋯ button (`fallbackFocusId`).
- `ThemeSwitch` — `toggle-group` with System, Light, and Dark (Monitor, Sun, Moon). The form posts `/theme` with `name="theme"` on each item, a hidden `theme`, and a hidden `next`. It sets the class immediately, then posts with `use:enhance` and does not follow the redirect. At 640 px and below the labels hide.
- `LocalTime` — one absolute timestamp in the viewer's time zone. Pass the ISO string as `iso`. A missing or unparseable value renders `n/a`. Chart axis labels use the same zone through `formatTick`.
- `ConfirmAction` — `alert-dialog` holding the POST form. Inside a table row the trigger is a `RowAction`. Delete project sets `typeToConfirm` so the user types the project name. Confirm stays disabled until `typeToConfirmMatches` is true. The server check stays the authority. No hidden field carries that name. The dialog body is `ConfirmForm`.
- `CommandText` — one truncated monospace line for a command, with the full text in `title` and a tooltip.
- `actionUrl`, `actionUrlFrom`, and `backTo` in `src/lib/url.ts` — named form actions, `?<params>&/<name>`. `actionUrlFrom` keeps the current query (including table state) and drops `confirm` and `/name` keys. Host and project forms use it. `actionUrl` builds a query when there is no current URL. `backTo` is the same path and query after a successful same-page action: it drops `confirm` and `/name` and does not append an action. Project revoke, member, join-token revoke, project rename, and service rename redirects use it. Delete project still redirects to `/projects`. Creating a project still redirects to the new project. Project probe and host snapshot do not redirect. The project `rename` action is shared: a `service_id` field patches the service; without it, the project name is patched.

Theme cookie `bot_theme` is `system`, `light`, or `dark` (`src/lib/theme.ts`). Missing or any other value is `system`. `POST /theme` is public (`isPublicPath`). The action stores the allowlisted value, never the raw form string. Cookie options: `HttpOnly`, `SameSite=Lax`, `Path=/`, max-age 31536000, `Secure` only when `url.protocol` is `https:`. `hooks.server.ts` `transformPageChunk` writes exactly one marker on the first `<html`: `class="dark"`, nothing, or `data-theme="system"`. The inline script in `src/app.html` uses `nonce="%sveltekit.nonce%"`. Early 503 responses return before `resolve`, so they do not get that marker.

Timestamps use the viewer's time zone (`src/lib/time-zone.ts`, `LocalTime`). The layout load reads cookie `bot_tz` and, when it is missing or not an IANA name, uses the server's zone. That same string is what the server HTML and the first client render share. After mount, if the browser zone differs, the page switches to it and stores `bot_tz` (`SameSite=Lax`, `Path=/`, max-age 31536000, `Secure` only on https, not `HttpOnly`). The date shape stays `en-NZ` with a 24-hour clock, and the zone abbreviation is the viewer's (NZDT, PDT, UTC, and so on). Chart ticks use that zone and do not print the abbreviation.
