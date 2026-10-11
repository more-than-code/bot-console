# deploybot-webapp

SvelteKit dashboard for deploybot. This pass shows Telegraf host metrics from Postgres on pi4. The host list is every row in `metrics.hosts`, plus any host that wrote a metric row in the last 7 days. The browser never connects to the database. Services, databases, and ops history are navigation placeholders only.

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
| `pnpm test` | Unit tests for formatting, host names, and series merge |

Production:

```bash
export PATH="$HOME/.local/opt/node/bin:$PATH"
PORT=5180 HOST=0.0.0.0 node build
```

`PORT` defaults to 3000 and `HOST` to `0.0.0.0` in the Node adapter. The planned unit on pi1 uses port 5180.

## Pages

| Path | Behavior |
|------|----------|
| `/` | One card per known host: CPU %, memory %, root disk %, CPU temperature, load, uptime, and last report in Pacific/Auckland. A host with no metric timestamp in the last 2 minutes is `stale` and the card turns red. That includes a registry row that has never reported. A metric with no rows shows `n/a`. Each card links to `/pi/[host]`. |
| `/pi/[host]?range=1h\|1d\|1w` | Charts for the last hour (30s buckets), day (5m), or week (30m). A series with no rows says `No data`. |
| `/services`, `/databases`, `/ops` | Coming soon. |

Both live pages render the first payload on the server and then poll every 15 seconds.

CPU % is `100 - usage_idle` for `cpu = 'cpu-total'`. Memory is `metrics.mem.used_percent`. Disk is `metrics.disk.used_percent` where `path = '/'`. Temperature is `metrics.temp.temp` for `sensor = 'cpu_thermal'`. Load and uptime come from `metrics.system` (Telegraf writes them on separate rows).

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
      "memoryPercent": 9.5,
      "diskPercent": 11.9,
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

The dashboard is meant for the home LAN and Tailscale. It does not authenticate viewers; do not publish the port.
