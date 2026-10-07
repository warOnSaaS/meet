// Test helpers: an in-process server on a free port with its own SQLite file, and a Chromium that fakes the
// camera and microphone (a moving test pattern and a beep), so calls run with no hardware and no prompts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

export async function startServer(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meet-test-'));
  Object.assign(process.env, { SESSION_SECRET: 'test-secret-'.padEnd(40, 'x'), DEV_LOGIN: '1', MEET_DB: path.join(dir, 'meet.db'), STUN_URLS: '', ...env });
  delete process.env.DATABASE_URL;
  // MEET_TEST_DATABASE_URL runs the same tests on Postgres (a database used only for tests).
  if (process.env.MEET_TEST_DATABASE_URL && !env.DATABASE_URL) env = { ...env, DATABASE_URL: process.env.MEET_TEST_DATABASE_URL };
  const { openDb } = await import('../server/db.mjs');
  const { loadConfig } = await import('../server/config.mjs');
  const { createApp } = await import('../server/http.mjs');
  const { attachWs } = await import('../server/ws.mjs');
  const db = await openDb(env.DATABASE_URL ?? `sqlite:${path.join(dir, 'meet.db')}`);
  const config = loadConfig();
  // No STUN in tests: everything is on this machine, so host candidates are enough.
  config.stun = [];
  const app = createApp({ db, config });
  const server = http.createServer((req, res) => app.handle(req, res));
  if (env.NO_WS !== '1') attachWs(server, app);
  else app.config.serverless = true;
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    app, db, base, dir,
    async close() {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
      await sleep(1500); // let long-polls that were waiting finish before the database closes
      await db.close?.();
    },
  };
}

export async function launch(extra = []) {
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = await import(path.join(os.homedir(), 'crm/node_modules/playwright/index.mjs'))); }
  return chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', ...extra],
  });
}

export async function api(base, name, input = {}, { cookie, ticket, token } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  if (ticket) headers['x-meet-ticket'] = ticket;
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(`${base}/api/tools/${name}`, { method: 'POST', headers, body: JSON.stringify(input) });
  const d = await r.json();
  if (!d.ok) throw Object.assign(new Error(`${name}: ${d.error?.message}`), { code: d.error?.code, status: r.status });
  return d.result;
}

// A signed-in session cookie for a fictional member, through the dev sign-in route.
export async function devCookie(base, login = 'sam') {
  const r = await fetch(`${base}/auth/dev?login=${login}`, { redirect: 'manual' });
  return r.headers.get('set-cookie').split(';')[0];
}

