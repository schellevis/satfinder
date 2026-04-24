'use strict';

/**
 * TVheadend REST API module.
 * Communicates with TVheadend via its JSON HTTP API.
 */

function getConfig() {
  const fs = require('fs');
  const path = require('path');
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
    return cfg.tvheadend || {};
  } catch {
    return {};
  }
}

function buildAuthHeader(username, password) {
  if (!username && !password) return {};
  const encoded = Buffer.from(`${username || ''}:${password || ''}`).toString('base64');
  return { Authorization: `Basic ${encoded}` };
}

async function apiGet(url, username, password, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        ...buildAuthHeader(username, password)
      }
    });
    if (!resp.ok) {
      throw new Error(`TVheadend HTTP ${resp.status}: ${resp.statusText}`);
    }
    return resp.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the channel list from TVheadend.
 */
async function getChannels(options = {}) {
  const cfg = { ...getConfig(), ...options };
  const { url, username, password } = cfg;
  if (!url) throw new Error('TVheadend URL not configured');

  const apiUrl = `${url.replace(/\/$/, '')}/api/channel/grid?start=0&limit=999`;
  const data = await apiGet(apiUrl, username, password);
  return (data.entries || []).map(ch => ({
    id: ch.uuid,
    name: ch.name,
    number: ch.number,
    icon: ch.icon_public_url || null,
    enabled: ch.enabled !== false,
    tags: ch.tags || []
  }));
}

/**
 * Get signal/stream status for a specific mux/service via TVheadend API.
 * TVheadend exposes this via /api/status/inputs (for tuner inputs).
 */
async function getInputStatus(options = {}) {
  const cfg = { ...getConfig(), ...options };
  const { url, username, password } = cfg;
  if (!url) throw new Error('TVheadend URL not configured');

  const apiUrl = `${url.replace(/\/$/, '')}/api/status/inputs`;
  const data = await apiGet(apiUrl, username, password);
  return (data.entries || []).map(entry => ({
    uuid: entry.uuid,
    input: entry.input,
    stream: entry.stream,
    signal: entry.signal,
    signal_scale: entry.signal_scale,
    snr: entry.snr,
    snr_scale: entry.snr_scale,
    ber: entry.ber,
    unc: entry.unc,
    bps: entry.bps,
    te: entry.te,
    cc: entry.cc,
    subscriptions: entry.subs,
    weight: entry.weight
  }));
}

/**
 * Get DVB mux list (transponders known to TVheadend).
 */
async function getMuxes(options = {}) {
  const cfg = { ...getConfig(), ...options };
  const { url, username, password } = cfg;
  if (!url) throw new Error('TVheadend URL not configured');

  const apiUrl = `${url.replace(/\/$/, '')}/api/mpegts/mux/grid?start=0&limit=999`;
  const data = await apiGet(apiUrl, username, password);
  return (data.entries || []).map(mux => ({
    uuid: mux.uuid,
    name: mux.name,
    network: mux.network,
    frequency: mux.frequency,
    polarisation: mux.polarisation,
    symbolrate: mux.symbolrate,
    fec: mux.fec,
    modulation: mux.modulation,
    enabled: mux.enabled,
    scan_state: mux.scan_state,
    num_services: mux.num_svc
  }));
}

/**
 * Sample all currently active TVheadend tuner inputs.
 * Returns signal measurements for whatever is playing at call time.
 * Note: at 3 AM nothing may be playing; use satip.measureSignal for scheduled history.
 */
async function sampleInputs(options = {}) {
  const inputs = await getInputStatus(options);
  const channels = await getChannels(options);
  const now = new Date().toISOString();

  // Build channel name lookup
  const channelMap = {};
  for (const ch of channels) {
    channelMap[ch.id] = ch.name;
  }

  const measurements = inputs.map(inp => {
    const signalPct = normalizeSignal(inp.signal, inp.signal_scale);
    const snrPct = normalizeSignal(inp.snr, inp.snr_scale);
    return {
      // /api/status/inputs has no uuid field; use tuner name as stable id
      channel_id: inp.input || null,
      channel_name: inp.stream || null,
      signal_level: signalPct,
      signal_quality: snrPct,
      ber: inp.ber || 0,
      unc: inp.unc || 0,
      measured_at: now
    };
  });

  return measurements;
}

function normalizeSignal(value, scale) {
  if (value == null) return null;
  // scale: 1 = relative (0–65535 promille), 2 = absolute dBm * 1000, 3 = dB * 1000
  if (scale === 1) return Math.min(100, Math.max(0, Math.round(value / 655.35)));
  if (scale === 2 || scale === 3) {
    // Map typical dBm range -100..-30 to 0..100
    const dbm = value / 1000;
    return Math.min(100, Math.max(0, Math.round((dbm + 100) * (100 / 70))));
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Check connectivity to TVheadend.
 */
async function ping(options = {}) {
  try {
    const channels = await getChannels(options);
    return { ok: true, channelCount: channels.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  getChannels,
  getInputStatus,
  getMuxes,
  sampleInputs,
  ping
};
