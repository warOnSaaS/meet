// Background blur: the camera option turns on on-device segmentation, the blurred track replaces the camera
// in the call (the other person receives it), the picture really changes, and turning it off sends the
// plain camera again. Chromium's fake camera has no person in it, so the whole frame counts as background.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, joinAs, inCall, api, ticketOf, cacheModels } from '../helpers.mjs';

const sentCam = (p) => p.evaluate(() => {
  const c = window.meetCall;
  const pc = [...c.engine.pcs.values()][0].pc;
  const t = pc.getTransceivers().slice().sort((a, b) => Number(a.mid) - Number(b.mid))[1];
  return { sent: t.sender.track?.id ?? null, raw: c.local.cam?.id, blur: c.blur?.track.id ?? null };
});

test('background blur replaces the camera with a blurred one, and back', { timeout: 180000 }, async (t) => {
  const srv = await startServer({ NO_WS: '1' });
  const browser = await launch();
  t.after(async () => { await browser.close(); await srv.close(); });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera', 'microphone'] });
  await cacheModels(ctx);
  if (process.env.BLUR_CPU) await ctx.addInitScript(() => localStorage.setItem('meet:blur-delegate', 'CPU'));
  const sam = await ctx.newPage();
  sam.on('pageerror', (e) => console.log('[sam pageerror]', e.message));
  await sam.goto(`${srv.base}/auth/dev?login=sam&name=Sam`);
  await sam.click('#start'); await sam.waitForSelector('#jf'); await sam.click('#jf button[type=submit]'); await inCall(sam);
  const url = await sam.evaluate(() => window.meetCall.meeting.join_url);
  const j = await joinAs(browser, url, 'Jordan');
  await sam.click('#notices [data-act=admit-all]');
  await inCall(j.page);
  await sam.waitForFunction(() => window.meetCall.engine?.pcs?.size === 1 && [...window.meetCall.engine.pcs.values()][0].state === 'connected', null, { timeout: 20000 });

  await sam.click('#bar [data-act=more]');
  await sam.click('#more [data-act=bg-blur]');
  await sam.waitForFunction(() => (window.meetCall.blur?.stats.masks ?? 0) > 40, null, { timeout: 60000 });
  const on = await sentCam(sam);
  assert.equal(on.sent, on.blur, 'the call sends the blurred track');
  const stats = await sam.evaluate(() => window.meetCall.blur.stats);
  // The blurred picture is softer than the camera's: compare edge strength (sum of neighbour differences).
  const sharp = await sam.evaluate(async () => {
    const b = window.meetCall.blur;
    const at = (src) => { const cv = Object.assign(document.createElement('canvas'), { width: 320, height: 180 }); const g = cv.getContext('2d'); g.drawImage(src, 0, 0, 320, 180); return g.getImageData(0, 0, 320, 180).data; };
    const edges = (d) => { let e = 0; for (let y = 0; y < 180; y++) for (let x = 1; x < 320; x++) { const i = (y * 320 + x) * 4; e += Math.abs(d[i + 1] - d[i - 3]); } return e; };
    // The same moment: the camera frame the blur reads, and the picture it sends.
    return edges(at(b.out)) / edges(at(b.video));
  });
  assert.ok(sharp < 0.75, `the picture is blurred (edge strength ${(sharp * 100).toFixed(0)}% of the camera's)`);
  // Jordan still receives Sam's video.
  await j.page.waitForFunction(() => window.meetCall.view().tiles.some((t) => !/\(you\)/.test(t.name) && t.video && t.w > 0), null, { timeout: 10000 });
  const st = await api(srv.base, 'meet.list_participants', { meeting: url.split('/m/')[1] }, { ticket: await ticketOf(sam) });
  assert.equal(st.participants.find((p) => p.display_name === 'Sam').background, 'blur');

  await sam.click('#bar [data-act=more]');
  await sam.click('#more [data-act=bg-none]');
  await sam.waitForFunction(() => !window.meetCall.blur);
  const off = await sentCam(sam);
  assert.equal(off.sent, off.raw, 'the plain camera again');
  console.log(`  blur: ${stats.delegate}, ${stats.masks} masks in ${stats.frames} frames, ${(stats.ms / stats.frames).toFixed(1)} ms a frame; edges ${(sharp * 100).toFixed(0)}% of the camera's`);
});
