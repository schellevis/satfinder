'use strict';

// ─── SVG icon constants (used in dynamic innerHTML) ───────────────────────────
const SVG_LOCK_CLOSED = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
const SVG_LOCK_OPEN   = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`;
const SVG_SIGNAL      = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`;
let defaultSatellite = 'Astra 28.2°E';

// ─── Theme ────────────────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('theme');
  const preferred = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', preferred);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
}

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  frequencies: [],
  satellites: [],
  signalHistory: [],
  signalChart: null,
  weatherChart: null,
  currentScanId: null,
  // Live session state
  liveSessionId: null,
  livePollingTimer: null,
  audioCtx: null,
  oscillator: null,
  gainNode: null,
  bandScan: {
    running: false,
    satellite: defaultSatellite,
    transponders: [],
    results: [],
    completed: 0,
    total: 0,
    scanId: null,
    statusText: 'Nog geen scan gestart.'
  }
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
document.querySelectorAll('.nav-tab[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab[data-tab]').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'tab-history') loadHistory();
    if (btn.dataset.tab === 'tab-settings') { loadSettings(); loadSchedulerStatus(); loadMuxList(); }
    if (btn.dataset.tab === 'tab-tvh') syncTvhFields();
  });
});

// ─── Weather badge ────────────────────────────────────────────────────────────
async function loadWeatherBadge() {
  try {
    const w = await api('/api/weather');
    document.getElementById('weather-text').textContent =
      `${w.temperature !== null ? w.temperature + '°C' : ''} · ${w.weather_description || ''} · ${w.cloud_cover ?? '?'}% bew.`;
  } catch {
    document.getElementById('weather-text').textContent = 'Weerfout';
  }
}

// ─── TAB 1: Signal Finder ────────────────────────────────────────────────────
async function initSignalTab() {
  try {
    const data = await api('/api/muxes');
    state.frequencies = data.muxes || [];
    state.satellites = data.satellites || [];

    const satSel = document.getElementById('si-satellite');
    satSel.innerHTML = '<option value="">– Alle –</option>' +
      state.satellites.map(s => `<option value="${s}">${s}</option>`).join('');

    fillTransponderSelect(state.frequencies);
  } catch (e) {
    toast('Frequenties laden mislukt: ' + e.message, 'error');
  }

  resetBandScanState();

  // Prefill host + default satellite from config
  try {
    const cfg = await api('/api/config');
    if (cfg.satip) {
      document.getElementById('si-host').value = cfg.satip.host || '';
      document.getElementById('si-port').value = cfg.satip.port || 554;
      if (cfg.satip.defaultSatellite && state.satellites.includes(cfg.satip.defaultSatellite)) {
        defaultSatellite = cfg.satip.defaultSatellite;
        satSel.value = defaultSatellite;
        filterTransponders();
      }
    }
  } catch {}
}

function fillTransponderSelect(list) {
  const sel = document.getElementById('si-transponder');
  sel.innerHTML = '<option value="">– Kies transponder –</option>' +
    list.map((t, i) => `<option value="${i}" data-idx="${i}">${t.satellite || ''} – ${t.frequency} MHz ${t.polarisation}</option>`).join('');
}

function filterTransponders() {
  const sat = document.getElementById('si-satellite').value;
  const list = sat ? state.frequencies.filter(f => f.satellite === sat) : state.frequencies;
  fillTransponderSelect(list);
  if (!state.bandScan.running) resetBandScanState();
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
      // Build elements with DOM API to avoid XSS — s.address comes from a LAN
      // SSDP packet and could contain malicious HTML if a rogue device replies.
      el.replaceChildren();
      for (const s of data.servers) {
        const div = document.createElement('div');
        div.className = 'tag tag-success';
        div.style.cssText = 'margin:.2rem .2rem 0 0;cursor:pointer';
        div.textContent = s.address;
        div.addEventListener('click', () => { document.getElementById('si-host').value = s.address; });
        el.appendChild(div);
      }
      if (data.servers[0]) document.getElementById('si-host').value = data.servers[0].address;
    }
  } catch (e) {
    el.textContent = 'Fout: ' + e.message;
  }
}

