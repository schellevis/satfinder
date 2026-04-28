'use strict';

const net = require('net');
const dgram = require('dgram');
const os = require('os');

const SSDP_MULTICAST = '239.255.255.250';
const SSDP_PORT = 1900;
const SATIP_ST = 'urn:ses-com:device:SatIPServer:1';
const RTSP_DEFAULT_PORT = 554;
const RTCP_APP_PACKET_TYPE = 204;

// Active RTSP sessions keyed by session id
const activeSessions = new Map();

/**
 * Discover SAT-IP servers on the local network via SSDP M-SEARCH.
 * Returns a list of discovered server objects within timeoutMs.
 */
const MAX_DISCOVER_TIMEOUT = 30000;

function discover(timeoutMs = 3000) {
  const safeTimeout = Math.min(Math.max(500, Number(timeoutMs) || 3000), MAX_DISCOVER_TIMEOUT);

  // Collect all non-loopback, non-link-local IPv4 addresses to send M-SEARCH
  // from each interface. On multi-homed hosts (e.g. Tailscale + LAN) the OS
  // may route multicast out on the wrong interface if we bind to 0.0.0.0.
  const localAddresses = Object.values(os.networkInterfaces())
    .flat()
    .filter(a => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'));

  // Always include one fallback socket bound to 0.0.0.0 in case enumeration misses an interface
  const bindAddresses = localAddresses.length > 0
    ? localAddresses.map(a => a.address)
    : ['0.0.0.0'];

  const msg = Buffer.from([
    'M-SEARCH * HTTP/1.1',
    `HOST: ${SSDP_MULTICAST}:${SSDP_PORT}`,
    'MAN: "ssdp:discover"',
    'MX: 2',
    `ST: ${SATIP_ST}`,
    '',
    ''
  ].join('\r\n'));

  return new Promise((resolve) => {
    const servers = [];
    const seen = new Set();
    const sockets = [];
    let closed = 0;

    function onMessage(buf, rinfo) {
      const text = buf.toString('utf8');
      if (seen.has(rinfo.address)) return;
      seen.add(rinfo.address);
      const locationMatch = text.match(/LOCATION:\s*(\S+)/i);
      const deviceMatch = text.match(/DEVICEID\.SES\.COM:\s*(\S+)/i);
      servers.push({
        address: rinfo.address,
        location: locationMatch ? locationMatch[1] : null,
        deviceId: deviceMatch ? deviceMatch[1] : null,
      });
    }

    function closeAll() {
      for (const s of sockets) {
        try { s.close(); } catch {}
      }
      resolve(servers);
    }

    for (const addr of bindAddresses) {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sockets.push(socket);
      socket.on('message', onMessage);
      socket.on('error', () => {}); // prevent unhandled rejection if interface goes away
      socket.bind({ address: addr }, () => {
        try {
          socket.setMulticastTTL(4);
          socket.setMulticastInterface(addr);
          socket.send(msg, 0, msg.length, SSDP_PORT, SSDP_MULTICAST);
        } catch {
          // Non-fatal — interface may not support multicast
        }
      });
    }

    setTimeout(closeAll, safeTimeout);
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

function buildControlUri(host, port, headers, sessionId) {
  if (headers['content-base']) {
    return headers['content-base'];
  }

  const streamId = headers['com.ses.streamid'];
  if (streamId) {
    return port && port !== RTSP_DEFAULT_PORT
      ? `rtsp://${host}:${port}/stream=${streamId}`
      : `rtsp://${host}/stream=${streamId}`;
  }

  return port && port !== RTSP_DEFAULT_PORT
    ? `rtsp://${host}:${port}/stream=${encodeURIComponent(sessionId)}`
    : `rtsp://${host}/stream=${encodeURIComponent(sessionId)}`;
}

function bindUdpSocket(socket, port) {
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(port, '0.0.0.0', () => {
      socket.removeListener('error', reject);
      resolve();
    });
  });
}

async function createProbe() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const basePort = 40000 + Math.floor(Math.random() * 10000) * 2;
    const rtpSocket = dgram.createSocket('udp4');
    const rtcpSocket = dgram.createSocket('udp4');

    try {
      await bindUdpSocket(rtpSocket, basePort);
      await bindUdpSocket(rtcpSocket, basePort + 1);
      return {
        rtpSocket,
        rtcpSocket,
        clientPorts: [basePort, basePort + 1],
        latestSignal: null,
        packetCount: 0,
        lastSignalAt: 0
      };
    } catch {
      try { rtpSocket.close(); } catch {}
      try { rtcpSocket.close(); } catch {}
    }
  }

  throw new Error('Unable to allocate RTP probe ports');
}

function closeProbe(probe) {
  if (!probe) return;
  try { probe.rtpSocket.close(); } catch {}
  try { probe.rtcpSocket.close(); } catch {}
}

