'use strict';

const net = require('net');
const dgram = require('dgram');

const SSDP_MULTICAST = '239.255.255.250';
const SSDP_PORT = 1900;
const SATIP_ST = 'urn:ses-com:device:SatIPServer:1';
const RTSP_DEFAULT_PORT = 554;

// Active RTSP sessions keyed by session id
const activeSessions = new Map();

/**
 * Discover SAT-IP servers on the local network via SSDP M-SEARCH.
 * Returns a list of discovered server objects within timeoutMs.
 */
const MAX_DISCOVER_TIMEOUT = 30000;

function discover(timeoutMs = 3000) {
  const safeTimeout = Math.min(Math.max(500, Number(timeoutMs) || 3000), MAX_DISCOVER_TIMEOUT);
  return new Promise((resolve) => {
    timeoutMs = safeTimeout;
    const servers = [];
    const seen = new Set();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    const msg = Buffer.from([
      'M-SEARCH * HTTP/1.1',
      `HOST: ${SSDP_MULTICAST}:${SSDP_PORT}`,
      'MAN: "ssdp:discover"',
      'MX: 2',
      `ST: ${SATIP_ST}`,
      '',
      ''
    ].join('\r\n'));

    socket.on('message', (buf, rinfo) => {
      const text = buf.toString('utf8');
      if (seen.has(rinfo.address)) return;
      seen.add(rinfo.address);
      const locationMatch = text.match(/LOCATION:\s*(\S+)/i);
      const deviceMatch = text.match(/DEVICEID\.SES\.COM:\s*(\S+)/i);
      servers.push({
        address: rinfo.address,
        location: locationMatch ? locationMatch[1] : null,
        deviceId: deviceMatch ? deviceMatch[1] : null,
        raw: text
      });
    });

    socket.bind(() => {
      try {
        socket.setBroadcast(true);
        socket.setMulticastTTL(4);
        socket.send(msg, 0, msg.length, SSDP_PORT, SSDP_MULTICAST);
      } catch (e) {
        // Non-fatal — socket might not support multicast on this interface
      }
    });

    setTimeout(() => {
      socket.close();
      resolve(servers);
    }, safeTimeout);
  });
}

/**
 * Low-level RTSP request over a plain TCP socket.
 */