async function measureSignal() {
  if (state.bandScan.running) { toast('Wacht tot de band-scan klaar is', 'error'); return; }

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
    btn.innerHTML = SVG_SIGNAL + ' Meten';
  }
}

function updateSignalDisplay(data, freq) {
  setMeter('si-level-bar', 'si-level-val', data.level);
  setMeter('si-quality-bar', 'si-quality-val', data.quality);

  const lockEl = document.getElementById('si-lock');
  lockEl.className = data.locked ? 'lock-indicator locked' : 'lock-indicator unlocked';
  const lockLabel = document.getElementById('si-lock-label');
  if (lockLabel) lockLabel.textContent = data.locked ? 'Lock verkregen' : 'Geen lock';

  document.getElementById('si-timestamp').textContent = 'Gemeten: ' + fmt(new Date());

  // Update stat tiles
  const lvl = data.level ?? null;
  const qty = data.quality ?? null;
  const statLv   = document.getElementById('stat-level-val');
  const statQt   = document.getElementById('stat-quality-val');
  const statLvU  = document.getElementById('stat-level-unit');
  const statQtU  = document.getElementById('stat-quality-unit');
  const statLock = document.getElementById('stat-lock-val');
  if (statLv)   statLv.textContent  = lvl !== null ? lvl : '—';
  if (statQt)   statQt.textContent  = qty !== null ? qty : '—';
  if (statLvU)  statLvU.textContent = lvl !== null ? '%' : '';
  if (statQtU)  statQtU.textContent = qty !== null ? '%' : '';
  if (statLock) {
    statLock.textContent  = data.locked ? 'Lock' : 'Geen lock';
    statLock.style.color  = data.locked ? 'var(--success)' : 'var(--danger)';
  }
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
      <td><span class="tag ${m.locked ? 'tag-success' : 'tag-danger'}">${m.locked ? 'Lock' : 'Geen'}</span></td>
    </tr>
  `).join('');
}

function getBandScanTransponders() {
  const sat = document.getElementById('si-satellite').value;
  return sat ? state.frequencies.filter(f => f.satellite === sat) : state.frequencies;
}

function getSelectedSatelliteName() {
  const sat = document.getElementById('si-satellite').value;
  return sat || 'Alle satellieten';
}

function resetBandScanState() {
  const transponders = getBandScanTransponders();
  const satName = getSelectedSatelliteName();
  state.bandScan = {
    running: false,
    satellite: document.getElementById('si-satellite').value || '',
    transponders,
    results: transponders.map(() => null),
    completed: 0,
    total: transponders.length,
    scanId: null,
    statusText: transponders.length ? 'Nog geen scan gestart.' : `Geen transponders voor ${satName}.`
  };
  clearAlert('si-band-scan-msg');
  updateBandScanLabel();
  renderBandScanResults();
}

function updateBandScanLabel() {
  const satName = getSelectedSatelliteName();
  const btn = document.getElementById('btn-band-scan');
  const title = document.getElementById('si-band-scan-title');
  if (btn && !state.bandScan.running) {
    // satName comes from <select> option text populated from our own transponder list, safe to use
    btn.replaceChildren();
    const svgContainer = document.createElement('span');
    svgContainer.innerHTML = SVG_SIGNAL;
    btn.appendChild(svgContainer.firstChild);
    btn.appendChild(document.createTextNode(` Scan ${satName}`));
  }
  if (title) title.textContent = `${satName} band-scan`;
}

function formatBandMetric(value) {
  if (value === null || value === undefined) return '<span class="text-muted">—</span>';
  const num = Number(value);
  const cls = num >= 60 ? 'tag-success' : num >= 30 ? 'tag-warning' : 'tag-danger';
  return `<span class="tag ${cls}">${num}%</span>`;
}

function updateBandScanProgress(statusText) {
  const fill = document.getElementById('si-band-prog-fill');
  const label = document.getElementById('si-band-prog-label');
  const next = state.bandScan.transponders[state.bandScan.completed];
  const pct = state.bandScan.total ? Math.round((state.bandScan.completed / state.bandScan.total) * 100) : 0;

  if (typeof statusText === 'string' && statusText) {
    state.bandScan.statusText = statusText;
  } else if (state.bandScan.running && next) {
    state.bandScan.statusText = `Bezig met ${next.frequency} MHz ${next.polarisation} (${state.bandScan.completed}/${state.bandScan.total} klaar)`;
  } else if (state.bandScan.completed) {
    state.bandScan.statusText = `Klaar: ${state.bandScan.completed}/${state.bandScan.total} transponders gemeten`;
  }

  if (fill) fill.style.width = `${pct}%`;
  if (label) label.textContent = state.bandScan.statusText;
}

function renderBandScanResults(statusText) {
  const tbody = document.getElementById('si-band-scan-body');
  const badge = document.getElementById('si-band-scan-badge');
  const summary = document.getElementById('si-band-scan-summary');
  const lockStat = document.getElementById('si-band-lock-stat');
  const lockMeta = document.getElementById('si-band-lock-meta');
  const progressStat = document.getElementById('si-band-progress-stat');
  const progressMeta = document.getElementById('si-band-progress-meta');
  const currentStat = document.getElementById('si-band-current-stat');
  const currentMeta = document.getElementById('si-band-current-meta');
  if (!tbody) return;

  if (badge) badge.textContent = `${state.bandScan.total} TP`;

  if (!state.bandScan.transponders.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Geen transponders geladen</td></tr>';
    if (summary) summary.textContent = '';
    if (lockStat) lockStat.textContent = '0 / 0';
    if (lockMeta) lockMeta.textContent = 'Geen transponders geladen.';
    if (progressStat) progressStat.textContent = '0%';
    if (progressMeta) progressMeta.textContent = '0 van 0 gemeten';
    if (currentStat) currentStat.textContent = '—';
    if (currentMeta) currentMeta.textContent = 'Wacht op transponderlijst';
    updateBandScanProgress(statusText || 'Geen transponders geladen.');
    return;
  }

  const measuredResults = state.bandScan.results.filter(Boolean);
  const measuredCount = measuredResults.length;
  const lockCount = measuredResults.filter(result => result.locked).length;
  const weakResults = measuredResults
    .filter(result => !result.error && result.quality !== null && result.quality !== undefined && result.quality < 60)
    .sort((a, b) => (a.locked === b.locked ? a.quality - b.quality : Number(a.locked) - Number(b.locked)));
  const pct = state.bandScan.total ? Math.round((measuredCount / state.bandScan.total) * 100) : 0;
  const currentIndex = state.bandScan.running ? Math.min(state.bandScan.completed, state.bandScan.total - 1) : -1;
  const currentTransponder = currentIndex >= 0 ? state.bandScan.transponders[currentIndex] : null;
  const latestMeasured = measuredResults[measuredResults.length - 1] || null;

  if (lockStat) lockStat.textContent = `${lockCount} / ${state.bandScan.total}`;
  if (lockMeta) {
    if (state.bandScan.running) {
      lockMeta.textContent = `${measuredCount} gemeten, ${state.bandScan.total - measuredCount} nog te gaan.`;
    } else if (measuredCount) {
      lockMeta.textContent = weakResults.length
        ? `${weakResults.length} transponders zitten nog onder 60% kwaliteit.`
        : 'Alle gemeten transponders zitten op of boven 60% kwaliteit.';
    } else {
      lockMeta.textContent = 'Nog geen scan gestart.';
    }
  }

  if (progressStat) progressStat.textContent = `${pct}%`;
  if (progressMeta) progressMeta.textContent = `${measuredCount} van ${state.bandScan.total} gemeten`;

  if (currentStat) {
    if (currentTransponder) {
      currentStat.textContent = `${currentTransponder.frequency} ${currentTransponder.polarisation}`;
    } else if (latestMeasured) {
      currentStat.textContent = `${latestMeasured.frequency} ${latestMeasured.polarisation}`;
    } else {
      currentStat.textContent = '—';
    }
  }

  if (currentMeta) {
    if (state.bandScan.running && currentTransponder) {
      currentMeta.textContent = `Nu bezig met ${currentIndex + 1} van ${state.bandScan.total}`;
    } else if (state.bandScan.scanId) {
      currentMeta.textContent = `Laatste scan #${state.bandScan.scanId}`;
    } else {
      currentMeta.textContent = 'Wacht op start';
    }
  }

  if (summary) {
    if (state.bandScan.running) {
      summary.textContent = weakResults.length
        ? `${lockCount}/${state.bandScan.total} lock. Zwakke transponders tot nu toe: ${weakResults.slice(0, 3).map(result => `${result.frequency} ${result.polarisation}`).join(', ')}.`
        : `${lockCount}/${state.bandScan.total} lock na ${measuredCount} van ${state.bandScan.total} metingen.`;
    } else if (state.bandScan.completed) {
      summary.textContent = weakResults.length
        ? `Zwakste transponders: ${weakResults.slice(0, 4).map(result => `${result.frequency} ${result.polarisation} (${result.quality}%)`).join(', ')}.`
        : `Laatste scan #${state.bandScan.scanId || '—'}: ${lockCount}/${state.bandScan.total} transponders met lock en geen zwakke uitschieters.`;
    } else {
      summary.textContent = 'Meet alle Astra 28.2 referentietransponders met één klik.';
    }
  }

  tbody.innerHTML = state.bandScan.transponders.map((transponder, index) => {
    const result = state.bandScan.results[index];
    const isCurrent = state.bandScan.running && index === currentIndex;
    let statusClass = 'tag-info';
    let statusLabel = 'Wacht';
    let rowClass = '';

    if (result) {
      if (result.error) {
        statusClass = 'tag-danger';
        statusLabel = 'Fout';
        rowClass = 'band-row-error';
      } else {
        statusClass = 'tag-success';
        statusLabel = 'Gemeten';
      }
    } else if (isCurrent) {
      statusLabel = 'Bezig';
    }

    if (isCurrent) rowClass = 'band-row-current';

    const lockHtml = result
      ? `<span class="tag ${result.locked ? 'tag-success' : 'tag-danger'}">${result.locked ? 'Lock' : 'Geen'}</span>`
      : '<span class="text-muted">—</span>';
    const errorTitle = result && result.error ? ` title="${escHtml(result.error)}"` : '';

    return `
      <tr class="${rowClass}" data-band-row="${index}">
        <td>
          <div>${escHtml(transponder.satellite || '')} – ${transponder.frequency} ${transponder.polarisation}</div>
          <div class="text-sm text-muted font-mono">${transponder.frequency} MHz ${transponder.polarisation}</div>
        </td>
        <td>${result ? formatBandMetric(result.level) : '<span class="text-muted">—</span>'}</td>
        <td>${result ? formatBandMetric(result.quality) : '<span class="text-muted">—</span>'}</td>
        <td>${lockHtml}</td>
        <td><span class="tag ${statusClass}"${errorTitle}>${statusLabel}</span></td>
      </tr>
    `;
  }).join('');

  if (state.bandScan.running && currentIndex >= 0) {
    const currentRow = tbody.querySelector(`[data-band-row="${currentIndex}"]`);
    if (currentRow) currentRow.scrollIntoView({ block: 'nearest' });
  }

  updateBandScanProgress(statusText);
}

