# bot-console: per-repo design (v2)

**Date:** 2026-10-13. **Status:** Draft, design only.
**Cross-repo design (the source of truth for auth, permissions, and the API):** [../../docs/design-bot-agent-deploy.md](../../docs/design-bot-agent-deploy.md). This file covers only what changes inside this repo.

## Direction

bot-console stops reading Postgres directly and becomes a BFF client of bot-api-server (decision D6). It holds no database login, no OAuth client secret, and no permission logic. It may hide controls the user's role cannot use, but bot-api-server decides.

## Transition

| Step | Pages | Data source |
|---|---|---|
| Today | Overview, per-host, Services, Processes | `cluster_metrics` on pi4 via `src/lib/server/db.ts` (read-only login) |
| v2 step 1 | Sign-in, projects, members, hosts, join tokens (new) | bot-api-server |
| v2 step 2 | Overview, per-host, Services, Processes, page by page | bot-api-server `/v1/.../metrics` and `/health`, after bot-agent data is in `deploybot.metrics` |
| v2 step 3 | Remove `src/lib/server/db.ts` and the `cluster_metrics` login from `.env` | — |

The existing pages and `docs/api-contract.md` stay valid until step 2 replaces each page. Step 2 should keep each page's current behavior (stale after 2 min, unknown versus down, process shortening). Only the source changes.

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

`.env` gains `BOT_API_URL`. It loses the Postgres URL and password at step 3. No OAuth secrets (they live on bot-api-server).

## Tests (when implemented)

- `hooks.server.ts`: cookie → `/v1/me` → locals; a missing or expired session redirects or returns 401.
- The callback route: state mismatch is rejected; the token never reaches the browser body.
- Join-token page: the token renders once; reloading does not show it again.
- `pnpm check`, `pnpm test`, and `pnpm build` with Node 24 on `PATH` (see AGENTS.md).
