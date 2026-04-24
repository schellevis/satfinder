'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');

const db = require('./src/database');
const frequencies = require('./src/frequencies');
const satip = require('./src/satip');
const tvheadend = require('./src/tvheadend');
const weather = require('./src/weather');
const scheduler = require('./src/scheduler');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const EXAMPLE_CONFIG_PATH = path.join(__dirname, 'config.example.json');
let bandScanRunning = false;

// ---------- Config helpers ----------

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    try {
      return JSON.parse(fs.readFileSync(EXAMPLE_CONFIG_PATH, 'utf8'));
    } catch {
      return { server: { port: 3000 } };
    }
  }
}

function saveConfig(newConfig) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2), 'utf8');
}

// ---------- App setup ----------

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function writeJsonLine(res, payload) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`${JSON.stringify(payload)}\n`);
}

async function runSignalBandScan({ host, port, tuner, satellite, weatherConfig, scanType = 'band-scan' }, onProgress = async () => {}) {
  const transponders = db.getAllMuxes(satellite || undefined);
  if (!transponders.length) {
    throw new Error('Geen transponders gevonden voor deze satelliet');
  }

  let weatherData = null;
  try {
    weatherData = await weather.getCurrentWeather(weatherConfig || {});
  } catch {}

  const scanId = db.startScan(scanType, weatherData);
  const results = [];

  try {
    await onProgress({ type: 'start', scanId, satellite, total: transponders.length, weatherData });

    for (let index = 0; index < transponders.length; index++) {
      const transponder = transponders[index];
      const measuredAt = new Date().toISOString();
      let result;

      try {
        const signal = await satip.measureSignal(host, port, { ...transponder, tuner });
        db.insertSignalMeasurement(scanId, {
          satellite: transponder.satellite || null,
          frequency: transponder.frequency,
          polarisation: transponder.polarisation,
          symbol_rate: transponder.symbol_rate,
          delivery_system: transponder.delivery_system || 'DVBS2',
          signal_level: signal.level,
          signal_quality: signal.quality,
          locked: signal.locked,
          measured_at: measuredAt
        });
        result = {
          ...transponder,
          level: signal.level,
          quality: signal.quality,
          locked: signal.locked,
          measured_at: measuredAt,
          error: null
        };
      } catch (err) {
        db.insertSignalMeasurement(scanId, {
          satellite: transponder.satellite || null,
          frequency: transponder.frequency,
          polarisation: transponder.polarisation,
          symbol_rate: transponder.symbol_rate,
          delivery_system: transponder.delivery_system || 'DVBS2',
          signal_level: null,
          signal_quality: null,
          locked: false,
          measured_at: measuredAt
        });
        result = {
          ...transponder,
          level: null,
          quality: null,
          locked: false,
          measured_at: measuredAt,
          error: err.message
        };
      }

      const progress = {
        type: 'progress',
        scanId,
        satellite,
        index: index + 1,
        total: transponders.length,
        ...result
      };
      results.push(progress);
      await onProgress(progress);
    }

    db.finishScan(scanId);
    return {
      scanId,
      weatherData,
      results,
      total: transponders.length,
      lockedCount: results.filter(result => result.locked).length,
      successCount: results.filter(result => !result.error).length
    };
  } catch (err) {
    try { db.finishScan(scanId); } catch {}
    throw err;
  }
}

// ---------- Routes ----------

// Config
app.get('/api/config', (req, res) => {
  const cfg = loadConfig();
  // Redact password fields before sending to client
  const safe = JSON.parse(JSON.stringify(cfg));
  if (safe.tvheadend) safe.tvheadend.password = safe.tvheadend.password ? '***' : '';
  res.json(safe);
});

