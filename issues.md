# Satfinder — openstaande issues

Bevindingen uit de code-review van 2026-04-24. Issue #1 (SAT-IP protocol) wordt
apart aangepakt en staat hier niet in.

Gesorteerd naar impact. Regelnummers zijn indicatief.

---

## 🔴 Blocker: core features doen niet wat ze beloven

### #2 Signaalwaarden worden als procenten getoond, maar zijn het niet
**Waar:** `src/satip.js:200` (`parseSignalBody`) + `public/app.js:40` (`setMeter`).
**Probleem:** SAT-IP `level` is 0–255, `quality` is 0–15. De parser doet geen
normalisatie; de UI behandelt ze als 0–100%. Perfecte lock toont als "15%".
**Fix:** normaliseer in `parseSignalBody` — `level = round(raw / 255 * 100)`,
`quality = round(raw / 15 * 100)`. Bewaar eventueel ook raw naast `_pct` voor
debugging. Afhankelijk van fix #1 (andere parse-strategie).

### #3 Dish-aligning UX is ongeschikt voor wat het moet doen
**Waar:** `src/satip.js:235` (`measureSignal`), `public/app.js:230`
(auto-refresh op 5 s), geen audio-feedback.
**Probleem:** een satfinder moet real-time feedback geven terwijl iemand de
schotel draait. Nu doet elke meting een volledige SETUP → PLAY → wait 1.5 s
→ GET_PARAMETER → TEARDOWN cyclus, elke 5 s. Dat is ~3 s tuner-overhead per
sample en elke keer opnieuw afstemmen — peaken is onmogelijk.
**Fix:**
- Twee nieuwe endpoints: `POST /api/satip/tune-session` (SETUP + PLAY, bewaar
  sessie) en `DELETE /api/satip/tune-session/:id` (TEARDOWN).
- `GET /api/satip/signal-live?sessionId=...` doet alleen GET_PARAMETER op de
  bestaande sessie (snel, <100 ms).
- Frontend: start-knop tunet één keer, polt daarna op 500 ms, stop-knop teardown.
- Overweeg WebAudio beep met pitch ~ signaal als extra bak feedback.

