# bot-console

SvelteKit console for Deploybot. It is a BFF in front of bot-api-server: the browser never calls the API, and this app has no database login. Sign in with Google, then open a project and a host. A project has a Services tab. A host has Overview and Processes tabs.

JavaScript is required. Search, sort, paging, tabs, and filters stay in the URL. Writes are SvelteKit form actions. The UI is Tailwind CSS v4 and shadcn-svelte (style `nova`, neutral base, Lucide icons). `cn()` lives in `src/lib/utils.ts`. Colours are the tokens in `src/app.css` (light on `:root`, dark on `.dark`), including the Deploybot status tokens. The header theme switch posts to `/theme` and stores `bot_theme` (`system`, `light`, or `dark`; default `system`).

## Setup

Requires Node.js 20+ and pnpm:

```bash
pnpm install
```

Copy `.env.example` to `.env`. The app reads these variables on the server only (`$env/dynamic/private`):

| Key | Purpose |
|-----|---------|
| `BOT_API_URL` | Required bot-api-server origin, no path. Unset or invalid → 503 `Console is not configured (BOT_API_URL)` |
| `BOT_API_ALLOW_INSECURE_HTTP` | Set to `1` to allow a non-loopback `http://` API URL (development/internal testing only) |
| `BOT_API_OAUTH_AUTHORIZE_HOSTS` | Comma-separated `authorize_url` hostnames. Default `accounts.google.com` |

`https` is accepted. `http` is accepted only for `localhost`, `127.0.0.1`, and `::1`, unless `BOT_API_ALLOW_INSECURE_HTTP=1`.

Do not commit `.env`. `.env` is gitignored.

`vite dev` and `vite preview` load `.env` themselves. `node build` does not, so export the variables or run with the working directory set to this repo. A systemd `EnvironmentFile=` is the better production source.

## Scripts

| Script | What it does |
|--------|----------------|
| `pnpm dev` | Dev server on `0.0.0.0:5180` (`strictPort`) |
| `pnpm build` | Production build into `build/` |
| `pnpm preview` | Preview the build on `0.0.0.0:5180` |
| `pnpm check` | `svelte-check` |
| `pnpm test` | Unit tests (`node --test`). They mock `fetch`. There is no API server in the tests. |

Production, behind the reverse proxy:

```bash
PORT=5180 HOST=127.0.0.1 ADDRESS_HEADER=X-Forwarded-For XFF_DEPTH=1 node build
```

`PORT` defaults to 3000 and `HOST` to `0.0.0.0` in the Node adapter. Bind to loopback (`HOST=127.0.0.1`) when a reverse proxy is the only client. `ADDRESS_HEADER=X-Forwarded-For` and `XFF_DEPTH=1` make `event.getClientAddress()` the rightmost forwarded address, the one the closest proxy added. The console sets that address as `X-Forwarded-For` on every bot-api-server call. The API rate-limits Google sign-in start (20 per minute), invite redemption, and OAuth by client IP, and it uses the rightmost `X-Forwarded-For` address only when the TCP peer is `BOT_API_TRUSTED_PROXY` (`127.0.0.1` in production). Without the header, every console user shares that loopback bucket. A client who can reach the console directly can spoof `X-Forwarded-For`, which is why the process listens on loopback. `vite dev` ignores these two variables and uses the socket peer. If `getClientAddress()` throws, or returns an empty or non-IP value, the console sends no `X-Forwarded-For`.

In development, run `pnpm dev` on port 5180 against a running `bot-api-server` (e.g. `BOT_API_URL=http://127.0.0.1:8090`).

## Pages

