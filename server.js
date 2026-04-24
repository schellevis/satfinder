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
    const servers = await satip.discover(timeout);
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

// Frequencies
app.get('/api/frequencies', (req, res) => {
  const { satellite } = req.query;
  const data = satellite ? frequencies.getBySatellite(satellite) : frequencies.getAll();
  res.json({ frequencies: data, satellites: frequencies.getSatellites() });
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
