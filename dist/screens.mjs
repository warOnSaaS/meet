// wOS Meetings screen part, built from screens/index.mjs by scripts/build-screens.mjs. AGPL-3.0. Do not edit.
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// public/app/api.mjs
function configure({ callTool: fn, media } = {}) {
  if (fn) suiteCall = fn;
  if (media) mediaBase = media;
}
async function callTool(name, input = {}) {
  if (suiteCall) {
    try {
      return await suiteCall(name, input);
    } catch (e) {
      throw new ToolFailed(e.code ?? "server", e.message ?? "Something went wrong.", e.status ?? 0);
    }
  }
  const headers = { "content-type": "application/json" };
  if (ticket) headers["x-meet-ticket"] = ticket;
  let r;
  try {
    r = await fetch(`/api/tools/${name}`, { method: "POST", headers, body: JSON.stringify(input), credentials: "same-origin" });
  } catch {
    throw new ToolFailed("offline", "Could not reach the server. Check your connection.", 0);
  }
  const d = await r.json().catch(() => ({}));
  if (!d.ok) throw new ToolFailed(d.error?.code ?? "server", d.error?.message ?? "Something went wrong.", r.status);
  return d.result;
}
async function mediaJoin(body) {
  const r = await fetch(`${mediaBase}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!d.ok) throw new ToolFailed(d.error?.code ?? "server", d.error?.message ?? "Could not join the call.", r.status);
  return d;
}
var ticket, setTicket, getTicket, suiteCall, mediaBase, getMediaBase, assetUrl, ToolFailed;
var init_api = __esm({
  "public/app/api.mjs"() {
    ticket = null;
    setTicket = (t) => {
      ticket = t;
    };
    getTicket = () => ticket;
    suiteCall = null;
    mediaBase = "/media";
    getMediaBase = () => mediaBase;
    assetUrl = (file) => `${mediaBase}/assets/${file}`;
    ToolFailed = class extends Error {
      constructor(code, message, status) {
        super(message);
        this.code = code;
        this.status = status;
      }
    };
  }
});

// public/app/dom.mjs
function toast(msg, ms = 3200) {
  if (toastFn) return toastFn(msg);
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("is-on");
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove("is-on"), ms);
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    document.body.append(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch {
    }
    ta.remove();
    return false;
  }
}
function fmtWhen(iso) {
  const d = new Date(iso);
  const today = /* @__PURE__ */ new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const tomorrow = new Date(today.getTime() + 864e5).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `today at ${time}`;
  if (tomorrow) return `tomorrow at ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} at ${time}`;
}
var esc, initials, toastT, toastFn, setToast, P, icon;
var init_dom = __esm({
  "public/app/dom.mjs"() {
    esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
    toastFn = null;
    setToast = (fn) => {
      toastFn = fn;
    };
    P = {
      video: '<rect x="3" y="6" width="12" height="12" rx="2.5"/><path d="M15 10.5l6-3.5v10l-6-3.5z"/>',
      mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
      "mic-off": '<path d="M9 9v2a3 3 0 0 0 5 2.2M15 9.3V6a3 3 0 0 0-5.7-1.3M19 11a7 7 0 0 1-1 3.6M5 11a7 7 0 0 0 11.6 5.3M12 18v3M3 3l18 18"/>',
      cam: '<rect x="3" y="6" width="12" height="12" rx="2.5"/><path d="M15 10.5l6-3.5v10l-6-3.5z"/>',
      "cam-off": '<path d="M15 10.5l6-3.5v10l-3-1.7M3 3l18 18M9 6h4a2 2 0 0 1 2 2v4M15 16.5A2 2 0 0 1 13 18H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2"/>',
      screen: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4M9 10.5l3-3 3 3M12 7.5v6"/>',
      hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7h-.5a6 6 0 0 1-4.6-2.2L3.5 17a1.6 1.6 0 0 1 2.4-2.1L8 17"/>',
      chat: '<path d="M4 5h16v11H9l-5 4z"/>',
      people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
      grid: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
      speaker: '<rect x="3" y="3" width="18" height="12" rx="1.5"/><rect x="3" y="17" width="5" height="4" rx="1"/><rect x="9.5" y="17" width="5" height="4" rx="1"/><rect x="16" y="17" width="5" height="4" rx="1"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
      leave: '<path d="M3 15.5c5.5-5 12.5-5 18 0l-2.5 2.5-3-1.5v-3a12 12 0 0 0-7 0v3l-3 1.5z"/>',
      x: '<path d="M6 6l12 12M18 6L6 18"/>',
      lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
      link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
      github: '<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
      more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
      computer: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
      notes: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h5"/>',
      record: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/>',
      board: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M7 13l3-3 2 2 4-4M8 21l4-4 4 4"/>',
      blur: '<circle cx="12" cy="9" r="3.5"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/><path d="M2.5 5.5h2M2.5 10h1.5M19.5 5.5h2M20 10h1.5M2.5 14.5h2M19.5 14.5h2" stroke-dasharray="1 2"/>',
      captions: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M10.5 10.2a2.3 2.3 0 1 0 0 3.6M17 10.2a2.3 2.3 0 1 0 0 3.6"/>',
      download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14"/>'
    };
    icon = (n, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] ?? ""}</svg>`;
  }
});

// public/app/signal.mjs
var Signal;
var init_signal = __esm({
  "public/app/signal.mjs"() {
    Signal = class {
      constructor({ base = "", media = "/media", token, cursor = 0, ws = false, onMessage, onGone, onState }) {
        Object.assign(this, { base, media, token, cursor, useWs: ws, onMessage, onGone, onState });
        this.handlers = /* @__PURE__ */ new Map();
        this.out = [];
        this.closed = false;
        this.mode = null;
        this.flushT = null;
        this.rpcId = 0;
        this.pending = /* @__PURE__ */ new Map();
      }
      // Messages that arrive before anyone listens for their type (an offer that lands before the media engine
      // exists) are kept for 30 s and handed over when a listener for that type is added.
      on(type, fn) {
        (this.handlers.get(type) ?? this.handlers.set(type, []).get(type)).push(fn);
        const held = (this.early ?? []).filter((m) => m.type === type && Date.now() - m.at < 3e4);
        if (held.length) {
          this.early = this.early.filter((m) => m.type !== type);
          queueMicrotask(() => {
            for (const m of held) {
              try {
                fn(m.body, m);
              } catch (e) {
                console.error(e);
              }
            }
          });
        }
        return this;
      }
      start() {
        if (this.useWs && typeof WebSocket !== "undefined") this.openWs();
        else this.pollLoop();
        return this;
      }
      dispatch(msgs) {
        for (const m of msgs) {
          if (m.id > this.cursor) this.cursor = m.id;
          if (m.type === "gone") {
            this.close();
            this.onGone?.();
            return;
          }
          if (m.type === "rpc-res" && this.pending.has(m.body?.rid)) {
            const p = this.pending.get(m.body.rid);
            this.pending.delete(m.body.rid);
            clearTimeout(p.t);
            m.body.ok ? p.resolve(m.body.data) : p.reject(Object.assign(new Error(m.body.error ?? "failed"), { code: m.body.code }));
            continue;
          }
          try {
            this.onMessage?.(m);
          } catch (e) {
            console.error(e);
          }
          const fns = this.handlers.get(m.type);
          if (!fns?.length) {
            this.early ??= [];
            this.early.push({ ...m, at: Date.now() });
            if (this.early.length > 500) this.early.shift();
            continue;
          }
          for (const fn of [...fns]) {
            try {
              fn(m.body, m);
            } catch (e) {
              console.error(e);
            }
          }
        }
      }
      openWs() {
        const u = new URL(this.base || (typeof location !== "undefined" ? location.origin : "http://localhost"));
        u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
        u.pathname = `${this.media}/ws`;
        u.search = `?token=${encodeURIComponent(this.token)}&since=${this.cursor}`;
        let opened = false;
        const ws = new WebSocket(u.toString());
        this.ws = ws;
        ws.onopen = () => {
          opened = true;
          this.mode = "ws";
          this.onState?.("ws");
          this.flush();
        };
        ws.onmessage = (e) => {
          const d = JSON.parse(e.data);
          if (d.msgs) this.dispatch(d.msgs);
        };
        ws.onclose = () => {
          this.ws = null;
          if (this.closed) return;
          if (!opened) {
            this.useWs = false;
            this.pollLoop();
          } else setTimeout(() => !this.closed && this.openWs(), 500);
        };
        ws.onerror = () => {
        };
      }
      async pollLoop() {
        this.mode = "poll";
        this.onState?.("poll");
        let backoff = 250;
        while (!this.closed) {
          try {
            const r = await fetch(`${this.base}${this.media}/signal?since=${this.cursor}&wait=8000`, { headers: { "x-meet-peer": this.token } });
            if (r.status === 401) {
              this.close();
              this.onGone?.();
              return;
            }
            const d = await r.json();
            if (d.msgs) this.dispatch(d.msgs);
            backoff = 250;
          } catch {
            await new Promise((res) => setTimeout(res, backoff));
            backoff = Math.min(backoff * 2, 4e3);
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
        if (this.ws?.readyState === 1) {
          this.ws.send(JSON.stringify({ msgs }));
          return;
        }
        try {
          await fetch(`${this.base}${this.media}/signal`, { method: "POST", headers: { "content-type": "application/json", "x-meet-peer": this.token }, body: JSON.stringify({ msgs }) });
        } catch {
          this.out.unshift(...msgs);
          setTimeout(() => this.flush(), 500);
        }
      }
      // Request and reply between peers (browser to participant host, host to host).
      request(to, method, data, timeoutMs = 1e4) {
        const rid = `${Date.now().toString(36)}.${++this.rpcId}`;
        return new Promise((resolve, reject) => {
          const t = setTimeout(() => {
            this.pending.delete(rid);
            reject(Object.assign(new Error(`${method} timed out`), { code: "timeout" }));
          }, timeoutMs);
          this.pending.set(rid, { resolve, reject, t, to });
          this.send(to, "rpc", { rid, method, data });
        });
      }
      // A peer is gone: fail every request waiting on it now, instead of when each times out.
      failTo(peer) {
        for (const [rid, p] of this.pending) {
          if (p.to !== peer) continue;
          this.pending.delete(rid);
          clearTimeout(p.t);
          p.reject(Object.assign(new Error("That computer left the call."), { code: "gone" }));
        }
      }
      // Serve requests: fn(method, data, from) returns the reply data or throws.
      serve(fn) {
        this.on("rpc", async (b, m) => {
          try {
            this.send(m.from, "rpc-res", { rid: b.rid, ok: true, data: await fn(b.method, b.data, m.from) });
          } catch (e) {
            this.send(m.from, "rpc-res", { rid: b.rid, ok: false, error: e.message, code: e.code });
          }
        });
      }
      async post(path, body) {
        const r = await fetch(`${this.base}${path.replace(/^\/media(?=\/)/, this.media)}`, { method: "POST", headers: { "content-type": "application/json", "x-meet-peer": this.token }, body: JSON.stringify(body ?? {}) });
        return r.json();
      }
      close() {
        this.closed = true;
        try {
          this.ws?.close();
        } catch {
        }
        for (const p of this.pending.values()) {
          clearTimeout(p.t);
          p.reject(new Error("closed"));
        }
        this.pending.clear();
      }
    };
  }
});

// public/app/channel.mjs
async function channelKey(meetingKey) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`wos-meet channel v1:${meetingKey}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
var enc, dec, b64, unb64, SecureChannel;
var init_channel = __esm({
  "public/app/channel.mjs"() {
    enc = new TextEncoder();
    dec = new TextDecoder();
    b64 = (u8) => {
      let s = "";
      for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode(...u8.subarray(i, i + 32768));
      return btoa(s);
    };
    unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    SecureChannel = class {
      constructor(signal, meetingKey) {
        this.signal = signal;
        this.key = channelKey(meetingKey);
        this.handlers = /* @__PURE__ */ new Map();
        this.stats = { sent: 0, received: 0, failed: 0 };
        signal.on("enc", (b, m) => this.receive(b, m));
      }
      on(type, fn) {
        (this.handlers.get(type) ?? this.handlers.set(type, []).get(type)).push(fn);
        return () => this.off(type, fn);
      }
      off(type, fn) {
        const l = this.handlers.get(type);
        if (l) l.splice(l.indexOf(fn) >>> 0, 1);
      }
      /** Send to everyone in the call ('*') or one peer. */
      async send(type, data, to = "*") {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await this.key, enc.encode(JSON.stringify({ t: type, d: data }))));
        this.signal.send(to, "enc", { iv: b64(iv), ct: b64(ct) });
        this.stats.sent++;
      }
      async receive(b, m) {
        let msg;
        try {
          const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(b.iv) }, await this.key, unb64(b.ct));
          msg = JSON.parse(dec.decode(pt));
        } catch {
          this.stats.failed++;
          return;
        }
        this.stats.received++;
        for (const fn of this.handlers.get(msg.t) ?? []) {
          try {
            fn(msg.d, m.from);
          } catch (e) {
            console.error(e);
          }
        }
      }
    };
  }
});

// public/app/notes/transcriber.mjs
async function detectEngine() {
  const forced = store.get("meet:engine");
  if (forced) return forced;
  const mem = navigator.deviceMemory ?? 8;
  if (typeof WebAssembly === "object" && typeof Worker === "function" && mem >= 2) {
    if (navigator.gpu) {
      try {
        if (await navigator.gpu.requestAdapter()) return "whisper-webgpu";
      } catch {
      }
    }
    return "whisper-wasm";
  }
  if (globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition) return "web-speech";
  return "none";
}
function loadWhisper(engine, onProgress) {
  if (workerReady) return workerReady;
  worker = new Worker(assetUrl("whisper-worker.js"), { type: "module" });
  const t0 = performance.now();
  workerReady = new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const d = e.data;
      if (d.op === "progress") {
        whisperStats.progress = d;
        onProgress?.(d);
      }
      if (d.op === "ready") {
        whisperStats.loads++;
        whisperStats.loadMs = Math.round(performance.now() - t0);
        whisperStats.device = d.device;
        whisperStats.model = d.model;
        resolve(d);
      }
      if (d.op === "error" && !d.id) reject(new Error(d.message));
      if (d.id && waiting.has(d.id)) {
        const w = waiting.get(d.id);
        waiting.delete(d.id);
        d.op === "error" ? w.reject(new Error(d.message)) : w.resolve(d);
      }
    };
    worker.onerror = (e) => reject(new Error(e.message || "The speech model could not start."));
  });
  worker.postMessage({ op: "load", model: modelFor(engine), device: engine === "whisper-webgpu" ? "webgpu" : "wasm" });
  return workerReady;
}
async function whisper(audio) {
  await workerReady;
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker.postMessage({ op: "run", id, audio }, [audio.buffer]);
  });
}
function wavBase64(f32) {
  const n = f32.length;
  const buf = new DataView(new ArrayBuffer(44 + n * 2));
  const w = (o, s2) => {
    for (let i = 0; i < s2.length; i++) buf.setUint8(o + i, s2.charCodeAt(i));
  };
  w(0, "RIFF");
  buf.setUint32(4, 36 + n * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  buf.setUint32(16, 16, true);
  buf.setUint16(20, 1, true);
  buf.setUint16(22, 1, true);
  buf.setUint32(24, RATE, true);
  buf.setUint32(28, RATE * 2, true);
  buf.setUint16(32, 2, true);
  buf.setUint16(34, 16, true);
  w(36, "data");
  buf.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) buf.setInt16(44 + i * 2, Math.max(-1, Math.min(1, f32[i])) * 32767, true);
  const u8 = new Uint8Array(buf.buffer);
  let s = "";
  for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode(...u8.subarray(i, i + 32768));
  return btoa(s);
}
var ENGINE_LABEL, store, modelFor, worker, workerReady, seq, waiting, whisperStats, NOISE, WORKLET, RATE, FRAME, Utterances, Transcriber;
var init_transcriber = __esm({
  "public/app/notes/transcriber.mjs"() {
    init_api();
    ENGINE_LABEL = {
      "whisper-webgpu": "Whisper on this device, using its graphics chip",
      "whisper-wasm": "Whisper on this device",
      "web-speech": "Your browser's speech service (Chrome and Safari may send your audio to their servers)",
      none: "This device cannot write down speech, so a helper in the call or the server does it",
      helper: "A helper in the call",
      server: "The team's speech service"
    };
    store = { get: (k) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    } };
    modelFor = (engine) => store.get("meet:whisper-model") || (engine === "whisper-webgpu" ? "onnx-community/whisper-base.en" : "onnx-community/whisper-tiny.en");
    worker = null;
    workerReady = null;
    seq = 0;
    waiting = /* @__PURE__ */ new Map();
    whisperStats = { loads: 0, loadMs: null, runs: 0, totalMs: 0, audioMs: 0, device: null, model: null, progress: null };
    NOISE = /^\s*(\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|you\.?|thank you\.?|thanks for watching!?|\.+)\s*$/i;
    WORKLET = `class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) { for (let i = 0; i < ch.length; i++) { this.buf[this.n++] = ch[i]; if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; } } }
    return true;
  }
}
registerProcessor('meet-tap', Tap);`;
    RATE = 16e3;
    FRAME = 480;
    Utterances = class {
      /** onUtterance({ audio: Float32Array at 16 kHz, start, end, speechEnd }) with times in ms since 1970. */
      constructor(track, { onUtterance, hangMs = 700, maxMs = 15e3, minMs = 350 } = {}) {
        Object.assign(this, { track, onUtterance, hangMs, maxMs, minMs });
        this.level = 0;
      }
      async start() {
        this.ctx = new AudioContext();
        const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
        await this.ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        this.src = this.ctx.createMediaStreamSource(new MediaStream([this.track]));
        this.node = new AudioWorkletNode(this.ctx, "meet-tap");
        const mute = this.ctx.createGain();
        mute.gain.value = 0;
        this.src.connect(this.node).connect(mute).connect(this.ctx.destination);
        this.ratio = this.ctx.sampleRate / RATE;
        this.carry = 0;
        this.pending = new Float32Array(0);
        this.pre = [];
        this.cur = null;
        this.floor = 4e-3;
        this.node.port.onmessage = (e) => this.feed(e.data);
        if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {
        });
      }
      // Down to 16 kHz by averaging (enough for speech), then 30 ms frames. Samples not used yet wait in rest.
      feed(chunk) {
        const input = this.rest?.length ? new Float32Array(this.rest.length + chunk.length) : chunk;
        if (input !== chunk) {
          input.set(this.rest);
          input.set(chunk, this.rest.length);
        }
        const out = [];
        let pos = this.carry;
        while (pos + this.ratio <= input.length) {
          let s = 0;
          const a = Math.floor(pos), b = Math.floor(pos + this.ratio);
          for (let i2 = a; i2 < b; i2++) {
            const x = input[i2];
            if (x === x) s += x;
          }
          out.push(s / Math.max(1, b - a));
          pos += this.ratio;
        }
        const used = Math.floor(pos);
        this.carry = pos - used;
        this.rest = input.slice(used);
        const joined = new Float32Array(this.pending.length + out.length);
        joined.set(this.pending);
        joined.set(out, this.pending.length);
        let i = 0;
        for (; i + FRAME <= joined.length; i += FRAME) this.frame(joined.subarray(i, i + FRAME));
        this.pending = joined.slice(i);
      }
      frame(f) {
        const now = performance.timeOrigin + performance.now();
        let sum = 0;
        for (const v of f) sum += v * v;
        const rms = Number.isFinite(sum) ? Math.sqrt(sum / f.length) : 0;
        this.level = rms;
        this.floor = rms < this.floor ? this.floor * 0.9 + rms * 0.1 : this.floor * 0.999 + rms * 1e-3;
        if (!Number.isFinite(this.floor)) this.floor = 4e-3;
        const loud = rms > Math.max(0.01, this.floor * 3);
        const copy = f.slice(0);
        if (!this.cur) {
          this.pre.push(copy);
          if (this.pre.length > 10) this.pre.shift();
          if (loud) {
            this.cur = { frames: [...this.pre], start: now - this.pre.length * 30, lastLoud: now, loudFrames: 1 };
            this.pre = [];
          }
          return;
        }
        this.cur.frames.push(copy);
        if (loud) {
          this.cur.lastLoud = now;
          this.cur.loudFrames++;
        }
        const len = this.cur.frames.length * 30;
        if (now - this.cur.lastLoud > this.hangMs || len > this.maxMs) this.flush(now);
      }
      flush(now = performance.timeOrigin + performance.now()) {
        const c = this.cur;
        this.cur = null;
        if (!c || c.loudFrames * 30 < this.minMs) return;
        const audio = new Float32Array(c.frames.length * FRAME);
        c.frames.forEach((f, i) => audio.set(f, i * FRAME));
        this.onUtterance?.({ audio, start: c.start, end: now, speechEnd: c.lastLoud });
      }
      stop() {
        this.flush();
        try {
          this.src?.disconnect();
          this.node?.disconnect();
        } catch {
        }
        this.ctx?.close().catch(() => {
        });
      }
    };
    Transcriber = class {
      /**
       * engine: whisper-webgpu | whisper-wasm | web-speech | server
       * onSegment({ id, start_at, end_at, text, engine, speech_end, run_ms })
       * server: async (wavBase64, start, end) => text, for the server fallback.
       */
      constructor({ track, engine, onSegment, onState, server }) {
        Object.assign(this, { track, engine, onSegment, onState, server });
        this.queue = Promise.resolve();
        this.n = 0;
      }
      async start() {
        if (this.engine === "web-speech") return this.startWebSpeech();
        if (this.engine.startsWith("whisper")) {
          this.onState?.("loading");
          await loadWhisper(this.engine, (p) => this.onState?.("loading", p));
        }
        this.cuts = new Utterances(this.track, { onUtterance: (u) => {
          this.queue = this.queue.then(() => this.write(u)).catch((e) => console.warn("[meet] notes", e.message));
        } });
        await this.cuts.start();
        this.onState?.("listening");
      }
      async write(u) {
        if (this.stopped) return;
        const t0 = performance.now();
        let text = "";
        if (this.engine === "server") text = await this.server(wavBase64(u.audio), u.start, u.end);
        else {
          const audioMs = u.audio.length / RATE * 1e3;
          const r = await whisper(u.audio);
          text = r.text;
          whisperStats.runs++;
          whisperStats.totalMs += r.ms;
          whisperStats.audioMs += audioMs;
        }
        text = String(text ?? "").trim();
        if (!text || NOISE.test(text)) return;
        this.onSegment?.({ id: `${this.idBase ??= Math.random().toString(36).slice(2, 8)}-${++this.n}`, start_at: Math.round(u.start), end_at: Math.round(u.end), text, engine: this.engine, speech_end: Math.round(u.speechEnd), run_ms: Math.round(performance.now() - t0) });
      }
      startWebSpeech() {
        const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
        const r = new SR();
        r.continuous = true;
        r.interimResults = false;
        r.lang = navigator.language || "en-US";
        let start = performance.timeOrigin + performance.now();
        r.onspeechstart = () => {
          start = performance.timeOrigin + performance.now();
        };
        r.onresult = (e) => {
          for (let i = e.resultIndex; i < e.results.length; i++) {
            if (!e.results[i].isFinal) continue;
            const end = performance.timeOrigin + performance.now();
            const text = e.results[i][0].transcript.trim();
            if (text) this.onSegment?.({ id: `ws-${++this.n}-${Math.round(end)}`, start_at: Math.round(start), end_at: Math.round(end), text, engine: "web-speech", speech_end: Math.round(end), run_ms: 0 });
            start = end;
          }
        };
        r.onerror = (e) => this.onState?.("error", { message: e.error === "not-allowed" ? "The browser blocked its speech service." : `The browser's speech service stopped (${e.error}).` });
        r.onend = () => {
          if (!this.stopped) try {
            r.start();
          } catch {
          }
        };
        r.start();
        this.sr = r;
        this.onState?.("listening");
      }
      get level() {
        return this.cuts?.level ?? 0;
      }
      stop() {
        this.stopped = true;
        this.cuts?.stop();
        try {
          this.sr?.stop();
        } catch {
        }
      }
    };
  }
});

