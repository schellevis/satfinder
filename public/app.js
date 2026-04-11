'use strict';

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  frequencies: [],
  satellites: [],
  autoRefreshTimer: null,
  signalHistory: [],
  signalChart: null,
  weatherChart: null,
  currentScanId: null
};

// ─── Utilities ───────────────────────────────────────────────────────────────
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function toast(msg, type = 'info', duration = 3500) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), duration);
}

function fmt(dt) {
  if (!dt) return '—';
  const d = new Date(dt);
  return d.toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function setMeter(barId, valId, pct) {
  const bar = document.getElementById(barId);
  const val = document.getElementById(valId);
  if (!bar || !val) return;
  const p = Math.min(100, Math.max(0, pct ?? 0));
  bar.style.width = `${p}%`;
  val.textContent = pct !== null && pct !== undefined ? `${p}%` : '—';
  bar.className = 'meter-fill' + (p >= 60 ? '' : p >= 30 ? ' medium' : ' low');
}

function showAlert(containerId, msg, type = 'info') {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
}

function clearAlert(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = '';
}

// ─── Tab navigation ───────────────────────────────────────────────────────────
document.querySelectorAll('nav button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'tab-history') loadHistory();
    if (btn.dataset.tab === 'tab-settings') { loadSettings(); loadSchedulerStatus(); }
    if (btn.dataset.tab === 'tab-tvh') syncTvhFields();
  });
});

// ─── Weather badge ────────────────────────────────────────────────────────────
async function loadWeatherBadge() {
  try {
    const w = await api('/api/weather');
    const icons = { 0: '☀️', 1: '🌤', 2: '⛅', 3: '☁️', 45: '🌫', 48: '🌫', 51: '🌦', 53: '🌦', 55: '🌧', 61: '🌧', 63: '🌧', 65: '🌧', 71: '🌨', 73: '🌨', 75: '❄️', 80: '🌦', 81: '🌧', 82: '⛈', 95: '⛈', 96: '⛈', 99: '⛈' };
    const code = w.weather_code;
    document.getElementById('weather-icon').textContent = icons[code] || '🌡';
    document.getElementById('weather-text').textContent =
      `${w.temperature !== null ? w.temperature + '°C' : ''} · ${w.weather_description || ''} · ☁️${w.cloud_cover ?? '?'}%`;
  } catch {
    document.getElementById('weather-text').textContent = 'Weerfout';
  }
}

// ─── TAB 1: Signal Finder ────────────────────────────────────────────────────
async function initSignalTab() {
  try {
    const data = await api('/api/frequencies');
    state.frequencies = data.frequencies || [];
    state.satellites = data.satellites || [];

    const satSel = document.getElementById('si-satellite');
    satSel.innerHTML = '<option value="">– Alle –</option>' +
      state.satellites.map(s => `<option value="${s}">${s}</option>`).join('');

    fillTransponderSelect(state.frequencies);
  } catch (e) {
    toast('Frequenties laden mislukt: ' + e.message, 'error');
  }

  // Prefill host from config
  try {
    const cfg = await api('/api/config');
    if (cfg.satip) {
      document.getElementById('si-host').value = cfg.satip.host || '';
      document.getElementById('si-port').value = cfg.satip.port || 554;
    }
  } catch {}
}

function fillTransponderSelect(list) {
  const sel = document.getElementById('si-transponder');
  sel.innerHTML = '<option value="">– Kies transponder –</option>' +
    list.map((t, i) => `<option value="${i}" data-idx="${i}">${t.name} (${t.frequency} MHz ${t.polarisation})</option>`).join('');
}

function filterTransponders() {
  const sat = document.getElementById('si-satellite').value;
  const list = sat ? state.frequencies.filter(f => f.satellite === sat) : state.frequencies;
  fillTransponderSelect(list);
}

