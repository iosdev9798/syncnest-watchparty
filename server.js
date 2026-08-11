const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const rooms = new Map();

function rtcConfig() {
  const urls = String(process.env.TURN_URLS || process.env.TURN_URL || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];
  if (urls.length) {
    const server = { urls };
    if (process.env.TURN_USERNAME) server.username = process.env.TURN_USERNAME;
    if (process.env.TURN_CREDENTIAL) server.credential = process.env.TURN_CREDENTIAL;
    iceServers.push(server);
  }
  return { iceServers };
}

function ensureRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      source: null,
      state: 'paused',
      currentTime: 0,
      updatedAt: Date.now(),
      users: new Map(),
      clients: new Map()
    });
  }
  return rooms.get(roomId);
}

function sourceKey(source) {
  if (!source || typeof source !== 'object') return '';
  if (source.type === 'youtube') return `youtube:${cleanText(source.videoId, 50)}`;
  if (source.type === 'local' && source.file) {
    const f = source.file;
    return `local:${cleanText(f.name, 180)}:${Number(f.size) || 0}`;
  }
  return '';
}

function snapshot(room) {
  let t = room.currentTime;
  if (room.state === 'playing') t += (Date.now() - room.updatedAt) / 1000;
  return { source: room.source, state: room.state, currentTime: Math.max(0, t) };
}

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(room, event, data, exceptClientId = '') {
  for (const [clientId, res] of room.clients) {
    if (clientId === exceptClientId) continue;
    try { sendEvent(res, event, data); } catch (_) {}
  }
}

function presence(room) {
  return Array.from(room.users, ([id, user]) => ({
    id,
    name: user.name,
    voice: Boolean(user.voice)
  }));
}

function broadcastPresence(room) {
  broadcast(room, 'presence', presence(room));
}

function cleanText(v, max) {
  return String(v || '').trim().slice(0, max);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 64_000) req.destroy();
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/rtc-config') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(rtcConfig()));
  }

  if (req.method === 'GET' && url.pathname === '/events') {
    const roomId = cleanText(url.searchParams.get('room'), 80);
    const name = cleanText(url.searchParams.get('name'), 30) || 'Guest';
    const clientId = cleanText(url.searchParams.get('client'), 80) || crypto.randomUUID();
    if (!roomId) { res.writeHead(400); return res.end('Missing room'); }

    const room = ensureRoom(roomId);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(': connected\n\n');

    const existingUser = room.users.get(clientId);
    room.clients.set(clientId, res);
    // EventSource reconnects automatically. Preserve the user's voice state
    // instead of silently marking them out of the call on every reconnect.
    room.users.set(clientId, { name, voice: existingUser ? Boolean(existingUser.voice) : false });
    sendEvent(res, 'room-state', snapshot(room));
    broadcastPresence(room);

    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch (_) {}
    }, 20_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      if (room.clients.get(clientId) === res) {
        room.clients.delete(clientId);
        room.users.delete(clientId);
        broadcast(room, 'rtc-peer-left', { clientId });
        broadcastPresence(room);
      }
      if (room.users.size === 0) {
        setTimeout(() => {
          const r = rooms.get(roomId);
          if (r && r.users.size === 0) rooms.delete(roomId);
        }, 60 * 60 * 1000);
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/action') {
    try {
      const body = await readJson(req);
      const roomId = cleanText(body.roomId, 80);
      const clientId = cleanText(body.clientId, 80);
      const name = cleanText(body.name, 30) || 'Guest';
      if (!roomId) { res.writeHead(400); return res.end('Missing room'); }
      const room = ensureRoom(roomId);

      if (body.type === 'load-video') {
        const videoId = cleanText(body.videoId, 50);
        if (videoId) {
          room.source = { type: 'youtube', videoId };
          room.state = 'paused';
          room.currentTime = 0;
          room.updatedAt = Date.now();
          broadcast(room, 'load-media', { source: room.source, by: name });
        }
      }

      if (body.type === 'load-local') {
        const file = body.file && typeof body.file === 'object' ? body.file : {};
        const localFile = {
          name: cleanText(file.name, 180),
          size: Math.max(0, Number(file.size) || 0),
          lastModified: Math.max(0, Number(file.lastModified) || 0),
          mime: cleanText(file.mime, 100)
        };
        if (localFile.name && localFile.size > 0) {
          room.source = { type: 'local', file: localFile };
          room.state = 'paused';
          room.currentTime = 0;
          room.updatedAt = Date.now();
          broadcast(room, 'load-media', { source: room.source, by: name });
        }
      }

      if (body.type === 'player-action') {
        const action = cleanText(body.action, 10);
        const requestedKey = cleanText(body.mediaKey, 300);
        if (requestedKey && requestedKey !== sourceKey(room.source)) {
          res.writeHead(204); return res.end();
        }
        const t = Number.isFinite(Number(body.currentTime)) ? Math.max(0, Number(body.currentTime)) : 0;
        if (action === 'play') room.state = 'playing';
        if (action === 'pause') room.state = 'paused';
        room.currentTime = t;
        room.updatedAt = Date.now();
        broadcast(room, 'player-action', { action, currentTime: t, at: Date.now(), by: name, mediaKey: sourceKey(room.source) }, clientId);
      }

      if (body.type === 'request-sync') {
        const client = room.clients.get(clientId);
        if (client) sendEvent(client, 'room-state', snapshot(room));
      }

      if (body.type === 'voice-status') {
        const user = room.users.get(clientId);
        if (user) {
          user.voice = Boolean(body.active);
          broadcastPresence(room);
        }
      }

      if (body.type === 'rtc-signal') {
        const targetId = cleanText(body.targetId, 80);
        const target = room.clients.get(targetId);
        if (target && body.signal && typeof body.signal === 'object') {
          sendEvent(target, 'rtc-signal', {
            fromId: clientId,
            fromName: name,
            signal: body.signal
          });
        }
      }

      res.writeHead(204); return res.end();
    } catch (_) {
      res.writeHead(400); return res.end('Bad request');
    }
  }

  if (req.method === 'GET') return serveStatic(req, res, url.pathname);
  res.writeHead(405); res.end('Method not allowed');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`SyncNest running on http://localhost:${PORT}`);
});