// public/app/notes.mjs
function plain(n) {
  const out = [n.title ? `Meeting notes: ${n.title}` : "Meeting notes", n.scripted ? "(Demo notes, a script, not AI)" : "", "", n.summary];
  if (n.decisions?.length) out.push("", "Decisions:", ...n.decisions.map((d) => `- ${d}`));
  if (n.action_items?.length) out.push("", "Action items:", ...n.action_items.map((a) => `- ${a.text}${a.owner ? ` (${a.owner})` : ""}`));
  return out.join("\n");
}
var CAPTION_MS, Notes;
var init_notes = __esm({
  "public/app/notes.mjs"() {
    init_api();
    init_dom();
    init_channel();
    init_transcriber();
    CAPTION_MS = 9e3;
    Notes = class {
      constructor(call) {
        this.call = call;
        this.status = null;
        this.timeline = /* @__PURE__ */ new Map();
        this.metrics = [];
        this.notes = null;
        this.captions = true;
        this.own = null;
        this.helping = /* @__PURE__ */ new Map();
        this.state = "off";
        this.engine = null;
      }
      get mid() {
        return this.call.meeting.id;
      }
      async init() {
        this.channel = new SecureChannel(this.call.signal, this.call.media.e2ee_key);
        this.call.channel = this.channel;
        this.channel.on("cap", (seg, from) => this.received(seg, from));
        this.engine = await detectEngine();
        await this.load();
        if (this.status?.on || this.status?.segments) await this.loadTranscript();
      }
      async load() {
        try {
          this.status = await callTool("meet.notes_status", { meeting: this.mid });
        } catch {
          return;
        }
        if (this.status.notes_written_at && (!this.notes || this.notes.written_at !== this.status.notes_written_at)) this.notes = await callTool("meet.get_notes", { meeting: this.mid }).catch(() => this.notes);
        await this.reconcile();
        this.call.render();
      }
      async loadTranscript() {
        const r = await callTool("meet.get_transcript", { meeting: this.mid }).catch(() => null);
        for (const s of r?.segments ?? []) this.add({ ...s, start_at: Date.parse(s.start_at), end_at: Date.parse(s.end_at), name: s.speaker, pid: s.participant });
      }
      get mine() {
        return this.status?.you;
      }
      // Start or stop the transcribers this device should run, from the latest status.
      async reconcile() {
        const s = this.status;
        const on = !!s?.on;
        const want = on && this.mine?.answer === "include" && this.call.audioOn && this.call.local.mic && this.call.canPublish();
        const by = this.mine?.written_by;
        const ownEngine = by === "self" ? this.engine : by === "server" ? "server" : null;
        if (on && this.mine?.answer === "pending" && !this.asked) this.ask();
        if (!want || !ownEngine) {
          this.own?.stop();
          this.own = null;
        } else if (!this.own || this.own.track !== this.call.local.mic || this.own.engine !== ownEngine) {
          this.own?.stop();
          this.own = this.makeTranscriber(this.call.local.mic, ownEngine, { pid: this.call.me.id, name: this.call.me.display_name });
        }
        const helpFor = new Set(on && /^whisper/.test(this.engine) ? s.helping : []);
        for (const [pid, t] of this.helping) if (!helpFor.has(pid) || t.track !== this.call.remoteFor(pid, "mic")) {
          t.stop();
          this.helping.delete(pid);
        }
        for (const pid of helpFor) {
          if (this.helping.has(pid)) continue;
          const track = this.call.remoteFor(pid, "mic");
          const person = s.people.find((p) => p.participant === pid);
          if (track && person) this.helping.set(pid, this.makeTranscriber(track, this.engine, { pid, name: person.name, helper: true }));
        }
        this.state = !on ? "off" : this.own?.state ?? (this.mine?.answer === "exclude" ? "excluded" : this.mine?.answer === "pending" ? "asking" : !this.call.audioOn ? "muted" : "waiting");
      }
      makeTranscriber(track, engine, who) {
        const t = new Transcriber({
          track,
          engine,
          server: async (wav, start, end) => (await callTool("meet.transcribe_audio", { meeting: this.mid, audio_base64: wav, start_at: String(Math.round(start)), end_at: String(Math.round(end)) })).text,
          onState: (st, p) => {
            t.state = st;
            if (!who.helper) {
              this.state = st;
              this.progress = p;
            }
            if (st === "error") toast(p?.message ?? "Notes stopped on this device.");
            this.call.render();
          },
          onSegment: (seg) => this.spoke(seg, who, engine === "server")
        });
        t.start().catch((e) => {
          t.state = "error";
          this.state = "error";
          toast(e.message);
          this.call.render();
        });
        return t;
      }
      // A line this device wrote down: show it, send it to the others encrypted, and keep it with the meeting.
      async spoke(seg, who, savedByServer) {
        const line = { ...seg, pid: who.pid, name: who.name };
        this.add(line);
        this.channel.send("cap", line).catch(() => {
        });
        if (!savedByServer) {
          await callTool("meet.add_transcript", { meeting: this.mid, segments: [{ id: seg.id, participant: who.pid, start_at: String(seg.start_at), end_at: String(seg.end_at), text: seg.text, engine: seg.engine }] }).catch((e) => console.warn("[meet] transcript", e.message));
        }
      }
      received(seg, from) {
        if (!seg?.id || this.timeline.has(seg.id)) return;
        this.metrics.push({ id: seg.id, from, pid: seg.pid, speech_end: seg.speech_end, arrived: Math.round(performance.timeOrigin + performance.now()), run_ms: seg.run_ms });
        this.add(seg);
      }
      add(seg) {
        if (this.timeline.has(seg.id)) return;
        this.timeline.set(seg.id, seg);
        this.call.render();
      }
      lines() {
        return [...this.timeline.values()].sort((a, b) => a.start_at - b.start_at);
      }
      ask() {
        this.asked = true;
        this.shownAt = (/* @__PURE__ */ new Date()).toISOString();
        const d = this.call.root.querySelector("#notesdlg");
        if (!d) return;
        d.innerHTML = `<h3>Notes are on</h3>
      <p>${esc(this.status.started_by ?? "The host")} turned on AI notes. If you agree, your device writes down what you say, and your words are kept with this meeting so the team gets a summary and action items.</p>
      <p class="ui-mute">Your device does it with ${esc(ENGINE_LABEL[this.engine] ?? this.engine).replace(/^./, (c) => c.toLowerCase())}. You can change your answer any time, or leave the call.</p>
      <div class="ui-dialog-a"><button class="ui-btn is-ghost" data-tool="meet.answer_notes" data-act="notes-out">Leave my voice out</button><button class="ui-btn is-accent" data-tool="meet.answer_notes" data-act="notes-in">Include my voice</button></div>`;
        if (!d.open) try {
          d.showModal();
        } catch {
          d.setAttribute("open", "");
        }
      }
      async answer(include) {
        const d = this.call.root.querySelector("#notesdlg");
        if (d?.open) d.close();
        await callTool("meet.answer_notes", { meeting: this.mid, include, engine: this.engine, ...this.shownAt ? { shown_at: this.shownAt } : {} });
        toast(include ? "Your voice is in the notes." : "Your voice is left out of the notes.");
        await this.load();
      }
      // ------------------------------------------------------------ drawing
      marker() {
        if (!this.status?.on) return "";
        return `<span class="ui-chip is-soft meet-notes-on" title="Notes are on: words of people who agreed are written down"><span class="ui-dot is-bad"></span> Notes on</span>`;
      }
      captionsHtml() {
        if (!this.status?.on && !this.timeline.size) return "";
        if (!this.captions) return "";
        const now = Date.now();
        const recent = this.lines().filter((s) => now - s.end_at < CAPTION_MS).slice(-3);
        if (!recent.length) return "";
        return `<div class="meet-captions" aria-live="polite">${recent.map((s) => `<p><b>${esc(s.name)}</b> ${esc(s.text)}</p>`).join("")}</div>`;
      }
      panelHtml() {
        const s = this.status;
        const host = this.call.amHost();
        if (!s) return '<p class="ui-empty">Loading notes\u2026</p>';
        const mine = s.you;
        const stateWord = { loading: `Loading the speech model${this.progress?.total ? ` (${Math.round(this.progress.loaded / this.progress.total * 100)}%)` : ""}\u2026`, listening: "Listening", muted: "Paused while you are muted", excluded: "Your voice is left out", asking: "Waiting for your answer", waiting: "Starting\u2026", error: "Stopped on this device", off: "" }[this.state] ?? "";
        const writtenBy = mine?.written_by === "self" ? ENGINE_LABEL[this.engine] : mine?.written_by === "server" ? ENGINE_LABEL.server : mine?.written_by?.startsWith("helper:") ? `${ENGINE_LABEL.helper}: ${esc(s.people.find((p) => `helper:${p.participant}` === mine.written_by)?.name ?? "someone")}` : mine?.answer === "include" ? "Nobody can yet: this device cannot, and there is no helper or speech service" : "";
        const head = s.on ? `<div class="meet-notes-h"><span class="ui-dot is-bad"></span><span><b>Notes are on</b><br><span class="ui-mute">Turned on by ${esc(s.started_by ?? "the host")}. Only people who agreed are written down.</span></span></div>` : `<div class="meet-notes-h"><span class="ui-dot"></span><span><b>Notes are off</b><br><span class="ui-mute">${host ? "Turn them on and everyone is asked first. Each person's own device writes down their words." : "The host can turn on AI notes. You will be asked first."}</span></span></div>`;
        const hostA = host ? `<p class="meet-side-a">${s.on ? '<button class="ui-btn is-quiet is-sm" data-tool="meet.stop_notes" data-act="notes-stop">Turn notes off</button>' : '<button class="ui-btn is-accent is-sm" data-tool="meet.start_notes" data-act="notes-start">Turn notes on</button>'}</p>` : "";
        const me = s.on && mine ? `<h3 class="meet-side-sub">Your voice</h3>
      <div class="meet-notes-me"><span>${mine.answer === "include" ? "Included" : mine.answer === "exclude" ? "Left out" : "Not answered yet"}${stateWord ? ` \xB7 ${esc(stateWord)}` : ""}</span>
      ${mine.answer === "include" ? '<button class="ui-btn is-ghost is-sm" data-tool="meet.answer_notes" data-act="notes-out">Leave my voice out</button>' : '<button class="ui-btn is-ghost is-sm" data-tool="meet.answer_notes" data-act="notes-in">Include my voice</button>'}</div>
      ${writtenBy ? `<p class="ui-hint">Written down by: ${writtenBy}</p>` : ""}` : "";
        const people = s.on ? `<h3 class="meet-side-sub">Everyone</h3><ul class="meet-plist">${s.people.map((p) => `<li class="meet-nrow"><span>${esc(p.name)}</span><span class="ui-chip ${p.answer === "include" ? "is-good" : "is-outline"}">${p.answer === "include" ? "Included" : p.answer === "exclude" ? "Left out" : "Asked"}</span></li>`).join("")}</ul>` : "";
        const lines = this.lines();
        const transcript = lines.length ? `<h3 class="meet-side-sub">Transcript <span class="ui-badge is-quiet">${lines.length}</span></h3><ol class="meet-transcript">${lines.map((l) => `<li><span class="meet-tr-h"><b>${esc(l.name)}</b> <time class="ui-mute">${new Date(l.start_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</time></span><span>${esc(l.text)}</span></li>`).join("")}</ol>` : s.on ? '<p class="ui-empty">Nothing said yet. Lines show here a moment after someone stops talking.</p>' : "";
        const n = this.notes?.summary ? this.notes : null;
        const notes = n ? `<h3 class="meet-side-sub">Notes ${n.scripted ? '<span class="ui-chip is-outline">Demo notes (a script, not AI)</span>' : `<span class="ui-chip is-outline">${esc(n.model)}</span>`}</h3>
      <div class="meet-notes-b"><p>${esc(n.summary)}</p>
      ${n.decisions.length ? `<p class="ui-label">Decisions</p><ul>${n.decisions.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}
      ${n.action_items.length ? `<p class="ui-label">Action items</p><ul>${n.action_items.map((a) => `<li>${esc(a.text)}${a.owner || a.due ? ` <span class="ui-mute">(${esc([a.owner, a.due].filter(Boolean).join(", "))})</span>` : ""}</li>`).join("")}</ul>` : ""}</div>` : "";
        const canWrite = lines.length || s.segments;
        const del = host && s.segments ? '<button class="ui-btn is-ghost is-sm is-danger" data-tool="meet.delete_transcript" data-act="notes-delete">Delete transcript and notes</button>' : "";
        const write = canWrite ? `<p class="meet-side-a"><button class="ui-btn is-quiet is-sm" data-tool="meet.summarise" data-act="notes-write">${n ? "Write the notes again" : "Write notes now"}</button>${n ? '<button class="ui-btn is-ghost is-sm" data-tool="meet.get_notes" data-act="notes-copy">Copy notes</button>' : ""}</p>${!s.model.ready ? '<p class="ui-hint">No model is set up, so a short script writes demo notes. Set a model in Settings to have AI write them.</p>' : ""}` : "";
        const linked = this.call.meeting.linked_record ?? "";
        const send = n ? s.in_suite ? `<h3 class="meet-side-sub">Send the notes</h3><div class="meet-send">
        <form data-tool="meet.notes_to_crm" data-act="send-crm"><label class="ui-sr" for="n-crm">CRM record</label><input class="ui-input" id="n-crm" name="record" placeholder="crm:deal:Acme Dental" value="${esc(linked.startsWith("crm:") ? linked : "")}"><button class="ui-btn is-sm" type="submit" data-tool="meet.notes_to_crm">Save to CRM</button></form>
        <form data-tool="meet.notes_to_board" data-act="send-board"><label class="ui-sr" for="n-board">Board client</label><input class="ui-input" id="n-board" name="client" placeholder="Client on the board"><button class="ui-btn is-sm" type="submit" data-tool="meet.notes_to_board">Add tasks</button></form>
        <form data-tool="meet.notes_to_chat" data-act="send-chat"><label class="ui-sr" for="n-chat">Chat channel</label><input class="ui-input" id="n-chat" name="channel" placeholder="general" value="${esc(linked.startsWith("chat:") ? linked.split(":").pop() : "")}"><button class="ui-btn is-sm" type="submit" data-tool="meet.notes_to_chat">Post in Chat</button></form>
        <p><button class="ui-btn is-sm" data-tool="meet.notes_to_email" data-act="send-email">Email everyone on the team who joined</button></p>
      </div>` : '<p class="ui-hint">Inside wOS, the notes go to the CRM, the board, Chat and email in one click.</p>' : "";
        return `${head}${hostA}${me}${notes}${write}${send}${transcript}${people}${del ? `<p class="meet-side-a">${del}</p>` : ""}`;
      }
      async onAct(a, el) {
        const mid = this.mid;
        if (a === "notes-start") {
          await callTool("meet.start_notes", { meeting: mid });
          toast("Notes are on. Everyone is asked first.");
          return this.load();
        }
        if (a === "notes-stop") {
          await callTool("meet.stop_notes", { meeting: mid });
          return this.load();
        }
        if (a === "notes-in") return this.answer(true);
        if (a === "notes-out") return this.answer(false);
        if (a === "notes-write") {
          toast("Writing the notes\u2026");
          this.notes = await callTool("meet.summarise", { meeting: mid });
          if (this.notes.warning) toast(this.notes.warning);
          return this.call.render();
        }
        if (a === "notes-delete") {
          if (!confirm("Delete this meeting's transcript and notes for everyone? This cannot be undone.")) return;
          await callTool("meet.delete_transcript", { meeting: mid });
          this.timeline.clear();
          this.notes = null;
          toast("Transcript and notes deleted");
          return this.load();
        }
        if (a === "notes-copy") {
          const n = await callTool("meet.get_notes", { meeting: mid });
          await copyText(plain(n));
          return toast("Notes copied");
        }
        if (a === "send-email") {
          const r = await callTool("meet.notes_to_email", { meeting: mid });
          return toast(`Emailed ${r.to.length} ${r.to.length === 1 ? "person" : "people"}`);
        }
        if (a === "captions") {
          this.captions = !this.captions;
          return this.call.render();
        }
      }
      async onSubmit(form) {
        const f = new FormData(form);
        const mid = this.mid;
        const act = form.dataset.act;
        if (act === "send-crm") {
          const r = await callTool("meet.notes_to_crm", { meeting: mid, record: String(f.get("record") || "").trim() || "linked" });
          toast(`Saved to ${r.to}`);
        }
        if (act === "send-board") {
          const r = await callTool("meet.notes_to_board", { meeting: mid, client: String(f.get("client") || "").trim() || void 0 });
          toast(r.sent ? `Added ${r.tasks.length} ${r.tasks.length === 1 ? "task" : "tasks"} for ${r.client}` : r.message);
        }
        if (act === "send-chat") {
          const r = await callTool("meet.notes_to_chat", { meeting: mid, channel: String(f.get("channel") || "").trim() || void 0 });
          toast(`Posted in ${r.channel}`);
        }
      }
      // For tests and the report.
      snapshot() {
        return { state: this.state, engine: this.engine, status: this.status, lines: this.lines(), metrics: this.metrics, whisper: { ...whisperStats }, channel: this.channel?.stats, notes: this.notes };
      }
      stop() {
        this.own?.stop();
        for (const t of this.helping.values()) t.stop();
        this.helping.clear();
      }
    };
  }
});

// public/app/record.mjs
var W, H, FPS, TYPES, Recording, fmtDur, Compositor;
var init_record = __esm({
  "public/app/record.mjs"() {
    init_api();
    init_dom();
    W = 1280;
    H = 720;
    FPS = 24;
    TYPES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4;codecs=avc1,mp4a", "video/mp4"];
    Recording = class {
      constructor(call) {
        this.call = call;
        this.status = null;
        this.rec = null;
        this.done = null;
      }
      get mid() {
        return this.call.meeting.id;
      }
      async load() {
        try {
          this.status = await callTool("meet.recording_status", { meeting: this.mid });
        } catch {
          return;
        }
        this.reconcile();
        this.call.render();
      }
      reconcile() {
        const s = this.status;
        const live = s && ["asking", "recording"].includes(s.state);
        if (live && s.you?.answer === "pending" && this.asked !== s.recording) this.ask();
        if (!live) this.closeAsk();
        const iRecord = live && s.state === "recording" && s.you?.recorder;
        if (iRecord && !this.rec) this.start();
        if (this.rec) this.rec.include(new Set(s?.included ?? []));
        if (this.rec && (!s || s.state !== "recording" || s.recording !== this.rec.id)) this.finish();
      }
      ask() {
        this.asked = this.status.recording;
        this.shownAt = (/* @__PURE__ */ new Date()).toISOString();
        const d = this.call.root.querySelector("#recdlg");
        if (!d) return;
        d.innerHTML = `<h3>Record this call?</h3>
      <p>${esc(this.status.started_by ?? "The host")} wants to record this call: the video and sound of everyone who agrees. Anyone who says no is left out of the picture and the sound.</p>
      <p class="ui-mute">You can change your answer while it records, turn your camera or microphone off, or leave.</p>
      <div class="ui-dialog-a"><button class="ui-btn is-ghost" data-tool="meet.answer_recording" data-act="rec-no">Leave me out</button><button class="ui-btn is-accent" data-tool="meet.answer_recording" data-act="rec-yes">Record me</button></div>`;
        if (!d.open) try {
          d.showModal();
        } catch {
          d.setAttribute("open", "");
        }
      }
      closeAsk() {
        const d = this.call.root.querySelector("#recdlg");
        if (d?.open) d.close();
      }
      async answer(agree) {
        this.closeAsk();
        this.status = await callTool("meet.answer_recording", { meeting: this.mid, agree, ...this.shownAt ? { shown_at: this.shownAt } : {} });
        toast(agree ? "You are in the recording." : "You are left out of the recording.");
        this.reconcile();
        this.call.render();
      }
      start() {
        try {
          this.rec = new Compositor(this.call, this.status.recording);
          this.rec.include(new Set(this.status.included));
          this.rec.start();
        } catch (e) {
          this.rec = null;
          toast(`This browser cannot record: ${e.message}`);
        }
      }
      async finish() {
        const r = this.rec;
        this.rec = null;
        this.done = await r.stop();
        this.call.render();
      }
      marker() {
        const s = this.status;
        if (!s || !["asking", "recording"].includes(s.state)) return "";
        return s.state === "recording" ? '<span class="ui-chip is-bad meet-rec-on" title="This call is being recorded"><span class="ui-dot is-bad"></span> Recording</span>' : '<span class="ui-chip is-soft meet-rec-on" title="Everyone is being asked about recording"><span class="ui-dot is-warn"></span> Asking to record</span>';
      }
      moreItems() {
        if (!this.call.amHost()) return [];
        const live = ["asking", "recording"].includes(this.status?.state);
        return [live ? ["rec-stop", "meet.stop_recording", "Stop recording", "record"] : ["rec-start", "meet.start_recording", "Record the call", "record"]];
      }
      notice() {
        if (!this.done) return "";
        const mb = (this.done.blob.size / 1e6).toFixed(1);
        return `<div class="ui-notice"><span>Your recording is ready: ${mb} MB, ${fmtDur(this.done.duration_s)}. Save it before you leave.</span>
      <button class="ui-btn is-accent is-sm" data-tool="meet.save_recording" data-act="rec-download">${icon("download", 16)} Download</button>
      ${this.status?.storage_ready ? '<button class="ui-btn is-sm" data-tool="meet.recording_upload_url" data-act="rec-upload">Save to team storage</button>' : ""}</div>`;
      }
      infoRow() {
        const s = this.status;
        if (!s || s.state === "off") return "Off. Recording starts only after everyone in the call is asked, and leaves out anyone who says no.";
        const yes = s.people.filter((p) => p.answer === "agree").length, no3 = s.people.filter((p) => p.answer === "decline").length, wait = s.people.filter((p) => p.answer === "pending" && p.in_call).length;
        if (s.state === "asking") return `Asking everyone: ${yes} agreed, ${no3} said no, ${wait} still deciding.`;
        if (s.state === "recording") return `Recording ${yes} ${yes === 1 ? "person" : "people"}${no3 ? `, ${no3} left out` : ""}${wait ? `, ${wait} still deciding (left out until they agree)` : ""}.`;
        if (s.saved) return `Last recording saved to ${s.saved.where === "disk" ? "a disk" : "team storage"} (${(s.saved.size_bytes / 1e6).toFixed(1)} MB).`;
        return "Stopped.";
      }
      async onAct(a) {
        const mid = this.mid;
        if (a === "rec-start") {
          this.status = await callTool("meet.start_recording", { meeting: mid });
          toast("Asking everyone first. Recording starts when they have answered.");
          this.reconcile();
          return this.call.render();
        }
        if (a === "rec-stop") {
          await callTool("meet.stop_recording", { meeting: mid });
          return this.load();
        }
        if (a === "rec-yes") return this.answer(true);
        if (a === "rec-no") return this.answer(false);
        if (a === "rec-download" && this.done) {
          const d = this.done;
          const ext = /mp4/.test(d.mime) ? "mp4" : "webm";
          const url = URL.createObjectURL(d.blob);
          const el = Object.assign(document.createElement("a"), { href: url, download: `${this.call.meeting.title.replace(/[^\w -]+/g, "").trim() || "meeting"} ${(/* @__PURE__ */ new Date()).toISOString().slice(0, 16).replace("T", " ").replace(":", ".")}.${ext}` });
          document.body.append(el);
          el.click();
          el.remove();
          setTimeout(() => URL.revokeObjectURL(url), 6e4);
          await callTool("meet.save_recording", { meeting: mid, recording: d.recording, where: "disk", size_bytes: d.blob.size, duration_s: d.duration_s, mime: d.mime });
          this.done = null;
          toast("Saved to your downloads");
          return this.load();
        }
        if (a === "rec-upload" && this.done) {
          const d = this.done;
          toast("Uploading\u2026");
          const u = await callTool("meet.recording_upload_url", { meeting: mid, recording: d.recording, mime: d.mime });
          const r = await fetch(u.url, { method: u.method, headers: u.headers, body: d.blob });
          if (!r.ok) throw new Error(`The storage refused the upload (${r.status}). Download it instead.`);
          await callTool("meet.save_recording", { meeting: mid, recording: d.recording, where: "storage", size_bytes: d.blob.size, duration_s: d.duration_s, mime: d.mime });
          this.done = null;
          toast("Saved to team storage");
          return this.load();
        }
      }
      snapshot() {
        return { status: this.status, recording: !!this.rec, included: this.rec ? [...this.rec.included] : null, frames: this.rec?.frames ?? 0, done: this.done ? { size: this.done.blob.size, mime: this.done.mime, duration_s: this.done.duration_s } : null };
      }
      stop() {
        if (this.rec) this.rec.stop().catch(() => {
        });
      }
    };
    fmtDur = (s) => s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
    Compositor = class {
      constructor(call, id) {
        this.call = call;
        this.id = id;
        this.included = /* @__PURE__ */ new Set();
        this.videos = /* @__PURE__ */ new Map();
        this.sources = /* @__PURE__ */ new Map();
        this.frames = 0;
        const mime = TYPES.find((t) => globalThis.MediaRecorder?.isTypeSupported?.(t));
        if (!mime || !HTMLCanvasElement.prototype.captureStream) throw new Error("no MediaRecorder or canvas capture");
        this.mime = mime.split(";")[0];
        this.canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
        this.g = this.canvas.getContext("2d");
        this.ac = new AudioContext();
        this.dest = this.ac.createMediaStreamDestination();
        const quiet = this.ac.createConstantSource();
        const g0 = this.ac.createGain();
        g0.gain.value = 0;
        quiet.connect(g0).connect(this.dest);
        quiet.start();
        const stream = new MediaStream([this.canvas.captureStream(FPS).getVideoTracks()[0], this.dest.stream.getAudioTracks()[0]]);
        this.mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 25e5 });
        this.chunks = [];
        this.mr.ondataavailable = (e) => {
          if (e.data.size) this.chunks.push(e.data);
        };
      }
      include(set) {
        this.included = set;
        this.syncAudio();
      }
      start() {
        this.t0 = performance.now();
        this.mr.start(1e3);
        if (this.ac.state === "suspended") this.ac.resume().catch(() => {
        });
        this.timer = setInterval(() => this.draw(), 1e3 / FPS);
      }
      // Who is in the picture: everyone included who is in the call, their camera and any screen they share.
      tracks() {
        const c = this.call;
        const out = [];
        for (const p of c.people) {
          if (!this.included.has(p.id) || !(p.in_call || p.id === c.me.id)) continue;
          const mine = p.id === c.me.id;
          const cam = mine ? c.videoOn ? c.camTrack() : null : p.video_on ? c.remoteFor(p.id, "cam") : null;
          const screen = mine ? c.local.screen : p.sharing ? c.remoteFor(p.id, "screen") : null;
          const mic = mine ? c.audioOn ? c.local.mic : null : c.remoteFor(p.id, "mic");
          out.push({ p, cam, screen, mic, mine });
        }
        return out;
      }
      syncAudio() {
        const want = new Map(this.tracks().filter((x) => x.mic && x.mic.readyState === "live").map((x) => [x.mic.id, x.mic]));
        for (const [id, node] of this.sources) if (!want.has(id)) {
          node.disconnect();
          this.sources.delete(id);
        }
        for (const [id, t] of want) if (!this.sources.has(id)) {
          const n = this.ac.createMediaStreamSource(new MediaStream([t]));
          n.connect(this.dest);
          this.sources.set(id, n);
        }
      }
      video(track) {
        let v = this.videos.get(track.id);
        if (!v) {
          v = Object.assign(document.createElement("video"), { muted: true, playsInline: true, autoplay: true });
          v.srcObject = new MediaStream([track]);
          v.play().catch(() => {
          });
          this.videos.set(track.id, v);
        }
        return v;
      }
      draw() {
        const g = this.g;
        g.fillStyle = "#111113";
        g.fillRect(0, 0, W, H);
        const list = this.tracks();
        if (this.frames % FPS === 0) this.syncAudio();
        const share = list.find((x) => x.screen);
        const tiles = list.map((x) => ({ ...x, track: x.cam }));
        let area = { x: 0, y: 0, w: W, h: H };
        if (share) {
          this.fit(this.video(share.screen), 0, 0, W, H - 150, true);
          area = { x: 0, y: H - 140, w: W, h: 140 };
        }
        const n = Math.max(1, tiles.length);
        const cols = share ? n : Math.ceil(Math.sqrt(n));
        const rows = share ? 1 : Math.ceil(n / cols);
        const gap = 8, tw = (area.w - gap * (cols + 1)) / cols, th = (area.h - gap * (rows + 1)) / rows;
        tiles.forEach((t, i) => {
          const x = area.x + gap + i % cols * (tw + gap), y = area.y + gap + Math.floor(i / cols) * (th + gap);
          g.fillStyle = "#222226";
          g.fillRect(x, y, tw, th);
          if (t.track && t.track.readyState === "live") this.fit(this.video(t.track), x, y, tw, th, false);
          else {
            g.fillStyle = "#e8e8ea";
            g.font = `600 ${Math.round(Math.min(tw, th) / 4)}px system-ui, sans-serif`;
            g.textAlign = "center";
            g.textBaseline = "middle";
            g.fillText(initials(t.p.display_name), x + tw / 2, y + th / 2);
          }
          g.font = "500 18px system-ui, sans-serif";
          g.textAlign = "left";
          g.textBaseline = "alphabetic";
          const label = t.p.display_name;
          const lw = g.measureText(label).width + 16;
          g.fillStyle = "rgba(0,0,0,.6)";
          g.fillRect(x + 8, y + th - 34, lw, 26);
          g.fillStyle = "#fff";
          g.fillText(label, x + 16, y + th - 15);
        });
        if (!tiles.length) {
          g.fillStyle = "#a1a1aa";
          g.font = "500 24px system-ui, sans-serif";
          g.textAlign = "center";
          g.fillText("Nobody in the call has agreed to be recorded yet", W / 2, H / 2);
        }
        this.frames++;
      }
      // Cover (cameras) or contain (screens) the box with the video.
      fit(v, x, y, w, h, contain, mirror) {
        if (!v.videoWidth) return;
        const r = v.videoWidth / v.videoHeight, br = w / h;
        let sw = v.videoWidth, sh = v.videoHeight, sx = 0, sy = 0, dx = x, dy = y, dw = w, dh = h;
        if (contain) {
          if (r > br) {
            dh = w / r;
            dy = y + (h - dh) / 2;
          } else {
            dw = h * r;
            dx = x + (w - dw) / 2;
          }
        } else if (r > br) {
          sw = sh * br;
          sx = (v.videoWidth - sw) / 2;
        } else {
          sh = sw / br;
          sy = (v.videoHeight - sh) / 2;
        }
        const g = this.g;
        if (mirror) {
          g.save();
          g.translate(dx + dw, dy);
          g.scale(-1, 1);
          g.drawImage(v, sx, sy, sw, sh, 0, 0, dw, dh);
          g.restore();
        } else g.drawImage(v, sx, sy, sw, sh, dx, dy, dw, dh);
      }
      async stop() {
        clearInterval(this.timer);
        const done = new Promise((res) => {
          this.mr.onstop = res;
        });
        if (this.mr.state !== "inactive") this.mr.stop();
        await done;
        for (const v of this.videos.values()) v.srcObject = null;
        this.ac.close().catch(() => {
        });
        return { blob: new Blob(this.chunks, { type: this.mime }), mime: this.mime, duration_s: Math.round((performance.now() - this.t0) / 1e3), recording: this.id };
      }
    };
  }
});

// public/app/board.mjs
function lib() {
  if (!libP) {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = assetUrl("wb/whiteboard.css");
    document.head.append(css);
    libP = import(
      /* @vite-ignore */
      assetUrl("wb/whiteboard.js")
    );
  }
  return libP;
}
var b642, unb642, libP, Whiteboard;
var init_board = __esm({
  "public/app/board.mjs"() {
    init_api();
    init_dom();
    b642 = (u8) => {
      let s = "";
      for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode(...u8.subarray(i, i + 32768));
      return btoa(s);
    };
    unb642 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    libP = null;
    Whiteboard = class {
      constructor(call) {
        this.call = call;
        this.status = null;
        this.hidden = false;
        this.stats = { sent: 0, received: 0, saves: 0 };
      }
      get mid() {
        return this.call.meeting.id;
      }
      async load() {
        try {
          this.status = await callTool("meet.get_whiteboard", { meeting: this.mid });
        } catch {
          return;
        }
        if (this.status.open && !this.hidden) await this.show();
        if (!this.status.open) this.hide(true);
        this.call.render();
      }
      async show() {
        if (this.el) {
          this.el.hidden = false;
          return;
        }
        const stage = this.call.root.querySelector("#stage");
        this.el = document.createElement("div");
        this.el.className = "meet-wb";
        this.el.innerHTML = `<div class="meet-wb-h"><b class="meet-wb-t"></b><div class="meet-wb-a" id="wba"></div></div><div class="meet-wb-c" id="wbc"><p class="ui-empty">Loading the whiteboard\u2026</p></div>`;
        stage.append(this.el);
        this.el.addEventListener("click", (e) => this.onClick(e));
        this.el.addEventListener("submit", (e) => this.onSubmit(e));
        this.renderHead();
        const L = await lib();
        this.L = L;
        this.doc = new L.Y.Doc();
        this.map = this.doc.getMap("elements");
        const full = await callTool("meet.get_whiteboard", { meeting: this.mid, full: true }).catch(() => null);
        if (full?.state) L.Y.applyUpdate(this.doc, unb642(full.state), "remote");
        else if (full?.elements?.length) this.doc.transact(() => {
          for (const e of full.elements) this.map.set(e.id, e);
        }, "remote");
        const ch = this.call.channel;
        this.offs = [
          ch.on("wb", (u) => {
            this.stats.received++;
            L.Y.applyUpdate(this.doc, unb642(u), "remote");
          }),
          // Someone just opened the board: send them what they are missing.
          ch.on("wb-hello", (sv, from) => ch.send("wb", b642(L.Y.encodeStateAsUpdate(this.doc, unb642(sv))), from))
        ];
        this.doc.on("update", (u, origin) => {
          if (origin === "local") {
            this.stats.sent++;
            ch.send("wb", b642(u)).catch(() => {
            });
            this.saveSoon();
          }
        });
        this.map.observe((e) => {
          if (e.transaction.origin !== "local") this.toScene();
        });
        ch.send("wb-hello", b642(L.Y.encodeStateVector(this.doc))).catch(() => {
        });
        const host = this.el.querySelector("#wbc");
        host.innerHTML = "";
        const tag = () => {
          for (const el of host.querySelectorAll("button:not([data-tool]), [role=menuitem]:not([data-tool]), label:has(> input[type=radio]):not([data-tool])")) {
            el.dataset.tool = "none";
            el.dataset.why = "draws on the whiteboard on this screen; the board is saved with meet.save_whiteboard, which agents use to draw";
          }
        };
        this.mo = new MutationObserver(tag);
        this.mo.observe(host, { childList: true, subtree: true });
        this.root = L.createRoot(host);
        const dark = matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light";
        this.root.render(L.React.createElement(L.Excalidraw, {
          excalidrawAPI: (api) => {
            this.api = api;
            this.toScene();
          },
          initialData: { elements: this.elements(), appState: { viewBackgroundColor: dark ? "#121214" : "#ffffff" } },
          theme: dark ? "dark" : "light",
          onChange: (els) => this.fromScene(els),
          UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false } }
        }));
      }
      elements() {
        return [...this.map?.values() ?? []].sort((a, b) => a.index < b.index ? -1 : a.index > b.index ? 1 : 0);
      }
      // Drawing on this screen: every element whose version moved goes into the shared document.
      fromScene(els) {
        if (this.applying || !this.map) return;
        this.doc.transact(() => {
          for (const el of els) {
            const cur = this.map.get(el.id);
            if (!cur || cur.version < el.version || cur.version === el.version && cur.versionNonce !== el.versionNonce && el.versionNonce < cur.versionNonce) this.map.set(el.id, JSON.parse(JSON.stringify(el)));
          }
        }, "local");
      }
      // Drawing from the others: put the merged document on screen.
      toScene() {
        if (!this.api) return;
        this.applying = true;
        try {
          this.api.updateScene({ elements: this.elements() });
        } finally {
          this.applying = false;
        }
      }
      saveSoon() {
        clearTimeout(this.saveT);
        this.saveT = setTimeout(() => this.save().catch((e) => console.warn("[meet] board save", e.message)), 2500);
      }
      async pictures() {
        const els = this.elements().filter((e) => !e.isDeleted);
        const appState = { exportBackground: true, viewBackgroundColor: "#ffffff", exportWithDarkMode: false };
        const files = this.api?.getFiles?.() ?? null;
        const svg = els.length ? (await this.L.exportToSvg({ elements: els, appState, files })).outerHTML : "";
        let png = "";
        if (els.length) {
          const blob = await this.L.exportToBlob({ elements: els, appState, files, mimeType: "image/png" });
          if (blob.size < 15e5) png = b642(new Uint8Array(await blob.arrayBuffer()));
        }
        return { els, svg, png };
      }
      async save() {
        if (!this.doc) return;
        const { els, svg, png } = await this.pictures();
        await callTool("meet.save_whiteboard", { meeting: this.mid, state: b642(this.L.Y.encodeStateAsUpdate(this.doc)), elements: els, svg, ...png ? { png_base64: png } : {} });
        this.stats.saves++;
      }
      hide(gone = false) {
        if (gone) {
          this.hidden = false;
          this.teardown();
          return;
        }
        this.hidden = true;
        if (this.el) this.el.hidden = true;
        this.call.render();
      }
      teardown() {
        clearTimeout(this.saveT);
        this.mo?.disconnect();
        for (const off of this.offs ?? []) off();
        this.offs = null;
        try {
          this.root?.unmount();
        } catch {
        }
        this.root = null;
        this.api = null;
        this.doc?.destroy();
        this.doc = null;
        this.map = null;
        this.el?.remove();
        this.el = null;
      }
      renderHead() {
        if (!this.el) return;
        const s = this.status;
        this.el.querySelector(".meet-wb-t").textContent = s?.title ?? "Whiteboard";
        const canClose = this.call.amHost() || s?.opened_by === this.call.me.display_name;
        const inSuite = !!this.call.notes?.status?.in_suite;
        const html = `<button class="ui-btn is-quiet is-sm" data-tool="meet.export_whiteboard" data-act="wb-png">${icon("download", 16)} PNG</button>
      <button class="ui-btn is-quiet is-sm" data-tool="meet.export_whiteboard" data-act="wb-svg">${icon("download", 16)} SVG</button>
      ${inSuite ? `<form class="meet-wb-att" data-tool="meet.attach_whiteboard" data-act="wb-attach"><label class="ui-sr" for="wbto">Attach to</label><input class="ui-input" id="wbto" name="to" placeholder="crm:deal:Acme Dental or board:task:7"><button class="ui-btn is-sm" type="submit" data-tool="meet.attach_whiteboard">Attach</button></form>` : ""}
      <button class="ui-btn is-ghost is-sm" data-tool="none" data-why="hides the whiteboard on this screen only" data-act="wb-hide">Hide</button>
      ${canClose ? '<button class="ui-btn is-ghost is-sm" data-tool="meet.close_whiteboard" data-act="wb-close">Close for everyone</button>' : ""}`;
        const a = this.el.querySelector("#wba");
        if (a.dataset.html !== html) {
          a.innerHTML = html;
          a.dataset.html = html;
        }
      }
      moreItems() {
        if (this.status?.open && !this.hidden) return [];
        return [this.status?.open ? ["wb-show", "none", "Show the whiteboard", "board", "shows the whiteboard on this screen again"] : ["wb-open", "meet.open_whiteboard", "Whiteboard", "board"]];
      }
      async onAct(a) {
        if (a === "wb-open") {
          this.hidden = false;
          this.status = await callTool("meet.open_whiteboard", { meeting: this.mid });
          await this.show();
          return this.call.render();
        }
        if (a === "wb-show") {
          this.hidden = false;
          await this.show();
          return this.call.render();
        }
        if (a === "wb-hide") return this.hide();
        if (a === "wb-close") {
          await this.save().catch(() => {
          });
          await callTool("meet.close_whiteboard", { meeting: this.mid });
          return this.load();
        }
        if (a === "wb-png" || a === "wb-svg") {
          await this.save();
          const format = a === "wb-png" ? "png" : "svg";
          const r = await callTool("meet.export_whiteboard", { meeting: this.mid, format });
          const blob = format === "png" ? new Blob([unb642(r.png_base64)], { type: r.mime }) : new Blob([r.svg], { type: r.mime });
          const url = URL.createObjectURL(blob);
          const link = Object.assign(document.createElement("a"), { href: url, download: r.file_name.replace(/[^\w .-]+/g, "") });
          document.body.append(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 6e4);
        }
      }
      async onClick(e) {
        const b = e.target.closest("button[data-act]");
        if (!b || b.closest("form")) return;
        b.disabled = true;
        try {
          await this.onAct(b.dataset.act);
        } catch (err) {
          toast(err.message);
        } finally {
          b.disabled = false;
        }
      }
      async onSubmit(e) {
        if (e.target.dataset.act !== "wb-attach") return;
        e.preventDefault();
        const to = String(new FormData(e.target).get("to") || "").trim();
        if (!to) return;
        try {
          await this.save();
          const r = await callTool("meet.attach_whiteboard", { meeting: this.mid, to });
          toast(`Attached to ${r.attached}`);
        } catch (err) {
          toast(err.message);
        }
      }
      snapshot() {
        return { open: !!this.status?.open, shown: !!this.el && !this.el.hidden, elements: this.elements().filter((e) => !e.isDeleted).length, stats: this.stats };
      }
      stop() {
        this.teardown();
      }
    };
  }
});

// public/app/media/p2p.mjs
var p2p_exports = {};
__export(p2p_exports, {
  P2PEngine: () => P2PEngine,
  SOURCES: () => SOURCES
});
var SOURCES, P2PEngine;
var init_p2p = __esm({
  "public/app/media/p2p.mjs"() {
    SOURCES = ["mic", "cam", "screen"];
    P2PEngine = class {
      constructor({ signal, me, local, ice, canPublish = true, onTrack, onTrackGone, onPeerState }) {
        Object.assign(this, { signal, me, local, ice, canPublish, onTrack, onTrackGone, onPeerState });
        this.kind = "p2p";
        this.pcs = /* @__PURE__ */ new Map();
        this.off = [];
        this.chain = Promise.resolve();
        const h = (b, m) => {
          this.chain = this.chain.then(() => this.onSignal(m.from, b)).catch((e) => console.warn("[meet] p2p", e.message));
        };
        signal.on("p2p", h);
        this.handler = h;
      }
      isOfferer(other) {
        return this.me < other;
      }
      async update(peers) {
        this.want = new Set(peers.filter((p) => p !== this.me));
        for (const [p, c] of this.pcs) if (!this.want.has(p)) this.drop(p, c);
        for (const p of this.want) if (!this.pcs.has(p) && this.isOfferer(p)) await this.connect(p);
      }
      makePc(peer) {
        const pc = new RTCPeerConnection({ iceServers: this.ice, bundlePolicy: "max-bundle" });
        const c = { pc, peer, pendingIce: [], restarts: 0, tracks: /* @__PURE__ */ new Map(), state: "connecting" };
        pc.onicecandidate = (e) => e.candidate && this.signal.send(peer, "p2p", { ice: e.candidate.toJSON() });
        pc.ontrack = (e) => {
          const source = SOURCES[this.slotOf(pc, e.transceiver)] ?? "cam";
          c.tracks.set(source, e.track);
          this.onTrack?.({ peer, source, track: e.track, receiver: e.receiver });
        };
        pc.oniceconnectionstatechange = () => this.watch(c);
        pc.onconnectionstatechange = () => this.watch(c);
        this.pcs.set(peer, c);
        return c;
      }
      slotOf(pc, t) {
        const list = pc.getTransceivers().slice().sort((a, b) => Number(a.mid) - Number(b.mid));
        return list.indexOf(t);
      }
      watch(c) {
        const s = c.pc.connectionState;
        const state2 = s === "connected" ? "connected" : s === "failed" ? "failed" : s === "disconnected" ? "unstable" : "connecting";
        if (state2 !== c.state) {
          c.state = state2;
          this.onPeerState?.(c.peer, state2, this.reasonFor(c));
        }
        if (s === "failed" && this.isOfferer(c.peer) && c.restarts < 3) {
          c.restarts++;
          this.offer(c, true).catch(() => {
          });
        }
      }
      reasonFor(c) {
        if (c.state !== "failed") return null;
        const turn = this.ice.some((s) => [].concat(s.urls).some((u) => /^turns?:/.test(u)));
        return turn ? "The connection failed even through the relay server." : "A firewall on one side blocks direct calls. A relay (TURN) server would fix this; an admin can add one.";
      }
      async connect(peer) {
        const c = this.makePc(peer);
        for (const kind of ["audio", "video", "video"]) c.pc.addTransceiver(kind, { direction: "sendrecv" });
        await this.fillSlots(c);
        await this.offer(c, false);
      }
      async offer(c, restart) {
        const offer = await c.pc.createOffer(restart ? { iceRestart: true } : void 0);
        await c.pc.setLocalDescription(offer);
        this.signal.send(c.peer, "p2p", { sdp: c.pc.localDescription.toJSON() });
      }
      async fillSlots(c) {
        const list = c.pc.getTransceivers().slice().sort((a, b) => Number(a.mid ?? 99) - Number(b.mid ?? 99));
        for (let i = 0; i < SOURCES.length; i++) {
          const t = list[i];
          if (!t) continue;
          t.direction = "sendrecv";
          await t.sender.replaceTrack(this.canPublish ? this.local[SOURCES[i]] ?? null : null);
          if (SOURCES[i] === "cam") this.tune(t.sender, "cam");
        }
      }
      async tune(sender, source) {
        try {
          const p = sender.getParameters();
          if (!p.encodings?.length) return;
          const n = Math.max(1, this.want?.size ?? 1);
          p.encodings[0].maxBitrate = source === "screen" ? 2e6 : n <= 1 ? 15e5 : 7e5;
          await sender.setParameters(p);
        } catch {
        }
      }
      async onSignal(from, b) {
        let c = this.pcs.get(from);
        if (b.sdp) {
          if (b.sdp.type === "offer") {
            if (!c) c = this.makePc(from);
            await c.pc.setRemoteDescription(b.sdp);
            await this.fillSlots(c);
            const ans = await c.pc.createAnswer();
            await c.pc.setLocalDescription(ans);
            this.signal.send(from, "p2p", { sdp: c.pc.localDescription.toJSON() });
          } else if (c) {
            await c.pc.setRemoteDescription(b.sdp);
          }
          if (c) for (const cand of c.pendingIce.splice(0)) await c.pc.addIceCandidate(cand).catch(() => {
          });
        } else if (b.ice) {
          if (!c || !c.pc.remoteDescription) {
            if (!c) {
              c = this.makePc(from);
            }
            c.pendingIce.push(b.ice);
          } else await c.pc.addIceCandidate(b.ice).catch(() => {
          });
        }
      }
      // A webinar viewer sends nothing; when the host lets them speak, their tracks go into the slots.
      async setCanPublish(on) {
        if (on === this.canPublish) return;
        this.canPublish = on;
        for (const c of this.pcs.values()) await this.fillSlots(c);
      }
      async setTrack(source, track) {
        this.local[source] = track;
        if (!this.canPublish) return;
        const i = SOURCES.indexOf(source);
        for (const c of this.pcs.values()) {
          const t = c.pc.getTransceivers().slice().sort((a, b) => Number(a.mid) - Number(b.mid))[i];
          if (t) {
            await t.sender.replaceTrack(track ?? null).catch(() => {
            });
            if (track) this.tune(t.sender, source);
          }
        }
      }
      drop(peer, c) {
        for (const source of c.tracks.keys()) this.onTrackGone?.({ peer, source });
        c.pc.close();
        this.pcs.delete(peer);
      }
      async stats() {
        const out = {};
        for (const [peer, c] of this.pcs) {
          const r = await c.pc.getStats();
          let rtt = null, inBytes = 0, outBytes = 0, relay = false;
          r.forEach((s) => {
            if (s.type === "candidate-pair" && s.nominated && s.state === "succeeded") {
              rtt = s.currentRoundTripTime;
              const lc = r.get(s.localCandidateId);
              relay = lc?.candidateType === "relay";
            }
            if (s.type === "inbound-rtp") inBytes += s.bytesReceived ?? 0;
            if (s.type === "outbound-rtp") outBytes += s.bytesSent ?? 0;
          });
          out[peer] = { state: c.state, rtt, inBytes, outBytes, relay };
        }
        return out;
      }
      async stop() {
        for (const [p, c] of this.pcs) this.drop(p, c);
        const list = this.signal.handlers.get("p2p");
        if (list) list.splice(list.indexOf(this.handler), 1);
      }
    };
  }
});

// meet-stub:./media/sfu.mjs
var sfu_exports = {};
__export(sfu_exports, {
  LiveKitEngine: () => LiveKitEngine,
  SfuEngine: () => SfuEngine
});
var no, SfuEngine, LiveKitEngine;
var init_sfu = __esm({
  "meet-stub:./media/sfu.mjs"() {
    no = () => {
      throw new Error("Calls of more than 4 people are not available inside wOS yet. Open the Meetings site for bigger calls.");
    };
    SfuEngine = class {
      constructor() {
        no();
      }
    };
    LiveKitEngine = class {
      constructor() {
        no();
      }
    };
  }
});

// meet-stub:./media/livekit.mjs
var livekit_exports = {};
__export(livekit_exports, {
  LiveKitEngine: () => LiveKitEngine2,
  SfuEngine: () => SfuEngine2
});
var no2, SfuEngine2, LiveKitEngine2;
var init_livekit = __esm({
  "meet-stub:./media/livekit.mjs"() {
    no2 = () => {
      throw new Error("Calls of more than 4 people are not available inside wOS yet. Open the Meetings site for bigger calls.");
    };
    SfuEngine2 = class {
      constructor() {
        no2();
      }
    };
    LiveKitEngine2 = class {
      constructor() {
        no2();
      }
    };
  }
});

// public/app/blur.mjs
var blur_exports = {};
__export(blur_exports, {
  Blur: () => Blur
});
async function segmenter(cpuOnly = false) {
  if (cpuOnly) segP = null;
  if (!segP) segP = (async () => {
    const { FilesetResolver, ImageSegmenter, WASM, MODEL } = await import(
      /* @vite-ignore */
      assetUrl("blur.js")
    );
    const files = await FilesetResolver.forVisionTasks(WASM);
    const make = (delegate) => ImageSegmenter.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: "VIDEO", outputConfidenceMasks: true, outputCategoryMask: false });
    let forced = null;
    try {
      forced = localStorage.getItem("meet:blur-delegate");
    } catch {
    }
    if (forced === "CPU" || cpuOnly) return { seg: await make("CPU"), delegate: "CPU" };
    try {
      return { seg: await make("GPU"), delegate: "GPU" };
    } catch {
      return { seg: await make("CPU"), delegate: "CPU" };
    }
  })();
  return segP;
}
var FPS2, segP, Blur;
var init_blur = __esm({
  "public/app/blur.mjs"() {
    init_api();
    FPS2 = 24;
    segP = null;
    Blur = class _Blur {
      static async create(camera, { amount = 24 } = {}) {
        const b = new _Blur(camera, amount);
        await b.start();
        return b;
      }
      constructor(camera, amount) {
        this.camera = camera;
        this.amount = amount;
        this.stats = { frames: 0, masks: 0, ms: 0, delegate: null };
      }
      async start() {
        const s = this.camera.getSettings();
        const w = s.width || 640, h = s.height || 360;
        this.video = Object.assign(document.createElement("video"), { muted: true, playsInline: true, autoplay: true });
        this.video.srcObject = new MediaStream([this.camera]);
        await this.video.play().catch(() => {
        });
        this.out = Object.assign(document.createElement("canvas"), { width: w, height: h });
        this.person = Object.assign(document.createElement("canvas"), { width: w, height: h });
        this.maskC = document.createElement("canvas");
        this.small = Object.assign(document.createElement("canvas"), { width: 256, height: Math.round(256 * h / w) });
        this.sg = this.small.getContext("2d");
        this.bg = Object.assign(document.createElement("canvas"), { width: 320, height: Math.round(320 * h / w) });
        this.bgg = this.bg.getContext("2d");
        this.g = this.out.getContext("2d");
        this.pg = this.person.getContext("2d");
        this.mg = this.maskC.getContext("2d", { willReadFrequently: true });
        const { seg, delegate } = await segmenter();
        this.seg = seg;
        this.stats.delegate = delegate;
        this.track = this.out.captureStream(FPS2).getVideoTracks()[0];
        this.track.contentHint = "motion";
        this.timer = setInterval(() => this.frame(), 1e3 / FPS2);
      }
      frame() {
        const v = this.video;
        if (!v.videoWidth || this.busy) return;
        const { width: W2, height: H2 } = this.out;
        this.busy = true;
        const t0 = performance.now();
        try {
          this.sg.drawImage(v, 0, 0, this.small.width, this.small.height);
          this.seg.segmentForVideo(this.small, t0, (r) => {
            const m = r.confidenceMasks?.[0];
            if (!m) return;
            if (this.maskC.width !== m.width || this.maskC.height !== m.height) {
              this.maskC.width = m.width;
              this.maskC.height = m.height;
              this.img = this.mg.createImageData(m.width, m.height);
            }
            const p = m.getAsFloat32Array();
            const d = this.img.data;
            for (let i = 0; i < p.length; i++) {
              d[i * 4 + 3] = Math.min(255, Math.max(0, (p[i] - 0.25) * 2 * 255));
            }
            this.mg.putImageData(this.img, 0, 0);
            this.stats.masks++;
          });
        } catch (e) {
          this.error = e.message;
        }
        this.bgg.filter = `blur(${Math.max(2, Math.round(this.amount * this.bg.width / W2))}px)`;
        this.bgg.drawImage(v, 0, 0, this.bg.width, this.bg.height);
        this.g.imageSmoothingQuality = "high";
        this.g.drawImage(this.bg, 0, 0, W2, H2);
        if (this.stats.masks) {
          this.pg.globalCompositeOperation = "copy";
          this.pg.drawImage(v, 0, 0, W2, H2);
          this.pg.globalCompositeOperation = "destination-in";
          this.pg.drawImage(this.maskC, 0, 0, W2, H2);
          this.g.drawImage(this.person, 0, 0);
        }
        this.stats.frames++;
        this.stats.ms += performance.now() - t0;
        this.busy = false;
        if (this.stats.frames === 12 && this.stats.delegate === "GPU" && this.stats.ms / 12 > 60 && !this.switching) {
          this.switching = true;
          segmenter(true).then(({ seg, delegate }) => {
            this.seg = seg;
            this.stats = { frames: 0, masks: 0, ms: 0, delegate, switched: true };
          }).catch(() => {
          });
        }
      }
      stop() {
        clearInterval(this.timer);
        this.track?.stop();
        if (this.video) this.video.srcObject = null;
      }
    };
  }
});

// public/app/call.mjs
var call_exports = {};
__export(call_exports, {
  Call: () => Call,
  VIEWER_DELAY_MS: () => VIEWER_DELAY_MS
});
function modeLabel(plan, engine) {
  if (!plan) return "Connecting\u2026";
  if (plan.mode === "p2p") return "Direct connection";
  if (plan.mode === "capped") return engine ? "Direct connection" : "Call is full";
  if (plan.mode === "hosts") return `Carried by ${plan.hosts.length} ${plan.hosts.length === 1 ? "computer" : "computers"} \xB7 encrypted`;
  if (plan.mode === "livekit") return "Media server";
  return "";
}
var bgPref, SPEAK_LEVEL, VIEWER_DELAY_MS, Call, linkify;
var init_call = __esm({
  "public/app/call.mjs"() {
    init_api();
    init_signal();
    init_dom();
    init_notes();
    init_record();
    init_board();
    bgPref = { get: () => {
      try {
        return localStorage.getItem("meet:background") || "none";
      } catch {
        return "none";
      }
    }, set: (v) => {
      try {
        localStorage.setItem("meet:background", v);
      } catch {
      }
    } };
    SPEAK_LEVEL = 0.03;
    VIEWER_DELAY_MS = 2e3;
    Call = class {
      constructor({ root, meeting, participant, media, local, prefs, onExit }) {
        Object.assign(this, { root, meeting, me: participant, media, onExit });
        this.local = { mic: local.mic ?? null, cam: local.cam ?? null, screen: null };
        this.audioOn = !!prefs.audio && !!this.local.mic;
        this.videoOn = !!prefs.video && !!this.local.cam;
        this.people = [];
        this.waiting = 0;
        this.remote = /* @__PURE__ */ new Map();
        this.levels = /* @__PURE__ */ new Map();
        this.peerTrouble = /* @__PURE__ */ new Map();
        this.layout = participant.layout ?? "grid";
        this.panel = null;
        this.chat = [];
        this.chatSeen = 0;
        this.requests = [];
        this.tiles = /* @__PURE__ */ new Map();
        this.audios = /* @__PURE__ */ new Map();
        this.timings = { t0: performance.now() };
      }
      // ------------------------------------------------------------ start and stop
      async start() {
        this.renderFrame();
        if (this.local.mic) this.local.mic.enabled = this.audioOn;
        if (!this.videoOn && this.local.cam) {
          this.local.cam.stop();
          this.local.cam = null;
        }
        callTool("meet.set_my_media", { meeting: this.meeting.id, audio: this.audioOn, video: this.videoOn }).catch(() => {
        });
        const j = await mediaJoin({ ticket: getTicket() });
        this.peer = j.peer;
        this.signal = new Signal({ media: getMediaBase(), token: j.token, cursor: j.cursor, ws: j.ws, onGone: () => this.gone(), onState: (s) => {
          this.signalMode = s;
        } });
        this.signal.on("plan", (p) => this.applyPlan(p));
        this.signal.on("changed", (b) => this.onChanged(b));
        this.signal.on("cmd", (b) => this.onCmd(b));
        this.signal.on("ended", (b) => this.exit(`The meeting was ended by ${b?.by ?? "the host"}.`, true));
        this.signal.on("peer-left", (b) => {
          this.peerTrouble.delete(b.peer);
          this.render();
        });
        this.signal.start();
        if (j.plan) await this.applyPlan(j.plan);
        await Promise.all([this.loadPeople(), this.loadChat(), this.loadStatus()]);
        this.notes = new Notes(this);
        await this.notes.init().catch((e) => console.warn("[meet] notes", e.message));
        this.recording = new Recording(this);
        await this.recording.load();
        this.whiteboard = new Whiteboard(this);
        await this.whiteboard.load();
        if (bgPref.get() === "blur" && this.local.cam) this.setBackground("blur", true).catch(() => {
        });
        this.levelT = setInterval(() => this.pollLevels(), 250);
        this.statT = setInterval(() => this.refreshTrouble(), 3e3);
        window.addEventListener("pagehide", this.onHide = () => {
          navigator.sendBeacon?.(`${getMediaBase()}/leave?token=` + encodeURIComponent(j.token));
        });
        this.timings.joined = performance.now();
      }
      async stopMedia() {
        clearInterval(this.levelT);
        clearInterval(this.statT);
        this.notes?.stop();
        this.recording?.stop();
        this.whiteboard?.stop();
        this.blur?.stop();
        if (this.onHide) window.removeEventListener("pagehide", this.onHide);
        this.ro?.disconnect();
        await this.engine?.stop().catch(() => {
        });
        this.engine = null;
        for (const t of [this.local.mic, this.local.cam, this.local.screen]) t?.stop();
        for (const a of this.audios.values()) {
          a.srcObject = null;
          a.remove();
        }
        this.signal?.close();
        this.audioCtx?.close().catch(() => {
        });
      }
      async leave() {
        if ((this.recording?.rec || this.recording?.done) && !confirm("Your recording is not saved yet. Leave anyway and lose it?")) return;
        this.leaving = true;
        await callTool("meet.leave", { meeting: this.meeting.id }).catch(() => {
        });
        await this.exit("You left the meeting.");
      }
      async exit(message) {
        if (this.exited) return;
        this.exited = true;
        await this.stopMedia();
        this.onExit?.(message);
      }
      gone() {
        if (!this.exited) this.exit(this.removed ? "The host removed you from this meeting." : "You were disconnected from the call.");
      }
      // ------------------------------------------------------------ the plan and engines
      async applyPlan(plan) {
        if (!plan || this.plan && plan.version <= this.plan.version) return;
        const before = Object.keys(this.plan?.peers ?? {}).sort().join();
        this.plan = plan;
        if (Object.keys(plan.peers ?? {}).sort().join() !== before) this.onChanged({ what: "participants" });
        const mode = plan.mode;
        let want = null;
        if ((mode === "p2p" || mode === "capped") && plan.p2p.includes(this.peer)) want = "p2p";
        else if (mode === "hosts" && plan.assign?.[this.peer]) want = "hosts";
        else if (mode === "livekit") want = "livekit";
        const canPublish = this.canPublish();
        if (this.engine && this.engine.kind !== want) {
          await this.engine.stop().catch(() => {
          });
          this.engine = null;
          for (const k of [...this.remote.keys()]) this.trackGone(k);
        }
        if (want && !this.engine) {
          const cbs = {
            signal: this.signal,
            me: this.peer,
            local: { ...this.local, cam: this.camTrack() },
            ice: this.media.ice_servers,
            e2eeKey: this.media.e2ee_key,
            canPublish,
            onTrack: (x) => this.onTrack(x),
            onTrackGone: (x) => this.trackGone(`${x.peer}:${x.source}`),
            onPeerState: (peer, s, reason) => {
              if (s === "failed") this.peerTrouble.set(peer, reason);
              else this.peerTrouble.delete(peer);
              this.render();
            },
            onEvent: (ev, d) => this.onEngineEvent(ev, d)
          };
          if (want === "p2p") {
            const { P2PEngine: P2PEngine2 } = await Promise.resolve().then(() => (init_p2p(), p2p_exports));
            this.engine = new P2PEngine2(cbs);
          }
          if (want === "hosts") {
            const { SfuEngine: SfuEngine3 } = await Promise.resolve().then(() => (init_sfu(), sfu_exports));
            this.engine = new SfuEngine3(cbs);
          }
          if (want === "livekit") {
            const { LiveKitEngine: LiveKitEngine3 } = await Promise.resolve().then(() => (init_livekit(), livekit_exports));
            this.engine = new LiveKitEngine3(cbs);
          }
        }
        try {
          const isViewer = (p) => this.meeting.kind === "webinar" && plan.peers?.[p]?.role === "viewer";
          if (want === "p2p") await this.engine.update(plan.p2p.filter((p) => p === this.peer || !(isViewer(p) && isViewer(this.peer))));
          else if (this.engine) await this.engine.update(plan);
          this.engine?.setCanPublish?.(canPublish);
        } catch (e) {
          console.warn("[meet] media", e);
          toast(e.message);
        }
        this.render();
      }
      canPublish() {
        return !(this.meeting.kind === "webinar" && this.myRole() === "viewer");
      }
      myRole() {
        return this.people.find((p) => p.id === this.me.id)?.role ?? this.me.role;
      }
      amHost() {
        return ["host", "cohost"].includes(this.myRole());
      }
      onTrack({ peer, source, track, receiver }) {
        const key = `${peer}:${source}`;
        this.remote.set(key, { track, receiver });
        this.applyDelay(receiver);
        if (track.kind === "audio") {
          let a = this.audios.get(peer);
          if (!a) {
            a = document.createElement("audio");
            a.autoplay = true;
            a.dataset.peer = peer;
            this.root.querySelector("#audios").append(a);
            this.audios.set(peer, a);
          }
          a.srcObject = new MediaStream([track]);
          a.play().catch(() => this.needsTap());
        }
        track.onmute = track.onunmute = () => this.render();
        if (!this.timings.firstRemote) this.timings.firstRemote = performance.now();
        if (track.kind === "audio") this.notes?.reconcile().catch(() => {
        });
        this.render();
      }
      trackGone(key) {
        const x = this.remote.get(key);
        this.remote.delete(key);
        const [peer, source] = key.split(":");
        if (source === "mic" && x?.track.kind === "audio") {
          const a = this.audios.get(peer);
          if (a) {
            a.srcObject = null;
            a.remove();
            this.audios.delete(peer);
          }
        }
        this.render();
      }
      isViewer() {
        return this.meeting.kind === "webinar" && this.myRole() === "viewer";
      }
      applyDelay(receiver) {
        if (!receiver || !("jitterBufferTarget" in receiver)) return;
        try {
          receiver.jitterBufferTarget = this.isViewer() ? VIEWER_DELAY_MS : null;
        } catch {
        }
      }
      // The host let me speak (or made me a viewer again): ask for the microphone and camera now, the first
      // time (the browser asks the person), and start or stop sending.
      async roleChanged() {
        const can = this.canPublish();
        for (const x of this.remote.values()) this.applyDelay(x.receiver);
        if (can && !this.local.mic && !this.local.cam) {
          try {
            const st = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
            this.local.mic = st.getAudioTracks()[0] ?? null;
            this.local.cam = st.getVideoTracks()[0] ?? null;
          } catch {
            toast("The browser blocked the microphone or camera. Allow them with the icon in the address bar.");
          }
          this.audioOn = !!this.local.mic;
          this.videoOn = !!this.local.cam;
          for (const src of ["mic", "cam"]) if (this.local[src]) await this.engine?.setTrack(src, this.local[src]);
          callTool("meet.set_my_media", { meeting: this.meeting.id, audio: this.audioOn, video: this.videoOn }).catch(() => {
          });
        }
        await this.engine?.setCanPublish?.(can);
        if (this.meeting.kind === "webinar") toast(can ? "The host let you speak. Your microphone is on." : "You are watching again.");
        this.render();
      }
      needsTap() {
        if (this.tapShown) return;
        this.tapShown = true;
        const n = document.createElement("button");
        n.className = "ui-btn is-accent meet-tap";
        n.dataset.tool = "none";
        n.dataset.why = "lets the browser play sound; browsers need one tap first";
        n.textContent = "Tap to hear the call";
        n.onclick = () => {
          for (const a of this.audios.values()) a.play().catch(() => {
          });
          n.remove();
        };
        this.root.querySelector(".meet-stage").append(n);
      }
      onEngineEvent(ev, d) {
        if (ev === "levels") {
          const t = Date.now();
          for (const x of d ?? []) {
            const pid = this.plan?.peers?.[x.owner]?.pid;
            if (pid) this.levels.set(pid, { level: 0.2, at: t });
          }
        }
        if (ev === "failover") {
          this.lastFailover = d;
        }
        if (ev === "host-lost") toast("A computer carrying the call left. Moving you to another one.");
        if (ev === "disconnected") toast("Lost the media server. Reconnecting\u2026");
      }
      // ------------------------------------------------------------ data from tools
      async loadPeople() {
        try {
          const r = await callTool("meet.list_participants", { meeting: this.meeting.id });
          this.people = r.participants;
          const before = this.waiting;
          this.waiting = r.waiting;
          if (this.amHost() && this.waiting > before) {
            const w = await callTool("meet.list_waiting", { meeting: this.meeting.id }).catch(() => ({ waiting: [] }));
            this.waitingList = w.waiting;
            const last = w.waiting.at(-1);
            if (last) toast(`${last.display_name} is waiting to join`);
          } else if (this.amHost() && this.waiting) {
            this.waitingList = (await callTool("meet.list_waiting", { meeting: this.meeting.id }).catch(() => ({ waiting: [] }))).waiting;
          } else this.waitingList = [];
          const mine = this.people.find((p) => p.id === this.me.id);
          if (mine && this.lastRole && mine.role !== this.lastRole) this.roleChanged();
          if (mine) this.lastRole = mine.role;
          const hands = new Set(this.people.filter((p) => p.hand_raised && p.id !== this.me.id).map((p) => p.id));
          if (this.amHost()) {
            for (const id of hands) if (!this.hands?.has(id)) toast(`${this.people.find((p) => p.id === id).display_name} raised their hand`);
          }
          this.hands = hands;
        } catch (e) {
          if (e.code === "forbidden") return this.exit("You are no longer in this meeting.");
        }
        this.render();
      }
      async loadChat() {
        const after = this.chat.at(-1)?.id ?? 0;
        const r = await callTool("meet.list_chat", { meeting: this.meeting.id, after }).catch(() => ({ messages: [] }));
        if (!r.messages.length) return;
        this.chat.push(...r.messages);
        if (this.panel === "chat") this.chatSeen = this.chat.length;
        else if (r.messages.some((m) => m.participant !== this.me.id)) toast(`${r.messages.at(-1).name}: ${r.messages.at(-1).body.slice(0, 80)}`);
        this.render();
      }
      async loadStatus() {
        const s = await callTool("meet.room_status", { meeting: this.meeting.id }).catch(() => null);
        if (!s) return;
        this.status = s;
        this.meeting = { ...this.meeting, ...s.meeting };
        this.requests = s.requests ?? [];
        this.render();
      }
      onChanged(b) {
        if (this.leaving || this.exited) return;
        clearTimeout(this.chT?.[b.what]);
        this.chT ??= {};
        this.chT[b.what] = setTimeout(() => {
          if (b.what === "participants" || b.what === "waiting") this.loadPeople();
          if (b.what === "chat") this.loadChat();
          if (b.what === "meeting") this.loadStatus();
          if (b.what === "notes" || b.what === "participants" && this.notes?.status?.on) this.notes?.load();
          if (b.what === "board") this.whiteboard?.load();
          if (b.what === "recording" || b.what === "participants" && this.recording?.status?.state === "recording") this.recording?.load();
        }, 60);
      }
      async onCmd(b) {
        if (b.to_pid !== this.me.id) return;
        if (b.removed) {
          this.removed = true;
          return this.exit("The host removed you from this meeting.");
        }
        if (b.set_media) {
          if (b.set_media.audio === false && this.audioOn) {
            this.setMic(false, true);
            if (b.by) toast(`${b.by} muted you`);
          }
          if (b.set_media.audio === true && !this.audioOn) this.setMic(true, true);
          if (b.set_media.video === false && this.videoOn) this.setCam(false, true);
          if (b.set_media.video === true && !this.videoOn) this.setCam(true, true);
        }
        if (b.request?.kind === "screen_share") {
          this.requests = [...this.requests.filter((r) => r.id !== b.request.id), b.request];
          this.render();
        }
        if (b.stop_share && this.local.screen) this.stopShare(true);
        if (b.layout && b.layout !== this.layout) {
          this.layout = b.layout;
          this.render();
        }
        if (b.background && b.background !== this.bg) this.setBackground(b.background, true).catch((e) => toast(e.message));
      }
      // ------------------------------------------------------------ my media
      async setMic(on, fromServer = false) {
        if (on && !this.local.mic) {
          try {
            const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
            this.local.mic = s.getAudioTracks()[0];
            await this.engine?.setTrack("mic", this.local.mic);
          } catch {
            toast("The browser blocked the microphone. Allow it with the icon in the address bar.");
            return;
          }
        }
        this.audioOn = on;
        if (this.local.mic) this.local.mic.enabled = on;
        if (!fromServer) await callTool("meet.set_my_media", { meeting: this.meeting.id, audio: on }).catch((e) => toast(e.message));
        await this.notes?.reconcile().catch(() => {
        });
        this.render();
      }
      async setCam(on, fromServer = false) {
        if (on && !this.local.cam) {
          try {
            const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } } });
            this.local.cam = s.getVideoTracks()[0];
          } catch {
            toast("The browser blocked the camera, or it is busy.");
            return;
          }
          await this.engine?.setTrack("cam", this.local.cam);
          if (this.bg === "blur") await this.setBackground("blur", true).catch(() => {
          });
        }
        if (!on && this.local.cam) {
          this.blur?.stop();
          this.blur = null;
          this.local.cam.stop();
          this.local.cam = null;
          await this.engine?.setTrack("cam", null);
        }
        this.videoOn = on;
        if (!fromServer) await callTool("meet.set_my_media", { meeting: this.meeting.id, video: on }).catch((e) => toast(e.message));
        this.render();
      }
      // The camera as others see it: blurred when background blur is on.
      camTrack() {
        return this.blur?.track ?? this.local.cam;
      }
      async setBackground(mode, fromServer = false) {
        this.bg = mode;
        bgPref.set(mode);
        if (mode === "blur" && this.local.cam && !this.blur) {
          const { Blur: Blur2 } = await Promise.resolve().then(() => (init_blur(), blur_exports));
          try {
            this.blur = await Blur2.create(this.local.cam);
          } catch (e) {
            this.bg = "none";
            bgPref.set("none");
            throw new Error(`Background blur could not start on this device (${e.message}).`);
          }
          await this.engine?.setTrack("cam", this.blur.track);
        }
        if (mode !== "blur" && this.blur) {
          const b = this.blur;
          this.blur = null;
          await this.engine?.setTrack("cam", this.local.cam);
          b.stop();
        }
        if (!fromServer) await callTool("meet.set_background", { meeting: this.meeting.id, background: mode }).catch((e) => toast(e.message));
        this.render();
      }
      // Choosing a screen is the browser's picker, which only the person can use (ROADMAP 3.3).
      async startShare() {
        let s;
        try {
          s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15 } }, audio: false });
        } catch {
          return;
        }
        const t = s.getVideoTracks()[0];
        t.contentHint = "detail";
        this.local.screen = t;
        t.onended = () => this.stopShare();
        await this.engine?.setTrack("screen", t);
        this.requests = this.requests.filter((r) => r.kind !== "screen_share");
        await callTool("meet.set_sharing", { meeting: this.meeting.id, sharing: true }).catch((e) => toast(e.message));
        this.render();
      }
      async stopShare(fromServer = false) {
        const t = this.local.screen;
        this.local.screen = null;
        t?.stop();
        await this.engine?.setTrack("screen", null);
        if (!fromServer) await callTool("meet.set_sharing", { meeting: this.meeting.id, sharing: false }).catch(() => {
        });
        this.render();
      }
      // ------------------------------------------------------------ who is speaking
      async pollLevels() {
        const t = Date.now();
        if (this.local.mic && this.audioOn) {
          if (!this.analyser || this.analyserTrack !== this.local.mic) {
            try {
              this.audioCtx ??= new AudioContext();
              const src = this.audioCtx.createMediaStreamSource(new MediaStream([this.local.mic]));
              this.analyser = this.audioCtx.createAnalyser();
              this.analyser.fftSize = 512;
              src.connect(this.analyser);
              this.analyserTrack = this.local.mic;
              this.buf = new Float32Array(512);
            } catch {
            }
          }
          if (this.analyser) {
            this.analyser.getFloatTimeDomainData(this.buf);
            let sum = 0;
            for (const v of this.buf) sum += v * v;
            const rms = Math.sqrt(sum / this.buf.length);
            if (rms > SPEAK_LEVEL) this.levels.set(this.me.id, { level: rms, at: t });
          }
        }
        for (const [key2, x] of this.remote) {
          if (!key2.endsWith(":mic") || !x.receiver?.getSynchronizationSources) continue;
          const lvl = x.receiver.getSynchronizationSources()[0]?.audioLevel ?? 0;
          const pid = this.plan?.peers?.[key2.split(":")[0]]?.pid;
          if (pid && lvl > SPEAK_LEVEL) this.levels.set(pid, { level: lvl, at: t });
        }
        const speaking = new Set([...this.levels].filter(([, v]) => t - v.at < 700).map(([pid]) => pid));
        let loudest = null;
        for (const [pid, v] of this.levels) if (t - v.at < 700 && (!loudest || v.level > loudest.level)) loudest = { pid, level: v.level };
        if (loudest && loudest.pid !== this.me.id && loudest.pid !== this.active) {
          if (this.candidate?.pid === loudest.pid) {
            if (t - this.candidate.since > 800) {
              this.active = loudest.pid;
              this.candidate = null;
            }
          } else this.candidate = { pid: loudest.pid, since: t };
        }
        const key = [...speaking].sort().join(",") + "|" + this.active;
        if (key !== this.speakingKey) {
          this.speakingKey = key;
          this.speaking = speaking;
          this.render();
        }
        this.renderCaptions();
      }
      async refreshTrouble() {
        if (this.engine?.kind !== "p2p") return;
        this.render();
      }
      // ------------------------------------------------------------ rendering
      renderFrame() {
        this.root.innerHTML = `<div class="meet-call" data-panel="">
      <header class="meet-call-top"><div class="meet-call-t"><b>${esc(this.meeting.title)}</b><span class="ui-mute meet-mode" id="mode"></span></div><div class="meet-call-tr" id="topr"></div></header>
      <div class="meet-notices" id="notices"></div>
      <div class="meet-body">
        <section class="meet-stage" id="stage" aria-label="Call"></section>
        <aside class="meet-side" id="side" aria-label="Side panel"></aside>
      </div>
      <nav class="ui-callbar meet-bar" id="bar" aria-label="Call controls"></nav>
      <div id="audios" hidden></div>
      <dialog class="ui-dialog meet-dlg" id="notesdlg" aria-label="Notes notice"></dialog>
      <dialog class="ui-dialog meet-dlg" id="recdlg" aria-label="Recording notice"></dialog>
      <div class="meet-more" id="more" hidden></div>
    </div>`;
        this.root.removeAttribute("aria-busy");
        this.root.querySelector("#bar").addEventListener("click", (e) => this.onBar(e));
        this.root.querySelector("#side").addEventListener("click", (e) => this.onSide(e));
        this.root.querySelector("#side").addEventListener("submit", (e) => this.onSideSubmit(e));
        this.root.querySelector("#notices").addEventListener("click", (e) => this.onNotice(e));
        for (const id of ["#notesdlg", "#recdlg"]) {
          this.root.querySelector(id).addEventListener("click", (e) => this.onSide(e));
          this.root.querySelector(id).addEventListener("cancel", (e) => e.preventDefault());
        }
        this.root.querySelector("#more").addEventListener("click", (e) => this.onMore(e));
      }
      render() {
        if (this.exited || !this.root.querySelector(".meet-call")) return;
        cancelAnimationFrame(this.raf);
        this.raf = requestAnimationFrame(() => this.renderNow());
      }
      renderNow() {
        const root = this.root.querySelector(".meet-call");
        if (!root || this.exited) return;
        root.dataset.panel = this.panel ?? "";
        root.dataset.layout = this.layout;
        this.root.querySelector("#mode").textContent = modeLabel(this.plan, this.engine);
        const topr = this.markers();
        const tr = this.root.querySelector("#topr");
        if (tr.innerHTML !== topr) tr.innerHTML = topr;
        this.renderNotices();
        this.renderStage();
        this.whiteboard?.renderHead();
        this.renderBar();
        this.renderSide();
      }
      peersOf(pid) {
        return Object.entries(this.plan?.peers ?? {}).filter(([, v]) => v.pid === pid && v.kind === "browser").map(([k]) => k);
      }
      remoteFor(pid, source) {
        for (const peer of this.peersOf(pid)) {
          const x = this.remote.get(`${peer}:${source}`);
          if (x) return x.track;
        }
        return null;
      }
      // What tiles to show: everyone in the call; a shared screen gets its own tile.
      tileList() {
        const inCall = this.people.filter((p) => p.id === this.me.id || p.in_call);
        const list = [];
        for (const p of inCall) {
          const mine = p.id === this.me.id;
          const cam = mine ? this.videoOn ? this.camTrack() : null : p.video_on ? this.remoteFor(p.id, "cam") : null;
          if (this.meeting.kind === "webinar" && p.role === "viewer") continue;
          list.push({ key: `${p.id}:cam`, pid: p.id, p, track: cam, mine, audio: mine ? this.audioOn : p.audio_on });
          const scr = mine ? this.local.screen : p.sharing ? this.remoteFor(p.id, "screen") : null;
          if (scr) list.push({ key: `${p.id}:screen`, pid: p.id, p, track: scr, mine, screen: true });
        }
        return list;
      }
      renderStage() {
        const stage = this.root.querySelector("#stage");
        const list = this.tileList();
        const screen = list.find((t) => t.screen);
        const big = this.layout === "speaker" || screen ? screen ?? list.find((t) => t.pid === this.active && !t.mine) ?? list.find((t) => !t.mine) ?? list[0] : null;
        let main = stage.querySelector(".meet-main");
        let grid = stage.querySelector(".ui-calls");
        if (!grid) {
          stage.innerHTML = '<div class="meet-main"></div><div class="ui-calls"></div><div class="meet-cap" id="captions"></div>';
          main = stage.querySelector(".meet-main");
          grid = stage.querySelector(".ui-calls");
        }
        stage.classList.toggle("has-big", !!big);
        grid.classList.toggle("is-strip", !!big);
        grid.dataset.n = String(list.length - (big ? 1 : 0));
        const keep = /* @__PURE__ */ new Set();
        for (const t of list) {
          keep.add(t.key);
          let el = this.tiles.get(t.key);
          if (!el) {
            el = this.makeTile(t);
            this.tiles.set(t.key, el);
          }
          this.updateTile(el, t);
          const parent = t === big ? main : grid;
          if (el.parentElement !== parent) parent.append(el);
        }
        for (const [k, el] of this.tiles) if (!keep.has(k)) {
          el.querySelector("video").srcObject = null;
          el.remove();
          this.tiles.delete(k);
        }
        for (const t of list) {
          const el = this.tiles.get(t.key);
          if (el.parentElement === grid) grid.append(el);
        }
        this.fit();
        this.renderCaptions();
        const owners = (pred) => list.filter(pred).flatMap((t) => this.peersOf(t.pid));
        this.engine?.setView?.({ visible: owners((t) => !t.mine && t !== big), big: big && !big.mine ? this.peersOf(big.pid)[0] ?? null : null });
      }
      // Size the grid so tiles are as large as the stage allows: try each column count, keep the biggest tile.
      fit() {
        const grid = this.root.querySelector("#stage .ui-calls");
        if (!grid) return;
        if (!this.ro) {
          this.ro = new ResizeObserver(() => this.fit());
          this.ro.observe(this.root.querySelector("#stage"));
        }
        const n = grid.children.length;
        if (grid.classList.contains("is-strip") || !n) {
          grid.style.gridTemplateColumns = "";
          return;
        }
        const cs = getComputedStyle(grid);
        const W2 = grid.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const H2 = grid.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
        const gap = parseFloat(cs.columnGap) || 8;
        const [a, b] = (getComputedStyle(grid.children[0]).aspectRatio || "16 / 10").split("/").map(Number);
        const ratio = a && b ? a / b : 1.6;
        let best = { w: 0, cols: 1 };
        for (let cols = 1; cols <= n; cols++) {
          const rows = Math.ceil(n / cols);
          const w = Math.min((W2 - gap * (cols - 1)) / cols, (H2 - gap * (rows - 1)) / rows * ratio);
          if (w > best.w) best = { w, cols };
        }
        const tw = Math.max(80, Math.floor(best.w));
        const v = `repeat(${best.cols}, ${tw}px)`;
        if (grid.style.gridTemplateColumns !== v) grid.style.gridTemplateColumns = v;
      }
      makeTile(t) {
        const el = document.createElement("div");
        el.className = "ui-tile";
        el.dataset.key = t.key;
        el.innerHTML = `<video autoplay playsinline muted></video><span class="ui-avatar">${esc(initials(t.p.display_name))}</span><span class="ui-tile-n"></span><span class="ui-tile-tag"></span>`;
        return el;
      }
      updateTile(el, t) {
        const v = el.querySelector("video");
        const live = t.track && t.track.readyState === "live" && (t.mine || !t.track.muted);
        if (live && v.srcObject?.getVideoTracks()[0] !== t.track) {
          v.srcObject = new MediaStream([t.track]);
          v.play().catch(() => {
          });
        }
        if (!live && v.srcObject) v.srcObject = null;
        el.classList.toggle("has-video", !!live);
        el.classList.toggle("is-mine", t.mine && !t.screen);
        el.classList.toggle("is-screen", !!t.screen);
        el.classList.toggle("is-muted", !t.screen && !t.audio);
        el.classList.toggle("is-agent", t.p.kind === "agent");
        el.classList.toggle("is-speaking", !t.screen && !!this.speaking?.has(t.pid));
        const trouble = !t.mine && this.peersOf(t.pid).some((pr) => this.peerTrouble.has(pr));
        el.classList.toggle("is-trouble", trouble);
        const name = t.screen ? `${t.mine ? "Your" : `${t.p.display_name}'s`} screen` : `${t.p.display_name}${t.mine ? " (you)" : ""}`;
        const n = el.querySelector(".ui-tile-n");
        if (n.textContent !== name) n.textContent = name;
        const tag = el.querySelector(".ui-tile-tag");
        const tagHtml = trouble ? `<span class="ui-chip is-bad">Can't connect</span>` : t.p.hand_raised && !t.screen ? `<span class="ui-chip is-soft">${icon("hand", 13)} Hand up</span>` : t.p.kind === "agent" ? '<span class="ui-chip is-soft">Agent</span>' : "";
        if (tag.innerHTML !== tagHtml) tag.innerHTML = tagHtml;
      }
      renderNotices() {
        const out = [];
        const p = this.plan;
        if (this.isViewer()) out.push(`<div class="ui-notice is-quiet"><span>You are watching${this.meeting.kind === "webinar" ? " a webinar" : ""}. Raise your hand to ask to speak.</span></div>`);
        if (p && p.capped?.includes(this.peer)) out.push(`<div class="ui-notice"><span>${esc(p.message ?? "This call is full.")}</span></div>`);
        else if (p?.message && this.amHost()) out.push(`<div class="ui-notice is-quiet"><span>${esc(p.message)}</span></div>`);
        if (this.peerTrouble.size) {
          const names = [...this.peerTrouble.keys()].map((pr) => p?.peers?.[pr]?.name).filter(Boolean);
          const reason = [...this.peerTrouble.values()][0];
          out.push(`<div class="ui-notice is-quiet"><span>Can't connect to ${esc(names.join(", ") || "someone")}. ${esc(reason ?? "")}</span></div>`);
        }
        for (const r of this.requests.filter((x) => x.kind === "screen_share")) {
          if (this.local.screen) continue;
          out.push(`<div class="ui-notice"><span>${esc(r.body?.by ?? "The host")} asked you to share your screen. You pick what to share.</span><button class="ui-btn is-accent is-sm" data-tool="meet.set_sharing" data-act="share">Share screen</button><button class="ui-btn is-ghost is-sm" data-tool="none" data-why="hides the request on this screen" data-act="dismiss" data-id="${esc(r.id)}">Not now</button></div>`);
        }
        if (this.amHost() && this.waiting && this.panel !== "people") out.push(`<div class="ui-notice is-quiet"><span>${this.waiting} waiting to join.</span><button class="ui-btn is-sm" data-tool="meet.admit" data-act="admit-all">Let everyone in</button><button class="ui-btn is-ghost is-sm" data-tool="none" data-why="opens the people panel" data-act="see-waiting">See who</button></div>`);
        out.push(this.recording?.notice() ?? "");
        const html = out.join("");
        const el = this.root.querySelector("#notices");
        if (el.innerHTML !== html) el.innerHTML = html;
      }
      renderBar() {
        const me = this.people.find((p) => p.id === this.me.id);
        const hand = !!me?.hand_raised;
        const canPub = this.canPublish();
        const unread = Math.max(0, this.chat.length - this.chatSeen);
        const b = (act, tool, pressed, label, ic, extra = "") => `<button data-act="${act}" ${tool === "none" ? `data-tool="none" data-why="${esc(extra)}"` : `data-tool="${tool}"`} ${pressed == null ? "" : `aria-pressed="${pressed}"`} aria-label="${esc(label)}" title="${esc(label)}">${ic}</button>`;
        const html = [
          canPub ? b("mic", "meet.set_my_media", this.audioOn, this.audioOn ? "Mute" : "Unmute", icon(this.audioOn ? "mic" : "mic-off")) : "",
          canPub ? b("cam", "meet.set_my_media", this.videoOn, this.videoOn ? "Turn camera off" : "Turn camera on", icon(this.videoOn ? "cam" : "cam-off")) : "",
          canPub && navigator.mediaDevices?.getDisplayMedia ? b("share", "meet.set_sharing", this.local.screen ? true : null, this.local.screen ? "Stop sharing" : "Share screen", icon("screen")).replace("<button", `<button class="${this.local.screen ? "is-on" : ""}"`) : "",
          b("hand", "meet.raise_hand", hand ? true : null, hand ? "Lower hand" : "Raise hand", icon("hand")).replace("<button", `<button class="meet-hide-sm ${hand ? "is-on" : ""}"`),
          b("layout", "meet.set_layout", null, this.layout === "grid" ? "Speaker view" : "Grid view", icon(this.layout === "grid" ? "speaker" : "grid")).replace("<button", '<button class="meet-hide-sm"'),
          `<span class="meet-bar-sep" aria-hidden="true"></span>`,
          b("people", "none", null, "People", `${icon("people")}${this.amHost() && this.waiting ? `<span class="meet-dot">${this.waiting}</span>` : ""}`, "opens the people panel"),
          b("chat", "none", null, "Chat", `${icon("chat")}${unread && this.panel !== "chat" ? `<span class="meet-dot">${unread}</span>` : ""}`, "opens the chat panel"),
          b("notes", "none", null, this.notes?.status?.on ? "Notes (on)" : "Notes", `${icon("notes")}${this.notes?.status?.on ? '<span class="meet-dot is-rec"></span>' : ""}`, "opens the notes panel"),
          b("more", "none", this.moreOpen ? true : null, "More", icon("more"), "opens more call options"),
          `<button class="is-leave" data-act="leave" data-tool="meet.leave">Leave</button>`
        ].join("");
        const bar = this.root.querySelector("#bar");
        if (bar.innerHTML !== html) bar.innerHTML = html;
      }
      renderSide() {
        const side = this.root.querySelector("#side");
        if (!this.panel) {
          if (side.innerHTML) side.innerHTML = "";
          return;
        }
        const tab = (k, label) => `<button role="tab" aria-selected="${this.panel === k}" data-tool="none" data-why="switches the side panel" data-panel="${k}">${label}</button>`;
        const head = `<div class="meet-side-h"><div class="ui-tabs" role="tablist">${tab("people", `People <span class="ui-badge is-quiet">${this.people.filter((p) => p.in_call || p.id === this.me.id).length}</span>`)}${tab("chat", "Chat")}${tab("notes", "Notes")}${tab("info", "Details")}</div><button class="ui-x" data-tool="none" data-why="closes the side panel" data-act="close" aria-label="Close">\xD7</button></div>`;
        let body = "";
        if (this.panel === "people") body = this.peopleHtml();
        if (this.panel === "chat") body = this.chatHtml();
        if (this.panel === "info") body = this.infoHtml();
        if (this.panel === "notes") body = this.notes?.panelHtml() ?? '<p class="ui-empty">Loading notes\u2026</p>';
        const html = head + `<div class="meet-side-b">${body}</div>`;
        if (side.dataset.html === html) return;
        const drafts = [...side.querySelectorAll("input[id]")].map((i) => [i.id, i.value]);
        const focused = document.activeElement?.closest?.("#side") ? document.activeElement.id : null;
        const scroll = side.querySelector(".meet-side-b")?.scrollTop ?? 0;
        const atEnd = (() => {
          const b = side.querySelector(".meet-side-b");
          return !b || b.scrollTop + b.clientHeight >= b.scrollHeight - 8;
        })();
        side.innerHTML = html;
        side.dataset.html = html;
        for (const [id, v] of drafts) {
          const i = side.querySelector(`#${id}`);
          if (i && v) i.value = v;
        }
        if (focused) side.querySelector(`#${focused}`)?.focus();
        const list = side.querySelector(".meet-chatlist");
        if (list) list.scrollTop = list.scrollHeight;
        const sb = side.querySelector(".meet-side-b");
        if (sb) sb.scrollTop = this.panel === "notes" && atEnd && this.panelWas === "notes" ? sb.scrollHeight : scroll;
        this.panelWas = this.panel;
      }
      peopleHtml() {
        const host = this.amHost();
        const webinar = this.meeting.kind === "webinar";
        const row = (p) => {
          const mine = p.id === this.me.id;
          const chips = [p.role === "host" ? "Host" : p.role === "cohost" ? "Co-host" : webinar && p.role === "speaker" ? "Speaker" : webinar && p.role === "viewer" ? "Viewer" : "", p.is_guest && !webinar ? "Guest" : "", p.kind === "agent" ? "Agent" : "", !p.in_call && !mine ? "Not connected" : ""].filter(Boolean);
          const acts = host && !mine && p.role !== "host" ? `<div class="meet-prow-a ${webinar && p.hand_raised ? "is-on" : ""}">
        ${p.audio_on ? `<button class="ui-btn is-ghost is-sm" data-tool="meet.mute_participant" data-act="mute" data-pid="${p.id}">Mute</button>` : ""}
        ${webinar ? p.role === "viewer" ? `<button class="ui-btn is-ghost is-sm" data-tool="meet.set_role" data-act="role" data-role="speaker" data-pid="${p.id}">Let speak</button>` : `<button class="ui-btn is-ghost is-sm" data-tool="meet.set_role" data-act="role" data-role="viewer" data-pid="${p.id}">Make viewer</button>` : `<button class="ui-btn is-ghost is-sm" data-tool="meet.set_role" data-act="role" data-role="${p.role === "cohost" ? p.is_guest ? "guest" : "member" : "cohost"}" data-pid="${p.id}">${p.role === "cohost" ? "Remove co-host" : "Make co-host"}</button>`}
        <button class="ui-btn is-ghost is-sm" data-tool="meet.request_screen_share" data-act="ask-share" data-pid="${p.id}">Ask to share</button>
        <button class="ui-btn is-ghost is-sm is-danger" data-tool="meet.remove_participant" data-act="remove" data-pid="${p.id}">Remove</button>
      </div>` : "";
          return `<li class="meet-prow"><span class="ui-avatar is-sm">${esc(initials(p.display_name))}</span><div class="meet-prow-m"><span>${esc(p.display_name)}${mine ? " (you)" : ""}</span><span class="meet-prow-c">${chips.map((c) => `<span class="ui-chip is-outline">${c}</span>`).join("")}${p.hand_raised ? `<span class="ui-chip is-soft">${icon("hand", 12)} Hand up</span>` : ""}</span></div><span class="meet-prow-i ${p.audio_on ? "" : "is-off"}" title="${p.audio_on ? "Mic on" : "Muted"}">${icon(p.audio_on ? "mic" : "mic-off", 16)}</span>${acts}</li>`;
        };
        const waiting2 = host && this.waitingList?.length ? `<h3 class="meet-side-sub">Waiting <span class="ui-badge">${this.waitingList.length}</span></h3><ul class="meet-plist">${this.waitingList.map((w) => `<li class="meet-prow"><span class="ui-avatar is-sm">${esc(initials(w.display_name))}</span><div class="meet-prow-m"><span>${esc(w.display_name)}</span><span class="meet-prow-c">${w.is_guest ? '<span class="ui-chip is-outline">Guest</span>' : ""}</span></div><div class="meet-prow-a is-on"><button class="ui-btn is-sm" data-tool="meet.admit" data-act="admit" data-pid="${w.id}">Let in</button><button class="ui-btn is-ghost is-sm" data-tool="meet.deny" data-act="deny" data-pid="${w.id}">Deny</button></div></li>`).join("")}</ul><p><button class="ui-btn is-quiet is-sm" data-tool="meet.admit" data-act="admit-all">Let everyone in</button></p>` : "";
        const rank = (p) => !webinar ? 0 : p.role !== "viewer" ? 0 : p.hand_raised ? 1 : 2;
        const inCall = this.people.filter((p) => p.in_call || p.id === this.me.id).sort((a, b) => rank(a) - rank(b));
        const away = this.people.filter((p) => !p.in_call && p.id !== this.me.id);
        const all = host ? `<p class="meet-side-a"><button class="ui-btn is-quiet is-sm" data-tool="meet.mute_participant" data-act="mute-all">Mute everyone</button><button class="ui-btn is-quiet is-sm" data-tool="meet.invite" data-act="invite">Copy invite</button></p>` : `<p class="meet-side-a"><button class="ui-btn is-quiet is-sm" data-tool="meet.invite" data-act="invite">Copy invite</button></p>`;
        return `${waiting2}${all}<h3 class="meet-side-sub">In the call</h3><ul class="meet-plist">${inCall.map(row).join("")}</ul>${away.length ? `<h3 class="meet-side-sub">Joined earlier</h3><ul class="meet-plist">${away.map(row).join("")}</ul>` : ""}`;
      }
      chatHtml() {
        const msgs = this.chat.map((m) => `<li class="meet-cmsg ${m.participant === this.me.id ? "is-mine" : ""}"><span class="meet-cmsg-h"><b>${esc(m.name)}</b> <span class="ui-mute">${new Date(m.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></span><span class="meet-cmsg-b">${linkify(esc(m.body))}</span></li>`).join("");
        return `<ul class="meet-chatlist">${msgs || '<li class="ui-empty">Messages here are seen by everyone in the call.</li>'}</ul>
      <form class="ui-composer meet-composer" data-tool="meet.send_chat" id="chatform"><label class="ui-sr" for="chatbox">Message</label><input id="chatbox" name="body" autocomplete="off" placeholder="Message everyone" maxlength="4000"><button class="ui-btn is-accent is-sm" type="submit" data-tool="meet.send_chat">Send</button></form>`;
      }
      infoHtml() {
        const s = this.status;
        const host = this.amHost();
        const m = this.meeting;
        const hosts = (s?.hosts ?? []).map((h) => `<li>${icon("computer", 16)} ${esc(h.name)}: ${h.carrying ? `carrying ${h.load ?? 0} of about ${h.capacity ?? "?"} people` : esc(h.status)}${h.upload_mbps ? `, ${h.upload_mbps} Mbit/s up` : ""}</li>`).join("");
        return `<dl class="ui-kv meet-kv">
        <dt>Link</dt><dd class="meet-link"><code>${esc(m.join_url)}</code></dd>
        <dt>Carried</dt><dd>${esc(s?.summary ?? modeLabel(this.plan, this.engine))}</dd>
        <dt>People</dt><dd>${s?.people_in_call ?? ""} in the call${s?.limit ? `, room for about ${s.limit}` : ""}</dd>
        <dt>Waiting room</dt><dd>${m.waiting_room ? "On" : "Off"}</dd>
        <dt>Locked</dt><dd>${m.locked ? "Yes, nobody new can join" : "No"}</dd>
        <dt>Recording</dt><dd>${esc(this.recording?.infoRow() ?? "Off.")}</dd>
      </dl>
      ${hosts ? `<h3 class="meet-side-sub">Computers carrying the call</h3><ul class="meet-hosts">${hosts}</ul>` : ""}
      <div class="meet-side-a is-col">
        <button class="ui-btn is-quiet is-sm" data-tool="meet.invite" data-act="invite">${icon("link", 16)} Copy invite</button>
        <button class="ui-btn is-quiet is-sm" data-tool="meet.add_host" data-act="add-host">${icon("computer", 16)} Help carry this call</button>
        ${host ? `<button class="ui-btn is-quiet is-sm" data-tool="meet.lock" data-act="lock">${icon("lock", 16)} ${m.locked ? "Unlock meeting" : "Lock meeting"}</button>
        <button class="ui-btn is-quiet is-sm" data-tool="meet.set_waiting_room" data-act="waiting-room">${m.waiting_room ? "Turn waiting room off" : "Turn waiting room on"}</button>
        <button class="ui-btn is-quiet is-sm" data-tool="meet.update" data-act="webinar">${m.kind === "webinar" ? "Switch to a normal meeting" : "Switch to webinar mode"}</button>
        <button class="ui-btn is-danger is-sm" data-tool="meet.end" data-act="end">End for everyone</button>` : ""}
      </div>
      <div id="hostcmd"></div>`;
      }
      // ------------------------------------------------------------ actions
      async onBar(e) {
        const b = e.target.closest("button[data-act]");
        if (!b) return;
        const a = b.dataset.act;
        try {
          if (a === "mic") await this.setMic(!this.audioOn);
          if (a === "cam") await this.setCam(!this.videoOn);
          if (a === "share") this.local.screen ? await this.stopShare() : await this.startShare();
          if (a === "hand") {
            const me = this.people.find((p) => p.id === this.me.id);
            await callTool("meet.raise_hand", { meeting: this.meeting.id, raised: !me?.hand_raised });
          }
          if (a === "layout") {
            this.layout = this.layout === "grid" ? "speaker" : "grid";
            this.render();
            await callTool("meet.set_layout", { meeting: this.meeting.id, layout: this.layout });
          }
          if (a === "people" || a === "chat" || a === "info" || a === "notes") this.openPanel(this.panel === a ? null : a);
          if (a === "more") {
            this.moreOpen = !this.moreOpen;
            this.renderMore();
            this.render();
          }
          if (a === "leave") await this.leave();
        } catch (err) {
          toast(err.message);
        }
      }
      openPanel(p) {
        this.panel = p;
        if (p === "chat") {
          this.chatSeen = this.chat.length;
          setTimeout(() => this.root.querySelector("#chatbox")?.focus(), 30);
        }
        if (p === "info") this.loadStatus();
        if (p === "people") this.loadPeople();
        this.render();
      }
      async onSide(e) {
        const t = e.target.closest("[data-panel]");
        if (t && t.tagName === "BUTTON") return this.openPanel(t.dataset.panel);
        const b = e.target.closest("button[data-act]");
        if (!b) return;
        const a = b.dataset.act, pid = b.dataset.pid, mid = this.meeting.id;
        try {
          if (a.startsWith("rec-")) {
            b.disabled = true;
            try {
              return await this.recording?.onAct(a);
            } finally {
              b.disabled = false;
            }
          }
          if (/^(notes-|send-|captions$)/.test(a)) {
            b.disabled = true;
            try {
              return await this.notes?.onAct(a, b);
            } finally {
              b.disabled = false;
            }
          }
          if (a === "close") return this.openPanel(null);
          if (a === "admit") await callTool("meet.admit", { meeting: mid, participant: pid });
          if (a === "admit-all") await callTool("meet.admit", { meeting: mid, all: true });
          if (a === "deny") await callTool("meet.deny", { meeting: mid, participant: pid });
          if (a === "mute") await callTool("meet.mute_participant", { meeting: mid, participant: pid });
          if (a === "mute-all") {
            await callTool("meet.mute_participant", { meeting: mid, all: true });
            toast("Everyone else is muted");
          }
          if (a === "role") await callTool("meet.set_role", { meeting: mid, participant: pid, role: b.dataset.role });
          if (a === "ask-share") {
            await callTool("meet.request_screen_share", { meeting: mid, participant: pid });
            toast("Asked. They pick what to share.");
          }
          if (a === "remove") await callTool("meet.remove_participant", { meeting: mid, participant: pid });
          if (a === "invite") {
            const r = await callTool("meet.invite", { meeting: mid });
            await copyText(r.message);
            toast("Invite copied");
          }
          if (a === "lock") await callTool("meet.lock", { meeting: mid, locked: !this.meeting.locked });
          if (a === "waiting-room") await callTool("meet.set_waiting_room", { meeting: mid, on: !this.meeting.waiting_room });
          if (a === "webinar") await callTool("meet.update", { meeting: mid, kind: this.meeting.kind === "webinar" ? "meeting" : "webinar" });
          if (a === "end") {
            await callTool("meet.end", { meeting: mid });
            await this.exit("You ended the meeting for everyone.");
          }
          if (a === "add-host") {
            const r = await callTool("meet.add_host", { meeting: mid });
            this.root.querySelector("#hostcmd").innerHTML = `<div class="ui-card meet-hostcmd"><p>Run this on a computer that is plugged in and has a good connection. It forwards the call without seeing it.</p><pre class="meet-cmd"><code>${esc(r.command)}</code></pre><p class="ui-hint">${esc(r.needs)}</p></div>`;
            await copyText(r.command);
            toast("Command copied");
          }
          if (["lock", "waiting-room", "webinar"].includes(a)) await this.loadStatus();
        } catch (err) {
          toast(err.message);
        }
      }
      async onSideSubmit(e) {
        if (e.target.dataset.act?.startsWith("send-")) {
          e.preventDefault();
          const btn = e.target.querySelector("button[type=submit]");
          if (btn) btn.disabled = true;
          try {
            await this.notes?.onSubmit(e.target);
          } catch (err) {
            toast(err.message);
          } finally {
            if (btn) btn.disabled = false;
          }
          return;
        }
        if (e.target.id !== "chatform") return;
        e.preventDefault();
        const box = e.target.querySelector("#chatbox");
        const body = box.value.trim();
        if (!body) return;
        box.value = "";
        try {
          await callTool("meet.send_chat", { meeting: this.meeting.id, body });
          await this.loadChat();
        } catch (err) {
          box.value = body;
          toast(err.message);
        }
      }
      async onNotice(e) {
        const b = e.target.closest("button[data-act]");
        if (!b) return;
        if (b.dataset.act === "share") await this.startShare();
        if (b.dataset.act === "dismiss") {
          this.requests = this.requests.filter((r) => r.id !== b.dataset.id);
          this.render();
        }
        if (b.dataset.act === "admit-all") await callTool("meet.admit", { meeting: this.meeting.id, all: true }).catch((err) => toast(err.message));
        if (b.dataset.act === "see-waiting") this.openPanel("people");
        if (b.dataset.act?.startsWith("rec-")) {
          b.disabled = true;
          try {
            await this.recording?.onAct(b.dataset.act);
          } catch (err) {
            toast(err.message);
          } finally {
            b.disabled = false;
          }
        }
      }
      // What everyone must be able to see while it is happening: notes on, recording.
      markers() {
        return [this.recording?.marker() ?? "", this.notes?.marker() ?? ""].join("");
      }
      renderCaptions() {
        const el = this.root.querySelector("#captions");
        if (!el) return;
        const html = this.notes?.captionsHtml() ?? "";
        if (el.innerHTML !== html) el.innerHTML = html;
      }
      // The More menu: things used less often, and on a phone the ones the bar has no room for.
      moreItems() {
        const me = this.people.find((p) => p.id === this.me.id);
        const hand = !!me?.hand_raised;
        const item = (act, tool, label, ic, why = "") => `<button class="meet-more-i" data-act="${act}" ${tool === "none" ? `data-tool="none" data-why="${esc(why)}"` : `data-tool="${tool}"`}>${icon(ic, 18)}<span>${esc(label)}</span></button>`;
        return [
          item("hand", "meet.raise_hand", hand ? "Lower hand" : "Raise hand", "hand"),
          item("layout", "meet.set_layout", this.layout === "grid" ? "Speaker view" : "Grid view", this.layout === "grid" ? "speaker" : "grid"),
          ...(this.recording?.moreItems() ?? []).map((x) => item(...x)),
          ...(this.whiteboard?.moreItems() ?? []).map((x) => item(...x)),
          ...this.canPublish() && this.local.cam && this.videoOn ? [this.bg === "blur" ? item("bg-none", "meet.set_background", "Stop blurring my background", "blur") : item("bg-blur", "meet.set_background", "Blur my background", "blur")] : [],
          item("captions", "none", this.notes?.captions ? "Hide captions" : "Show captions", "captions", "shows or hides captions on this screen only"),
          item("info", "none", "Call details", "info", "opens call details")
        ].join("");
      }
      renderMore() {
        const el = this.root.querySelector("#more");
        if (!el) return;
        el.hidden = !this.moreOpen;
        if (this.moreOpen) el.innerHTML = `<div class="meet-more-in" role="menu">${this.moreItems()}</div>`;
      }
      async onMore(e) {
        const b = e.target.closest("button[data-act]");
        if (e.target === e.currentTarget || b) {
          this.moreOpen = false;
          this.renderMore();
          this.render();
        }
        if (!b) return;
        const a = b.dataset.act;
        try {
          if (a === "hand" || a === "layout") return this.onBar({ target: b });
          if (a === "captions") return this.notes?.onAct("captions");
          if (a === "info") return this.openPanel("info");
          if (a.startsWith("rec-")) await this.recording?.onAct(a);
          if (a.startsWith("wb-")) await this.whiteboard?.onAct(a);
          if (a === "bg-blur" || a === "bg-none") {
            if (a === "bg-blur") toast("Starting background blur\u2026");
            await this.setBackground(a === "bg-blur" ? "blur" : "none");
          }
        } catch (err) {
          toast(err.message);
        }
      }
      // ------------------------------------------------------------ for tests and the parity report
      view() {
        const tiles = [...this.root.querySelectorAll(".ui-tile")].map((el) => {
          const v = el.querySelector("video");
          return { key: el.dataset.key, name: el.querySelector(".ui-tile-n").textContent, video: !!v.srcObject, w: v.videoWidth, h: v.videoHeight, t: v.currentTime, frames: v.getVideoPlaybackQuality?.().totalVideoFrames ?? 0, speaking: el.classList.contains("is-speaking"), muted: el.classList.contains("is-muted") };
        });
        const audio = [...this.audios.values()].map((a) => ({ peer: a.dataset.peer, playing: !a.paused, t: a.currentTime, rtp: this.remote.get(`${a.dataset.peer}:mic`)?.receiver?.getSynchronizationSources?.()[0]?.rtpTimestamp ?? null }));
        return { tiles, audio };
      }
      async snapshot() {
        const { tiles, audio } = this.view();
        return { peer: this.peer, mode: this.plan?.mode, engine: this.engine?.kind ?? null, signal: this.signalMode, tiles, audio, stats: await this.engine?.stats?.(), timings: this.timings, failover: this.lastFailover ?? null };
      }
    };
    linkify = (s) => s.replace(/\bhttps?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  }
});

// public/app/home.mjs
init_api();
init_dom();
var app = null;
var nav = null;
var REPO = "https://github.com/warOnSaaS/meet";
var state = { who: null };
window.meetState = state;
var $ = (id) => app.querySelector(`#${id}`);
function startMeet(root, navImpl) {
  app = root;
  nav = navImpl;
  return route();
}
async function stopMeet() {
  const c = window.meetCall;
  window.meetCall = null;
  if (c && !c.exited) await c.leave().catch(() => {
  });
}
async function route() {
  try {
    await routeInner();
  } catch (e) {
    showError(e);
  }
}
async function routeInner() {
  state.who = await callTool("meet.whoami").catch(() => ({ user: null, can_start: false }));
  const p = nav.path().split("?")[0];
  const m = /^\/m\/([^/?#]+)/.exec(p);
  if (m) return joinPage(decodeURIComponent(m[1]));
  return homePage();
}
function showError(e) {
  console.error(e);
  app.innerHTML = `<main class="meet-center"><div class="ui-card meet-narrow"><h1 class="meet-h">Something went wrong</h1><p class="ui-mute">${esc(e.message ?? String(e))}</p><p><a class="ui-btn is-quiet" href="${nav.href("/")}">Back to start</a></p></div></main>`;
  app.removeAttribute("aria-busy");
}
function topBar() {
  if (nav.suite) return "";
  const u = state.who?.user;
  const right = u ? `<span class="ui-avatar is-sm" aria-hidden="true">${u.avatar_url ? `<img src="${esc(u.avatar_url)}" alt="">` : esc(initials(u.name))}</span><span class="hide-sm">${esc(u.name)}</span><a class="ui-btn is-ghost is-sm" href="/auth/signout">Sign out</a>` : state.who?.signin_available ? `<a class="ui-btn is-quiet is-sm" href="/auth/github?next=${encodeURIComponent(location.pathname + location.search)}">${icon("github")} Sign in with GitHub</a>` : "";
  return `<header class="ui-top meet-top"><a class="ui-brand meet-brand" href="${nav.href("/")}">${icon("video")}<span>Meetings</span></a><div class="meet-top-r">${right}</div></header>`;
}
async function homePage() {
  const w = state.who;
  const signedIn = !!w.user;
  const flash = nav.query().get("signin");
  const flashMsg = { failed: "GitHub sign-in did not finish. Try again.", unavailable: "GitHub sign-in is not set up on this server. See docs/SELF-HOSTING.md.", "not-on-team": "That GitHub account is not on this team." }[flash];
  app.innerHTML = `${topBar()}
  <main class="meet-home">
    ${flashMsg ? `<div class="ui-notice is-quiet">${esc(flashMsg)}</div>` : ""}
    <section class="meet-hero">
      <h1 class="meet-h1">Video meetings for small teams</h1>
      <p class="meet-lead">${nav.suite ? "Start a call and send the link. People on your team walk straight in; anyone else with the link waits until you let them in. Calls of up to 4 people go straight between you." : "Start a call, send the link, talk. Guests join from a browser with no account. Small calls go straight between people; bigger ones are carried by a computer in the call, encrypted so it cannot see or hear them."}</p>
      <div class="meet-actions">
        ${w.can_start ? `<button class="ui-btn is-accent is-lg" data-tool="meet.create" id="start">${icon("video")} Start a meeting</button>` : signedIn ? "" : w.signin_available ? `<a class="ui-btn is-accent is-lg" href="/auth/github">${icon("github")} Sign in to start a meeting</a>` : ""}
        <form class="meet-joinform" data-tool="meet.get" id="joinform">
          <label class="ui-sr" for="joinlink">Meeting link or code</label>
          <input class="ui-input" id="joinlink" name="link" placeholder="Paste a meeting link" autocomplete="off">
          <button class="ui-btn is-quiet" type="submit" data-tool="meet.get">Join</button>
        </form>
      </div>
    </section>
    ${signedIn ? `<section class="meet-section">
      <div class="meet-section-h"><h2 class="meet-h2">Your meetings</h2><div class="meet-section-a"><button class="ui-btn is-quiet is-sm" data-tool="meet.export" id="export">Export</button><button class="ui-btn is-quiet is-sm" data-tool="meet.doctor" id="doctor">Check calls</button></div></div>
      <div id="mine" class="meet-list"><p class="ui-empty">Loading\u2026</p></div>
      <form class="ui-card meet-schedule" data-tool="meet.schedule" id="schedule">
        <h3 class="meet-h3">Schedule a meeting</h3>
        <div class="ui-fields">
          <label class="ui-field is-wide"><span class="ui-label">Title</span><input class="ui-input" name="title" required placeholder="Weekly stand-up" maxlength="140"></label>
          <label class="ui-field"><span class="ui-label">Starts</span><input class="ui-input" name="starts_at" type="datetime-local" required></label>
          <label class="ui-field"><span class="ui-label">Length</span><select class="ui-select" name="duration_min"><option value="15">15 minutes</option><option value="30" selected>30 minutes</option><option value="45">45 minutes</option><option value="60">1 hour</option><option value="90">90 minutes</option></select></label>
          <label class="ui-check is-wide"><input type="checkbox" name="waiting_room" checked> Waiting room: guests wait until you let them in</label>
        </div>
        <div class="meet-form-a"><button class="ui-btn is-accent" type="submit" data-tool="meet.schedule">Schedule</button></div>
      </form>
      <div id="doctorout"></div>
      <details class="ui-card meet-settings" id="settingsbox">
        <summary class="meet-h3">Notes and recording settings</summary>
        <form data-tool="meet.set_settings" id="settings">
          <p class="ui-mute">Optional. Without a model, a labelled script writes demo notes. Keys are stored encrypted and never shown again.</p>
          <div class="ui-fields">
            <label class="ui-field is-wide"><span class="ui-label">Notes model address (OpenAI-compatible)</span><input class="ui-input" name="notes_model_url" placeholder="https://api.openai.com/v1 or http://localhost:11434/v1"></label>
            <label class="ui-field"><span class="ui-label">Model</span><input class="ui-input" name="notes_model" placeholder="gpt-4.1-mini"></label>
            <label class="ui-field"><span class="ui-label">Key</span><input class="ui-input" name="notes_model_key" type="password" autocomplete="off" placeholder="Leave empty to keep"></label>
            <label class="ui-field is-wide"><span class="ui-label">Speech service for devices that cannot transcribe (optional)</span><input class="ui-input" name="transcribe_url" placeholder="https://api.openai.com/v1"></label>
            <label class="ui-field"><span class="ui-label">Speech model</span><input class="ui-input" name="transcribe_model" placeholder="whisper-1"></label>
            <label class="ui-field"><span class="ui-label">Speech key</span><input class="ui-input" name="transcribe_key" type="password" autocomplete="off" placeholder="Leave empty to keep"></label>
            <label class="ui-field is-wide"><span class="ui-label">Recording storage (S3-compatible address)</span><input class="ui-input" name="s3_endpoint" placeholder="https://<account>.r2.cloudflarestorage.com"></label>
            <label class="ui-field"><span class="ui-label">Bucket</span><input class="ui-input" name="s3_bucket"></label>
            <label class="ui-field"><span class="ui-label">Region</span><input class="ui-input" name="s3_region" placeholder="auto"></label>
            <label class="ui-field"><span class="ui-label">Access key id</span><input class="ui-input" name="s3_access_key_id" type="password" autocomplete="off" placeholder="Leave empty to keep"></label>
            <label class="ui-field"><span class="ui-label">Secret access key</span><input class="ui-input" name="s3_secret_access_key" type="password" autocomplete="off" placeholder="Leave empty to keep"></label>
          </div>
          <div class="meet-form-a"><button class="ui-btn is-accent" type="submit" data-tool="meet.set_settings">Save settings</button></div>
        </form>
      </details>
    </section>` : ""}
    <section class="meet-section meet-ways">
      ${nav.suite ? "" : '<div class="ui-card"><h3 class="meet-h3">Use it here</h3><p class="ui-mute">Sign in with GitHub and start meetings on this server. Calls of up to 4 people need nothing else.</p></div>'}
      <div class="ui-card"><h3 class="meet-h3">Host it yourself, free</h3><p class="ui-mute">One command on your own server: <code>docker compose up</code>. Add a media server for big calls with <code>--profile meetings</code>. AGPL-3.0.</p><p><a class="ui-btn is-quiet is-sm" href="${REPO}" rel="noopener">${icon("github")} Get the code</a></p></div>
    </section>
  </main>`;
  app.removeAttribute("aria-busy");
  $("start")?.addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    try {
      const m = await callTool("meet.create", { title: signedIn ? `${w.user.name}'s meeting` : "Meeting" });
      const u = new URL(m.host_link);
      await nav.go(u.pathname + u.search);
    } catch (err) {
      toast(err.message);
      e.currentTarget.disabled = false;
    }
  });
  $("joinform").addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = new FormData(e.currentTarget).get("link").toString().trim();
    if (!v) return;
    try {
      const m = await callTool("meet.get", { meeting: v });
      const u = new URL(m.join_url);
      await nav.go(u.pathname);
    } catch (err) {
      toast(err.message);
    }
  });
  if (!signedIn) return;
  const sch = $("schedule");
  const d = new Date(Date.now() + 864e5);
  d.setMinutes(0, 0, 0);
  sch.starts_at.value = new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  sch.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(sch);
    try {
      await callTool("meet.schedule", { title: f.get("title"), starts_at: new Date(f.get("starts_at")).toISOString(), duration_min: Number(f.get("duration_min")), waiting_room: f.get("waiting_room") === "on" });
      sch.reset();
      toast("Scheduled. Copy the invite from the list.");
      loadMine();
    } catch (err) {
      toast(err.message);
    }
  });
  $("export").addEventListener("click", async () => {
    try {
      const data = await callTool("meet.export");
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })), download: "meetings-export.json" });
      a.click();
    } catch (err) {
      toast(err.message);
    }
  });
  $("doctor").addEventListener("click", async (e) => {
    const out = $("doctorout");
    e.currentTarget.disabled = true;
    out.innerHTML = '<p class="ui-mute">Checking\u2026</p>';
    try {
      const r = await callTool("meet.doctor");
      out.innerHTML = `<div class="ui-card meet-doctor"><h3 class="meet-h3">${esc(r.summary)}</h3><ul class="meet-checks">${r.checks.map((c) => `<li><span class="ui-chip ${c.ok ? "is-good" : "is-bad"}">${c.ok ? "ok" : "fix"}</span> <b>${esc(c.name)}</b>: ${esc(c.said)}${c.fix ? `<br><span class="ui-hint">${esc(c.fix)}</span>` : ""}</li>`).join("")}</ul></div>`;
    } catch (err) {
      out.innerHTML = `<div class="ui-notice is-quiet">${esc(err.message)}</div>`;
    }
    e.currentTarget.disabled = false;
  });
  loadMine();
  loadSettings();
}
var SECRET = ["notes_model_key", "transcribe_key", "s3_access_key_id", "s3_secret_access_key"];
async function loadSettings() {
  const f = $("settings");
  if (!f) return;
  const s = await callTool("meet.get_settings").catch(() => null);
  if (s) for (const el of f.querySelectorAll("input")) {
    const v = s[el.name];
    if (SECRET.includes(el.name)) el.placeholder = v?.set ? v.from === "server" ? "Set on the server" : "Set. Leave empty to keep" : "Not set";
    else if (v?.value && v.from === "settings") el.value = v.value;
    else if (v?.value) el.placeholder = `${v.value} (from the server)`;
  }
  f.onsubmit = async (e) => {
    e.preventDefault();
    const input = {};
    for (const el of f.querySelectorAll("input")) if (!SECRET.includes(el.name) || el.value) input[el.name] = el.value;
    try {
      await callTool("meet.set_settings", input);
      toast("Settings saved");
      for (const k of SECRET) f[k].value = "";
      loadSettings();
    } catch (err) {
      toast(err.message);
    }
  };
}
async function loadMine() {
  const el = $("mine");
  if (!el) return;
  const { meetings } = await callTool("meet.list");
  if (!meetings.length) {
    el.innerHTML = '<p class="ui-empty">No meetings yet. Start one, or schedule one below.</p>';
    return;
  }
  el.innerHTML = meetings.map((m) => `<div class="meet-row" data-id="${esc(m.id)}">
    <div class="meet-row-m"><b>${esc(m.title)}</b><span class="ui-mute">${m.status === "live" ? '<span class="ui-chip is-good">Live</span>' : esc(m.starts_at ? fmtWhen(m.starts_at) : "Not scheduled")}${m.kind === "webinar" ? " \xB7 webinar" : ""}</span></div>
    <div class="meet-row-a">
      <button class="ui-btn is-quiet is-sm" data-tool="meet.invite" data-act="invite">Copy invite</button>
      <a class="ui-btn is-sm" href="${esc(new URL(m.join_url).pathname)}">Join</a>
      ${m.status === "scheduled" ? '<button class="ui-btn is-ghost is-sm" data-tool="meet.cancel" data-act="cancel">Cancel</button>' : ""}
    </div></div>`).join("");
  el.onclick = async (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const id = b.closest("[data-id]").dataset.id;
    try {
      if (b.dataset.act === "invite") {
        const r = await callTool("meet.invite", { meeting: id });
        await copyText(r.message);
        toast("Invite copied");
      }
      if (b.dataset.act === "cancel") {
        await callTool("meet.cancel", { meeting: id });
        toast("Cancelled");
        loadMine();
      }
    } catch (err) {
      toast(err.message);
    }
  };
}
var ticketKey = (mid) => `meet:ticket:${mid}`;
var store2 = {
  get(k) {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      sessionStorage.setItem(k, v);
    } catch {
    }
  },
  del(k) {
    try {
      sessionStorage.removeItem(k);
    } catch {
    }
  }
};
async function joinPage(token) {
  const qs = nav.query();
  if (qs.get("hk")) return hostLinkPage(token, qs.get("hk"));
  let m = await callTool("meet.get", { meeting: token });
  const saved = store2.get(ticketKey(m.id));
  if (saved) {
    setTicket(saved);
    m = await callTool("meet.get", { meeting: token });
  }
  if (m.status === "ended") return endedPage("This meeting has ended.");
  if (m.you?.status === "removed") return endedPage("The host removed you from this meeting.");
  const hostKey = qs.get("host");
  const name = m.you?.display_name ?? state.who.user?.name ?? store2.get("meet:name") ?? "";
  const prefs = { audio: store2.get("meet:audio") !== "0", video: store2.get("meet:video") !== "0" };
  const viewer = m.kind === "webinar" && !hostKey && !m.you_host && !["speaker", "cohost", "host"].includes(m.you?.role);
  app.innerHTML = `${topBar()}
  <main class="meet-pre ${viewer ? "is-viewer" : ""}">
    ${viewer ? `<div class="meet-pre-v"><div class="ui-tile meet-preview is-cam-off"><span class="ui-avatar">${icon("people", 28)}</span></div><p class="ui-hint meet-perm">You join as a viewer. If the host lets you speak, your browser will ask for your microphone and camera then.</p></div>` : `<div class="meet-pre-v">
      <div class="ui-tile meet-preview ${prefs.video ? "" : "is-cam-off"}" id="preview"><video autoplay playsinline muted></video><span class="ui-avatar">${esc(initials(name || "?"))}</span><span class="ui-tile-n">${esc(name || "You")}</span></div>
      <div class="ui-callbar">
        <button data-tool="none" data-why="chooses whether you join with the microphone on; nothing is sent before you join" id="pmic" aria-pressed="${prefs.audio}" aria-label="Microphone">${icon(prefs.audio ? "mic" : "mic-off")}</button>
        <button data-tool="none" data-why="chooses whether you join with the camera on; nothing is sent before you join" id="pcam" aria-pressed="${prefs.video}" aria-label="Camera">${icon(prefs.video ? "cam" : "cam-off")}</button>
      </div>
      <p class="ui-hint meet-perm" id="perm"></p>
    </div>`}
    <form class="meet-pre-f" data-tool="meet.join" id="jf">
      <p class="ui-label">${m.kind === "webinar" ? "Webinar" : "Meeting"}</p>
      <h1 class="meet-h">${esc(m.title)}</h1>
      <p class="ui-mute">${m.status === "live" ? "Happening now." : m.starts_at ? `Starts ${esc(fmtWhen(m.starts_at))}.` : ""} ${m.waiting_room && !hostKey && !m.you_host ? "The host lets people in." : ""}</p>
      ${m.notes_on ? '<div class="ui-notice is-quiet meet-join-notice"><span><span class="ui-dot is-bad"></span> Notes are on in this meeting. Before anything you say is written down, you are asked, and you can say no.</span></div>' : ""}
      <label class="ui-field"><span class="ui-label">Your name</span><input class="ui-input" name="name" value="${esc(name)}" required maxlength="60" autocomplete="name" placeholder="Your name"></label>
      <button class="ui-btn is-accent is-lg is-block" type="submit" data-tool="meet.join">${hostKey || m.you_host ? "Start the meeting" : "Join"}</button>
      ${!state.who.user && state.who.signin_available ? `<p class="ui-hint">Have an account? <a href="/auth/github?next=${encodeURIComponent(location.pathname + location.search)}">Sign in with GitHub</a>.</p>` : ""}
    </form>
  </main>`;
  app.removeAttribute("aria-busy");
  const local = { stream: null, mic: null, cam: null };
  const video = app.querySelector("#preview video");
  const perm = $("perm");
  async function getMedia() {
    if (viewer) return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } } });
      local.mic = s.getAudioTracks()[0] ?? null;
      local.cam = s.getVideoTracks()[0] ?? null;
      perm.textContent = "";
    } catch (e) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        local.mic = s.getAudioTracks()[0];
      } catch {
      }
      perm.textContent = e.name === "NotAllowedError" ? "The browser blocked the camera or microphone. Allow them with the icon in the address bar, then reload. You can still join and listen." : "No camera found. You can still join.";
    }
    if (local.mic) local.mic.enabled = prefs.audio;
    if (local.cam && !prefs.video) {
      local.cam.stop();
      local.cam = null;
    }
    video.srcObject = local.cam ? new MediaStream([local.cam]) : null;
  }
  const mediaReady = getMedia();
  const pmic = $("pmic");
  const pcam = $("pcam");
  if (pmic) pmic.onclick = () => {
    prefs.audio = !prefs.audio;
    if (local.mic) local.mic.enabled = prefs.audio;
    pmic.setAttribute("aria-pressed", prefs.audio);
    pmic.innerHTML = icon(prefs.audio ? "mic" : "mic-off");
    store2.set("meet:audio", prefs.audio ? "1" : "0");
  };
  if (pcam) pcam.onclick = async () => {
    prefs.video = !prefs.video;
    pcam.setAttribute("aria-pressed", prefs.video);
    pcam.innerHTML = icon(prefs.video ? "cam" : "cam-off");
    store2.set("meet:video", prefs.video ? "1" : "0");
    $("preview").classList.toggle("is-cam-off", !prefs.video);
    if (!prefs.video && local.cam) {
      local.cam.stop();
      local.cam = null;
      video.srcObject = null;
    }
    if (prefs.video && !local.cam) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
        local.cam = s.getVideoTracks()[0];
        video.srcObject = new MediaStream([local.cam]);
      } catch {
        perm.textContent = "The camera is blocked or busy.";
      }
    }
  };
  $("jf").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.currentTarget.querySelector("button[type=submit]");
    btn.disabled = true;
    const nm = new FormData(e.currentTarget).get("name").toString().trim();
    store2.set("meet:name", nm);
    try {
      let r = await callTool("meet.join", { meeting: m.id, name: nm, ...hostKey ? { host_key: hostKey } : {} });
      setTicket(r.ticket);
      store2.set(ticketKey(m.id), r.ticket);
      if (hostKey) nav.replace(nav.path().split("?")[0]);
      if (r.participant.status === "waiting") r = await waitingRoom(m, r);
      if (!r) return;
      await mediaReady;
      const { Call: Call2 } = await Promise.resolve().then(() => (init_call(), call_exports));
      const call = new Call2({ root: app, meeting: r.meeting, participant: r.participant, media: r.media, local, prefs, onExit: (why) => {
        store2.del(ticketKey(m.id));
        endedPage(why);
      } });
      window.meetCall = call;
      await call.start();
    } catch (err) {
      btn.disabled = false;
      if (err instanceof ToolFailed && err.code === "ended") return endedPage(err.message);
      toast(err.message);
    }
  });
}
async function waitingRoom(m, r) {
  app.innerHTML = `${topBar()}<main class="meet-center"><div class="ui-card meet-narrow meet-waiting">
    <span class="meet-pulse" aria-hidden="true"></span>
    <h1 class="meet-h">Waiting for the host</h1>
    <p class="ui-mute">${esc(m.title)}. The host will let you in soon. Keep this page open.</p>
    <button class="ui-btn is-quiet" data-tool="meet.leave" id="wleave">Leave</button>
  </div></main>`;
  let gone = false;
  $("wleave").onclick = async () => {
    gone = true;
    await callTool("meet.leave", { meeting: m.id }).catch(() => {
    });
    store2.del(ticketKey(m.id));
    nav.go("/");
  };
  for (; ; ) {
    await new Promise((res) => setTimeout(res, 2e3));
    if (gone) return null;
    try {
      r = await callTool("meet.join", { meeting: m.id });
      if (r.participant.status === "admitted") return r;
      if (r.participant.status === "denied") {
        endedPage("The host did not let you in.");
        return null;
      }
    } catch (err) {
      if (["removed", "ended", "locked"].includes(err.code)) {
        endedPage(err.message);
        return null;
      }
    }
  }
}
function endedPage(message) {
  app.innerHTML = `${topBar()}<main class="meet-center"><div class="ui-card meet-narrow"><h1 class="meet-h">${esc(message || "You left the meeting.")}</h1><p class="meet-actions"><a class="ui-btn is-quiet" href="${nav.href("/")}">Back to start</a>${nav.path().startsWith("/m/") && !/ended|removed|did not/.test(message ?? "") ? `<a class="ui-btn" href="${esc(nav.href(nav.path().split("?")[0]))}">Rejoin</a>` : ""}</p></div></main>`;
  app.removeAttribute("aria-busy");
}
function hostLinkPage(token, hk) {
  const cmd = `npx -y github:warOnSaaS/meet host "${location.origin}${nav.href(`/m/${token}`)}?hk=${hk}"`;
  app.innerHTML = `${topBar()}<main class="meet-center"><div class="ui-card meet-narrow">
    <h1 class="meet-h">Help carry this call</h1>
    <p class="ui-mute">This link is for a computer that forwards the call for others. Run this in a terminal on a computer that is plugged in and has a good connection (Node 22 or newer), or open it in the wOS desktop app.</p>
    <pre class="meet-cmd"><code>${esc(cmd)}</code></pre>
    <p class="meet-actions"><button class="ui-btn is-quiet" data-tool="none" data-why="copies the command shown on screen" id="copycmd">Copy command</button><a class="ui-btn is-ghost" href="${esc(nav.href(`/m/${token}`))}">Join the call instead</a></p>
  </div></main>`;
  app.removeAttribute("aria-busy");
  $("copycmd").onclick = async () => {
    await copyText(cmd);
    toast("Copied");
  };
}