function rtspRequest(host, port, method, uri, headers = {}, body = '') {
  return new Promise((resolve, reject) => {
    let resolved = false;
    let buf = '';

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      client.destroy();
      reject(new Error(`RTSP ${method} timed out`));
    }, 10000);

    const client = net.createConnection({ host, port }, () => {
      // Each request opens a fresh TCP connection so CSeq always starts at 1.
      // (Sessions with persistent connections will need per-session tracking.)
      const lines = [
        `${method} ${uri} RTSP/1.0`,
        'CSeq: 1',
        'User-Agent: satfinder/1.0',
        ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`)
      ];
      if (body) {
        lines.push(`Content-Length: ${Buffer.byteLength(body)}`);
        lines.push('');
        lines.push(body);
      } else {
        lines.push('');
        lines.push('');
      }
      client.write(lines.join('\r\n'));
    });

    function tryResolve() {
      if (resolved) return;
      const headerEnd = buf.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      // Parse Content-Length so we wait for the full body before resolving.
      // Without this, GET_PARAMETER and DESCRIBE responses arriving in two TCP
      // chunks would be resolved with a truncated body.
      const clMatch = buf.slice(0, headerEnd).match(/Content-Length:\s*(\d+)/i);
      const contentLength = clMatch ? parseInt(clMatch[1], 10) : 0;

      if (buf.length >= headerEnd + 4 + contentLength) {
        resolved = true;
        clearTimeout(timeout);
        client.destroy();
        resolve(parseRtspResponse(buf));
      }
    }

    client.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      tryResolve();
    });

    // FIN from server — resolve with whatever we have (no Content-Length case)
    client.on('end', () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      resolve(parseRtspResponse(buf));
    });

    client.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function parseRtspResponse(raw) {
  const [headerPart, ...bodyParts] = raw.split('\r\n\r\n');
  const lines = headerPart.split('\r\n');
  const statusLine = lines[0] || '';
  const statusMatch = statusLine.match(/RTSP\/[\d.]+ (\d+) (.*)/);
  const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;
  const statusText = statusMatch ? statusMatch[2] : '';
  const headers = {};
  for (let i = 1; i < lines.length; i++) {
    const idx = lines[i].indexOf(':');
    if (idx > -1) {
      const key = lines[i].slice(0, idx).trim().toLowerCase();
      const value = lines[i].slice(idx + 1).trim();
      headers[key] = value;
    }
  }
  return { statusCode, statusText, headers, body: bodyParts.join('\r\n\r\n') };
}

/**
 * Build SAT-IP RTSP URI for a transponder.
 */
function buildTuneUri(host, transponder) {
  const { frequency, polarisation, symbol_rate, delivery_system, fec, tuner } = transponder;
  const msys = (delivery_system || 'DVBS').toLowerCase();
  const pol = (polarisation || 'h').toLowerCase();
  const sr = symbol_rate || 22000;
  const freq = frequency;
  const fecStr = fec ? `&fec=${fec.replace('/', '')}` : '';
  const src = tuner || 1;
  return `rtsp://${host}/?src=${src}&freq=${freq}&pol=${pol}&sr=${sr}&msys=${msys}${fecStr}&pids=0`;
}

/**
 * Tune to a transponder on a SAT-IP server.
 * Returns the RTSP session id.
 */
async function tune(host, port, transponder) {
  port = port || RTSP_DEFAULT_PORT;
  const uri = buildTuneUri(host, transponder);
  const resp = await rtspRequest(host, port, 'SETUP', uri, {
    Transport: 'RTP/AVP;unicast;client_port=1234-1235'
  });
  if (resp.statusCode !== 200) {
    throw new Error(`SETUP failed: ${resp.statusCode} ${resp.statusText}`);
  }
  const sessionHeader = resp.headers['session'] || '';
  const sessionId = sessionHeader.split(';')[0].trim();

  // Use the content-base from SETUP response as the session control URI, falling back to building one
  const contentBase = resp.headers['content-base'] ||
    `rtsp://${host}:${port}/stream=${encodeURIComponent(sessionId)}`;
  await rtspRequest(host, port, 'PLAY', contentBase, { Session: sessionId });

  activeSessions.set(sessionId, { host, port, uri: contentBase, tuner: transponder.tuner || 1 });
  return sessionId;
}

/**
 * Get signal parameters for an active RTSP session.
 */
async function getSignal(host, port, sessionId) {
  port = port || RTSP_DEFAULT_PORT;
  const body = 'tuner_signal\r\ntuner_quality\r\ntuner_lock\r\n';
  let uri;
  if (activeSessions.has(sessionId)) {
    uri = activeSessions.get(sessionId).uri;
  } else {
    uri = `rtsp://${host}/stream=${sessionId}`;
  }
  const resp = await rtspRequest(host, port, 'GET_PARAMETER', uri, {
    Session: sessionId,
    'Content-Type': 'text/parameters',
    'Content-Length': Buffer.byteLength(body)
  }, body);

  return parseSignalBody(resp.body);
}

function parseSignalBody(body) {
  const result = { level: 0, quality: 0, locked: false };
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const [key, val] = line.split(':').map(s => s.trim());
    if (!key || !val) continue;
    if (key === 'tuner_signal') {
      // SAT-IP spec: 0–255 raw value
      const raw = parseInt(val, 10) || 0;
      result.level = Math.round(raw / 255 * 100);
      result.level_raw = raw;
    } else if (key === 'tuner_quality') {
      // SAT-IP spec: 0–15 raw value
      const raw = parseInt(val, 10) || 0;
      result.quality = Math.round(raw / 15 * 100);
      result.quality_raw = raw;
    } else if (key === 'tuner_lock') {
      result.locked = val === '1' || val.toLowerCase() === 'true';
    }
  }
  return result;
}

/**
 * Tear down an active RTSP session.
 */
async function teardown(host, port, sessionId) {
  port = port || RTSP_DEFAULT_PORT;
  let uri;
  if (activeSessions.has(sessionId)) {
    uri = activeSessions.get(sessionId).uri;
    activeSessions.delete(sessionId);
  } else {
    uri = `rtsp://${host}/stream=${sessionId}`;
  }
  try {
    await rtspRequest(host, port, 'TEARDOWN', uri, { Session: sessionId });
  } catch {
    // Best-effort teardown
  }
}

/**
 * Combined: tune, get signal, teardown.
 */
async function measureSignal(host, port, transponder) {
  let sessionId = null;
  try {
    sessionId = await tune(host, port, transponder);
    // Give the tuner a moment to lock
    await new Promise(r => setTimeout(r, 1500));
    const signal = await getSignal(host, port, sessionId);
    return signal;
  } finally {
    if (sessionId) {
      await teardown(host, port, sessionId).catch(() => {});
    }
  }
}

module.exports = {
  discover,
  tune,
  getSignal,
  teardown,
  measureSignal,
  activeSessions
};
