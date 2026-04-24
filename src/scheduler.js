'use strict';

const cron = require('node-cron');
const db = require('./database');
const tvheadend = require('./tvheadend');
const satip = require('./satip');
const frequencies = require('./frequencies');
const weather = require('./weather');

let scheduledTask = null;
let lastRun = null;
let lastStatus = null;
let running = false;

const DEFAULT_CRON = '0 3 * * *';

function getSchedulerConfig() {
  const fs = require('fs');
  const path = require('path');
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
  } catch {
    return {};
  }
}

function isRunning() {
  return running;
}

function getStatus() {
  const cfg = (getSchedulerConfig().scheduler) || {};
  return {
    enabled: cfg.enabled || false,
    cron: cfg.cron || DEFAULT_CRON,
    active: scheduledTask !== null,
    lastRun,
    lastStatus,
    running
  };
}

/**
 * Run a full scheduled scan: weather + signal measurements per transponder + TVheadend snapshot.
 */
async function runScan(scanType = 'scheduled') {
  if (running) {
    return { error: 'Scan already in progress' };
  }
  running = true;
  lastRun = new Date().toISOString();
  lastStatus = 'running';

  let scanId = null;
  let weatherData = null;

  try {
    // Fetch weather first
    try {
      weatherData = await weather.getCurrentWeather();
    } catch (e) {
      console.warn('[scheduler] Weather fetch failed:', e.message);
    }

    scanId = db.startScan(scanType, weatherData);

    // Measure signal for every configured transponder via SAT-IP
    let signalCount = 0;
    const fullCfg = getSchedulerConfig();
    const satipCfg = fullCfg.satip || {};
    if (satipCfg.host) {
      const transponders = frequencies.getAll();
      console.log(`[scheduler] Measuring ${transponders.length} transponders via SAT-IP…`);
      for (const t of transponders) {
        try {
          const signal = await satip.measureSignal(satipCfg.host, satipCfg.port || 554, t);
          db.insertSignalMeasurement(scanId, {
            satellite: t.satellite || null,
            frequency: t.frequency,
            polarisation: t.polarisation,
            symbol_rate: t.symbol_rate,
            delivery_system: t.delivery_system || 'DVBS2',
            signal_level: signal.level,
            signal_quality: signal.quality,
            locked: signal.locked,
            measured_at: new Date().toISOString()
          });
          signalCount++;
        } catch (e) {
          console.warn(`[scheduler] Signal measurement failed for ${t.frequency} MHz:`, e.message);
        }
      }
    } else {
      console.warn('[scheduler] SAT-IP host not configured, skipping transponder measurements.');
    }

    // Also snapshot active TVheadend inputs (best-effort, may be empty at night)
    let channelCount = 0;
    try {
      const tvCfg = fullCfg.tvheadend || {};
      const channelMeasurements = await tvheadend.sampleInputs(tvCfg);
      for (const m of channelMeasurements) {
        db.insertChannelMeasurement(scanId, m);
        channelCount++;
      }
    } catch (e) {
      console.warn('[scheduler] TVheadend sample failed:', e.message);
    }

    db.finishScan(scanId);
    lastStatus = `ok:${signalCount} signal + ${channelCount} channel`;
    console.log(`[scheduler] Scan #${scanId} complete. ${signalCount} signal + ${channelCount} channel measurements.`);
    return { scanId, measurements: signalCount + channelCount, signalMeasurements: signalCount, channelMeasurements: channelCount, weatherData };
  } catch (err) {
    lastStatus = `error:${err.message}`;
    console.error('[scheduler] Scan error:', err);
    if (scanId) {
      try { db.finishScan(scanId); } catch {}
    }
    return { error: err.message, scanId };
  } finally {
    running = false;
  }
}

/**
 * Start the cron-based scheduler based on current config.
 */
function start() {
  stop();
  const fullCfg = getSchedulerConfig();
  const cfg = fullCfg.scheduler || {};
  if (!cfg.enabled) {
    console.log('[scheduler] Scheduler disabled in config.');
    return false;
  }
  const expression = cfg.cron || DEFAULT_CRON;
  if (!cron.validate(expression)) {
    console.error(`[scheduler] Invalid cron expression: ${expression}`);
    return false;
  }
  const timezone = cfg.timezone || (fullCfg.weather && fullCfg.weather.timezone) || 'Europe/Amsterdam';
  scheduledTask = cron.schedule(expression, () => {
    console.log('[scheduler] Running scheduled scan…');
    runScan('scheduled').catch(err => console.error('[scheduler]', err));
  }, { timezone });

  console.log(`[scheduler] Started with expression "${expression}"`);
  return true;
}

/**
 * Stop the scheduler.
 */
function stop() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('[scheduler] Stopped.');
  }
}

/**
 * Reload scheduler (e.g. after config change).
 */
function reload() {
  stop();
  return start();
}

module.exports = { start, stop, reload, runScan, getStatus, isRunning };
