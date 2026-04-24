'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db = null;

function getDbPath() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
    return cfg.database && cfg.database.path ? cfg.database.path : 'satfinder.db';
  } catch {
    return process.env.DB_PATH || 'satfinder.db';
  }
}

function getDb() {
  if (!db) {
    const dbPath = path.resolve(getDbPath());
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
  }
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_type TEXT NOT NULL DEFAULT 'manual',
      started_at DATETIME NOT NULL,
      finished_at DATETIME,
      weather_data TEXT
    );

    CREATE TABLE IF NOT EXISTS signal_measurements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id INTEGER REFERENCES scans(id) ON DELETE CASCADE,
      satellite TEXT,
      frequency INTEGER,
      polarisation TEXT,
      symbol_rate INTEGER,
      delivery_system TEXT,
      signal_level INTEGER,
      signal_quality INTEGER,
      locked BOOLEAN,
      measured_at DATETIME NOT NULL
    );

    CREATE TABLE IF NOT EXISTS channel_measurements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id INTEGER REFERENCES scans(id) ON DELETE CASCADE,
      channel_id TEXT,
      channel_name TEXT,
      signal_level INTEGER,
      signal_quality INTEGER,
      ber INTEGER,
      unc INTEGER,
      measured_at DATETIME NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_signal_measurements_scan_id ON signal_measurements(scan_id);
    CREATE INDEX IF NOT EXISTS idx_channel_measurements_scan_id ON channel_measurements(scan_id);
    CREATE INDEX IF NOT EXISTS idx_scans_started_at ON scans(started_at);
  `);
}

function startScan(scanType = 'manual', weatherData = null) {
  const db = getDb();
  const stmt = db.prepare(
    'INSERT INTO scans (scan_type, started_at, weather_data) VALUES (?, ?, ?)'
  );
  const result = stmt.run(scanType, new Date().toISOString(), weatherData ? JSON.stringify(weatherData) : null);
  return result.lastInsertRowid;
}

function finishScan(scanId) {
  const db = getDb();
  db.prepare('UPDATE scans SET finished_at = ? WHERE id = ?')
    .run(new Date().toISOString(), scanId);
}

function insertSignalMeasurement(scanId, data) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO signal_measurements
      (scan_id, satellite, frequency, polarisation, symbol_rate, delivery_system,
       signal_level, signal_quality, locked, measured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(
    scanId,
    data.satellite || null,
    data.frequency || null,
    data.polarisation || null,
    data.symbol_rate || null,
    data.delivery_system || null,
    data.signal_level ?? null,
    data.signal_quality ?? null,
    data.locked ? 1 : 0,
    data.measured_at || new Date().toISOString()
  ).lastInsertRowid;
}

function insertChannelMeasurement(scanId, data) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO channel_measurements
      (scan_id, channel_id, channel_name, signal_level, signal_quality, ber, unc, measured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(
    scanId,
    data.channel_id || null,
    data.channel_name || null,
    data.signal_level ?? null,
    data.signal_quality ?? null,
    data.ber ?? null,
    data.unc ?? null,
    data.measured_at || new Date().toISOString()
  ).lastInsertRowid;
}

function getScans(limit = 50, offset = 0) {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM scans ORDER BY started_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset);
}

function getScanById(id) {
  const db = getDb();
  const scan = db.prepare('SELECT * FROM scans WHERE id = ?').get(id);
  if (!scan) return null;
  const signals = db.prepare('SELECT * FROM signal_measurements WHERE scan_id = ? ORDER BY measured_at').all(id);
  const channels = db.prepare('SELECT * FROM channel_measurements WHERE scan_id = ? ORDER BY measured_at').all(id);
  return { ...scan, signals, channels };
}

function getSignalHistory(frequency, limit = 100) {
  const db = getDb();
  return db.prepare(`
    SELECT sm.*, s.started_at, s.weather_data
    FROM signal_measurements sm
    JOIN scans s ON s.id = sm.scan_id
    WHERE sm.frequency = ?
    ORDER BY sm.measured_at DESC
    LIMIT ?
  `).all(frequency, limit);
}

/**
 * Return distinct frequencies that have at least one signal measurement.
 * Used to populate the history chart dropdown with only relevant frequencies.
 */
function getFrequenciesWithData() {
  const db = getDb();
  return db.prepare(
    'SELECT DISTINCT frequency FROM signal_measurements WHERE frequency IS NOT NULL ORDER BY frequency'
  ).all().map(r => r.frequency);
}

/**
 * For each scan that has both weather data and signal measurements, return
 * the average signal level/quality so we can plot signal vs. weather.
 */
function getSignalWeatherCorrelation(limit = 100) {
  const db = getDb();
  return db.prepare(`
    SELECT
      s.id,
      s.started_at,
      s.weather_data,
      ROUND(AVG(sm.signal_level), 1)   AS avg_level,
      ROUND(AVG(sm.signal_quality), 1) AS avg_quality,
      COUNT(sm.id)                     AS measurement_count
    FROM scans s
    JOIN signal_measurements sm ON sm.scan_id = s.id
    WHERE s.weather_data IS NOT NULL
    GROUP BY s.id
    ORDER BY s.started_at DESC
    LIMIT ?
  `).all(limit);
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  getDb,
  startScan,
  finishScan,
  insertSignalMeasurement,
  insertChannelMeasurement,
  getScans,
  getScanById,
  getSignalHistory,
  getFrequenciesWithData,
  getSignalWeatherCorrelation,
  close
};
