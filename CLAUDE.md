# CLAUDE.md – Satfinder

## Project overview

Satfinder is a self-hosted Node.js web application for fine-tuning a satellite dish via SAT-IP,
monitoring channel reception through TVheadend, and correlating signal quality with live weather
data from Open-Meteo. Everything runs in a single Node.js process; no build step is required.

## Repository layout

```
satfinder/
├── server.js              # Express app + all API routes + startup / shutdown
├── src/
│   ├── database.js        # SQLite (better-sqlite3) – migrations + CRUD helpers
│   ├── frequencies.js     # Static transponder list (Astra 28.2°E / 19.2°E, Hotbird 13°E)
│   ├── satip.js           # SAT-IP SSDP discovery + RTSP tune / signal / teardown
│   ├── scheduler.js       # node-cron scheduler – nightly channel scan
│   ├── tvheadend.js       # TVheadend JSON REST API client
│   └── weather.js         # Open-Meteo current-weather client
├── public/
│   ├── index.html         # Single-page UI (4 tabs, vanilla HTML/CSS/JS)
│   └── app.js             # Frontend JavaScript (tabs, charts, API calls)
├── config.example.json    # Reference configuration (copy to config.json and edit)
├── package.json
├── Dockerfile
├── docker-compose.yml
└── .github/workflows/
    └── docker.yml         # Build + push to ghcr.io on push/tag
```

## Getting started

```bash
npm install
cp config.example.json config.json   # edit config.json to match your setup
npm start                             # http://localhost:3000
npm run dev                           # hot-reload via nodemon
```

## Configuration (`config.json`)

| Section         | Key                        | Default              | Description                                |
|-----------------|----------------------------|----------------------|--------------------------------------------|
| `server`        | `port`                     | `3000`               | HTTP listen port                           |
| `server`        | `host`                     | `0.0.0.0`            | HTTP listen interface                      |
| `satip`         | `host`                     | —                    | SAT-IP server IP address                   |
| `satip`         | `port`                     | `554`                | SAT-IP RTSP port                           |
| `satip`         | `tuner`                    | `1`                  | Tuner source index                         |
| `tvheadend`     | `url`                      | —                    | TVheadend base URL (e.g. `http://…:9981`)  |
| `tvheadend`     | `username` / `password`    | —                    | TVheadend credentials                      |
| `weather`       | `latitude` / `longitude`   | Amsterdam            | Location for Open-Meteo weather            |
| `weather`       | `timezone`                 | `Europe/Amsterdam`   | IANA timezone for Open-Meteo               |
| `scheduler`     | `enabled`                  | `false`              | Enable nightly cron scan                   |
| `scheduler`     | `cron`                     | `0 3 * * *`          | Cron expression (default: 03:00 daily)     |
| `database`      | `path`                     | `satfinder.db`       | SQLite database file path                  |

The `PORT` and `HOST` environment variables override `server.port` / `server.host`.
`DB_PATH` environment variable overrides `database.path`.

## API routes

| Method | Route                    | Description                         |
|--------|--------------------------|-------------------------------------|
| GET    | `/api/config`            | Current config (passwords redacted) |
| POST   | `/api/config`            | Save config (deep-merge)            |
| GET    | `/api/satip/discover`    | SSDP-discover SAT-IP servers        |
| POST   | `/api/satip/tune`        | Tune to a transponder (RTSP SETUP)  |
| GET    | `/api/satip/signal`      | Measure signal + persist to DB      |
| GET    | `/api/frequencies`       | Known transponders list             |
| GET    | `/api/tvheadend/channels`| Channel list from TVheadend         |
| GET    | `/api/tvheadend/status`  | Live tuner-input status             |
| POST   | `/api/tvheadend/scan`    | Run a manual channel scan           |
| GET    | `/api/weather`           | Current weather (Open-Meteo)        |
| GET    | `/api/scans`             | Scan history (paginated)            |
| GET    | `/api/scans/:id`         | Scan detail + measurements          |
| GET    | `/api/history/signal`    | Signal history for a frequency      |
| GET    | `/api/scheduler/status`  | Scheduler state                     |
| POST   | `/api/scheduler/config`  | Update scheduler settings           |
| POST   | `/api/scheduler/run`     | Trigger a scheduled scan manually   |

## Database schema

Three SQLite tables (auto-migrated on startup):

- **`scans`** – top-level scan records (manual or scheduled), with weather snapshot
- **`signal_measurements`** – per-transponder SAT-IP measurements linked to a scan
- **`channel_measurements`** – per-input TVheadend measurements linked to a scan

## Key technical notes

### SAT-IP (RTSP)
`src/satip.js` implements a minimal RTSP/1.0 client over raw TCP sockets (no external RTSP library).
`measureSignal()` performs SETUP → wait 1.5 s → GET_PARAMETER → TEARDOWN in a single call and
returns `{ level, quality, locked }`.

### TVheadend
`src/tvheadend.js` uses the native `fetch` API (Node 18+). Signal normalisation maps both
relative (scale=1) and absolute dBm (scale=2/3) values to a 0–100 percentage.

### Weather
`src/weather.js` calls the Open-Meteo free API (no key required). The WMO weather-code table is
fully mapped to Dutch descriptions.

### Scheduler
`src/scheduler.js` uses `node-cron`. The scheduler is only active when `scheduler.enabled = true`
in config. It can be reloaded at runtime via `POST /api/scheduler/config`.

## Docker

```bash
# Build
docker build -t satfinder .

# Run (config and DB persisted in ./data)
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/data:/data \
  -e DB_PATH=/data/satfinder.db \
  satfinder

# Or with docker compose
docker compose up -d
```

See `docker-compose.yml` for a full Portainer-compatible stack definition.

## Extending the transponder database

Edit `src/frequencies.js` and add entries to the `transponders` array:

```js
{ name: 'My Transponder', satellite: 'My Sat 5°W', frequency: 11123,
  polarisation: 'H', symbol_rate: 27500, delivery_system: 'DVBS2', fec: '3/4' }
```

Alternatively a future local API endpoint can push transponders at runtime.

## Conventions

- **Strict mode** (`'use strict'`) at the top of every `.js` file.
- No build/transpile step; vanilla Node.js 18+.
- Frontend: zero npm dependencies – plain HTML5/CSS3/JS, Chart.js loaded from CDN.
- Config passwords are never returned to the client (replaced with `***`).
- Graceful shutdown on `SIGINT`/`SIGTERM`: scheduler stops, DB closes.
- **Never hardcode** IP addresses, hostnames, coordinates, usernames, or other personally identifiable / environment-specific values. These must always come from `config.json` and be configurable by the user. Discuss with the user before introducing any new defaults.