app.post('/api/config', (req, res) => {
  try {
    const current = loadConfig();
    const incoming = req.body;
    // Deep merge; preserve passwords if placeholder sent
    const merged = deepMerge(current, incoming);
    if (incoming.tvheadend && incoming.tvheadend.password === '***') {
      merged.tvheadend.password = current.tvheadend ? current.tvheadend.password : '';
    }
    saveConfig(merged);
    // Reload scheduler if scheduler config changed
    if (incoming.scheduler) {
      scheduler.reload();
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SAT-IP
app.get('/api/satip/discover', async (req, res) => {
  try {
    const timeout = Math.min(Math.max(500, parseInt(req.query.timeout, 10) || 3000), 30000);
    const [servers, probed] = await Promise.all([
      satip.discover(timeout),
      satip.probeHost(loadConfig()?.satip?.host, loadConfig()?.satip?.port || 554)
    ]);
    // Merge: add probed host if not already found via SSDP
    if (probed && !servers.some(s => s.address === probed.address)) {
      servers.unshift(probed);
    }
    res.json({ servers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/satip/tune', async (req, res) => {
  try {
    const cfg = loadConfig();
    const satipCfg = cfg.satip || {};
    const host = req.body.host || satipCfg.host;
    const port = req.body.port || satipCfg.port || 554;
    if (!host) return res.status(400).json({ error: 'SAT-IP host not configured' });

    const transponder = {
      frequency: req.body.frequency,
      polarisation: req.body.polarisation,
      symbol_rate: req.body.symbol_rate,
      delivery_system: req.body.delivery_system,
      fec: req.body.fec,
      tuner: req.body.tuner || satipCfg.tuner || 1
    };
    if (!transponder.frequency) return res.status(400).json({ error: 'frequency required' });

    const sessionId = await satip.tune(host, port, transponder);
    res.json({ sessionId, host, port });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/satip/signal', async (req, res) => {
  try {
    const cfg = loadConfig();
    const satipCfg = cfg.satip || {};
    const host = req.query.host || satipCfg.host;
    const port = parseInt(req.query.port, 10) || satipCfg.port || 554;
    if (!host) return res.status(400).json({ error: 'SAT-IP host not configured' });

    const { frequency, polarisation, symbol_rate, delivery_system, fec } = req.query;
    if (!frequency) return res.status(400).json({ error: 'frequency required' });

    const signal = await satip.measureSignal(host, port, {
      frequency: parseInt(frequency, 10),
      polarisation: polarisation || 'H',
      symbol_rate: parseInt(symbol_rate, 10) || 22000,
      delivery_system: delivery_system || 'DVBS2',
      fec: fec || null,
      tuner: satipCfg.tuner || 1
    });

    // Persist as a quick single-shot measurement
    const scanId = db.startScan('manual');
    const transponderInfo = frequencies.findTransponder(frequency, polarisation || 'H') || {};
    db.insertSignalMeasurement(scanId, {
      satellite: transponderInfo.satellite || null,
      frequency: parseInt(frequency, 10),
      polarisation: polarisation || 'H',
      symbol_rate: parseInt(symbol_rate, 10) || 22000,
      delivery_system: delivery_system || 'DVBS2',
      signal_level: signal.level,
      signal_quality: signal.quality,
      locked: signal.locked,
      measured_at: new Date().toISOString()
    });
    db.finishScan(scanId);

    res.json({ ...signal, scanId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/satip/band-scan', async (req, res) => {
  try {
    const cfg = loadConfig();
    const satipCfg = cfg.satip || {};
    const host = req.query.host || satipCfg.host;
    const port = parseInt(req.query.port, 10) || satipCfg.port || 554;
    const satellite = req.query.satellite || satipCfg.defaultSatellite || '';
    if (!host) return res.status(400).json({ error: 'SAT-IP host not configured' });
    if (bandScanRunning) return res.status(409).json({ error: 'Er draait al een band-scan' });

    bandScanRunning = true;
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const result = await runSignalBandScan({
      host,
      port,
      tuner: satipCfg.tuner || 1,
      satellite,
      weatherConfig: cfg.weather || {},
      scanType: 'band-scan'
    }, async (payload) => {
      writeJsonLine(res, payload);
    });

    writeJsonLine(res, {
      type: 'done',
      scanId: result.scanId,
      satellite,
      total: result.total,
      lockedCount: result.lockedCount,
      successCount: result.successCount,
      weatherData: result.weatherData
    });
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      writeJsonLine(res, { type: 'error', message: err.message });
      res.end();
    }
  } finally {
    bandScanRunning = false;
  }
});

// SAT-IP live session: tune once, poll signal without full tune/teardown per sample
app.post('/api/satip/tune-session', async (req, res) => {
  try {
    const cfg = loadConfig();
    const satipCfg = cfg.satip || {};
    const host = req.body.host || satipCfg.host;
    const port = parseInt(req.body.port, 10) || satipCfg.port || 554;
    if (!host) return res.status(400).json({ error: 'SAT-IP host not configured' });

    const transponder = {
      frequency: req.body.frequency,
      polarisation: req.body.polarisation || 'H',
      symbol_rate: req.body.symbol_rate || 22000,
      delivery_system: req.body.delivery_system || 'DVBS2',
      fec: req.body.fec || null,
      tuner: req.body.tuner || satipCfg.tuner || 1
    };
    if (!transponder.frequency) return res.status(400).json({ error: 'frequency required' });

    const sessionId = await satip.tune(host, port, transponder);
    res.json({ sessionId, host, port });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fast signal poll on existing live session (no tune overhead)
app.get('/api/satip/signal-live', async (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  const session = satip.activeSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });

  try {
    const signal = await satip.getSignal(session.host, session.port, sessionId);
    res.json(signal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Tear down a live session
app.delete('/api/satip/tune-session/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const session = satip.activeSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  try {
    await satip.teardown(session.host, session.port, sessionId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Muxes
app.get('/api/muxes', (req, res) => {
  const { satellite } = req.query;
  const muxes = db.getAllMuxes(satellite || undefined);
  const satellites = db.getMuxSatellites();
  res.json({ muxes, satellites });
});

app.post('/api/muxes', (req, res) => {
  const { satellite, frequency, polarisation, symbol_rate, delivery_system, fec } = req.body;
  if (!satellite || !frequency || !polarisation) {
    return res.status(400).json({ error: 'satellite, frequency en polarisation zijn verplicht' });
  }
  try {
    const id = db.insertMux({ satellite, frequency, polarisation, symbol_rate, delivery_system, fec, source: 'manual' });
    res.json({ id });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Deze frequentie/polarisatie combinatie bestaat al' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/muxes/:id', (req, res) => {
  const { satellite, frequency, polarisation, symbol_rate, delivery_system, fec } = req.body;
  if (!satellite || !frequency || !polarisation) {
    return res.status(400).json({ error: 'satellite, frequency en polarisation zijn verplicht' });
  }
  const changes = db.updateMux(parseInt(req.params.id, 10), { satellite, frequency, polarisation, symbol_rate, delivery_system, fec });
  if (!changes) return res.status(404).json({ error: 'Mux niet gevonden' });
  res.json({ ok: true });
});

app.delete('/api/muxes/all', (req, res) => {
  const deleted = db.deleteAllMuxes();
  res.json({ deleted });
});

app.delete('/api/muxes/:id', (req, res) => {
  const changes = db.deleteMux(parseInt(req.params.id, 10));
  if (!changes) return res.status(404).json({ error: 'Mux niet gevonden' });
  res.json({ ok: true });
});

app.post('/api/muxes/import-tvheadend', async (req, res) => {
  try {
    const cfg = loadConfig();
    const tvCfg = cfg.tvheadend || {};
    if (!tvCfg.url) return res.status(400).json({ error: 'TVheadend URL niet geconfigureerd' });

    const muxes = await tvheadend.getMuxes(tvCfg);
    let imported = 0, updated = 0, skipped = 0;

    for (const mux of muxes) {
      if (!mux.frequency) { skipped++; continue; }
      const result = db.upsertTvhMux({
        satellite: mux.network || 'Onbekend',
        frequency: mux.frequency,
        polarisation: mapTvhPolarisation(mux.polarisation),
        symbol_rate: mux.symbolrate || 27500,
        delivery_system: mapTvhDeliverySystem(mux.modulation),
        fec: mux.fec || '3/4',
        tvh_uuid: mux.uuid
      });
      if (result === 'imported') imported++;
      else if (result === 'updated') updated++;
      else skipped++;
    }

    res.json({ imported, updated, skipped, total: muxes.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function mapTvhPolarisation(pol) {
  if (!pol) return 'H';
  const p = String(pol).toUpperCase();
  if (p.startsWith('V') || p === 'VERTICAL') return 'V';
  if (p.startsWith('H') || p === 'HORIZONTAL') return 'H';
  if (p.startsWith('L') || p === 'CIRCULAR_LEFT') return 'L';
  if (p.startsWith('R') || p === 'CIRCULAR_RIGHT') return 'R';
  return p.charAt(0) || 'H';
}

function mapTvhDeliverySystem(modulation) {
  if (!modulation) return 'DVBS2';
  const m = String(modulation).toUpperCase();
  if (m.includes('S2')) return 'DVBS2';
  if (m.includes('DVB-S')) return 'DVBS';
  return 'DVBS2';
}

// Frequencies (backward-compatible alias)
app.get('/api/frequencies', (req, res) => {
  const { satellite } = req.query;
  const muxes = db.getAllMuxes(satellite || undefined);
  const satellites = db.getMuxSatellites();
  res.json({ frequencies: muxes, satellites });
});

// TVheadend
app.get('/api/tvheadend/channels', async (req, res) => {
  try {
    const cfg = loadConfig();
    const tvCfg = cfg.tvheadend || {};
    const channels = await tvheadend.getChannels(tvCfg);
    res.json({ channels });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tvheadend/status', async (req, res) => {
  try {
    const cfg = loadConfig();
    const tvCfg = cfg.tvheadend || {};
    const inputs = await tvheadend.getInputStatus(tvCfg);
    res.json({ inputs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Renamed from /api/tvheadend/scan: samples currently active inputs (not a real mux scan)
app.post('/api/tvheadend/sample', async (req, res) => {
  try {
    const cfg = loadConfig();
    const tvCfg = cfg.tvheadend || {};

    let weatherData = null;
    try { weatherData = await weather.getCurrentWeather(); } catch {}

    const scanId = db.startScan('manual', weatherData);
    const measurements = await tvheadend.sampleInputs(tvCfg);
    for (const m of measurements) {
      db.insertChannelMeasurement(scanId, m);
    }
    db.finishScan(scanId);

    res.json({ ok: true, scanId, measurements: measurements.length, weatherData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Weather
app.get('/api/weather', async (req, res) => {
  try {
    const cfg = loadConfig();
    const data = await weather.getCurrentWeather(cfg.weather || {});
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Scans
app.get('/api/scans', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;
    const scans = db.getScans(limit, offset);
    res.json({ scans });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/scans/:id', (req, res) => {
  try {
    const scan = db.getScanById(parseInt(req.params.id, 10));
    if (!scan) return res.status(404).json({ error: 'Scan not found' });
    res.json(scan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Frequencies that actually have measurements (for the chart dropdown)
app.get('/api/history/frequencies', (req, res) => {
  try {
    const freqs = db.getFrequenciesWithData();
    res.json({ frequencies: freqs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Signal vs weather correlation data
app.get('/api/history/correlation', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const data = db.getSignalWeatherCorrelation(limit);
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/history/signal', (req, res) => {
  try {
    const { frequency, limit } = req.query;
    if (!frequency) return res.status(400).json({ error: 'frequency required' });
    const data = db.getSignalHistory(parseInt(frequency, 10), parseInt(limit, 10) || 100);
    res.json({ history: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Scheduler
app.get('/api/scheduler/status', (req, res) => {
  res.json(scheduler.getStatus());
});

app.post('/api/scheduler/config', (req, res) => {
  try {
    const current = loadConfig();
    current.scheduler = { ...current.scheduler, ...req.body };
    saveConfig(current);
    scheduler.reload();
    res.json({ ok: true, status: scheduler.getStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/scheduler/run', async (req, res) => {
  try {
    const result = await scheduler.runScan('manual');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Utility ----------

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

// ---------- Start ----------

const cfg = loadConfig();
const PORT = process.env.PORT || (cfg.server && cfg.server.port) || 3000;
const HOST = process.env.HOST || (cfg.server && cfg.server.host) || '0.0.0.0';

// Seed muxes table from static list on first startup
const seeded = db.seedMuxes(frequencies.getAll());
if (seeded) console.log(`Seeded ${seeded} transponders into muxes table`);

app.listen(PORT, HOST, () => {
  console.log(`Satfinder running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  scheduler.start();
});

// Graceful shutdown
async function shutdown() {
  // Tear down any active RTSP sessions (best-effort, max 3 s)
  const teardowns = [];
  for (const [sessionId, session] of satip.activeSessions) {
    teardowns.push(satip.teardown(session.host, session.port, sessionId).catch(() => {}));
  }
  if (teardowns.length) {
    await Promise.race([Promise.all(teardowns), new Promise(r => setTimeout(r, 3000))]);
  }
  scheduler.stop();
  db.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