### #4 TVheadend "scan" scant niet
**Waar:** `src/tvheadend.js:123` (`scanChannels`), `server.js:180`
(`POST /api/tvheadend/scan`), knop "Scan starten" in `public/index.html:318`.
**Probleem:** de functie heet `scanChannels` maar doet één `GET
/api/status/inputs` — een snapshot van *toevallig actieve* tuners. Geen
mux-scan, geen service-scan. Als er niks speelt (bijv. 's nachts) is het
resultaat leeg.
**Fix — twee opties:**
1. **Herbenoemen** naar `sampleInputs` / `POST /api/tvheadend/sample` en UI
   tekst aanpassen ("Huidige tuner-status vastleggen"). Eerlijk en simpel.
2. **Echt scannen** via TVH `/api/mpegts/mux/scan` per mux, of door
   `scan_state` te forceren. Veel meer werk, en TVH vereist service/mux UUIDs.
Advies: (1), tenzij je mux-scan echt wilt.

### #5 Scheduler levert geen bruikbare historie op
**Waar:** `src/scheduler.js:45` (`runScan`), die alleen `tvheadend.scanChannels()`
roept.
**Probleem:** de nachtelijke scan zou "signaal over tijd" moeten opleveren om
met weer te correleren. Maar hij raakt `signal_measurements` niet aan en de
TVH-snapshot is om 03:00 meestal leeg. De grafiek "Signaalverloop over tijd"
in de history-tab toont dus alleen losse handmatige metingen.
**Fix:** scheduler loopt door `frequencies.getAll()` (of een configureerbare
subset) en roept per transponder `satip.measureSignal()` aan. Weer ophalen
vóór de loop, één scan-rij, N `signal_measurements`. Reken op ~5 s per
transponder × 30 transponders = ~2,5 min voor de default lijst. Afhankelijk
van fix #1.

---

## 🟠 Inhoudelijke fouten die wel te herkennen maar misleidend zijn

### #6 "Weather correlation" correleert niet
**Waar:** `public/app.js:470` (`buildWeatherCorrelationChart`).
**Probleem:** de grafiek plot bewolking + neerslag per scan. Signaalwaarden
komen er niet in voor. Dat is geen correlatie, dat is alleen weer.
**Fix:** scatter plot met cloud_cover (of precipitation) op X-as en
gemiddeld signal_quality van die scan op Y-as. Of lijngrafiek met dubbele
Y-as: signaal vs weer, X = tijd. Vereist dat fix #5 eerst data produceert.

### #7 Elke handmatige meting = nieuwe scan-rij
**Waar:** `server.js:129` (`/api/satip/signal`).
**Probleem:** 20× op "Meten" klikken tijdens schotel-uitlijning = 20 scan-rijen
in de history.
**Fix — kies er één:**
- Niet persisten bij live-metingen; alleen persisten bij expliciete "sessie
  opslaan" knop.
- Session-concept: eerste meting opent scan, vervolgmetingen binnen N seconden
  op dezelfde transponder vallen onder dezelfde scan, auto-sluit na idle.
Advies: eerste optie zodra fix #3 live-peaken mogelijk maakt.

### #8 TVheadend signal-normalisatie is verkeerd
**Waar:** `src/tvheadend.js:154` (`normalizeSignal`).
**Probleem:** TVH `scale=1` levert waarden in 0–65535 range (promille
representatie). Code doet `value / 1000`, dus max is ~65 i.p.v. 100.
**Fix:** `Math.round(value / 655.35)` voor `scale === 1`. Voor `scale === 2/3`
even verifiëren tegen TVH source — de dBm-mapping -100..-30 → 0..100 is
discutabel voor DVB-S (typisch -25..-65 dBm), misschien beter blootleggen
als raw dBm i.p.v. forceren naar %.

---

## 🟡 Kleinere bugs en frictie

### #9 RTSP-parser kan body afkappen
**Waar:** `src/satip.js:107` in `rtspRequest`.
**Probleem:** `resolve()` gebeurt zodra `\r\n\r\n` in de buffer staat. Bij
responses met body (alle `GET_PARAMETER` en `DESCRIBE`) die in twee TCP-chunks
binnenkomen, mis je de body. Werkt nu "meestal" omdat SAT-IP bodies klein zijn.
**Fix:** parse de Content-Length header; pas resolven als `buf.length >=
headerEnd + 4 + contentLength`. Bij ontbrekende Content-Length: na `FIN` of
timeout resolven. Onafhankelijk van #1, maar hoog nut voor stabiliteit.

### #10 Scheduler-timezone is hardcoded
**Waar:** `src/scheduler.js:112`.
**Probleem:** cron gebruikt vaste `'Europe/Amsterdam'`, negeert
`weather.timezone`-setting.
**Fix:** lees timezone uit config (`cfg.scheduler.timezone` met fallback
naar `cfg.weather.timezone`, dan 'Europe/Amsterdam').

### #11 Grafiek-dropdown toont frequenties zonder data
**Waar:** `public/app.js:425` (`populateFreqSelector`).
**Probleem:** alle bekende transponders worden getoond, ook degene waar nooit
een meting voor is geweest → leeg chart bij selectie.
**Fix:** nieuw endpoint `/api/history/frequencies` dat `DISTINCT frequency`
uit `signal_measurements` levert, of groupeer client-side op basis van reeds
opgehaalde history.

### #12 XSS-vector in SSDP-discover resultaat
**Waar:** `public/app.js:148` (`discoverSatip`).
**Probleem:** `s.address` komt uit een SSDP-antwoord op het LAN en wordt
zonder escaping in `innerHTML` gedouwd. Een vijandig LAN-apparaat kan HTML
injecteren.
**Fix:** `escHtml()` (bestaat al) gebruiken, of textNode + dataset voor de
click-handler i.p.v. inline `onclick`.

### #13 Geen auth op `POST /api/config`
**Waar:** `server.js:52`.
**Probleem:** iedereen met netwerkbereik kan TVH-wachtwoord, cron-expressie,
SAT-IP host wijzigen. Het wachtwoord lekt niet (`***` placeholder) maar kan
wel overschreven worden.
**Fix — afweging:** voor een LAN-only self-hosted tool misschien acceptabel,
maar documenteer het expliciet in README/CLAUDE.md óf zet een simpele Basic
Auth-laag op `/api/config*` routes. Merk op dat de vorige auth-layer er net
uit gesloopt is (commit e9280c5) — check of die beslissing terecht was.

### #14 CSeq is globaal i.p.v. per-connection
**Waar:** `src/satip.js:15-17`.
**Probleem:** RTSP vereist CSeq per connectie vanaf 1. Elke `rtspRequest`
opent een nieuwe TCP-connectie maar gebruikt een globale teller. De meeste
servers trekken hier hun schouders over op, maar strikt incorrect.
**Fix:** CSeq teller als parameter van `rtspRequest`, of simpelweg altijd
`CSeq: 1` per losse request — omdat elke call een nieuwe connectie is, mag
dat. Wordt anders als fix #3 sessies gaat hergebruiken: dan wél oplopend
binnen een sessie.

### #15 Geen TEARDOWN van achtergebleven sessies bij shutdown
**Waar:** `server.js:297-307` (SIGINT/SIGTERM handlers).
**Probleem:** actieve RTSP-sessies blijven op de SAT-IP server tot die zelf
timeout (~60 s).
**Fix:** in shutdown handler `activeSessions` uitlopen en teardown sturen
voor elke entry. Niet kritisch maar netjes.

### #16 `entry.uuid` bestaat niet op TVH `/api/status/inputs`
**Waar:** `src/tvheadend.js:77`.
**Probleem:** `channel_id: inp.uuid || inp.stream` — `uuid` is altijd
undefined op die endpoint, dus `stream` wordt altijd `channel_id` én
`channel_name`.
**Fix:** verwijder het `uuid`-alternatief of gebruik `input` als id (naam van
de tuner) en `stream` als "wat speelt er". Maar die zijn niet stabiel tussen
scans — overweeg of `channel_measurements` überhaupt een `channel_id` moet
hebben, of alleen een `input_name`.

---

## Prioriteitsvolgorde voor aanpakken

1. **#1 + #2** (SAT-IP protocol + normalisatie) — fundering. Zonder dit werkt niks.
2. **#9** (RTSP-body) — klein en maakt #1 robuuster.
3. **#3** (live peak-UX) — maakt de core feature bruikbaar.
4. **#5** (scheduler door transponders) — maakt history en #6 zinvol.
5. **#6** (echte weer-correlatie) — levert inzicht dat de app belooft.
6. **#8** (TVH normalisatie) — parallel met de rest.
7. **#7, #11** — opruimwerk voor UX.
8. **#4** — keuze maken: herbenoemen of echt scannen.
9. **#10, #12, #13, #14, #15, #16** — losse patches.