function setBandScanControls(running) {
  const bandBtn = document.getElementById('btn-band-scan');
  const measureBtn = document.getElementById('btn-measure');
  const liveBtn = document.getElementById('btn-live-start');
  const satName = getSelectedSatelliteName();
  if (bandBtn) {
    bandBtn.disabled = running;
    if (running) {
      bandBtn.replaceChildren();
      const spinner = document.createElement('span');
      spinner.className = 'spinner';
      bandBtn.appendChild(spinner);
      bandBtn.appendChild(document.createTextNode(` Scan ${satName}…`));
    } else {
      updateBandScanLabel();
    }
  }
  if (measureBtn) measureBtn.disabled = running;
  if (liveBtn) liveBtn.disabled = running;
}

async function readErrorResponse(res) {
  const data = await res.json().catch(() => ({}));
  return data.error || `HTTP ${res.status}`;
}

async function streamJsonLines(url, onMessage) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(await readErrorResponse(res));
  }
  if (!res.body) {
    throw new Error('Streaming wordt niet ondersteund door deze browser');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      await onMessage(JSON.parse(line));
    }
  }

  const finalLine = buffer.trim();
  if (finalLine) {
    await onMessage(JSON.parse(finalLine));
  }
}

async function handleBandScanEvent(payload) {
  switch (payload.type) {
    case 'start': {
      state.bandScan.scanId = payload.scanId;
      state.bandScan.total = payload.total || state.bandScan.total;
      showAlert('si-band-scan-msg', `Band-scan gestart${payload.weatherData ? ' met weerdata' : ''}.`, 'info');
      renderBandScanResults();
      return;
    }
    case 'progress': {
      state.bandScan.results[payload.index - 1] = payload;
      state.bandScan.completed = payload.index;
      updateSignalDisplay({ level: payload.level, quality: payload.quality, locked: payload.locked }, payload.frequency);
      addSignalHistory({
        frequency: payload.frequency,
        polarisation: payload.polarisation,
        level: payload.level,
        quality: payload.quality,
        locked: payload.locked,
        measured_at: payload.measured_at
      });
      renderBandScanResults();
      return;
    }
    case 'done': {
      state.bandScan.running = false;
      state.bandScan.scanId = payload.scanId;
      state.bandScan.total = payload.total || state.bandScan.total;
      renderBandScanResults(`Klaar: ${payload.lockedCount}/${payload.total} transponders met lock`);
      showAlert('si-band-scan-msg', `Band-scan opgeslagen als scan #${payload.scanId}. ${payload.lockedCount}/${payload.total} transponders hebben lock.`, 'success');
      if (document.getElementById('tab-history').classList.contains('active')) loadHistory();
      toast(`Band-scan klaar (${payload.lockedCount}/${payload.total} lock)`, 'success');
      return;
    }
    case 'error':
      throw new Error(payload.message || 'Band-scan mislukt');
    default:
      return;
  }
}