// screens/index.mjs
init_api();
init_dom();

// public/app/meet.css
var meet_default = ".wos-meet{@keyframes meet-pulse{0%{box-shadow:0 0 color-mix(in srgb,var(--ui-accent) 45%,transparent)}to{box-shadow:0 0 0 16px transparent}}@keyframes meet-blink{50%{opacity:.35}}}.wos-meet .meet-top{max-width:1200px;margin:0 auto}.wos-meet .meet-top-r{display:flex;align-items:center;gap:10px;font-size:14px;color:var(--ui-ink-2)}.wos-meet .meet-brand svg{height:22px;width:22px}.wos-meet .meet-h1{font-family:var(--ui-display);font-weight:var(--ui-display-weight,600);letter-spacing:var(--ui-display-track,-.02em);font-size:clamp(30px,5vw,48px);line-height:1.08;margin:0 0 14px}.wos-meet .meet-h{font-family:var(--ui-display);font-weight:var(--ui-display-weight,600);font-size:24px;line-height:1.2;margin:0 0 8px}.wos-meet .meet-h2{font-size:17px;font-weight:var(--ui-weight-strong,600);margin:0}.wos-meet .meet-h3{font-size:15px;font-weight:var(--ui-weight-strong,600);margin:0 0 8px}.wos-meet .meet-lead{font-size:17px;color:var(--ui-ink-2);max-width:640px;margin:0 0 24px;line-height:1.55}.wos-meet .meet-home{max-width:960px;margin:0 auto;padding:clamp(24px,6vw,72px) 16px 64px}.wos-meet .meet-hero{margin-bottom:48px}.wos-meet .meet-actions{display:flex;flex-wrap:wrap;gap:12px;align-items:center}.wos-meet .meet-joinform{display:flex;gap:8px;flex:1;min-width:min(100%,320px);max-width:440px}.wos-meet .meet-joinform .ui-input{min-height:42px}.wos-meet .meet-section{margin-top:36px}.wos-meet .meet-section-h{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap}.wos-meet .meet-section-a{display:flex;gap:8px}.wos-meet .meet-list{display:grid;gap:8px;margin-bottom:20px}.wos-meet .meet-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;background:var(--ui-card);border:1px solid var(--ui-card-line);border-radius:var(--ui-radius);flex-wrap:wrap}.wos-meet .meet-row-m{display:grid;gap:2px;min-width:0}.wos-meet .meet-row-m b{font-weight:var(--ui-weight-strong,600)}.wos-meet .meet-row-m .ui-mute{font-size:13.5px}.wos-meet .meet-row-a{display:flex;gap:6px;flex-wrap:wrap}.wos-meet .meet-schedule{margin-top:8px}.wos-meet .meet-form-a{display:flex;justify-content:flex-end}.wos-meet .meet-ways{display:grid;grid-template-columns:1fr 1fr;gap:12px}.wos-meet .meet-ways p{margin:0 0 8px}.wos-meet .meet-ways code,.wos-meet .meet-cmd{font-family:var(--ui-mono,ui-monospace),monospace;font-size:13px}.wos-meet .meet-doctor{margin-top:12px}.wos-meet .meet-checks{list-style:none;padding:0;margin:0;display:grid;gap:8px;font-size:14px}.wos-meet .meet-center{min-height:calc(100svh - 80px);display:grid;place-items:center;padding:16px}.wos-meet .meet-narrow{width:min(520px,100%);padding:28px}.wos-meet .meet-cmd{white-space:pre-wrap;word-break:break-all;background:var(--ui-surface-2);border:1px solid var(--ui-line);border-radius:var(--ui-radius-sm);padding:12px;margin:12px 0}.wos-meet .meet-waiting{text-align:center}.wos-meet .meet-waiting .ui-btn{margin-top:8px}.wos-meet .meet-pulse{display:block;width:14px;height:14px;margin:4px auto 16px;border-radius:50%;background:var(--ui-accent);animation:meet-pulse 1.6s ease-out infinite}@media(prefers-reduced-motion:reduce){.wos-meet .meet-pulse{animation:none}}.wos-meet .meet-pre{max-width:1100px;margin:0 auto;padding:clamp(16px,4vw,48px) 16px;display:grid;grid-template-columns:minmax(0,1.5fr) minmax(280px,1fr);gap:clamp(20px,4vw,48px);align-items:center}.wos-meet .meet-preview{width:100%}.wos-meet .meet-preview video{transform:scaleX(-1)}.wos-meet .meet-pre-f .ui-btn.is-block{margin-top:4px}.wos-meet .meet-pre-f .ui-hint{margin-top:12px}.wos-meet .meet-perm{text-align:center;min-height:1em}.wos-meet .ui-tile>.ui-avatar{position:relative;z-index:0}.wos-meet .ui-tile video{opacity:0;transition:opacity var(--ui-dur) var(--ui-ease)}.wos-meet .ui-tile.has-video video,.wos-meet .meet-preview:not(.is-cam-off) video{opacity:1;z-index:1}.wos-meet .ui-tile.has-video>.ui-avatar{visibility:hidden}.wos-meet .ui-tile .ui-tile-n,.wos-meet .ui-tile .ui-tile-tag{z-index:2}.wos-meet .ui-tile.is-mine video{transform:scaleX(-1)}.wos-meet .ui-tile.is-screen video{object-fit:contain;background:#000}.wos-meet .ui-tile.is-trouble{box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--ui-bad) 60%,transparent)}.wos-meet .ui-callbar button svg{pointer-events:none}.wos-meet .ui-callbar button.is-on{background:var(--ui-accent);color:var(--ui-on-accent);border-color:transparent}.wos-meet .meet-call{height:100svh;display:grid;grid-template-rows:auto auto minmax(0,1fr) auto}.wos-meet .meet-call-top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px 4px}.wos-meet .meet-call-t{display:flex;align-items:baseline;gap:10px;min-width:0}.wos-meet .meet-call-t b{font-weight:var(--ui-weight-strong,600);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wos-meet .meet-mode{font-size:13px;white-space:nowrap}.wos-meet .meet-notices{display:grid;gap:6px;padding:0 16px}.wos-meet .meet-notices:not(:empty){padding-top:6px}.wos-meet .meet-notices .ui-notice{align-items:center;flex-wrap:wrap}.wos-meet .meet-notices .ui-notice>span{flex:1;min-width:200px}.wos-meet .meet-body{display:grid;grid-template-columns:minmax(0,1fr);min-height:0;padding:8px 16px 0;gap:12px}.wos-meet .meet-call[data-panel=people] .meet-body,.wos-meet .meet-call[data-panel=chat] .meet-body,.wos-meet .meet-call[data-panel=info] .meet-body{grid-template-columns:minmax(0,1fr) 340px}.wos-meet .meet-stage{position:relative;min-height:0;display:grid;grid-template-rows:minmax(0,1fr);overflow:hidden;border-radius:var(--ui-radius-lg)}.wos-meet .meet-stage .ui-calls{min-height:0;overflow:auto;align-content:center;justify-content:center}.wos-meet .meet-main:empty{display:none}.wos-meet .meet-stage.has-big{grid-template-rows:minmax(0,1fr) auto}.wos-meet .meet-stage.has-big .meet-main{min-height:0;display:grid;padding:8px;background:color-mix(in srgb,var(--ui-ink) 6%,var(--ui-bg));border-radius:var(--ui-radius-lg) var(--ui-radius-lg) 0 0}.wos-meet .meet-stage.has-big .meet-main>.ui-tile{aspect-ratio:auto;height:100%;min-height:0;grid-column:auto}.wos-meet .meet-stage.has-big .meet-main>.ui-tile video{object-fit:contain;background:#000}.wos-meet .ui-calls.is-strip{display:flex;overflow-x:auto;align-content:start;border-radius:0 0 var(--ui-radius-lg) var(--ui-radius-lg)}.wos-meet .ui-calls.is-strip:empty{display:none}.wos-meet .ui-calls.is-strip>.ui-tile{flex:0 0 180px;aspect-ratio:16/10}.wos-meet .meet-tap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:5}.wos-meet .meet-bar{padding:10px 16px calc(10px + env(safe-area-inset-bottom))}.wos-meet .meet-bar-sep{width:1px;height:28px;background:var(--ui-line);margin:0 4px}.wos-meet .meet-bar button{position:relative}.wos-meet .meet-dot{position:absolute;top:-3px;right:-3px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--ui-accent);color:var(--ui-on-accent);font:600 11px/18px var(--ui-font)}.wos-meet .meet-side{min-height:0;display:none;flex-direction:column;background:var(--ui-surface);border:1px solid var(--ui-line);border-radius:var(--ui-radius-lg);overflow:hidden}.wos-meet .meet-side:not(:empty){display:flex}.wos-meet .meet-side-h{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px 0;border-bottom:1px solid var(--ui-line)}.wos-meet .meet-side-h .ui-tabs{border:0}.wos-meet .meet-side-b{flex:1;min-height:0;overflow:auto;padding:12px 14px;display:flex;flex-direction:column}.wos-meet .meet-side-sub{font-size:12px;font-weight:500;color:var(--ui-ink-3);margin:12px 0 6px}.wos-meet .meet-side-sub:first-child{margin-top:0}.wos-meet .meet-side-a{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 4px}.wos-meet .meet-side-a.is-col{flex-direction:column;align-items:stretch;margin-top:16px}.wos-meet .meet-side-a.is-col .ui-btn{justify-content:flex-start}.wos-meet .meet-plist{list-style:none;margin:0;padding:0;display:grid;gap:2px}.wos-meet .meet-prow{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;padding:6px 4px;border-radius:var(--ui-radius-sm)}.wos-meet .meet-prow:hover{background:var(--ui-hover)}.wos-meet .meet-prow-m{display:grid;gap:2px;min-width:0;font-size:14px}.wos-meet .meet-prow-m>span:first-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wos-meet .meet-prow-c{display:flex;gap:4px;flex-wrap:wrap}.wos-meet .meet-prow-c:empty{display:none}.wos-meet .meet-prow-i{color:var(--ui-ink-3);display:grid}.wos-meet .meet-prow-i.is-off{color:var(--ui-bad)}.wos-meet .meet-prow-a{grid-column:2/-1;display:none;flex-wrap:wrap;gap:4px}.wos-meet .meet-prow:hover .meet-prow-a,.wos-meet .meet-prow:focus-within .meet-prow-a,.wos-meet .meet-prow-a.is-on{display:flex}@media(hover:none){.wos-meet .meet-prow-a{display:flex}}.wos-meet .meet-chatlist{list-style:none;margin:0;padding:0;flex:1;overflow:auto;display:flex;flex-direction:column;gap:10px}.wos-meet .meet-cmsg{display:grid;gap:2px;font-size:14px}.wos-meet .meet-cmsg-h{font-size:12.5px}.wos-meet .meet-cmsg-b{white-space:pre-wrap;overflow-wrap:anywhere}.wos-meet .meet-composer{margin:10px 0 0}.wos-meet .meet-kv{font-size:13.5px}.wos-meet .meet-link code{font-family:var(--ui-mono,ui-monospace),monospace;font-size:12.5px;word-break:break-all}.wos-meet .meet-hosts{list-style:none;padding:0;margin:0;display:grid;gap:6px;font-size:13.5px}.wos-meet .meet-hosts li{display:flex;gap:6px;align-items:center}.wos-meet .meet-hostcmd{margin-top:12px;font-size:13.5px}.wos-meet .meet-call-tr{display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end}.wos-meet .meet-notes-on .ui-dot,.wos-meet .meet-rec-on .ui-dot{animation:meet-blink 1.6s ease-in-out infinite}@media(prefers-reduced-motion:reduce){.wos-meet .meet-notes-on .ui-dot,.wos-meet .meet-rec-on .ui-dot{animation:none}}.wos-meet .meet-dot.is-rec{min-width:9px;width:9px;height:9px;padding:0;top:2px;right:2px;background:var(--ui-bad)}.wos-meet .meet-cap{position:absolute;left:0;right:0;bottom:12px;display:flex;justify-content:center;pointer-events:none;z-index:4;padding:0 12px}.wos-meet .meet-cap:empty{display:none}.wos-meet .meet-captions{max-width:min(760px,100%);display:grid;gap:2px;padding:8px 14px;border-radius:var(--ui-radius);background:color-mix(in srgb,#000 72%,transparent);color:#fff;font-size:15px;line-height:1.45}.wos-meet .meet-captions p{margin:0}.wos-meet .meet-captions b{font-weight:var(--ui-weight-strong,600);margin-right:6px;color:color-mix(in srgb,#fff 78%,var(--ui-accent))}.wos-meet .meet-stage.has-big .meet-cap{bottom:132px}.wos-meet .meet-more{position:fixed;inset:0;z-index:30}.wos-meet .meet-more-in{position:absolute;right:16px;bottom:calc(72px + env(safe-area-inset-bottom));min-width:220px;display:grid;padding:6px;background:var(--ui-surface);border:1px solid var(--ui-line-2);border-radius:var(--ui-radius-lg);box-shadow:var(--ui-shadow-lg)}.wos-meet .meet-more-i{display:flex;align-items:center;gap:10px;padding:9px 10px;font:inherit;font-size:14px;color:var(--ui-ink);background:none;border:0;border-radius:var(--ui-radius-sm);cursor:pointer;text-align:left}.wos-meet .meet-more-i:hover,.wos-meet .meet-more-i:focus-visible{background:var(--ui-hover)}.wos-meet .meet-more-i svg{color:var(--ui-ink-2);flex:none}.wos-meet .meet-notes-h{display:flex;gap:10px;align-items:flex-start;font-size:14px;margin-bottom:10px}.wos-meet .meet-notes-h .ui-dot{margin-top:6px}.wos-meet .meet-notes-me{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:14px}.wos-meet .meet-nrow{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px;font-size:14px}.wos-meet .meet-transcript{list-style:none;margin:0;padding:0;display:grid;gap:10px;font-size:14px}.wos-meet .meet-transcript li{display:grid;gap:1px}.wos-meet .meet-tr-h{font-size:12.5px}.wos-meet .meet-notes-b{font-size:14px;line-height:1.5;background:var(--ui-surface-2);border:1px solid var(--ui-line);border-radius:var(--ui-radius);padding:10px 12px;margin-bottom:8px}.wos-meet .meet-notes-b p{margin:0 0 6px}.wos-meet .meet-notes-b ul{margin:0 0 8px;padding-left:18px}.wos-meet .meet-send{display:grid;gap:6px}.wos-meet .meet-send form{display:flex;gap:6px}.wos-meet .meet-send .ui-input{min-width:0;flex:1}.wos-meet .meet-send p{margin:0}.wos-meet .meet-dlg p{margin:0 0 10px;line-height:1.5}.wos-meet .meet-join-notice{margin-bottom:12px}.wos-meet .meet-settings{margin-top:12px}.wos-meet .meet-settings summary{cursor:pointer;margin:0}.wos-meet .meet-settings form{margin-top:12px}.wos-meet .meet-wb{position:absolute;inset:0;z-index:6;display:grid;grid-template-rows:auto minmax(0,1fr);background:var(--ui-surface);border:1px solid var(--ui-line);border-radius:var(--ui-radius-lg);overflow:hidden}.wos-meet .meet-wb[hidden]{display:none}.wos-meet .meet-wb-h{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px 6px 14px;border-bottom:1px solid var(--ui-line);flex-wrap:wrap}.wos-meet .meet-wb-t{font-weight:var(--ui-weight-strong,600);font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}.wos-meet .meet-wb-a{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.wos-meet .meet-wb-att{display:flex;gap:6px}.wos-meet .meet-wb-att .ui-input{min-height:32px;width:230px}.wos-meet .meet-wb-c{position:relative;min-height:0}.wos-meet .meet-wb-c .excalidraw{--ui-pad:0}@media(max-width:760px){.wos-meet .meet-pre{grid-template-columns:1fr}.wos-meet .meet-pre.is-viewer .meet-preview{aspect-ratio:16/9}.wos-meet .meet-ways{grid-template-columns:1fr}.wos-meet .meet-body{padding:6px 8px 0}.wos-meet .meet-call[data-panel=people] .meet-body,.wos-meet .meet-call[data-panel=chat] .meet-body,.wos-meet .meet-call[data-panel=info] .meet-body{grid-template-columns:minmax(0,1fr)}.wos-meet .meet-side{position:fixed;left:0;right:0;bottom:calc(62px + env(safe-area-inset-bottom));z-index:20;height:min(64svh,calc(100svh - 140px));border-radius:var(--ui-radius-lg) var(--ui-radius-lg) 0 0;box-shadow:var(--ui-shadow-lg)}.wos-meet .meet-bar{gap:5px;padding-left:8px;padding-right:8px;flex-wrap:nowrap}.wos-meet .meet-bar button{width:38px;height:38px;flex:none}.wos-meet .meet-bar [data-act=info],.wos-meet .meet-bar .meet-hide-sm{display:none}.wos-meet .meet-more-in{left:8px;right:8px}.wos-meet .meet-cap{bottom:8px}.wos-meet .meet-captions{font-size:14px}.wos-meet .meet-wb-att{display:none}.wos-meet .meet-wb-h{padding:4px 6px 4px 10px}.wos-meet .meet-bar-sep{display:none}.wos-meet .meet-bar button.is-leave{width:auto;padding:0 14px}.wos-meet .ui-calls.is-strip>.ui-tile{flex-basis:120px;aspect-ratio:3/4}.wos-meet .meet-mode{display:none}}\n";