function fillTransponderFields() {
  const sel = document.getElementById('si-transponder');
  const idx = sel.value;
  if (idx === '') return;
  const sat = document.getElementById('si-satellite').value;
  const list = sat ? state.frequencies.filter(f => f.satellite === sat) : state.frequencies;
  const t = list[parseInt(idx, 10)];
  if (!t) return;
  document.getElementById('si-freq').value = t.frequency;
  document.getElementById('si-pol').value = t.polarisation;
  document.getElementById('si-sr').value = t.symbol_rate;
  document.getElementById('si-msys').value = t.delivery_system;
}

async function discoverSatip() {
  const el = document.getElementById('si-discover-result');
  el.textContent = 'Zoeken…';
  try {
    const data = await api('/api/satip/discover?timeout=3000');
    if (!data.servers || data.servers.length === 0) {
      el.textContent = 'Geen SAT-IP servers gevonden.';
    } else {
      el.innerHTML = data.servers.map(s =>
        `<div class="tag tag-success" style="margin:.2rem .2rem 0 0;cursor:pointer" onclick="document.getElementById('si-host').value='${s.address}'">${s.address}</div>`
      ).join('');
      if (data.servers[0]) document.getElementById('si-host').value = data.servers[0].address;
    }
  } catch (e) {
    el.textContent = 'Fout: ' + e.message;
  }
}

async function measureSignal() {
  const host = document.getElementById('si-host').value.trim();
  const port = document.getElementById('si-port').value || '554';
  const freq = document.getElementById('si-freq').value;
  const pol = document.getElementById('si-pol').value;
  const sr = document.getElementById('si-sr').value || '22000';
  const msys = document.getElementById('si-msys').value;

  if (!host) { toast('Voer een SAT-IP host in', 'error'); return; }
  if (!freq) { toast('Voer een frequentie in', 'error'); return; }

  const btn = document.getElementById('btn-measure');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Meten…';

  try {
    const params = new URLSearchParams({ host, port, frequency: freq, polarisation: pol, symbol_rate: sr, delivery_system: msys });
    const data = await api('/api/satip/signal?' + params.toString());
    updateSignalDisplay(data, freq);
    addSignalHistory({ ...data, frequency: freq, polarisation: pol, measured_at: new Date().toISOString() });
    toast('Meting ontvangen', 'success');
  } catch (e) {
    toast('Meetfout: ' + e.message, 'error');
    updateSignalDisplay({ level: 0, quality: 0, locked: false }, freq);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '📶 Meten';
  }
}

function updateSignalDisplay(data, freq) {
  setMeter('si-level-bar', 'si-level-val', data.level ?? 0);
  setMeter('si-quality-bar', 'si-quality-val', data.quality ?? 0);

  const lockEl = document.getElementById('si-lock');
  if (data.locked) {
    lockEl.textContent = '🔒 Lock verkregen';
    lockEl.className = 'lock-indicator locked';
  } else {
    lockEl.textContent = '🔓 Geen lock';
    lockEl.className = 'lock-indicator unlocked';
  }
  document.getElementById('si-timestamp').textContent = 'Gemeten: ' + fmt(new Date());
}

function addSignalHistory(entry) {
  state.signalHistory.unshift(entry);
  if (state.signalHistory.length > 50) state.signalHistory.pop();
  renderSignalHistory();
}

function renderSignalHistory() {
  const tbody = document.getElementById('si-history-body');
  document.getElementById('si-history-count').textContent = state.signalHistory.length;
  if (!state.signalHistory.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Nog geen metingen</td></tr>';
    return;
  }
  tbody.innerHTML = state.signalHistory.map(m => `
    <tr>
      <td class="font-mono text-sm">${fmt(m.measured_at)}</td>
      <td>${m.frequency} MHz</td>
      <td><span class="tag ${(m.level || 0) >= 60 ? 'tag-success' : (m.level || 0) >= 30 ? 'tag-warning' : 'tag-danger'}">${m.level ?? '—'}%</span></td>
      <td><span class="tag ${(m.quality || 0) >= 60 ? 'tag-success' : (m.quality || 0) >= 30 ? 'tag-warning' : 'tag-danger'}">${m.quality ?? '—'}%</span></td>
      <td>${m.locked ? '🔒' : '🔓'}</td>
    </tr>
  `).join('');
}

