// Signalling client, shared by the browser and the participant host (Node 22 has fetch and WebSocket).
// Uses a WebSocket when the server offers one and falls back to long-polling (which is all Vercel can do).
// Messages: { from, to, type, body }. to is a peer id, or '*' for everyone in the meeting.

export class Signal {
  constructor({ base = '', media = '/media', token, cursor = 0, ws = false, onMessage, onGone, onState }) {
    Object.assign(this, { base, media, token, cursor, useWs: ws, onMessage, onGone, onState });
    this.handlers = new Map();
    this.out = [];
    this.closed = false;
    this.mode = null;
    this.flushT = null;
    this.rpcId = 0;
    this.pending = new Map();
  }

  // Messages that arrive before anyone listens for their type (an offer that lands before the media engine
  // exists) are kept for 30 s and handed over when a listener for that type is added.
  on(type, fn) {
    (this.handlers.get(type) ?? this.handlers.set(type, []).get(type)).push(fn);
    const held = (this.early ?? []).filter((m) => m.type === type && Date.now() - m.at < 30000);
    if (held.length) {
      this.early = this.early.filter((m) => m.type !== type);
      queueMicrotask(() => { for (const m of held) { try { fn(m.body, m); } catch (e) { console.error(e); } } });
    }
    return this;
  }

  start() {
    if (this.useWs && typeof WebSocket !== 'undefined') this.openWs();
    else this.pollLoop();
    return this;
  }

  dispatch(msgs) {
    for (const m of msgs) {
      if (m.id > this.cursor) this.cursor = m.id;
      if (m.type === 'gone') { this.close(); this.onGone?.(); return; }
      if (m.type === 'rpc-res' && this.pending.has(m.body?.rid)) {
        const p = this.pending.get(m.body.rid);
        this.pending.delete(m.body.rid);
        clearTimeout(p.t);
        m.body.ok ? p.resolve(m.body.data) : p.reject(Object.assign(new Error(m.body.error ?? 'failed'), { code: m.body.code }));
        continue;
      }
      try { this.onMessage?.(m); } catch (e) { console.error(e); }
      const fns = this.handlers.get(m.type);
      if (!fns?.length) {
        this.early ??= [];
        this.early.push({ ...m, at: Date.now() });
        if (this.early.length > 500) this.early.shift();
        continue;
      }
      for (const fn of [...fns]) {
        try { fn(m.body, m); } catch (e) { console.error(e); }
      }
    }
  }

  openWs() {
    const u = new URL(this.base || (typeof location !== 'undefined' ? location.origin : 'http://localhost'));
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = `${this.media}/ws`;
    u.search = `?token=${encodeURIComponent(this.token)}&since=${this.cursor}`;
    let opened = false;
    const ws = new WebSocket(u.toString());
    this.ws = ws;
    ws.onopen = () => { opened = true; this.mode = 'ws'; this.onState?.('ws'); this.flush(); };
    ws.onmessage = (e) => { const d = JSON.parse(e.data); if (d.msgs) this.dispatch(d.msgs); };
    ws.onclose = () => {
      this.ws = null;
      if (this.closed) return;
      // Never opened: no WebSocket here, poll instead. Dropped: try again shortly.
      if (!opened) { this.useWs = false; this.pollLoop(); } else setTimeout(() => !this.closed && this.openWs(), 500);
    };
    ws.onerror = () => {};
  }

  async pollLoop() {
    this.mode = 'poll';
    this.onState?.('poll');
    let backoff = 250;
    while (!this.closed) {
      try {
        const r = await fetch(`${this.base}${this.media}/signal?since=${this.cursor}&wait=8000`, { headers: { 'x-meet-peer': this.token } });
        if (r.status === 401) { this.close(); this.onGone?.(); return; }
        const d = await r.json();
        if (d.msgs) this.dispatch(d.msgs);
        backoff = 250;
      } catch {
        await new Promise((res) => setTimeout(res, backoff));
        backoff = Math.min(backoff * 2, 4000);
      }
    }
  }

  send(to, type, body) {
    this.out.push({ to, type, body });
    if (!this.flushT) this.flushT = setTimeout(() => this.flush(), 0);
  }

  async flush() {
    clearTimeout(this.flushT);
    this.flushT = null;
    if (!this.out.length || this.closed) return;
    const msgs = this.out.splice(0);
    if (this.ws?.readyState === 1) { this.ws.send(JSON.stringify({ msgs })); return; }
    try {
      await fetch(`${this.base}${this.media}/signal`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-meet-peer': this.token }, body: JSON.stringify({ msgs }) });
    } catch {
      this.out.unshift(...msgs);
      setTimeout(() => this.flush(), 500);
    }
  }

  // Request and reply between peers (browser to participant host, host to host).
  request(to, method, data, timeoutMs = 10000) {
    const rid = `${Date.now().toString(36)}.${++this.rpcId}`;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(rid); reject(Object.assign(new Error(`${method} timed out`), { code: 'timeout' })); }, timeoutMs);
      this.pending.set(rid, { resolve, reject, t, to });
      this.send(to, 'rpc', { rid, method, data });
    });
  }

  // A peer is gone: fail every request waiting on it now, instead of when each times out.
  failTo(peer) {
    for (const [rid, p] of this.pending) {
      if (p.to !== peer) continue;
      this.pending.delete(rid);
      clearTimeout(p.t);
      p.reject(Object.assign(new Error('That computer left the call.'), { code: 'gone' }));
    }
  }

  // Serve requests: fn(method, data, from) returns the reply data or throws.
  serve(fn) {
    this.on('rpc', async (b, m) => {
      try { this.send(m.from, 'rpc-res', { rid: b.rid, ok: true, data: await fn(b.method, b.data, m.from) }); }
      catch (e) { this.send(m.from, 'rpc-res', { rid: b.rid, ok: false, error: e.message, code: e.code }); }
    });
  }

  async post(path, body) {
    const r = await fetch(`${this.base}${path.replace(/^\/media(?=\/)/, this.media)}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-meet-peer': this.token }, body: JSON.stringify(body ?? {}) });
    return r.json();
  }

  close() {
    this.closed = true;
    try { this.ws?.close(); } catch {}
    for (const p of this.pending.values()) { clearTimeout(p.t); p.reject(new Error('closed')); }
    this.pending.clear();
  }
}
