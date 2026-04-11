'use strict';

const cron = require('node-cron');
const db = require('./database');
const tvheadend = require('./tvheadend');
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
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
    return cfg.scheduler || {};
  } catch {
    return {};
  }
}

function isRunning() {
  return running;
}

function getStatus() {
  const cfg = getSchedulerConfig();
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
 * Run a full scheduled scan: weather + TVheadend channel measurements.
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

    // Scan TVheadend channels
    let measurements = [];
    try {
      measurements = await tvheadend.scanChannels();
    } catch (e) {
      console.warn('[scheduler] TVheadend scan failed:', e.message);
    }

    for (const m of measurements) {
      db.insertChannelMeasurement(scanId, m);
    }

    db.finishScan(scanId);
    lastStatus = `ok:${measurements.length} measurements`;
    console.log(`[scheduler] Scan #${scanId} complete. ${measurements.length} channel measurements.`);
    return { scanId, measurements: measurements.length, weatherData };
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
  const cfg = getSchedulerConfig();
  if (!cfg.enabled) {
    console.log('[scheduler] Scheduler disabled in config.');
    return false;
  }
  const expression = cfg.cron || DEFAULT_CRON;
  if (!cron.validate(expression)) {
    console.error(`[scheduler] Invalid cron expression: ${expression}`);
    return false;
  }
  scheduledTask = cron.schedule(expression, () => {
    console.log('[scheduler] Running scheduled scan…');
    runScan('scheduled').catch(err => console.error('[scheduler]', err));
  }, { timezone: 'Europe/Amsterdam' });

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
