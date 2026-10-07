// The whole server as one request handler, so it runs the same under `node bin/meet.mjs serve` and as a
// Vercel function (api/index.mjs). Routes:
//   /api/tools/<name>   every tool, the only thing screens call
//   /mcp                the same tools over MCP (JSON-RPC over HTTP)
//   /media/*            call signalling (join, long-poll, send) and media tokens; WebSocket at /media/ws
//   /auth/*             GitHub sign-in
//   everything else     the screens (public/)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { tools, byName, catalogue, ToolError } from './tools/meet.mjs';
import { callerFrom, sign, verify, githubLoginRedirect, githubCallback, upsertUser, sessionToken, cookieHeader, safeNext } from './auth.mjs';
import { createRoom } from './room/room.mjs';
import { handleMcp } from './mcp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };

export function createApp({ db, config }) {
  const room = createRoom({ db, config });
  const app = { db, config, room };
  const reports = new Map(); // host peer -> Map(reporter -> time): who said that host is gone

  const baseOf = (req) => config.publicUrl || `${req.headers['x-forwarded-proto'] ?? (req.socket?.encrypted ? 'https' : 'http')}://${req.headers['x-forwarded-host'] ?? req.headers.host}`;

  async function callTool(name, input, caller, base) {
    const t = byName.get(name);
    if (!t) throw new ToolError('unknown_tool', `There is no tool called ${name}.`, 404);
    const ctx = { db, config, room, caller, base };
    return t.handler(ctx, input ?? {});
  }
  app.callTool = callTool;

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const base = baseOf(req);
    try {
      room.reap().catch(() => {});
      if (p === '/healthz') return json(res, 200, { ok: true });
      if (p === '/api/tools' && req.method === 'GET') return json(res, 200, catalogue());
      if (p.startsWith('/api/tools/')) {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: { code: 'method', message: 'Use POST.' } });
        const name = decodeURIComponent(p.slice('/api/tools/'.length));
        const caller = await callerFrom(req, app);
        try {
          const result = await callTool(name, await body(req), caller, base);
          return json(res, 200, { ok: true, result });
        } catch (e) {
          if (e instanceof ToolError) return json(res, e.status, { ok: false, error: { code: e.code, message: e.message } });
          throw e;
        }
      }
      if (p === '/mcp') return handleMcp(req, res, { app, base, body, json });
      if (p.startsWith('/media/')) return media(req, res, p, url, base);
      if (p === '/auth/github') return githubLoginRedirect(res, config, base, url.searchParams.get('next'));
      if (p === '/auth/github/callback') return githubCallback(req, res, app, base);
      if (p === '/auth/dev' && config.devLogin) {
        const login = (url.searchParams.get('login') || 'sam').replace(/[^a-z0-9-]/gi, '').slice(0, 39);
        const user = await upsertUser(db, { login, name: url.searchParams.get('name') || login[0].toUpperCase() + login.slice(1) });
        res.writeHead(302, { 'set-cookie': cookieHeader(sessionToken(config, user), 30 * 86400, base.startsWith('https')), location: safeNext(url.searchParams.get('next')) }).end();
        return;
      }
      if (p === '/auth/signout') {
        res.writeHead(302, { 'set-cookie': cookieHeader('', 0, base.startsWith('https')), location: '/' }).end();
        return;
      }
      return serveStatic(req, res, p);
    } catch (e) {
      console.error(e);
      return json(res, 500, { ok: false, error: { code: 'server', message: 'Something went wrong on the server.' } });
    }
  }

  // ---------- media signalling ----------

  async function peerFrom(req, url) {
    const tok = req.headers['x-meet-peer'] || url.searchParams.get('token');
    const v = verify(config.secret, tok, 'peer');
    if (!v) return null;
    return db.get('SELECT * FROM meet_peers WHERE peer_id = ?', [v.peer]);
  }

  async function media(req, res, p, url, base) {
    if (p === '/media/join' && req.method === 'POST') {
      const b = await body(req);
      let meetingId, participantId = null, kind = 'browser', client = 'browser';
      const ticket = verify(config.secret, b.ticket, 'ticket');
      const hostTok = verify(config.secret, b.host_token, 'hosttoken');
      if (ticket) {
        const part = await db.get('SELECT * FROM meeting_participants WHERE id = ?', [ticket.pid]);
        if (!part || part.status !== 'admitted') return json(res, 403, { ok: false, error: { code: 'not_admitted', message: 'You are not in this meeting yet.' } });
        meetingId = ticket.mid; participantId = part.id;
      } else if (hostTok) {
        meetingId = hostTok.mid; kind = 'host'; client = b.client === 'desktop' ? 'desktop' : 'cli'; participantId = hostTok.by ?? null;
      } else return json(res, 401, { ok: false, error: { code: 'ticket', message: 'Join the meeting first.' } });
      const m = await db.get('SELECT * FROM meetings WHERE id = ?', [meetingId]);
      if (!m || m.status === 'ended') return json(res, 410, { ok: false, error: { code: 'ended', message: 'This meeting has ended.' } });
      // One browser connection per participant: a reload replaces the old one.
      if (kind === 'browser') for (const old of await db.all("SELECT peer_id FROM meet_peers WHERE participant_id = ? AND kind = 'browser'", [participantId])) await room.leave(old.peer_id);
      const { peer, cursor } = await room.join(meetingId, { participantId, kind, client, metrics: b.metrics ?? null });
      const token = sign(config.secret, { k: 'peer', peer, mid: meetingId, exp: Date.now() + 24 * 3600e3 });
      return json(res, 200, { ok: true, peer, token, cursor, plan: await room.currentPlan(meetingId), ws: !config.serverless, room: m.room_name });
    }
    const peer = await peerFrom(req, url);
    if (!peer) return json(res, 401, { ok: false, error: { code: 'gone', message: 'This connection to the call has ended. Rejoin.' } });
    if (p === '/media/signal' && req.method === 'GET') {
      const since = Number(url.searchParams.get('since') ?? 0);
      const wait = Math.min(Number(url.searchParams.get('wait') ?? config.pollMs), config.serverless ? 8000 : 25000);
      let gone = false;
      res.on('close', () => { gone = true; });
      const msgs = await room.poll(peer, since, wait, () => gone);
      return json(res, 200, { ok: true, msgs });
    }
    if (p === '/media/signal' && req.method === 'POST') {
      const b = await body(req);
      const list = Array.isArray(b.msgs) ? b.msgs : [b];
      for (const msg of list) {
        if (!msg?.type || !msg.to) continue;
        await room.send(peer.meeting_id, peer.peer_id, String(msg.to), String(msg.type).slice(0, 40), msg.body ?? null);
      }
      await room.touch(peer.peer_id);
      return json(res, 200, { ok: true });
    }
    if (p === '/media/metrics' && req.method === 'POST') { await room.setMetrics(peer.peer_id, await body(req)); return json(res, 200, { ok: true }); }
    if (p === '/media/drain' && req.method === 'POST') { await room.drain(peer.peer_id); return json(res, 200, { ok: true }); }
    if (p === '/media/leave' && req.method === 'POST') { await room.leave(peer.peer_id); return json(res, 200, { ok: true }); }
    if (p === '/media/speedtest' && req.method === 'POST') {
      let n = 0;
      for await (const c of req) { n += c.length; if (n > 4e6) break; }
      return json(res, 200, { ok: true, bytes: n });
    }
    // A browser lost its host. If that host has also gone quiet here, drop it now instead of waiting.
    // Dropped when it has also gone quiet here for 3 s, or when two different computers in the call say so.
    if (p === '/media/report' && req.method === 'POST') {
      const b = await body(req);
      const h = b.dead && (await db.get("SELECT * FROM meet_peers WHERE peer_id = ? AND meeting_id = ? AND kind = 'host'", [b.dead, peer.meeting_id]));
      if (!h) return json(res, 200, { ok: true, dropped: false });
      const by = reports.get(h.peer_id) ?? new Map();
      by.set(peer.peer_id, Date.now());
      for (const [k, t] of by) if (Date.now() - t > 10000) by.delete(k);
      reports.set(h.peer_id, by);
      const drop = Date.now() - Number(h.last_seen) > 3000 || by.size >= 2;
      if (drop) { reports.delete(h.peer_id); await room.leave(h.peer_id); }
      return json(res, 200, { ok: true, dropped: drop });
    }
    if (p === '/media/plan') return json(res, 200, { ok: true, plan: await room.currentPlan(peer.meeting_id) });
    if (p === '/media/livekit-token' && req.method === 'POST') {
      if (!config.livekit) return json(res, 404, { ok: false, error: { code: 'no_media_server', message: 'No media server is set up.' } });
      const m = await db.get('SELECT * FROM meetings WHERE id = ?', [peer.meeting_id]);
      const part = peer.participant_id ? await db.get('SELECT * FROM meeting_participants WHERE id = ?', [peer.participant_id]) : null;
      const canPublish = !(m.kind === 'webinar' && part?.role === 'viewer');
      const jwt = livekitToken(config.livekit, { identity: peer.peer_id, name: part?.display_name ?? 'Guest', room: m.room_name, canPublish, metadata: JSON.stringify({ pid: part?.id ?? null }) });
      return json(res, 200, { ok: true, url: config.livekit.url, token: jwt });
    }
    return json(res, 404, { ok: false, error: { code: 'not_found', message: 'No such media route.' } });
  }

  // ---------- static ----------

  function serveStatic(req, res, p) {
    let file;
    if (p === '/' || p.startsWith('/m/') || p === '/host' || p === '/parity') file = path.join(PUBLIC, 'index.html');
    else {
      file = path.join(PUBLIC, path.normalize(decodeURIComponent(p)).replace(/^(\.\.[/\\])+/, ''));
      if (!file.startsWith(PUBLIC)) return json(res, 404, { ok: false });
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return json(res, 404, { ok: false, error: { code: 'not_found', message: 'Not found.' } });
      const etag = `"${st.size.toString(36)}-${st.mtimeMs.toString(36)}"`;
      if (req.headers['if-none-match'] === etag) return res.writeHead(304).end();
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', etag, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', ...(file.endsWith('.html') ? { 'permissions-policy': 'camera=(self), microphone=(self), display-capture=(self)' } : {}) });
      fs.createReadStream(file).pipe(res);
    });
  }

  app.handle = handle;
  return app;
}

export function livekitToken(lk, { identity, name, room, canPublish = true, metadata, ttlS = 6 * 3600 }) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const t = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const claims = b64({ iss: lk.key, sub: identity, name, metadata, nbf: t - 10, exp: t + ttlS, video: { room, roomJoin: true, canPublish, canSubscribe: true, canPublishData: true } });
  const mac = crypto.createHmac('sha256', lk.secret).update(`${head}.${claims}`).digest('base64url');
  return `${head}.${claims}.${mac}`;
}

export function json(res, status, obj) {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

export async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > 1e6) throw new ToolError('too_big', 'Request too large.', 413);
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ToolError('bad_json', 'The request body is not valid JSON.', 400); }
}