async function startBandScan() {
  if (state.bandScan.running) return;

  const host = document.getElementById('si-host').value.trim();
  const port = document.getElementById('si-port').value || '554';
  const satellite = document.getElementById('si-satellite').value;
  const transponders = getBandScanTransponders();
  const satName = getSelectedSatelliteName();

  if (!host) { toast('Voer een SAT-IP host in', 'error'); return; }
  if (!transponders.length) { toast(`Geen transponders voor ${satName}`, 'error'); return; }

  if (state.liveSessionId) {
    await stopLiveSession();
  }

  resetBandScanState();
  state.bandScan.running = true;
  renderBandScanResults();
  setBandScanControls(true);

  try {
    const params = new URLSearchParams({ host, port });
    if (satellite) params.set('satellite', satellite);
    await streamJsonLines('/api/satip/band-scan?' + params.toString(), handleBandScanEvent);
    if (state.bandScan.running) {
      throw new Error('Band-scan onverwacht onderbroken');
    }
  } catch (e) {
    state.bandScan.running = false;
    renderBandScanResults('Band-scan afgebroken');
    showAlert('si-band-scan-msg', e.message, 'danger');
    toast('Band-scan mislukt: ' + e.message, 'error');
  } finally {
    state.bandScan.running = false;
    setBandScanControls(false);
    renderBandScanResults();
  }
}

