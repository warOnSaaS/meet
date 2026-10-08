// Writes down what one microphone says, on this device.
//
// Whisper (OpenAI's speech model, MIT licence) runs in the browser through transformers.js (Apache-2.0):
// on the graphics chip with WebGPU where the browser has it, otherwise on the processor (WebAssembly). The
// model downloads once (about 40 MB for tiny.en, 80 MB for base.en) and the browser keeps it. Audio never
// leaves the device for this. Where Whisper cannot run, the browser's own speech service (Web Speech API) is
// the fallback, and the screen says so, because Chrome and Safari may send that audio to their servers.
//
// Speech is cut into utterances by loudness (a small voice activity detector), and each utterance becomes one
// line with its start and end time.
import { assetUrl } from '../api.mjs';

export const ENGINE_LABEL = {
  'whisper-webgpu': 'Whisper on this device, using its graphics chip',
  'whisper-wasm': 'Whisper on this device',
  'web-speech': 'Your browser\'s speech service (Chrome and Safari may send your audio to their servers)',
  none: 'This device cannot write down speech, so a helper in the call or the server does it',
  helper: 'A helper in the call',
  server: 'The team\'s speech service',
};

const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } } };

/** What this device can use, best first. localStorage meet:engine forces one (for testing fallbacks). */
export async function detectEngine() {
  const forced = store.get('meet:engine');
  if (forced) return forced;
  const mem = navigator.deviceMemory ?? 8;
  if (typeof WebAssembly === 'object' && typeof Worker === 'function' && mem >= 2) {
    if (navigator.gpu) { try { if (await navigator.gpu.requestAdapter()) return 'whisper-webgpu'; } catch {} }
    return 'whisper-wasm';
  }
  if (globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition) return 'web-speech';
  return 'none';
}

export const modelFor = (engine) => store.get('meet:whisper-model') || (engine === 'whisper-webgpu' ? 'onnx-community/whisper-base.en' : 'onnx-community/whisper-tiny.en');

// ---------------------------------------------------------------- Whisper, shared by every transcriber here

let worker = null;
let workerReady = null;
let seq = 0;
const waiting = new Map();
export const whisperStats = { loads: 0, loadMs: null, runs: 0, totalMs: 0, audioMs: 0, device: null, model: null, progress: null };

function loadWhisper(engine, onProgress) {
  if (workerReady) return workerReady;
  worker = new Worker(assetUrl('whisper-worker.js'), { type: 'module' });
  const t0 = performance.now();
  workerReady = new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const d = e.data;
      if (d.op === 'progress') { whisperStats.progress = d; onProgress?.(d); }
      if (d.op === 'ready') { whisperStats.loads++; whisperStats.loadMs = Math.round(performance.now() - t0); whisperStats.device = d.device; whisperStats.model = d.model; resolve(d); }
      if (d.op === 'error' && !d.id) reject(new Error(d.message));
      if (d.id && waiting.has(d.id)) { const w = waiting.get(d.id); waiting.delete(d.id); d.op === 'error' ? w.reject(new Error(d.message)) : w.resolve(d); }
    };
    worker.onerror = (e) => reject(new Error(e.message || 'The speech model could not start.'));
  });
  worker.postMessage({ op: 'load', model: modelFor(engine), device: engine === 'whisper-webgpu' ? 'webgpu' : 'wasm' });
  return workerReady;
}

async function whisper(audio) {
  await workerReady;
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker.postMessage({ op: 'run', id, audio }, [audio.buffer]);
  });
}

// Whisper writes these when it hears no words.
const NOISE = /^\s*(\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|you\.?|thank you\.?|thanks for watching!?|\.+)\s*$/i;

// ---------------------------------------------------------------- utterances from a microphone track

const WORKLET = `class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) { for (let i = 0; i < ch.length; i++) { this.buf[this.n++] = ch[i]; if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; } } }
    return true;
  }
}
registerProcessor('meet-tap', Tap);`;

const RATE = 16000;
const FRAME = 480; // 30 ms at 16 kHz

export class Utterances {
  /** onUtterance({ audio: Float32Array at 16 kHz, start, end, speechEnd }) with times in ms since 1970. */
  constructor(track, { onUtterance, hangMs = 700, maxMs = 15000, minMs = 350 } = {}) {
    Object.assign(this, { track, onUtterance, hangMs, maxMs, minMs });
    this.level = 0;
  }

