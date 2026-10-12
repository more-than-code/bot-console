# bot-console

SvelteKit dashboard for deploybot. This pass shows Telegraf host metrics from Postgres on pi4, a Services page for declared service health, and a Processes page for the per-host process list. The host list is every row in `metrics.hosts`, plus any host that wrote a metric row in the last 7 days. The browser never connects to the database. Databases and ops history are navigation placeholders only. Overview and per-Pi pages are cards and charts, not tables.

## Setup

Node 24 and pnpm are installed under the home directory. The system Node at `/usr/bin/node` is too old. Put the user-local Node on `PATH` before every command:

```bash
export PATH="$HOME/.local/opt/node/bin:$PATH"
pnpm install
```

Copy `.env.example` to `.env` if needed. The app reads these variables on the server only (`$env/dynamic/private`, with `postgres`):

| Key | Purpose |
|-----|---------|
| `PGHOST` | Postgres host |
| `PGPORT` | Postgres port |
| `PGDATABASE` | Database name (`cluster_metrics`) |
| `PGUSER` | Read-only role |
| `PGPASSWORD` | Password for that role |

Do not commit `.env` or print the password. `.env` is gitignored.

`vite dev` and `vite preview` load `.env` themselves. `node build` does not, so either export the variables or run it with the working directory set to this repo: the server loads `.env` from the working directory when a key is missing, and does not override variables that are already set. A systemd `EnvironmentFile=` is the better production source.

## Scripts

| Script | What it does |
|--------|----------------|
| `pnpm dev` | Dev server on `0.0.0.0:5180` (`strictPort`) |
| `pnpm build` | Production build into `build/` |
| `pnpm preview` | Preview the build on `0.0.0.0:5180` |
| `pnpm check` | `svelte-check` |
| `pnpm test` | Unit tests for formatting, host names, series merge, and the services view |

Production:

```bash
export PATH="$HOME/.local/opt/node/bin:$PATH"
PORT=5180 HOST=0.0.0.0 node build
```

`PORT` defaults to 3000 and `HOST` to `0.0.0.0` in the Node adapter. The user unit `bot-console.service` on pi2 listens on port 5180.

## Pages

| Path | Behavior |
|------|----------|
| `/` | One card per known host: CPU %, memory %, root disk %, CPU temperature, load, uptime, and last report in Pacific/Auckland. A host with no metric timestamp in the last 2 minutes is `stale` and the card turns red. That includes a registry row that has never reported. A metric with no rows shows `n/a`. Each card links to `/pi/[host]`. |
| `/pi/[host]?range=1h\|1d\|1w` | Charts for the last hour (30s buckets), day (5m), or week (30m). A series with no rows says `No data`. Memory and root-disk cards, and those chart titles, show used / total when the latest total is present (`1.1 / 7.6 GB (14.9%)`), the percent alone when total is missing, and `n/a` when all three are missing. The chart lines stay percent. |
| `/services?host=&q=&order=&dir=&page=&pageSize=` | Service health only. Host chips, a debounced search box, and one paged table. Column headers are links that sort ascending or descending. A service name opens that service on Processes. An old `service=` bookmark explains the move and links there. Missing `metrics.services` shows an empty state instead of an error. |
| `/processes?host=&service=&q=&sort=&dir=&page=&pageSize=` | Per-host processes for the latest sample window. Same host chips, search, and paged sortable table. `sort` defaults to `cpu` and `dir` to `desc`. The process column is a shortened command line when one was stored (Node reports every process as `MainThread`). Missing `metrics.procstat` shows an empty state instead of an error. |
| `/databases`, `/ops` | Coming soon. |

The live pages render the first payload on the server and then poll every 15 seconds. `/`, `/services`, `/processes`, `/databases`, `/ops`, and `/pi/[host]` send `cache-control: no-store`.

CPU % is `100 - usage_idle` for `cpu = 'cpu-total'`. Memory is `metrics.mem.used_percent`. Disk is `metrics.disk.used_percent` where `path = '/'`. The same latest rows also carry memory `used`, `total`, and `available`, and root-disk `used`, `total`, and `free`, as bytes. Temperature is `metrics.temp.temp` for `sensor = 'cpu_thermal'`. Load and uptime come from `metrics.system` (Telegraf writes them on separate rows).

Network and disk I/O charts are per-second rates from cumulative counters. Per-interface (or per-disk) deltas that go backwards are dropped as counter resets. Network sums every interface except `lo`. Disk I/O uses whole disks only (`mmcblk0`, `nvme0n1`, `sda`, …), not partitions.

`metrics.time` is `timestamp without time zone` storing UTC. Queries compare it with `now() AT TIME ZONE 'UTC'` and return `timestamptz` via `AT TIME ZONE 'UTC'`.

## API

Responses are JSON, `cache-control: no-store`. A host is known when its name is in `metrics.hosts` or in metric rows from the last 7 days, and it matches the host-name shape (letters, digits, `.`, `_`, `-`, up to 253 characters, no `..`). Any other name is 404. A `range` other than `1h`, `1d`, or `1w` is 400. Omitting `range` means `1h`.

A missing metric table or column becomes `null` for that metric. The other metrics and the other hosts still return. `online` is false when none of the latest cpu, memory, disk, temperature, load, or uptime timestamps fall inside the last 2 minutes.

`GET /api/overview`

