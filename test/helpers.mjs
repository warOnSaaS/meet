// Test helpers: an in-process server on a free port with its own SQLite file, and a Chromium that fakes the
// camera and microphone (a moving test pattern and a beep), so calls run with no hardware and no prompts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

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
