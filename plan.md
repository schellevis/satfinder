# Satfinder – Projectplan
## Doel
Een webtool waarmee je je satellietschotel kunt finetunen via SAT-IP, kanaalreceptie kunt monitoren via TVheadend, en de resultaten kunt correleren met weersomstandigheden.
---
## Architectuur
### Backend
- **Runtime:** Node.js 18+
- **Framework:** Express.js
- **Database:** SQLite (via `better-sqlite3`)
- **Scheduler:** `node-cron`
### Frontend
- Vanilla HTML5 / CSS3 / JavaScript (geen frameworks, directe afhankelijkheden minimaal)
- Responsive single-page interface
### Externe diensten
- **SAT-IP:** Directe verbinding via RTSP/HTTP (RFC 7826 / SAT-IP specification 1.2.2)
- **TVheadend:** JSON REST API
- **Weer-API:** Open-Meteo (gratis, geen API-sleutel vereist)
---
## Modules
### 1. SAT-IP module (`src/satip.js`)
- **Discover** van SAT-IP server via SSDP (UPnP) of handmatig IP-adres
- **Tune** naar een satelliet transponder (DVB-S / DVB-S2):
  - Frequency (MHz)
  - Polarisatie (H/V)
  - Symboolrate (ks/s)
  - Delivery system (DVBS / DVBS2)
  - FEC
- **Signaalmetingen** ophalen: level, quality, lock-status
- Ondersteuning voor meerdere tuners
- RTSP PLAY / TEARDOWN sessie-beheer
### 2. Frequentiedatabase (`src/frequencies.js`)
Bekende transponders voor Nederland. maak dit makkelijk uitbreidbaar (bijv via lokale api)
#### Astra 28.2°E (populair voor UK-zenders, ook in NL)
| Naam               | Freq (MHz) | Polarisatie | Symboolrate | Systeem |
|--------------------|-----------|-------------|-------------|---------|
| Astra 28.2 – 10773 | 10773     | H           | 22000       | DVB-S   |
| Astra 28.2 – 10714 | 10714     | H           | 22000       | DVB-S   |
| Astra 28.2 – 10847 | 10847     | H           | 22000       | DVB-S   |
| Astra 28.2 – 10788 | 10788     | H           | 22000       | DVB-S   |
| Astra 28.2 – 10862 | 10862     | H           | 22000       | DVB-S   |
| Astra 28.2 – 11836 | 11836     | H           | 27500       | DVB-S2  |
| Astra 28.2 – 10971 | 10971     | V           | 22000       | DVB-S   |
| Astra 28.2 – 11954 | 11954     | H           | 27500       | DVB-S2  |
#### Astra 19.2°E (sterkste signaal in NL, meeste zenders)
| Naam               | Freq (MHz) | Polarisatie | Symboolrate | Systeem |
|--------------------|-----------|-------------|-------------|---------|
| Astra 19.2 – 10744 | 10744     | H           | 22000       | DVB-S2  |
| Astra 19.2 – 10817 | 10817     | H           | 22000       | DVB-S2  |
| Astra 19.2 – 10832 | 10832     | V           | 22000       | DVB-S2  |
| Astra 19.2 – 10876 | 10876     | H           | 22000       | DVB-S2  |
| Astra 19.2 – 10921 | 10921     | H           | 27500       | DVB-S2  |
| Astra 19.2 – 11038 | 11038     | H           | 22000       | DVB-S2  |
| Astra 19.2 – 11229 | 11229     | H           | 22000       | DVB-S2  |
| Astra 19.2 – 11347 | 11347     | H           | 22000       | DVB-S2  |
| Astra 19.2 – 11420 | 11420     | H           | 22000       | DVB-S2  |
| Astra 19.2 – 11508 | 11508     | V           | 22000       | DVB-S2  |
| Astra 19.2 – 11523 | 11523     | H           | 22000       | DVB-S2  |
#### Hotbird 13°E (ook populair in NL)
| Naam               | Freq (MHz) | Polarisatie | Symboolrate | Systeem |
|--------------------|-----------|-------------|-------------|---------|
| Hotbird 13 – 10815 | 10815     | H           | 27500       | DVB-S2  |
| Hotbird 13 – 10853 | 10853     | H           | 27500       | DVB-S2  |
| Hotbird 13 – 10873 | 10873     | V           | 29900       | DVB-S2  |
| Hotbird 13 – 11179 | 11179     | H           | 27500       | DVB-S2  |
| Hotbird 13 – 11296 | 11296     | H           | 27500       | DVB-S2  |
| Hotbird 13 – 11354 | 11354     | H           | 27500       | DVB-S2  |
| Hotbird 13 – 11432 | 11432     | H           | 27500       | DVB-S2  |
| Hotbird 13 – 11538 | 11538     | H           | 27500       | DVB-S2  |
| Hotbird 13 – 11642 | 11642     | H           | 27500       | DVB-S2  |
| Hotbird 13 – 11747 | 11747     | H           | 27500       | DVB-S2  |
### 3. TVheadend module (`src/tvheadend.js`)
- Verbinden met TVheadend REST API (basis-authenticatie)
- Kanalenlijst ophalen (`/api/channel/grid`)
- Stream-info ophalen per kanaal
- Signaalstatus controleren via tvheadend API
- Per kanaal een meting doen en opslaan
### 4. Weer-module (`src/weather.js`)
- Gebruik Open-Meteo API (gratis, geen sleutel nodig):
  - URL: `https://api.open-meteo.com/v1/forecast`