function toggleAutoRefresh() {
  const enabled = document.getElementById('si-auto-refresh').checked;
  if (enabled) {
    state.autoRefreshTimer = setInterval(measureSignal, 5000);
  } else {
    clearInterval(state.autoRefreshTimer);
    state.autoRefreshTimer = null;
  }
}

// ─── TAB 2: TVheadend ─────────────────────────────────────────────────────────
async function syncTvhFields() {
  try {
    const cfg = await api('/api/config');
    const tvh = cfg.tvheadend || {};
    document.getElementById('tvh-url').value = tvh.url || '';
    document.getElementById('tvh-user').value = tvh.username || '';
    document.getElementById('tvh-pass').value = '';
  } catch {}
}

async function tvhSaveAndTest() {
  const url = document.getElementById('tvh-url').value.trim();
  const username = document.getElementById('tvh-user').value.trim();
  const password = document.getElementById('tvh-pass').value;

  const statusEl = document.getElementById('tvh-status');
  statusEl.textContent = 'Verbinding testen…';

  try {
    const cfg = await api('/api/config');
    cfg.tvheadend = { url, username, password: password || cfg.tvheadend?.password || '' };
    await api('/api/config', { method: 'POST', body: cfg });
    const channels = await api('/api/tvheadend/channels');
    statusEl.innerHTML = `<span class="tag tag-success">✓ Verbonden — ${channels.channels.length} kanalen</span>`;
    toast('TVheadend verbinding geslaagd', 'success');
  } catch (e) {
    statusEl.innerHTML = `<span class="tag tag-danger">✗ ${e.message}</span>`;
    toast('Verbinding mislukt: ' + e.message, 'error');
  }
}

