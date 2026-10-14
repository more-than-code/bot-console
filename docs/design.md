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

- New routes: `/signin` (Google only for now; GitHub later), `/auth/google/callback`, `/signout`, and `/device` (the device-code approval page for MCP clients: sign in, enter the code, approve; umbrella §7).
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

Pages render on the server and stay usable without JavaScript. Shared pieces live in `src/lib/components/`. Colours come from the tokens in `src/app.css`.

| Piece | Role |
|---|---|
| `DataTable` | Every table. Client mode passes the rows the page already loaded. `src/lib/table.ts` sorts, searches (case-insensitive substring of searchable columns), and pages them from the URL: `<id>.q`, `<id>.sort`, `<id>.dir`, `<id>.page`. Sort headers and the pager are links. Search is a GET form. Default page size is 25. A table that fits on one page and has no search query shows no pager. The first click on a column uses that column's `firstDir` (ascending when omitted). A later click on the active column toggles. Server mode (`server` prop) does not sort, search, or page in the browser. The same namespaced params drive the API request. The pager says `Showing a–b of total`, and Prev/Next set `<id>.cursor`. A sort, search, or host change drops the cursor. A middle page, whose cursor is opaque, says `Showing n of total`. |
| `Tabs` | Link strip with `aria-current="page"` for the host page and the project page. |
| `PageHeader` | Breadcrumbs, `h1`, optional subtitle and actions. |
| `StatusBadge` | The known host and health statuses. Anything else renders as `unknown`. |
| `Notice` | Error, info, and success text. Errors are alerts. The others are status. |
| `ConfirmAction` | Revoke credential, delete project, remove member, and revoke join token. Delete project asks the user to type the project name. The server still rejects a mismatch. |
| `actionUrlFrom` | Named form actions on host and project pages. Keeps the current query, including table search, sort, and page, then appends `&/<name>`. |
| `backTo` | Success redirect for a same-page project action. Same path and query, minus `confirm` and the `/name` action key. |

Project services (`/projects/[id]?tab=services`, every member) call `GET /v1/projects/{id}/services` with `q`, `host_id`, `sort`, `dir`, `limit=25`, and `cursor`, taken from `services.q`, `services.host`, `services.sort`, `services.dir`, and `services.cursor`. Sortable columns are name, host, kind, status, and last seen (`last_seen` opens descending). Ports is not a sort. The Project column appears only when some row's `project_name` differs from this project. A Checks column lists health checks and posts the probe. Search is one server-side field. The host filter is a GET select of reachable hosts (relation owner, or shared at deploy), plus All hosts. A metrics share is not an option. A `services.host` that is not a UUID, or that is outside that set, is not sent, and the page shows a Notice. A cursor that is too long or contains a control character is not sent and shows a Notice. A search longer than 100 characters after trimming, or one that contains NUL, is not sent and shows a Notice. It is not treated as an empty search. The rename form renders only when that row may be renamed. `serviceLabel` is `display_name`, otherwise the discovered name, unless that name is `port-<n>`, which renders as `port <n> · <owner_user>`. Admin+ renames with `?services.edit=<id>` and `PATCH /v1/services/{id}`. The process sample is still `sort=cpu|memory` and `limit=200`, and the processes table opens descending. CPU, RSS, memory, and threads also open descending when chosen from another column. The Process cell shows `process_name`. A Service column shows that label (or the word `service`) and links to the service's project only when the caller is a member of it. The link's `services.q` is the discovered name, capped at 100 code points.

`tests/components-reuse.test.ts` rejects a route that grows its own table, tab strip, alert, `confirm(`, `StatusText` import, or `<h1`.

## Tests (when implemented)

- `hooks.server.ts`: cookie → `/v1/me` → locals; a missing or expired session redirects or returns 401.
- The callback route: state mismatch is rejected; the token never reaches the browser body.
- Join-token page: the token renders once; reloading does not show it again.
- `pnpm check`, `pnpm test`, and `pnpm build` with Node 24 on `PATH` (see AGENTS.md).