- Ophalen van huidige weersomstandigheden:
  - Temperatuur
  - Bewolking (%)
  - Neerslag (mm)
  - Windsnelheid
  - Weercode (WMO)
- Geografische locatie: configureerbaar (lat/lon)
### 5. Database module (`src/database.js`)
SQLite-tabellen:
```sql
-- Scans
CREATE TABLE scans (
  id INTEGER PRIMARY KEY,
  scan_type TEXT,       -- 'manual' | 'scheduled'
  started_at DATETIME,
  finished_at DATETIME,
  weather_data TEXT     -- JSON blob
);
-- Signal metingen (per transponder)
CREATE TABLE signal_measurements (
  id INTEGER PRIMARY KEY,
  scan_id INTEGER REFERENCES scans(id),
  satellite TEXT,
  frequency INTEGER,
  polarisation TEXT,
  symbol_rate INTEGER,
  delivery_system TEXT,
  signal_level INTEGER,   -- 0-100
  signal_quality INTEGER, -- 0-100
  locked BOOLEAN,
  measured_at DATETIME
);
-- Kanaal metingen (TVheadend)
CREATE TABLE channel_measurements (
  id INTEGER PRIMARY KEY,
  scan_id INTEGER REFERENCES scans(id),
  channel_id TEXT,
  channel_name TEXT,
  signal_level INTEGER,
  signal_quality INTEGER,
  ber INTEGER,            -- bit error rate
  unc INTEGER,            -- uncorrected blocks
  measured_at DATETIME
);
```
### 6. Scheduler module (`src/scheduler.js`)
- `node-cron` gebaseerde scheduler
- Configureerbare cron-expressie (standaard: `0 3 * * *` = 03:00 iedere nacht)
- Uitvoer van volledige kanaalscan via TVheadend
- Logs opslaan
### 7. Express routes (`server.js`)
| Methode | Route                        | Beschrijving                           |
|---------|------------------------------|----------------------------------------|
| GET     | /api/config                  | Huidige configuratie ophalen           |
| POST    | /api/config                  | Configuratie opslaan                   |
| GET     | /api/satip/discover          | SAT-IP server ontdekken                |
| POST    | /api/satip/tune              | Afstemmen op transponder               |
| GET     | /api/satip/signal            | Huidig signaal ophalen                 |
| GET     | /api/frequencies             | Bekende transponders ophalen           |
| GET     | /api/tvheadend/channels      | Kanalenlijst ophalen                   |
| POST    | /api/tvheadend/scan          | Handmatige kanaalscan starten          |
| GET     | /api/weather                 | Huidige weersomstandigheden            |
| GET     | /api/scans                   | Scan-geschiedenis ophalen              |
| GET     | /api/scans/:id               | Scan details                           |
| GET     | /api/scheduler/status        | Scheduler-status                       |
| POST    | /api/scheduler/config        | Scheduler configureren                 |
| POST    | /api/scheduler/run           | Scheduled scan handmatig triggeren     |
---
## Frontend pagina's (tabs)
### Tab 1: Signaalfinder
- Invoer: SAT-IP adres, transponder (kies uit lijst of handmatig)
- Visuele signaalmeters (level + quality)
- Lock-indicator
- Refresh-knop / auto-refresh
- Geschiedenis van laatste metingen
### Tab 2: TVheadend Kanalen
- Koppeling met TVheadend instellen
- Kanalenlijst laden
- "Scan starten" knop
- Voortgangsbalk per kanaal
- Resultaattabel met signaalwaarden
### Tab 3: Geschiedenis & Statistieken
- Tabel van alle scans
- Filter op datum / kanaal
- Correlatie: signaalsterkte vs. weersomstandigheden
- Grafiek (Chart.js) van signaalverloop over tijd
### Tab 4: Instellingen
- SAT-IP server IP/poort
- TVheadend URL / gebruikersnaam / wachtwoord
- Locatie (lat/lon) voor weerdata
- Cron-schema voor nachtelijke scan
- Schakelaar voor automatische scan aan/uit
---
## Beveiliging & Configuratie
- Configuratie opgeslagen in `config.json` (niet in versiebeheer – staat in `.gitignore`)
- Basis HTTP-authenticatie optioneel voor de webinterface
- Gevoelige velden (wachtwoorden) worden alleen server-side opgeslagen
---
## Installatie & Gebruik
```bash
# Installeer afhankelijkheden
npm install
# Eerste keer configureren
cp config.example.json config.json
# Pas config.json aan
# Starten
npm start
# Of met auto-herstart bij wijzigingen (development)
npm run dev
```
Open de browser op `http://localhost:3000`
---
## Technische notities
### SAT-IP Signaalprotocol
SAT-IP gebruikt RTSP (RFC 7826). Een typisch tune-commando:
```
SETUP rtsp://<ip>/? \
  src=1&freq=10773&pol=h&sr=22000&msys=dvbs&pids=0 \
  RTSP/1.0
```
Signaalstatus wordt verkregen via RTSP GET_PARAMETER:
```
GET_PARAMETER rtsp://<ip>/stream=<id> RTSP/1.0
Content-Type: text/parameters
tuner_signal,tuner_quality,tuner_lock
```
### Open-Meteo Weercode mapping
| Code | Omschrijving |
|------|-------------|
| 0    | Helder       |
| 1-3  | Gedeeltelijk bewolkt |
| 45,48 | Mist       |
| 51-67 | Motregen / regen |
| 71-77 | Sneeuw      |
| 80-82 | Buien       |
| 95-99 | Onweer      |