async function loadTvhChannels() {
  const tbody = document.getElementById('tvh-channels-body');
  tbody.innerHTML = '<tr><td colspan="3"><span class="spinner"></span> Laden…</td></tr>';
  try {
    const data = await api('/api/tvheadend/channels');
    const ch = data.channels || [];
    if (!ch.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-muted">Geen kanalen gevonden</td></tr>';
      return;
    }
    tbody.innerHTML = ch.map(c => `
      <tr>
        <td>${c.number || '—'}</td>
        <td>${escHtml(c.name)}</td>
        <td><span class="tag ${c.enabled ? 'tag-success' : 'tag-warning'}">${c.enabled ? 'Actief' : 'Inactief'}</span></td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-muted">Fout: ${e.message}</td></tr>`;
    toast('Kanalen laden mislukt: ' + e.message, 'error');
  }
}

async function loadTvhInputs() {
  const tbody = document.getElementById('tvh-inputs-body');
  tbody.innerHTML = '<tr><td colspan="6"><span class="spinner"></span></td></tr>';
  try {
    const data = await api('/api/tvheadend/status');
    const inputs = data.inputs || [];
    if (!inputs.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-muted">Geen actieve inputs</td></tr>';
      return;
    }
    tbody.innerHTML = inputs.map(inp => `
      <tr>
        <td class="text-sm">${escHtml(inp.input || '—')}</td>
        <td class="text-sm">${escHtml(inp.stream || '—')}</td>
        <td><span class="tag ${sigTag(inp.signal)}">${inp.signal ?? '—'}%</span></td>
        <td><span class="tag ${sigTag(inp.snr)}">${inp.snr ?? '—'}%</span></td>
        <td>${inp.ber ?? '—'}</td>
        <td>${inp.unc ?? '—'}</td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-muted">Fout: ${e.message}</td></tr>`;
  }
}

function sigTag(v) {
  if (v == null) return 'tag-info';
  return v >= 60 ? 'tag-success' : v >= 30 ? 'tag-warning' : 'tag-danger';
}

async function startTvhScan() {
  const btn = document.getElementById('btn-tvh-scan');
  const prog = document.getElementById('tvh-scan-progress');
  const fill = document.getElementById('tvh-prog-fill');
  const label = document.getElementById('tvh-prog-label');
  const result = document.getElementById('tvh-scan-result');

  btn.disabled = true;
  prog.style.display = 'block';
  fill.style.width = '10%';
  label.textContent = 'Scan gestart…';
  result.innerHTML = '';

  try {
    fill.style.width = '40%';
    label.textContent = 'Kanaaldata ophalen…';
    const data = await api('/api/tvheadend/scan', { method: 'POST', body: {} });
    fill.style.width = '100%';
    label.textContent = `Klaar — ${data.measurements} metingen opgeslagen (scan #${data.scanId})`;
    result.innerHTML = `<div class="alert alert-success">✓ Scan #${data.scanId} voltooid met ${data.measurements} metingen.</div>`;
    toast('TVheadend scan voltooid', 'success');
  } catch (e) {
    fill.style.width = '100%';
    fill.style.background = 'var(--danger)';
    label.textContent = 'Fout: ' + e.message;
    result.innerHTML = `<div class="alert alert-danger">✗ ${e.message}</div>`;
    toast('Scan mislukt: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    setTimeout(() => {
      prog.style.display = 'none';
      fill.style.background = '';
      fill.style.width = '0%';
    }, 4000);
  }
}

// ─── TAB 3: History ───────────────────────────────────────────────────────────
async function loadHistory() {
  const tbody = document.getElementById('history-body');
  tbody.innerHTML = '<tr><td colspan="5"><span class="spinner"></span></td></tr>';
  try {
    const data = await api('/api/scans?limit=50');
    const scans = data.scans || [];
    if (!scans.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Geen scans gevonden</td></tr>';
      return;
    }
    tbody.innerHTML = scans.map(s => {
      const w = s.weather_data ? JSON.parse(s.weather_data) : null;
      const weatherStr = w ? `${w.temperature ?? '?'}°C · ☁️${w.cloud_cover ?? '?'}%` : '—';
      return `
        <tr>
          <td>${s.id}</td>
          <td><span class="tag tag-info">${s.scan_type}</span></td>
          <td class="font-mono text-sm">${fmt(s.started_at)}</td>
          <td class="text-sm">${weatherStr}</td>
          <td><button class="btn btn-secondary btn-sm" onclick="showScanDetail(${s.id})">Details</button></td>
        </tr>
      `;
    }).join('');
    populateFreqSelector(scans);
    buildWeatherCorrelationChart(scans);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-muted">Fout: ${e.message}</td></tr>`;
  }
}

async function showScanDetail(id) {
  const card = document.getElementById('history-detail-card');
  const detail = document.getElementById('history-detail');
  card.style.display = 'block';
  detail.innerHTML = '<span class="spinner"></span>';
  try {
    const scan = await api(`/api/scans/${id}`);
    const w = scan.weather_data ? JSON.parse(scan.weather_data) : null;
    let html = `<p class="text-sm text-muted">Type: <b>${scan.scan_type}</b> · Start: ${fmt(scan.started_at)} · Eind: ${fmt(scan.finished_at)}</p>`;
    if (w) html += `<p class="text-sm text-muted mt-1">Temp: ${w.temperature}°C · Bewolking: ${w.cloud_cover}% · Neerslag: ${w.precipitation}mm</p>`;

    if (scan.signals && scan.signals.length) {
      html += `<div class="section-title mt-2">Signaalmetingen (${scan.signals.length})</div>`;
      html += `<div class="table-wrap"><table><thead><tr><th>Freq</th><th>Pol</th><th>Niveau</th><th>Qual.</th><th>Lock</th></tr></thead><tbody>`;
      for (const m of scan.signals) {
        html += `<tr><td>${m.frequency}</td><td>${m.polarisation}</td><td>${m.signal_level ?? '—'}%</td><td>${m.signal_quality ?? '—'}%</td><td>${m.locked ? '🔒' : '🔓'}</td></tr>`;
      }
      html += '</tbody></table></div>';
    }

    if (scan.channels && scan.channels.length) {
      html += `<div class="section-title mt-2">Kanaalmetingen (${scan.channels.length})</div>`;
      html += `<div class="table-wrap"><table><thead><tr><th>Kanaal</th><th>Signaal</th><th>SNR</th><th>BER</th></tr></thead><tbody>`;
      for (const m of scan.channels) {
        html += `<tr><td>${escHtml(m.channel_name || m.channel_id || '—')}</td><td>${m.signal_level ?? '—'}%</td><td>${m.signal_quality ?? '—'}%</td><td>${m.ber ?? '—'}</td></tr>`;
      }
      html += '</tbody></table></div>';
    }

    detail.innerHTML = html;
  } catch (e) {
    detail.innerHTML = `<div class="alert alert-danger">${e.message}</div>`;
  }
}

function populateFreqSelector(scans) {
  const sel = document.getElementById('chart-freq-select');
  const freqs = [...new Set(state.frequencies.map(f => f.frequency))];
  sel.innerHTML = freqs.map(f => `<option value="${f}">${f} MHz</option>`).join('');
  if (freqs.length) loadChartData();
}

async function loadChartData() {
  const freq = document.getElementById('chart-freq-select').value;
  if (!freq) return;
  try {
    const data = await api(`/api/history/signal?frequency=${freq}&limit=100`);
    buildSignalChart(data.history || []);
  } catch (e) {
    console.warn('Chart data error:', e);
  }
}

function buildSignalChart(history) {
  const labels = history.map(h => fmt(h.measured_at)).reverse();
  const levels = history.map(h => h.signal_level).reverse();
  const qualities = history.map(h => h.signal_quality).reverse();

  const ctx = document.getElementById('signal-chart').getContext('2d');
  if (state.signalChart) state.signalChart.destroy();
  state.signalChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Signaalsterkte %', data: levels, borderColor: '#4f8ef7', backgroundColor: 'rgba(79,142,247,.1)', tension: .3, fill: true, pointRadius: 3 },
        { label: 'Signaalqualiteit %', data: qualities, borderColor: '#2ecc71', backgroundColor: 'rgba(46,204,113,.1)', tension: .3, fill: true, pointRadius: 3 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#9098bb' } },
        x: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#9098bb', maxTicksLimit: 10 } }
      },
      plugins: { legend: { labels: { color: '#e0e0f0' } } }
    }
  });
}