// ─── Live session (dish alignment mode) ──────────────────────────────────────
async function startLiveSession() {
  if (state.bandScan.running) { toast('Wacht tot de band-scan klaar is', 'error'); return; }

  const host = document.getElementById('si-host').value.trim();
  const port = document.getElementById('si-port').value || '554';
  const freq = document.getElementById('si-freq').value;
  const pol  = document.getElementById('si-pol').value;
  const sr   = document.getElementById('si-sr').value || '22000';
  const msys = document.getElementById('si-msys').value;

  if (!host) { toast('Voer een SAT-IP host in', 'error'); return; }
  if (!freq) { toast('Voer een frequentie in', 'error'); return; }

  const btnStart = document.getElementById('btn-live-start');
  const btnStop  = document.getElementById('btn-live-stop');
  btnStart.disabled = true;

  try {
    const data = await api('/api/satip/tune-session', {
      method: 'POST',
      body: { host, port: parseInt(port, 10), frequency: parseInt(freq, 10),
              polarisation: pol, symbol_rate: parseInt(sr, 10), delivery_system: msys }
    });
    state.liveSessionId = data.sessionId;
    btnStart.style.display = 'none';
    btnStop.style.display  = 'inline-flex';
    state.livePollingTimer = setInterval(pollLiveSignal, 500);
    toast('Live sessie gestart', 'success');
  } catch (e) {
    toast('Sessie starten mislukt: ' + e.message, 'error');
    btnStart.disabled = false;
  }
}