| Path | Behavior |
|------|----------|
| `/` | 303 redirect to `/projects`. |
| `/signin` | Google sign-in. |
| `/projects` | List and create projects. |
| `/projects/[id]` | Hosts (default), Services, Catalog, members, join tokens, and settings. Admin+ manages env sets and registries. Each env set is a collapsible section (starts open) whose header has the key count, Add variable and Delete; "New env set" in the card header opens a dialog for the name and dotenv text, with "New keys are secret" on by default. Variables are edited in place (api-v1 v1.13): a plain value is shown and copyable, a secret shows only its preview (first 4 characters and `…` for 16+ characters, else `••••`) and cannot be copied; editing a secret asks for a new value. Add variable puts an editable row at the top (Secret checked by default); each row can be deleted. The secret flag is chosen when adding and is fixed afterwards. Rename and delete of a set stay with the owner. Each host links to `/hosts/[id]`. Breadcrumb: Projects › {project}. |
| `/hosts/[id]` | Tabs `?tab=overview\|processes` (default overview). `?tab=services` redirects to the project Services tab for this host when the caller is a member of the owning project, or of one of the first 20 session projects that list the host. An admin or owner of the owning project also sees catalog approvals. Breadcrumb: Projects › {project} › {host}. |
| `/device` | Approve or deny a device code for the signed-in user. |
| `/oauth/consent` | Allow or deny an MCP sign-in request. Signed out, redirects to `/signin?next=` this URL. |
| `/account/apps` | Connected apps for the signed-in user. Revoke ends that grant. |
| `/invite/[token]` | Join a project from an invite link. Signed out, redirects to `/signin?next=/invite/<token>` when the token is 43 base64url characters. That redirect sends `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, and `X-Frame-Options: DENY`. Lookup runs on load. Join posts accept and redirects to the project. The invite page sends the same three headers. |
| `/theme` | Public. `POST` sets the `bot_theme` cookie and redirects to a safe `next`. An unsafe `next` becomes `/`. |

Overview (`?range=1h|6h|24h|7d`, default `1h`) shows status, a snapshot action, and charts from `GET /v1/hosts/{id}/metrics`. One failed metric stays on that chart; the others still render. Charts refresh every 30 seconds while the tab is visible. Project Services (`?tab=services`) loads `GET /v1/projects/{id}/services` with server search, a host filter, sort, and cursor paging (`limit=25`). Admin+ renames a service from an icon button on that row (the dialog posts `display_name`, at most 64 characters) and probes a health check from an icon button there. The same rows get a Health checks button. The dialog edits protocol, a port from that service, an HTTP path, an interval from 30 to 300 seconds, the expected status range, and enabled. Save replaces the set with `PUT /v1/services/{id}/health-checks`. Success closes the dialog and, once that dialog has finished closing, the row says `Saved health checks.` That line clears when you leave Services, switch projects, open the dialog, or start another action. A bad request stays in the dialog on the field. The dialog notes that checks run on the host against `127.0.0.1:<port>` and that HTTPS and virtual hosts are not supported yet. A port with no check can add a TCP check. Switching a row to HTTP on a port that already has a TCP check drops that TCP row and says `Replaced the TCP check on <port> (HTTP covers it).` A TCP check on another port stays. Probe on a draft row posts that row's protocol, port, and path and does not save. The server reads the service first and does not call the probe when that port is not on the service, or when the HTTP path is not allowed. A probe failure is shown on that row in the dialog. A saved check still posts only `check_id`. If that row's checks could not be read, the Health checks button is disabled and says `Health checks could not be read.`, so Save cannot replace them with an empty set. A save that comes back with a confirmation id stays in the dialog and says `This change needs a confirmation; save it from the console session.` Processes loads `GET /v1/hosts/{id}/processes?sort=cpu|memory&limit=200`. Search filters the returned process rows in the browser. The Process cell shows the process name. A Service cell shows the service label and links to that service's project Services tab when the caller is a member of it. The host filter on project Services lists owned hosts and deploy shares. A search longer than 100 characters, a search containing NUL, or a host filter that is not a reachable host is not sent and shows a Notice. A service started from the catalog shows a `catalog` badge beside its name. An owned container row also shows its container name and a short image digest. A discovered container is labelled with its container name. A Show select next to the host filter chooses Deploybot services (the default), also discovered, or everything including gone (`?show=deploybot|discovered|all`). Those send `view=deploybot`, `view=deploybot_and_discovered`, and `view=all`. Any other `show` stays on the default. A service the host no longer reports shows stopped when Deploybot owns or declares it, and gone when it was only discovered. The default view's empty state, when there is no search and no load or action message, says "No services run by Deploybot yet." and links to discovered listeners, keeping the host filter. A search with no hits, or a message, says "No services reported."

Catalog (`?tab=catalog`) lists program and container image entries for every member. Row actions follow `my_actions`. The owner adds a program or a container image, sets permissions, and deletes an entry; an owner or admin edits an entry. A container service can have a Docker health check (command, interval, timeout, retries, start period); its deploy waits for Docker healthy. Only Deploy pulls the image and creates the container: until an image entry has a container on some host, Run, Stop, Restart and Logs are greyed out ("Deploy first: nothing is on a host yet."), and in their host choice a host without the container shows `(not deployed)`. While Deploy, Run, Stop, Restart or Rollback runs, the dialog shows a spinner, a label such as `Deploying…`, an elapsed timer and, for Deploy, the longest health wait; it cannot be dismissed until the request ends. Each container port row has Public (all interfaces), off by default. A public port listens on all of the host's interfaces and is allowed only when that host's runner.toml sets `allow_public_ports = true`; otherwise the deploy is refused. The catalog port column and the deploy dialog mark a public port as `<host>:<container> public` and leave a loopback port as `<host>:<container>`. The dialog shows that line before Deploy (Run job for a job), and adds `Publishes on all of the host's interfaces.` when any port is public. A successful image save closes the dialog and, once that dialog has finished closing, the catalog says Saved <name>. That line clears when you leave the catalog, switch projects, open Permissions, or start delete, run, stop, restart, deploy, rollback, or a create or edit dialog. Reloading env sets or files, or cancelling a save before it is sent, leaves the line in place. Image entries can also be deployed, rolled back, or removed when `my_actions` includes `deploy`. For a service, the rollback list offers the last three distinct succeeded or unchanged digests and omits the current digest unless that digest succeeded or was unchanged more than once in that window, in which case it is offered first as Previous version (same image). Run, stop, restart, and status ask for a host and reuse one idempotency key until that post succeeds. Logs do not. `waiting for the host owner's approval` is an info notice. On a host page, an owning-project admin approves or revokes catalog entries and sees exec, args, and env on each row; other callers do not see that section. A container form's Logs group sets max size per file and files kept; leaving both empty lets Deploybot use 10 MB and 3 files, the docker run preview shows those limits, and a host whose agent does not support log settings is not offered Deploy when the entry sets them.

Security note: The console dashboard is intended to run behind an authenticating reverse proxy with TLS or on private/overlay networks (VPN/internal). Do not expose the HTTP port directly to untrusted networks.

## Auth

`BOT_API_URL` is required. Every page except `/signin`, `/theme`, `/auth/google/callback`, and static assets needs a session. A page without a session redirects to `/signin?next=<path>`, and `next` has to be a same-origin relative path.

Sign-in is one "Sign in with Google" button. The server asks bot-api-server for the Google URL, stores the OAuth `state` and `next` in a short-lived HttpOnly cookie, and sends the browser to `authorize_url`. That redirect happens only when the URL is `https` and its parsed hostname is in `BOT_API_OAUTH_AUTHORIZE_HOSTS`. The callback checks `state`, posts the code to `/v1/auth/google/callback`, and stores the API token in the `bot_session` cookie. That cookie is HttpOnly, SameSite=Lax, Path=/, Max-Age 604800, and `Secure` only when the console request itself is https. The browser does not receive the session token in a response body.

`/signout` asks the API to delete the session and always clears the cookie. Mutations are form posts to this app. The server calls bot-api-server.

A join token is shown once, on the create result, and is not written to browser storage. The install command is shown with it only when it matches the command the API just issued. Otherwise the page says `Install command not shown: unexpected format` and the copy button is for the token only. An invite link is the same kind of one-time secret: admin+ creates it on the Members tab, the dialog shows the url once, and closing the dialog clears it. The url is shown only when its origin is this console and its path is `/invite/<token>`. The pending list never includes the token. Opening the link does not join; Join is a POST. `/signin` responses send `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. Buttons follow the caller's project role. The API still enforces that role. `forbidden` and `not_found` are messages on the page. Lists that stop at the page or item cap, or that see a repeated cursor, say `More items not shown`.

The header shows the product name, a Projects link, the theme switch (System, Light, Dark), and, when signed in, the user's name, a menu linking to Connected apps, and Sign out.

This console has not been run against bot-api-server or Google from the unit tests. They mock `fetch`.