function buildWeatherCorrelationChart(scans) {
  const points = scans
    .filter(s => s.weather_data)
    .map(s => {
      const w = JSON.parse(s.weather_data);
      return { cloud: w.cloud_cover, precip: w.precipitation };
    })
    .filter(p => p.cloud != null);

  if (!points.length) return;

  const ctx = document.getElementById('weather-chart').getContext('2d');
  if (state.weatherChart) state.weatherChart.destroy();
  state.weatherChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: points.map((_, i) => `Scan ${i + 1}`),
      datasets: [
        { label: 'Bewolking %', data: points.map(p => p.cloud), backgroundColor: 'rgba(79,142,247,.6)', borderColor: '#4f8ef7', borderWidth: 1 },
        { label: 'Neerslag mm', data: points.map(p => p.precip || 0), backgroundColor: 'rgba(124,92,191,.6)', borderColor: '#7c5cbf', borderWidth: 1, yAxisID: 'y1' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#9098bb' } },
        y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#9098bb' } },
        x: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#9098bb', maxTicksLimit: 15 } }
      },
      plugins: { legend: { labels: { color: '#e0e0f0' } } }
    }
  });
}

// ─── TAB 4: Settings ─────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const cfg = await api('/api/config');
    const s = cfg.satip || {};
    const t = cfg.tvheadend || {};
    const w = cfg.weather || {};
    const sch = cfg.scheduler || {};

    document.getElementById('cfg-satip-host').value = s.host || '';
    document.getElementById('cfg-satip-port').value = s.port || 554;
    document.getElementById('cfg-satip-tuner').value = s.tuner || 1;

    document.getElementById('cfg-tvh-url').value = t.url || '';
    document.getElementById('cfg-tvh-user').value = t.username || '';
    document.getElementById('cfg-tvh-pass').value = '';

    document.getElementById('cfg-lat').value = w.latitude || '';
    document.getElementById('cfg-lon').value = w.longitude || '';
    document.getElementById('cfg-tz').value = w.timezone || 'Europe/Amsterdam';

    document.getElementById('cfg-cron').value = sch.cron || '0 3 * * *';
    document.getElementById('cfg-scheduler-enabled').checked = !!sch.enabled;
  } catch (e) {
    toast('Configuratie laden mislukt: ' + e.message, 'error');
  }
}