// Open a page, sign in when asked, and get to the call screen.
export async function joinAs(browser, url, name, { login, viewport = { width: 1280, height: 800 } } = {}) {
  const ctx = await browser.newContext({ viewport, permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name} pageerror]`, e.message));
  page.on('console', (m) => { if (m.type() === 'error' || /\[meet\]/.test(m.text())) console.log(`[${name}]`, m.text()); });
  if (login) await page.goto(`${new URL(url).origin}/auth/dev?login=${login}&name=${encodeURIComponent(name)}&next=${encodeURIComponent(new URL(url).pathname + new URL(url).search)}`);
  else await page.goto(url);
  await page.waitForSelector('#jf');
  await page.fill('#jf input[name=name]', name);
  await page.click('#jf button[type=submit]');
  return { ctx, page, name };
}

export const inCall = (page) => page.waitForFunction(() => !!window.meetCall?.peer, null, { timeout: 20000 });

// Wait until this page shows `n` remote tiles whose video is playing, and hears `n` remote audio streams.
export async function waitForMedia(page, n, timeout = 30000) {
  await page.waitForFunction((n) => {
    const s = window.meetCall?.view();
    if (!s) return false;
    const remote = s.tiles.filter((t) => !/\(you\)/.test(t.name) && !/screen/i.test(t.name));
    const playing = remote.filter((t) => t.video && t.w > 0 && t.t > 0.3);
    const audio = s.audio.filter((a) => a.playing && a.t > 0.3);
    return playing.length >= n && audio.length >= n;
  }, n, { timeout, polling: 500 });
  return page.evaluate(() => window.meetCall.snapshot());
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- participant hosts ----------


// Start a participant host process for a meeting, the way a person would with the command from
// "Help carry this call". Flags make it ready at once (no one minute warm-up) with a stated upload.
export async function startHost(base, meeting, ticket, { name = 'host', upload = 40, extra = [] } = {}) {
  const r = await api(base, 'meet.add_host', { meeting }, { ticket });
  const bin = new URL('../bin/meet.mjs', import.meta.url).pathname;
  const child = spawn(process.execPath, [bin, 'host', r.host_url, '--local', '--warmup=0', `--upload-mbps=${upload}`, '--assume-plugged', `--name=${name}`, ...extra], { stdio: ['ignore', 'pipe', 'pipe'] });
  const lines = [];
  const onData = (d) => { for (const l of String(d).split('\n').filter(Boolean)) { lines.push(l); if (process.env.MEET_HOST_LOG) console.log(`[${name}] ${l}`); } };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  return { child, lines, name, kill: (sig = 'SIGKILL') => child.kill(sig), exited: new Promise((res) => child.on('exit', res)) };
}

// Wait until the server says this many computers are ready to carry the call.
export async function waitHostsReady(base, meeting, ticket, n, timeout = 30000) {
  const end = Date.now() + timeout;
  for (;;) {
    const s = await api(base, 'meet.list_hosts', { meeting }, { ticket });
    if (s.hosts.filter((h) => h.status === 'ready').length >= n) return s;
    if (Date.now() > end) throw new Error(`hosts not ready: ${JSON.stringify(s.hosts)}`);
    await sleep(500);
  }
}

// The meeting ticket a page holds (for calling tools as that person from the test).
export const ticketOf = (page) => page.evaluate(() => sessionStorage.getItem(Object.keys(sessionStorage).find((k) => k.startsWith('meet:ticket:'))));

// ---------- audio delay ----------

// Give every page a generated microphone (silence, with a tone we switch on), and a detector on each
// received audio stream that notes when a tone starts. All pages run on this computer, so they share a clock.
export async function installToneProbe(page) {
  await page.evaluate(async () => {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(); osc.frequency.value = 880;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const dest = ctx.createMediaStreamDestination();
    osc.connect(gain).connect(dest); osc.start();
    const track = dest.stream.getAudioTracks()[0];
    const call = window.meetCall;
    call.local.mic = track; call.audioOn = true;
    await call.engine?.setTrack('mic', track);
    const heard = [];
    const watching = new Map();
    const watch = () => {
      for (const [peer, a] of call.audios) {
        if (watching.has(peer) || !a.srcObject) continue;
        const src = ctx.createMediaStreamSource(a.srcObject);
        const an = ctx.createAnalyser(); an.fftSize = 256; src.connect(an);
        watching.set(peer, { an, buf: new Float32Array(256), on: false });
      }
      for (const [peer, w] of watching) {
        w.an.getFloatTimeDomainData(w.buf);
        let s = 0; for (const v of w.buf) s += v * v;
        const loud = Math.sqrt(s / w.buf.length) > 0.05;
        if (loud && !w.on) heard.push({ peer, at: performance.timeOrigin + performance.now() });
        w.on = loud;
      }
    };
    setInterval(watch, 2);
    window.meetTone = {
      beep(ms = 300) { const at = performance.timeOrigin + performance.now(); gain.gain.setValueAtTime(0.8, ctx.currentTime); gain.gain.setValueAtTime(0, ctx.currentTime + ms / 1000); return at; },
      heard,
    };
  });
}

// One beep from `speaker`; returns each listener's delay in ms (null if not heard within 3 s).
export async function measureAudioDelay(speaker, listeners) {
  const speakerPeer = await speaker.evaluate(() => window.meetCall.peer);
  const before = await Promise.all(listeners.map((p) => p.evaluate(() => window.meetTone.heard.length)));
  const at = await speaker.evaluate(() => window.meetTone.beep());
  await sleep(3000);
  return Promise.all(listeners.map(async (p, i) => {
    const h = await p.evaluate(([n, peer]) => window.meetTone.heard.slice(n).filter((x) => x.peer === peer), [before[i], speakerPeer]);
    return h.length ? Math.round(h[0].at - at) : null;
  }));
}

// Wait until `n` remote videos are decoding new frames and `n` remote audio streams are receiving packets
// right now. (A frozen live video still advances currentTime, so frames and packets are what count.)
export async function waitFlowing(page, n, timeout = 30000) {
  await page.evaluate(() => { delete window.__flow; });
  await page.waitForFunction((n) => {
    const s = window.meetCall?.view();
    if (!s) return false;
    const now = performance.now();
    const prev = window.__flow;
    if (!prev || now - prev.at < 600) { if (!prev) window.__flow = { at: now, v: {}, a: {} }; if (!prev) return false; }
    let moving = 0, hearing = 0;
    const v = {}, a = {};
    for (const t of s.tiles) {
      if (/\(you\)/.test(t.name) || /screen/i.test(t.name)) continue;
      v[t.key] = t.frames;
      if (t.video && prev.v[t.key] != null && t.frames > prev.v[t.key]) moving++;
    }
    for (const x of s.audio) { a[x.peer] = x.rtp; if (x.rtp != null && prev.a[x.peer] != null && x.rtp !== prev.a[x.peer]) hearing++; }
    const good = moving >= n && hearing >= n;
    if (now - prev.at >= 600) window.__flow = { at: now, v, a, run: good ? (prev.run ?? 0) + 1 : 0 };
    return good && window.__flow.run >= 2;
  }, n, { timeout, polling: 200 });
}

// What each page has, for a failing test.
export async function diag(pages) {
  for (const p of pages) {
    const d = await p.evaluate(async () => {
      const c = window.meetCall;
      const s = await c.snapshot();
      return { me: c.me.display_name, peer: c.peer, mode: s.mode, engine: s.engine, tiles: s.tiles.map((t) => `${t.name}:${t.video ? `${t.w}x${t.h}@${t.t.toFixed(1)}` : 'none'}`), audio: s.audio.map((a) => `${a.peer}:${a.t.toFixed(1)}`), stats: s.stats, assign: c.plan?.assign?.[c.peer], dir: c.engine?.dir ? Object.fromEntries([...c.engine.dir].map(([h, l]) => [h, l.length])) : null };
    }).catch((e) => ({ error: e.message }));
    console.log(JSON.stringify(d));
  }
}

// The server as its own process (load tests: the test driver must not slow the server down).
export async function startServerProcess(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meet-load-'));
  const bin = new URL('../bin/meet.mjs', import.meta.url).pathname;
  const child = spawn(process.execPath, [bin, 'serve', '--port=0'], { env: { ...process.env, SESSION_SECRET: 'load-secret-'.padEnd(40, 'x'), DEV_LOGIN: '1', MEET_DB: path.join(dir, 'meet.db'), STUN_URLS: '', HOST: '127.0.0.1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = await new Promise((res, rej) => {
    child.stdout.on('data', (d) => { const m = /http:\/\/localhost:(\d+)/.exec(String(d)); if (m) res(`http://127.0.0.1:${m[1]}`); });
    child.stderr.on('data', (d) => process.stderr.write(d));
    child.on('exit', (c) => rej(new Error(`server exited ${c}`)));
  });
  return { base, child, async close() { child.kill(); } };
}