  async start() {
    this.ctx = new AudioContext();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    this.src = this.ctx.createMediaStreamSource(new MediaStream([this.track]));
    this.node = new AudioWorkletNode(this.ctx, 'meet-tap');
    const mute = this.ctx.createGain(); mute.gain.value = 0;
    this.src.connect(this.node).connect(mute).connect(this.ctx.destination);
    this.ratio = this.ctx.sampleRate / RATE;
    this.carry = 0;
    this.pending = new Float32Array(0);
    this.pre = []; // the last 300 ms before speech, so the first word is not cut
    this.cur = null;
    this.floor = 0.004;
    this.node.port.onmessage = (e) => this.feed(e.data);
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  // Down to 16 kHz by averaging (enough for speech), then 30 ms frames. Samples not used yet wait in rest.
  feed(chunk) {
    const input = this.rest?.length ? new Float32Array(this.rest.length + chunk.length) : chunk;
    if (input !== chunk) { input.set(this.rest); input.set(chunk, this.rest.length); }
    const out = [];
    let pos = this.carry; // a fraction of a sample, 0 <= carry < 1
    while (pos + this.ratio <= input.length) {
      let s = 0; const a = Math.floor(pos), b = Math.floor(pos + this.ratio);
      for (let i = a; i < b; i++) { const x = input[i]; if (x === x) s += x; } // skip NaN samples
      out.push(s / Math.max(1, b - a));
      pos += this.ratio;
    }
    const used = Math.floor(pos);
    this.carry = pos - used;
    this.rest = input.slice(used);
    const joined = new Float32Array(this.pending.length + out.length);
    joined.set(this.pending); joined.set(out, this.pending.length);
    let i = 0;
    for (; i + FRAME <= joined.length; i += FRAME) this.frame(joined.subarray(i, i + FRAME));
    this.pending = joined.slice(i);
  }

  frame(f) {
    const now = performance.timeOrigin + performance.now();
    let sum = 0; for (const v of f) sum += v * v;
    const rms = Number.isFinite(sum) ? Math.sqrt(sum / f.length) : 0;
    this.level = rms;
    // The noise floor follows quiet stretches quickly and loud ones slowly.
    this.floor = rms < this.floor ? this.floor * 0.9 + rms * 0.1 : this.floor * 0.999 + rms * 0.001;
    if (!Number.isFinite(this.floor)) this.floor = 0.004;
    const loud = rms > Math.max(0.01, this.floor * 3);
    const copy = f.slice(0);
    if (!this.cur) {
      this.pre.push(copy); if (this.pre.length > 10) this.pre.shift();
      if (loud) { this.cur = { frames: [...this.pre], start: now - this.pre.length * 30, lastLoud: now, loudFrames: 1 }; this.pre = []; }
      return;
    }
    this.cur.frames.push(copy);
    if (loud) { this.cur.lastLoud = now; this.cur.loudFrames++; }
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
    try { this.src?.disconnect(); this.node?.disconnect(); } catch {}
    this.ctx?.close().catch(() => {});
  }
}

// ---------------------------------------------------------------- one transcriber per microphone

export class Transcriber {
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
    if (this.engine === 'web-speech') return this.startWebSpeech();
    if (this.engine.startsWith('whisper')) {
      this.onState?.('loading');
      await loadWhisper(this.engine, (p) => this.onState?.('loading', p));
    }
    this.cuts = new Utterances(this.track, { onUtterance: (u) => { this.queue = this.queue.then(() => this.write(u)).catch((e) => console.warn('[meet] notes', e.message)); } });
    await this.cuts.start();
    this.onState?.('listening');
  }

  async write(u) {
    if (this.stopped) return;
    const t0 = performance.now();
    let text = '';
    if (this.engine === 'server') text = await this.server(wavBase64(u.audio), u.start, u.end);
    else {
      const audioMs = (u.audio.length / RATE) * 1000; // read before the audio moves to the worker
      const r = await whisper(u.audio);
      text = r.text;
      whisperStats.runs++; whisperStats.totalMs += r.ms; whisperStats.audioMs += audioMs;
    }
    text = String(text ?? '').trim();
    if (!text || NOISE.test(text)) return;
    this.onSegment?.({ id: `${this.idBase ??= Math.random().toString(36).slice(2, 8)}-${++this.n}`, start_at: Math.round(u.start), end_at: Math.round(u.end), text, engine: this.engine, speech_end: Math.round(u.speechEnd), run_ms: Math.round(performance.now() - t0) });
  }

  startWebSpeech() {
    const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    const r = new SR();
    r.continuous = true; r.interimResults = false; r.lang = navigator.language || 'en-US';
    let start = performance.timeOrigin + performance.now();
    r.onspeechstart = () => { start = performance.timeOrigin + performance.now(); };
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue;
        const end = performance.timeOrigin + performance.now();
        const text = e.results[i][0].transcript.trim();
        if (text) this.onSegment?.({ id: `ws-${++this.n}-${Math.round(end)}`, start_at: Math.round(start), end_at: Math.round(end), text, engine: 'web-speech', speech_end: Math.round(end), run_ms: 0 });
        start = end;
      }
    };
    r.onerror = (e) => this.onState?.('error', { message: e.error === 'not-allowed' ? 'The browser blocked its speech service.' : `The browser's speech service stopped (${e.error}).` });
    r.onend = () => { if (!this.stopped) try { r.start(); } catch {} };
    r.start();
    this.sr = r;
    this.onState?.('listening');
  }

  get level() { return this.cuts?.level ?? 0; }

  stop() {
    this.stopped = true;
    this.cuts?.stop();
    try { this.sr?.stop(); } catch {}
  }
}

/** 16 kHz mono PCM as a WAV file, base64, for the server fallback. */
export function wavBase64(f32) {
  const n = f32.length;
  const buf = new DataView(new ArrayBuffer(44 + n * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) buf.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); buf.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); buf.setUint32(16, 16, true);
  buf.setUint16(20, 1, true); buf.setUint16(22, 1, true); buf.setUint32(24, RATE, true); buf.setUint32(28, RATE * 2, true);
  buf.setUint16(32, 2, true); buf.setUint16(34, 16, true); w(36, 'data'); buf.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) buf.setInt16(44 + i * 2, Math.max(-1, Math.min(1, f32[i])) * 0x7fff, true);
  const u8 = new Uint8Array(buf.buffer);
  let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
