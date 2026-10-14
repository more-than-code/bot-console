# bot-console: per-repo design (v2)

**Date:** 2026-10-13. **Status:** Draft, design only.
**Cross-repo design (the source of truth for auth, permissions, and the API):** [../../docs/design-bot-agent-deploy.md](../../docs/design-bot-agent-deploy.md). This file covers only what changes inside this repo.

## Direction

bot-console stops reading Postgres directly and becomes a BFF client of bot-api-server (decision D6). It holds no database login, no OAuth client secret, and no permission logic. It may hide controls the user's role cannot use, but bot-api-server decides.

## Transition

| Step | Pages | Data source | Status |
|---|---|---|---|
| Today | Overview, per-host, Services, Processes | `cluster_metrics` on pi4 via `src/lib/server/db.ts` (read-only login) | Superseded |
| v2 step 1 | Sign-in, projects, members, hosts, join tokens (new) | bot-api-server | Done |
| v2 step 2 | Overview, per-host, Services, Processes, page by page | bot-api-server `/v1/.../metrics` and `/health`, after bot-agent data is in `deploybot.metrics` | Done 2026-10-14 (Joe: old pages deleted) |
| v2 step 3 | Remove `src/lib/server/db.ts` and the `cluster_metrics` login from `.env` | — | Done 2026-10-14 (Joe: old pages deleted) |

Steps 2 and 3 landed together. The console no longer reads Postgres. Host overview and processes are tabs on `/hosts/[id]`. Services is a tab on `/projects/[id]`. Both are fed only by bot-api-server. `BOT_API_URL` is required.

## Auth (BFF)

