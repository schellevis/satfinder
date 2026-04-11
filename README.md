# Satfinder

[![Docker Image](https://ghcr.io/schellevis/satfinder)](https://github.com/schellevis/satfinder/pkgs/container/satfinder)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A self-hosted web application for fine-tuning a satellite dish via **SAT-IP**, monitoring channel
reception through **TVheadend**, and correlating signal quality with live **weather data**.

![Screenshot of the Satfinder UI – signal finder tab](https://raw.githubusercontent.com/schellevis/satfinder/main/docs/screenshot.png)

---

## Features

- 📡 **SAT-IP integration** – SSDP auto-discovery + RTSP tune/signal/teardown for DVB-S / DVB-S2
- 📺 **TVheadend integration** – live tuner-input signal monitoring, channel list
- 🌦 **Weather correlation** – signal measurements annotated with Open-Meteo weather (no API key)
- 📊 **History & charts** – signal trend graphs powered by Chart.js
- ⏰ **Nightly scheduler** – automated channel scan via configurable cron expression
- 🔒 **Optional HTTP Basic Auth** for the web interface
- 🐳 **Docker / Portainer ready** – single-image deployment with persistent volume

---

## Quick start

### With Docker Compose (recommended)

```bash
# 1. Create a data directory and config file
mkdir -p data
cp config.example.json data/config.json
# Edit data/config.json with your SAT-IP / TVheadend settings

# 2. Start
docker compose up -d

# 3. Open http://localhost:3000
```

### With Node.js directly

**Requirements:** Node.js 18+

```bash
npm install
cp config.example.json config.json   # edit to match your setup
npm start                             # production
npm run dev                           # development (auto-restart via nodemon)
```

Open `http://localhost:3000` in your browser.

---

## Configuration

Copy `config.example.json` to `config.json` and adjust:

```json
{
  "server": {
    "port": 3000,
    "host": "0.0.0.0",
    "basicAuth": { "enabled": false, "username": "admin", "password": "changeme" }
  },
  "satip": {
    "host": "192.168.1.100",
    "port": 554,
    "tuner": 1
  },
  "tvheadend": {
    "url": "http://192.168.1.101:9981",
    "username": "admin",
    "password": "changeme"
  },
  "weather": {
    "latitude": 52.3676,
    "longitude": 4.9041,
    "timezone": "Europe/Amsterdam"
  },
  "scheduler": {
    "enabled": false,
    "cron": "0 3 * * *"
  },
  "database": {
    "path": "satfinder.db"
  }
}
```

All settings (except passwords) can also be changed at runtime through the **Settings** tab in the UI.

### Environment variables

| Variable  | Description                                 |
|-----------|---------------------------------------------|
| `PORT`    | Override `server.port`                      |
| `HOST`    | Override `server.host`                      |
| `DB_PATH` | Override `database.path` (SQLite file path) |

---

## Docker

### Pre-built image (ghcr.io)

```bash
docker pull ghcr.io/schellevis/satfinder:latest
```

### Run manually

```bash
docker run -d \
  --name satfinder \
  --restart unless-stopped \
  -p 3000:3000 \
  -v $(pwd)/data:/data \
  -e DB_PATH=/data/satfinder.db \
  ghcr.io/schellevis/satfinder:latest
```

Mount your `config.json` if you want to supply it externally:

```bash
-v $(pwd)/config.json:/app/config.json:ro
```

### Docker Compose / Portainer stack

See [`docker-compose.yml`](docker-compose.yml) – it is Portainer stack-compatible (no build
required; uses the pre-built `ghcr.io` image).

```bash
docker compose up -d
docker compose logs -f
```

---

## Architecture

```
Node.js 18 (Express)
├── src/satip.js        – SAT-IP SSDP + RTSP client (raw TCP sockets)
├── src/tvheadend.js    – TVheadend JSON REST API client (fetch)
├── src/weather.js      – Open-Meteo API client (fetch, no key needed)
├── src/scheduler.js    – node-cron nightly scan
├── src/database.js     – SQLite via better-sqlite3 (auto-migration)
├── src/frequencies.js  – Static transponder database
└── public/             – Vanilla HTML5 / CSS3 / JS single-page UI
```

### Supported satellites (built-in transponders)

| Satellite      | Transponders |
|----------------|-------------|
| Astra 28.2°E   | 8           |
| Astra 19.2°E   | 11          |
| Hotbird 13°E   | 10          |

Additional transponders can be added in `src/frequencies.js`.

---

## API reference

| Method | Route                     | Description                         |
|--------|---------------------------|-------------------------------------|
| GET    | `/api/config`             | Current config (passwords redacted) |
| POST   | `/api/config`             | Save config (deep-merge)            |
| GET    | `/api/satip/discover`     | SSDP-discover SAT-IP servers        |
| POST   | `/api/satip/tune`         | Tune to a transponder               |
| GET    | `/api/satip/signal`       | Measure signal + persist            |
| GET    | `/api/frequencies`        | Known transponders                  |
| GET    | `/api/tvheadend/channels` | Channel list                        |
| GET    | `/api/tvheadend/status`   | Live tuner-input status             |
| POST   | `/api/tvheadend/scan`     | Manual channel scan                 |
| GET    | `/api/weather`            | Current weather                     |
| GET    | `/api/scans`              | Scan history (paginated)            |
| GET    | `/api/scans/:id`          | Scan detail + measurements          |
| GET    | `/api/history/signal`     | Signal history for a frequency      |
| GET    | `/api/scheduler/status`   | Scheduler state                     |
| POST   | `/api/scheduler/config`   | Update scheduler settings           |
| POST   | `/api/scheduler/run`      | Trigger scheduled scan              |

---

## License

MIT – see [LICENSE](LICENSE) for details.