async function loadSchedulerStatus() {
  try {
    const st = await api('/api/scheduler/status');
    const el = document.getElementById('scheduler-status-text');
    el.innerHTML = `Status: <b>${st.active ? 'Actief' : 'Inactief'}</b> · Laatste run: ${fmt(st.lastRun)} · ${st.lastStatus || '—'}`;
  } catch {}
}

async function saveSettings() {
  const msg = document.getElementById('settings-msg');
  msg.innerHTML = '';
  try {
    const cfg = await api('/api/config');

    cfg.satip = {
      host: document.getElementById('cfg-satip-host').value.trim(),
      port: parseInt(document.getElementById('cfg-satip-port').value, 10) || 554,
      tuner: parseInt(document.getElementById('cfg-satip-tuner').value, 10) || 1
    };

    const pass = document.getElementById('cfg-tvh-pass').value;
    cfg.tvheadend = {
      url: document.getElementById('cfg-tvh-url').value.trim(),
      username: document.getElementById('cfg-tvh-user').value.trim(),
      password: pass || (cfg.tvheadend ? '***' : '')
    };

    cfg.weather = {
      latitude: parseFloat(document.getElementById('cfg-lat').value) || 52.3676,
      longitude: parseFloat(document.getElementById('cfg-lon').value) || 4.9041,
      timezone: document.getElementById('cfg-tz').value.trim() || 'Europe/Amsterdam'
    };

    cfg.scheduler = {
      enabled: document.getElementById('cfg-scheduler-enabled').checked,
      cron: document.getElementById('cfg-cron').value.trim() || '0 3 * * *'
    };

    await api('/api/config', { method: 'POST', body: cfg });
    msg.innerHTML = '<div class="alert alert-success">✓ Instellingen opgeslagen.</div>';
    toast('Instellingen opgeslagen', 'success');
    loadSchedulerStatus();

    // Sync host to signal tab
    document.getElementById('si-host').value = cfg.satip.host || '';
    document.getElementById('si-port').value = cfg.satip.port || 554;
  } catch (e) {
    msg.innerHTML = `<div class="alert alert-danger">✗ ${e.message}</div>`;
    toast('Opslaan mislukt: ' + e.message, 'error');
  }
}

async function triggerScheduledScan() {
  const msg = document.getElementById('settings-msg');
  msg.innerHTML = '<div class="alert alert-info">⏳ Scan uitvoeren…</div>';
  try {
    const result = await api('/api/scheduler/run', { method: 'POST', body: {} });
    if (result.error) throw new Error(result.error);
    msg.innerHTML = `<div class="alert alert-success">✓ Scan #${result.scanId} klaar — ${result.measurements} metingen.</div>`;
    toast('Scan voltooid', 'success');
    loadSchedulerStatus();
  } catch (e) {
    msg.innerHTML = `<div class="alert alert-danger">✗ ${e.message}</div>`;
    toast('Scan mislukt: ' + e.message, 'error');
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Init ─────────────────────────────────────────────────────────────────────
(async function init() {
  loadWeatherBadge();
  await initSignalTab();
})();