function parseSes1Signal(packet) {
  const text = packet.toString('latin1');
  const versionIndex = text.indexOf('ver=');
  const tunerIndex = text.indexOf('tuner=');
  if (versionIndex === -1 || tunerIndex === -1) return null;

  const tunerEnd = text.indexOf(';', tunerIndex);
  const tunerText = text.slice(tunerIndex + 6, tunerEnd === -1 ? undefined : tunerEnd);
  const fields = tunerText.split(',');
  if (fields.length < 4) return null;

  const levelRaw = parseInt(fields[1], 10);
  const lockRaw = parseInt(fields[2], 10);
  const qualityRaw = parseInt(fields[3], 10);
  if (!Number.isFinite(levelRaw) || !Number.isFinite(lockRaw) || !Number.isFinite(qualityRaw)) {
    return null;
  }

  return {
    level: Math.round(levelRaw / 255 * 100),
    quality: Math.round(qualityRaw / 15 * 100),
    locked: lockRaw === 1,
    level_raw: levelRaw,
    quality_raw: qualityRaw,
    source: 'rtcp-ses1'
  };
}

function parseRtcpCompoundPacket(message) {
  let offset = 0;

  while (offset + 4 <= message.length) {
    const packetType = message[offset + 1];
    const lengthWords = message.readUInt16BE(offset + 2);
    const packetLength = (lengthWords + 1) * 4;
    if (packetLength <= 0 || offset + packetLength > message.length) break;

    if (packetType === RTCP_APP_PACKET_TYPE && packetLength >= 12) {
      const name = message.subarray(offset + 8, offset + 12).toString('ascii');
      if (name === 'SES1') {
        const signal = parseSes1Signal(message.subarray(offset, offset + packetLength));
        if (signal) return signal;
      }
    }

    offset += packetLength;
  }

  return null;
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
  const probe = await createProbe();

  probe.rtpSocket.on('message', () => {
    probe.packetCount++;
  });

  probe.rtcpSocket.on('message', (message) => {
    probe.packetCount++;
    const signal = parseRtcpCompoundPacket(message);
    if (signal) {
      probe.latestSignal = signal;
      probe.lastSignalAt = Date.now();
    }
  });

  let sessionId = null;
  const resp = await rtspRequest(host, port, 'SETUP', uri, {
    Transport: `RTP/AVP;unicast;client_port=${probe.clientPorts[0]}-${probe.clientPorts[1]}`
  });

  try {
    if (resp.statusCode !== 200) {
      throw new Error(`SETUP failed: ${resp.statusCode} ${resp.statusText}`);
    }
    const sessionHeader = resp.headers['session'] || '';
    sessionId = sessionHeader.split(';')[0].trim();

    const controlUri = buildControlUri(host, port, resp.headers, sessionId);
    await rtspRequest(host, port, 'PLAY', controlUri, { Session: sessionId });

    activeSessions.set(sessionId, {
      host,
      port,
      uri: controlUri,
      tuner: transponder.tuner || 1,
      probe
    });
    return sessionId;
  } catch (err) {
    if (sessionId) {
      try {
        const controlUri = buildControlUri(host, port, resp.headers, sessionId);
        await rtspRequest(host, port, 'TEARDOWN', controlUri, { Session: sessionId });
      } catch {}
    }
    closeProbe(probe);
    throw err;
  }
}

/**
 * Get signal parameters for an active RTSP session.
 */
async function getSignal(host, port, sessionId) {
  port = port || RTSP_DEFAULT_PORT;
  const activeSession = activeSessions.get(sessionId);
  if (activeSession && activeSession.probe && activeSession.probe.latestSignal) {
    return activeSession.probe.latestSignal;
  }

  const body = 'tuner_signal\r\ntuner_quality\r\ntuner_lock\r\n';
  let uri;
  if (activeSession) {
    uri = activeSession.uri;
  } else {
    uri = `rtsp://${host}/stream=${sessionId}`;
  }

  try {
    const resp = await rtspRequest(host, port, 'GET_PARAMETER', uri, {
      Session: sessionId,
      'Content-Type': 'text/parameters',
      'Content-Length': Buffer.byteLength(body)
    }, body);
    if (resp.statusCode === 200) {
      return parseSignalBody(resp.body);
    }
  } catch {}

  if (activeSession && activeSession.probe && activeSession.probe.latestSignal) {
    return activeSession.probe.latestSignal;
  }

  throw new Error('SAT-IP server returned no signal metrics');
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
  let probe = null;
  if (activeSessions.has(sessionId)) {
    const activeSession = activeSessions.get(sessionId);
    uri = activeSession.uri;
    probe = activeSession.probe;
    activeSessions.delete(sessionId);
  } else {
    uri = `rtsp://${host}/stream=${sessionId}`;
  }
  try {
    await rtspRequest(host, port, 'TEARDOWN', uri, { Session: sessionId });
  } catch {
    // Best-effort teardown
  } finally {
    closeProbe(probe);
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

/**
 * Probe a known host directly via TCP to port 554.
 * Used as a fallback for SAT-IP servers that don't respond to SSDP.
 * Returns a server object if the port is reachable, null otherwise.
 */
function probeHost(host, port = 554) {
  if (!host) return Promise.resolve(null);
  port = port || 554;
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: 2000 }, () => {
      socket.destroy();
      resolve({ address: host, location: null, deviceId: null, source: 'probe' });
    });
    socket.on('timeout', () => { socket.destroy(); resolve(null); });
    socket.on('error', () => resolve(null));
  });
}

module.exports = {
  discover,
  probeHost,
  tune,
  getSignal,
  teardown,
  measureSignal,
  activeSessions
};