async function stopLiveSession() {
  if (state.livePollingTimer) {
    clearInterval(state.livePollingTimer);
    state.livePollingTimer = null;
  }
  stopAudio();
  if (state.liveSessionId) {
    try {
      await api(`/api/satip/tune-session/${encodeURIComponent(state.liveSessionId)}`, { method: 'DELETE' });
    } catch {}
    state.liveSessionId = null;
  }
  const btnStart = document.getElementById('btn-live-start');
  const btnStop  = document.getElementById('btn-live-stop');
  btnStart.style.display   = 'inline-flex';
  btnStart.disabled        = false;
  btnStop.style.display    = 'none';
  toast('Live sessie gestopt', 'info');
}

async function pollLiveSignal() {
  if (!state.liveSessionId) return;
  try {
    const data = await api(`/api/satip/signal-live?sessionId=${encodeURIComponent(state.liveSessionId)}`);
    updateSignalDisplay(data, document.getElementById('si-freq').value);
    if (document.getElementById('si-audio-enabled').checked) {
      playAudioFeedback(data.quality);
    }
  } catch (e) {
    if (e.message.includes('not found') || e.message.includes('404')) {
      await stopLiveSession();
      toast('Sessie verlopen', 'error');
    }
  }
}

// ─── Audio feedback ───────────────────────────────────────────────────────────
function playAudioFeedback(qualityPct) {
  try {
    if (!state.audioCtx) {
      state.audioCtx = new AudioContext();
      state.gainNode = state.audioCtx.createGain();
      state.gainNode.gain.value = 0.08;
      state.gainNode.connect(state.audioCtx.destination);
      state.oscillator = state.audioCtx.createOscillator();
      state.oscillator.type = 'sine';
      state.oscillator.connect(state.gainNode);
      state.oscillator.start();
    }
    // Map 0–100% quality to 220–2200 Hz
    const freq = 220 + (qualityPct / 100) * 1980;
    state.oscillator.frequency.setTargetAtTime(freq, state.audioCtx.currentTime, 0.05);
  } catch {}
}