- New routes: `/signin` (Google only for now; GitHub later), `/auth/google/callback`, `/signout`, `/device` (the device-code approval page for MCP clients: sign in, enter the code, approve; umbrella §7), `/oauth/consent` (MCP browser consent: client name marked unverified, full redirect host, Allow or Deny), and `/account/apps` (Connected apps, linked from the header account menu, with a revoke action).
- Sign-in: a server route calls bot-api-server `GET /v1/auth/google/start`, then redirects. The callback route posts `code` and `state` to `POST /v1/auth/google/callback` and receives the session token once.
- Cookie `bot_session`: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=604800`, and `Secure` when the origin is HTTPS (the dev `:5180` is HTTP over the tailnet, so no `Secure` there).
- `hooks.server.ts`: read the cookie, call `GET /v1/me` (cached for each request), and put the user in `event.locals`. Unauthenticated page requests redirect to `/signin`. `/api/*` returns 401.
- Every server-side call to bot-api-server sends `Authorization: Bearer <cookie value>`. The browser never talks to bot-api-server.
- Mutating forms (phase 2 deploy/run/stop/restart) send one `idempotency_key` per click and reuse it on retry. SvelteKit's origin check covers CSRF for form POSTs.

## New pages

- **Projects:** list, create (the creator becomes owner), rename and delete (owner).
- **Members:** list; admins add, remove, and change viewer/admin roles; the owner transfers ownership.
- **Hosts:** per project: status (online, offline, or asleep for `always_on=false`), last seen, agent version; admin+ revokes a credential.
- **Join host:** admin+ creates a join token and sees it **once**, with the install command. The page never shows the token again.
- **Ops (phase 2):** logs for every member, viewers included. Deploy (by container name: adopt if it exists, create otherwise) for admin+. Run, stop, and restart for admin+ on `owned` services. Results come back inline. History reads `GET /v1/projects/{id}/audit`. This replaces the spec-v1 rule that "the dashboard does not drive ops".

## Env

`BOT_API_URL` is required. There is no Postgres URL or password. No OAuth secrets (they live on bot-api-server). An unset or invalid `BOT_API_URL` makes every route except static assets return 503.

## Components

Pages render on the server. JavaScript is required for dialogs, the theme switch, and chart refresh. Search, sort, paging, tabs, and filters stay in the URL, and every write is still a SvelteKit form action. Shared pieces live in `src/lib/components/` and are built on the shadcn-svelte primitives in `src/lib/components/ui/` (generated; do not edit them). Colours come only from the tokens in `src/app.css`. Icons are `@lucide/svelte`. `cn()` is in `src/lib/utils.ts`. Command lines, ports, pids, tokens, and install commands use the monospace stack. Dialogs mount only while open and use the generated portal.

| Piece | Role |
|---|---|
| `DataTable` | Every table. Client mode passes the rows the page already loaded. `src/lib/table.ts` sorts, searches (case-insensitive substring of searchable columns), and pages them from the URL: `<id>.q`, `<id>.sort`, `<id>.dir`, `<id>.page`. Sort headers and the pager are links. Search is a GET form. Default page size is 25. A table that fits on one page and has no search query shows no pager. The first click on a column uses that column's `firstDir` (ascending when omitted). A later click on the active column toggles. Server mode (`server` prop) does not sort, search, or page in the browser. The same namespaced params drive the API request. The pager says `Showing a–b of total`, and Prev/Next set `<id>.cursor`. A sort, search, or host change drops the cursor. A middle page, whose cursor is opaque, says `Showing n of total`. |
| `Tabs` | Link strip with `aria-current="page"` for the host page and the project page. |
| `PageHeader` | Breadcrumbs, `h1`, optional subtitle and actions. |
| `StatusBadge` | The known host and health statuses. Anything else renders as `unknown`. |
| `Notice` | Error, info, and success text. Errors are alerts. The others are status. |
| `RowAction` | Icon-only ghost button for every action inside a table row. The `aria-label` and the tooltip are the action plus the row (for example "Rename port 22 · root"). Destructive rows use the destructive text colour. Rename is Pencil, probe Activity, revoke credential ShieldOff, remove member UserMinus, change role UserCog, revoke join token Ban, delete Trash2. Actions outside a table keep a text label. |
| `ConfirmAction` | Alert dialog for revoke credential, delete project, remove member, and revoke join token. The dialog holds the POST form (`ConfirmForm`). Inside a table row the trigger is a `RowAction`. Delete project asks the user to type the project name, and Confirm stays disabled until that text matches. The server still rejects a mismatch. No hidden field carries the project name. |
| `actionUrlFrom` | Named form actions on host and project pages. Keeps the current query, including table search, sort, and page, then appends `&/<name>`. |
| `backTo` | Success redirect for a same-page project action. Same path and query, minus `confirm` and the `/name` action key. |

Project services (`/projects/[id]?tab=services`, every member) call `GET /v1/projects/{id}/services` with `q`, `host_id`, `sort`, `dir`, `limit=25`, and `cursor`, taken from `services.q`, `services.host`, `services.sort`, `services.dir`, and `services.cursor`. Sortable columns are name, host, kind, status, and last seen (`last_seen` opens descending). Ports is not a sort. The Project column appears only when some row's `project_name` differs from this project. A Checks column lists health checks and posts the probe. Search is one server-side field. The host filter is a GET select of reachable hosts (relation owner, or shared at deploy), plus All hosts. A metrics share is not an option. A `services.host` that is not a UUID, or that is outside that set, is not sent, and the page shows a Notice. A cursor that is too long or contains a control character is not sent and shows a Notice. A search longer than 100 characters after trimming, or one that contains NUL, is not sent and shows a Notice. It is not treated as an empty search. The rename form renders only when that row may be renamed. `serviceLabel` is `display_name`, otherwise the discovered name, unless that name is `port-<n>`, which renders as `port <n> · <owner_user>`. Admin+ renames from an icon button on the row. The dialog posts `display_name` (at most 64 characters) to the shared `rename` action, which still `PATCH`es `/v1/services/{id}`. A failed rename shows a Notice and keeps the typed value. Probe on that row is an icon button too. The process sample is still `sort=cpu|memory` and `limit=200`, and the processes table opens descending. CPU, RSS, memory, and threads also open descending when chosen from another column. The Process cell shows `process_name`. A Service column shows that label (or the word `service`) and links to the service's project only when the caller is a member of it. The link's `services.q` is the discovered name, capped at 100 code points.

`tests/components-reuse.test.ts` rejects a route that grows its own table, tab strip, alert, `confirm(`, `StatusText` import, or `<h1`. It also rejects a `#hex`, `rgb(`, `oklch(`, or `color-mix(in oklch` literal and an inline colour style (`style=` or `style:`) outside `src/lib/components/ui/`, `forceMount` or `portalProps` outside that folder, a text-labelled button inside a DataTable row snippet, and a raw `<button` or `<input` outside `src/lib/components/ui/` and `src/lib/components/*.svelte`.

## Theme

Cookie `bot_theme` is `system` (the default), `light`, or `dark`. Any other value counts as `system` and is never written back raw. `POST /theme` is public. It sets the cookie (`HttpOnly`, `SameSite=Lax`, `Path=/`, max-age one year, `Secure` only when the request is https) and redirects to a safe `next`, or to `/` when `next` is unsafe. The server writes `class="dark"` for dark, nothing for light, and `data-theme="system"` for system. An inline script in `src/app.html` (`nonce="%sveltekit.nonce%"`) adds `.dark` before paint when the choice is system and the OS prefers dark, and it follows later OS changes only while that attribute is still `system`. `ThemeSwitch` sets the class immediately, then posts `/theme` (`name="theme"`, hidden `next`) with `use:enhance` and does not reload the page. At 640 px and below the three choices are icons only, and the switch sits on the next header line. The signed-in row wraps, and a long account name truncates.

## Tests (when implemented)

- `hooks.server.ts`: cookie → `/v1/me` → locals; a missing or expired session redirects or returns 401.
- The callback route: state mismatch is rejected; the token never reaches the browser body.
- Join-token page: the token renders once; reloading does not show it again.
- `pnpm check`, `pnpm test`, and `pnpm build` with Node 24 on `PATH` (see AGENTS.md).