// screens/index.mjs
var BASE = "/a/meet";
var index_default = {
  title: "Meetings",
  mount(el, ctx) {
    const doc = el.ownerDocument;
    el.classList.add("wos-meet");
    if (!doc.getElementById("wos-meet-style")) doc.head.append(Object.assign(doc.createElement("style"), { id: "wos-meet-style", textContent: meet_default }));
    configure({ callTool: (name, input) => ctx.callTool(name, input), media: "/media/meet" });
    if (ctx.toast) setToast((m) => ctx.toast(m));
    let path = ctx.path || "/";
    const strip = (p) => {
      let x = String(p);
      if (x.startsWith(BASE)) x = x.slice(BASE.length) || "/";
      return x;
    };
    const nav2 = {
      suite: true,
      path: () => path,
      query: () => new URLSearchParams(path.split("?")[1] ?? ""),
      // The suite's address bar carries the path; a query (a host key) stays in memory only.
      go: (p) => {
        path = strip(p);
        ctx.navigate(path.split("?")[0]);
        return route();
      },
      replace: (p) => {
        path = strip(p);
      },
      href: (p) => `${BASE}${p === "/" ? "" : p}`
    };
    const onClick = (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest?.("a[href]");
      if (!a || a.target || a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href.startsWith(BASE)) return;
      e.preventDefault();
      nav2.go(href);
    };
    el.addEventListener("click", onClick);
    startMeet(el, nav2);
    return {
      update(p) {
        const next = strip(p || "/");
        if (next.split("?")[0] === path.split("?")[0]) return;
        path = next;
        stopMeet().finally(() => route());
      },
      unmount() {
        el.removeEventListener("click", onClick);
        stopMeet();
        el.innerHTML = "";
        el.classList.remove("wos-meet");
      }
    };
  }
};
export {
  index_default as default
};