function stopAudio() {
  try {
    if (state.oscillator) { state.oscillator.stop(); state.oscillator = null; }
    if (state.audioCtx)   { state.audioCtx.close();  state.audioCtx   = null; }
    state.gainNode = null;
  } catch {}
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
    const data = await api('/api/tvheadend/sample', { method: 'POST', body: {} });
    fill.style.width = '100%';
    label.textContent = `Klaar — ${data.measurements} metingen opgeslagen (scan #${data.scanId})`;
    result.innerHTML = `<div class="alert alert-success">✓ Snapshot #${data.scanId} voltooid met ${data.measurements} metingen.</div>`;
    toast('Tuner-status vastgelegd', 'success');
  } catch (e) {
    fill.style.width = '100%';
    fill.style.background = 'var(--danger)';
    label.textContent = 'Fout: ' + e.message;
    result.innerHTML = `<div class="alert alert-danger">✗ ${e.message}</div>`;
    toast('Vastleggen mislukt: ' + e.message, 'error');
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
      const weatherStr = w ? `${w.temperature ?? '?'}°C · ${w.cloud_cover ?? '?'}% bew.` : '—';
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
    populateFreqSelector();
    buildWeatherCorrelationChart();
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
        html += `<tr><td>${m.frequency}</td><td>${m.polarisation}</td><td>${m.signal_level ?? '—'}%</td><td>${m.signal_quality ?? '—'}%</td><td><span class="tag ${m.locked ? 'tag-success' : 'tag-danger'}">${m.locked ? 'Lock' : 'Geen'}</span></td></tr>`;
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

async function populateFreqSelector() {
  const sel = document.getElementById('chart-freq-select');
  try {
    const data = await api('/api/history/frequencies');
    const freqs = data.frequencies || [];
    sel.innerHTML = freqs.length
      ? freqs.map(f => `<option value="${f}">${f} MHz</option>`).join('')
      : '<option value="">— Geen metingen —</option>';
    if (freqs.length) loadChartData();
  } catch {
    sel.innerHTML = '<option value="">— Fout bij laden —</option>';
  }
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

async function buildWeatherCorrelationChart() {
  try {
    const { data } = await api('/api/history/correlation?limit=100');
    if (!data || !data.length) return;

    const points = data.reverse().map(row => {
      const w = row.weather_data ? JSON.parse(row.weather_data) : {};
      return {
        label: fmt(row.started_at),
        cloud: w.cloud_cover ?? null,
        precip: w.precipitation ?? 0,
        quality: row.avg_quality,
        level: row.avg_level
      };
    }).filter(p => p.cloud != null && p.quality != null);

    if (!points.length) return;

    const ctx = document.getElementById('weather-chart').getContext('2d');
    if (state.weatherChart) state.weatherChart.destroy();
    state.weatherChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: points.map(p => p.label),
        datasets: [
          {
            label: 'Gem. signaalqualiteit %',
            data: points.map(p => p.quality),
            borderColor: '#2ecc71', backgroundColor: 'rgba(46,204,113,.1)',
            tension: .3, fill: true, pointRadius: 3, yAxisID: 'y'
          },
          {
            label: 'Bewolking %',
            data: points.map(p => p.cloud),
            borderColor: '#4f8ef7', backgroundColor: 'rgba(79,142,247,.08)',
            tension: .3, fill: false, pointRadius: 3, yAxisID: 'y', borderDash: [4, 3]
          },
          {
            label: 'Neerslag mm',
            data: points.map(p => p.precip),
            borderColor: '#7c5cbf', backgroundColor: 'rgba(124,92,191,.3)',
            type: 'bar', yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          y:  { min: 0, max: 100, grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#9098bb' } },
          y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#9098bb' } },
          x:  { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#9098bb', maxTicksLimit: 10 } }
        },
        plugins: { legend: { labels: { color: '#e0e0f0' } } }
      }
    });
  } catch (e) {
    console.warn('Weather correlation chart error:', e);
  }
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

    const defSatSel = document.getElementById('cfg-default-satellite');
    defSatSel.innerHTML = '<option value="">– Alle (geen voorkeur) –</option>' +
      state.satellites.map(sat => `<option value="${sat}"${sat === s.defaultSatellite ? ' selected' : ''}>${sat}</option>`).join('');

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
      tuner: parseInt(document.getElementById('cfg-satip-tuner').value, 10) || 1,
      defaultSatellite: document.getElementById('cfg-default-satellite').value
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

// ─── Mux management (Settings tab) ───────────────────────────────────────────

async function loadMuxList() {
  const tbody = document.getElementById('mux-list-body');
  const badge = document.getElementById('mux-count-badge');
  if (!tbody) return;
  try {
    const data = await api('/api/muxes');
    const muxes = data.muxes || [];
    if (badge) badge.textContent = muxes.length;
    if (!muxes.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-muted">Geen muxes. Importeer uit TVheadend of voeg handmatig toe.</td></tr>';
      return;
    }
    tbody.innerHTML = muxes.map(m => `
      <tr>
        <td class="text-sm">${escHtml(m.satellite)}</td>
        <td class="font-mono text-sm">${m.frequency}</td>
        <td>${m.polarisation}</td>
        <td class="text-sm">${m.symbol_rate}</td>
        <td><span class="tag tag-info">${escHtml(m.source)}</span></td>
        <td><button class="btn btn-danger btn-sm" onclick="deleteMux(${m.id})">×</button></td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-muted">Fout: ${escHtml(e.message)}</td></tr>`;
  }
}

async function importMuxesFromTvh() {
  const btn = document.getElementById('btn-import-tvh');
  const msg = document.getElementById('mux-import-msg');
  btn.disabled = true;
  btn.textContent = 'Importeren…';
  msg.innerHTML = '';
  try {
    const result = await api('/api/muxes/import-tvheadend', { method: 'POST', body: {} });
    msg.innerHTML = `<div class="alert alert-success">Geïmporteerd: ${result.imported}, bijgewerkt: ${result.updated}, overgeslagen: ${result.skipped} (totaal: ${result.total})</div>`;
    toast(`${result.imported} muxes geïmporteerd uit TVheadend`, 'success');
    await loadMuxList();
    await initSignalTab();
  } catch (e) {
    msg.innerHTML = `<div class="alert alert-danger">${escHtml(e.message)}</div>`;
    toast('Import mislukt: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Importeer uit TVheadend';
  }
}

async function clearAllMuxes() {
  if (!confirm('Alle muxes verwijderen? Dit kan niet ongedaan worden.')) return;
  try {
    const result = await api('/api/muxes/all', { method: 'DELETE' });
    toast(`${result.deleted} muxes verwijderd`, 'info');
    await loadMuxList();
    await initSignalTab();
  } catch (e) {
    toast('Verwijderen mislukt: ' + e.message, 'error');
  }
}

async function deleteMux(id) {
  try {
    await api(`/api/muxes/${id}`, { method: 'DELETE' });
    await loadMuxList();
    await initSignalTab();
  } catch (e) {
    toast('Verwijderen mislukt: ' + e.message, 'error');
  }
}

async function addMuxManually() {
  const satellite = document.getElementById('mux-add-sat').value.trim();
  const frequency = parseInt(document.getElementById('mux-add-freq').value, 10);
  const polarisation = document.getElementById('mux-add-pol').value;
  const symbol_rate = parseInt(document.getElementById('mux-add-sr').value, 10) || 27500;
  const delivery_system = document.getElementById('mux-add-msys').value;
  const fec = document.getElementById('mux-add-fec').value.trim() || '3/4';

  if (!satellite) { toast('Vul een satellietnaam in', 'error'); return; }
  if (!frequency) { toast('Vul een frequentie in', 'error'); return; }

  try {
    await api('/api/muxes', { method: 'POST', body: { satellite, frequency, polarisation, symbol_rate, delivery_system, fec } });
    toast('Mux toegevoegd', 'success');
    document.getElementById('mux-add-freq').value = '';
    await loadMuxList();
    await initSignalTab();
  } catch (e) {
    toast('Toevoegen mislukt: ' + e.message, 'error');
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
  initTheme();
  loadWeatherBadge();
  await initSignalTab();
})();
