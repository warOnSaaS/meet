// Calls carried by a LiveKit media server (a real livekit-server in dev mode on this computer), encrypted end
// to end with the meeting's key. Skipped when no livekit-server binary is found (.bin/ or PATH).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { startServer, launch, joinAs, inCall, waitFlowing, api, ticketOf, sleep } from '../helpers.mjs';

const local = new URL('../../.bin/livekit-server', import.meta.url).pathname;
let bin = fs.existsSync(local) ? local : null;
if (!bin) { try { bin = execFileSync('which', ['livekit-server'], { encoding: 'utf8' }).trim() || null; } catch {} }

test('a call too big for direct connections goes to LiveKit, encrypted end to end', { skip: !bin && 'no livekit-server binary' }, async (t) => {
  const lk = spawn(bin, ['--dev', '--bind', '127.0.0.1'], { stdio: 'ignore' });
  t.after(() => lk.kill());
  for (let i = 0; i < 40; i++) { if (await fetch('http://127.0.0.1:7880/').then((r) => r.ok).catch(() => false)) break; await sleep(250); }
  const srv = await startServer({ P2P_MAX: '2', LIVEKIT_URL: 'ws://127.0.0.1:7880', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'secret' });
  const browser = await launch();
  t.after(async () => { await browser.close(); await srv.close(); });

  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 }, permissions: ['camera', 'microphone'] });
  const sam = await ctx.newPage();
  sam.on('pageerror', (e) => console.log('[Sam pageerror]', e.message));
  await sam.goto(`${srv.base}/auth/dev?login=sam&name=Sam`);
  await sam.click('#start');
  await sam.waitForSelector('#jf');
  await sam.click('#jf button[type=submit]');
  await inCall(sam);
  const meeting = await sam.evaluate(() => window.meetCall.meeting);
  await api(srv.base, 'meet.set_waiting_room', { meeting: meeting.id, on: false }, { ticket: await ticketOf(sam) });
  const pages = [sam];
  for (const name of ['Jordan', 'Casey']) { const p = await joinAs(browser, meeting.join_url, name, { viewport: { width: 1000, height: 700 } }); await inCall(p.page); pages.push(p.page); }
  const t0 = Date.now();
  await Promise.all(pages.map((p) => waitFlowing(p, 2, 45000)));
  console.log(`  LiveKit, 3 people: everyone seeing and hearing everyone ${Date.now() - t0} ms after the third joined`);
  for (const p of pages) {
    const s = await p.evaluate(() => window.meetCall.snapshot());
    assert.equal(s.mode, 'livekit');
    assert.equal(s.engine, 'livekit');
    assert.equal(s.stats.e2ee, true, 'end-to-end encryption is on');
  }
});