```json
{
  "generatedAt": "2026-10-11T07:04:00.000Z",
  "hosts": [
    {
      "name": "pi1",
      "lanIp": "192.168.2.10",
      "tailscaleIp": "100.0.0.1",
      "role": "coding-node",
      "runs": "short note from metrics.hosts.hosts",
      "cpuPercent": 0.2,
      "memoryPercent": 14.9,
      "memoryUsedBytes": 1221152768,
      "memoryTotalBytes": 8200626176,
      "memoryAvailableBytes": 6979473408,
      "diskPercent": 12.3,
      "diskUsedBytes": 7291064320,
      "diskTotalBytes": 62290444288,
      "diskFreeBytes": 51816525824,
      "tempC": 57.5,
      "load1": 0,
      "load5": 0.1,
      "load15": 0.2,
      "uptimeSeconds": 42902,
      "lastReported": "2026-10-11T07:04:00.000Z",
      "online": true
    }
  ]
}
```

`GET /api/pi/pi1?range=1h` returns `{ generatedAt, range, host, points }`. Each point is:

```json
{
  "t": "2026-10-11T07:04:00.000Z",
  "cpu": 2.7,
  "memory": 16.4,
  "disk": 14.1,
  "temp": 60.6,
  "load1": 0.1,
  "netRx": 3807.6,
  "netTx": 2688.4,
  "diskRead": 0,
  "diskWrite": 80486.4
}
```

Rates are bytes per second. `generatedAt` and `t` are ISO-8601 UTC. The UI renders them in Pacific/Auckland.

`host` on `/api/pi/:host` is the same object as an overview host. Any capacity field may be null. The overview cards still show memory and disk as percents.

`GET /api/services` still accepts `host`, `sort=cpu|memory`, and `service`, and still returns `processes[]` capped at 40 rows per host plus declared service processes outside that cut. `sort` only orders that process list. New query params, all optional: `q`, `order`, `dir`, `page`, `pageSize`. New response fields: `q`, `order` (default `host`), `dir` (default `asc`), `page`, `pageSize`, `servicesTotal`. When `page` and `pageSize` are both omitted, `services` is the full filtered list and those two fields are null. Setting either one returns that page (`page` defaults to 1, `pageSize` to 25, maximum 100; `page` maximum 10000). `order` is `name`, `status`, `host`, `port`, `unit`, `http`, `lastCheck`, `latency`, `cpu`, or `memory`. Status order is up, then unknown, then down. Memory order is RSS bytes. Nulls are last in both directions. Ties break by host, then name. `q` is a free-text search of service name, project, host, unit, and health URL (trimmed, max 200 characters, no NUL). The match is SQL `ILIKE` on a bound pattern with `%`, `_`, and `\` escaped. `q`, `order`, and `page` do not change `processes[]`. The HTML page always requests one page even when its URL omits `page`. A bad host, sort, order, direction, page, page size, or service name is 400. An unknown host is an empty selection, not 404.

`GET /api/processes` is new. It returns one page of deduped process rows from the same 10-minute lookback and 90-second sample window. There is no 40-row cap on this route. Query: `host`, `service`, `q`, `sort`, `dir`, `page`, `pageSize`. Defaults: `sort=cpu`, `dir=desc`, `page=1`, `pageSize=25`. `sort` is `host`, `process`, `pid`, `user`, `threads`, `cpu`, `memory`, `uptime`, or `sampledAt`. `q` matches process name, command line, user, host, and pid with the same `ILIKE` rules. `service` keeps rows linked to that service. Search is applied in SQL. Sort and page run in the API after dedupe and service linking, because the process column is the shortened command line and uptime is computed. The body is `{ generatedAt, host, service, q, sort, dir, page, pageSize, total, hosts, processesAvailable, sampledAt, processes }`. `total` is the filtered count before paging. `sampledAt` is the newest row in that filtered set.

`servicesAvailable` is false when `metrics.services` is missing. `processesAvailable` is false when `metrics.procstat` is missing or the process query hits a missing column (the live table has no `cmdline` until the SQL runs). A missing relation (`42P01`) is remembered for 60 seconds, then checked again, so a bot-console restart is not required just to notice the new tables. A missing column (`42703`) is not cached. The overview queries in `src/lib/server/metrics.ts` are separate and still remember a missing table or column until that process restarts. Process CPU is per core (a value can pass 100%). Memory percent is the process's share of host RAM. Each process row has `cmdline`: a shortened command line, or null. The full command line stays in the database. Table state lives in the URL. Search updates it after a 300ms pause and also on form submit. Sort headers and page links are real links.

Service queries look back 10 minutes for the latest procstat, unit, and HTTP row. They do not scan the 7-day retention window on each poll. A unit or HTTP sample older than 2 minutes is `unknown`, not `down`. User-scope health is HTTP plus a fresh process. The unit name on those rows is the cgroup path, not a health check. System-scope health is the unit plus HTTP when a URL is set. A service with no unit and no user scope (Briefed, pgAdmin) is HTTP only.

The Services registry, the procstat column changes, and the `systemd_units` and `http_response` tables are defined in `bot-agent/sql/010_procstat_and_services.sql`. The dashboard does not create them. Telegraf does not already have those two measurements. Manifests and the Telegraf snippets live in `bot-agent/` and are described in `docs/spec-v1.md`.

The dashboard is meant for the home LAN and Tailscale. It does not authenticate viewers; do not publish the port.
