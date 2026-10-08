// The whiteboard, end to end: two people draw on one board and see each other's shapes (Yjs updates over the
// encrypted channel), a third person who arrives later gets the whole board, the board is saved to the
// meeting, exported as PNG and SVG, attached to a CRM record (inside wOS, with a stand-in for its tools),
// and closed for everyone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, launch, joinAs, inCall, api, sleep, ticketOf, devCookie } from '../helpers.mjs';
import { byName } from '../../server/tools/meet.mjs';

const count = (p) => p.evaluate(() => window.meetCall.whiteboard.snapshot().elements);
async function draw(page, key, from, to) {
  const box = await page.locator('.meet-wb .excalidraw canvas.interactive').boundingBox();
  await page.click(`.meet-wb label:has([data-testid="toolbar-${key === "r" ? "rectangle" : "ellipse"}"])`);
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
}

test('whiteboard: drawn together, synced encrypted, saved, exported, attached, closed', { timeout: 180000 }, async (t) => {
  const srv = await startServer({ NO_WS: '1' });
  const browser = await launch();
  t.after(async () => { await browser.close(); await srv.close(); });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera', 'microphone'], acceptDownloads: true });
  const sam = await ctx.newPage();
  sam.on('pageerror', (e) => console.log('[sam pageerror]', e.message));
  await sam.goto(`${srv.base}/auth/dev?login=sam&name=Sam`);
  await sam.click('#start'); await sam.waitForSelector('#jf'); await sam.click('#jf button[type=submit]'); await inCall(sam);
  const url = await sam.evaluate(() => window.meetCall.meeting.join_url);
  const mid = await sam.evaluate(() => window.meetCall.meeting.id);
  const j = await joinAs(browser, url, 'Jordan', { viewport: { width: 1440, height: 900 } });
  await sam.click('#notices [data-act=admit-all]');
  await inCall(j.page);

  await sam.click('#bar [data-act=more]');
  await sam.click('#more [data-act=wb-open]');
  await sam.waitForSelector('.meet-wb .excalidraw canvas.interactive', { timeout: 30000 });
  await j.page.waitForSelector('.meet-wb .excalidraw canvas.interactive', { timeout: 30000 });
  const t0 = Date.now();
  await draw(sam, 'r', [420, 250], [640, 390]);
  await j.page.waitForFunction(() => window.meetCall.whiteboard.snapshot().elements >= 1, null, { timeout: 10000 });
  const syncMs = Date.now() - t0;
  await draw(j.page, 'o', [820, 250], [980, 390]);
  await sam.waitForFunction(() => window.meetCall.whiteboard.snapshot().elements >= 2, null, { timeout: 10000 });
  assert.equal(await count(sam), 2);
  assert.equal(await count(j.page), 2);
  const stats = await sam.evaluate(() => ({ wb: window.meetCall.whiteboard.snapshot().stats, ch: window.meetCall.channel.stats }));
  assert.ok(stats.wb.sent > 0 && stats.wb.received > 0);
  // The signalling mailbox only ever held ciphertext: no Excalidraw element names in it.
  const leaked = await srv.db.all("SELECT body FROM meet_signals WHERE type = 'enc' AND (body LIKE '%rectangle%' OR body LIKE '%ellipse%')");
  assert.equal(leaked.length, 0, 'whiteboard strokes are encrypted on the way');

  // Saved to the meeting a moment after the last change.
  await sam.waitForFunction(() => window.meetCall.whiteboard.snapshot().stats.saves > 0 || true);
  await sleep(4000);
  const tk = await ticketOf(sam);
  const got = await api(srv.base, 'meet.get_whiteboard', { meeting: mid }, { ticket: tk });
  assert.equal(got.open, true);
  assert.equal(got.shapes, 2);

  // Someone who arrives later gets the whole board.
  const c = await joinAs(browser, url, 'Casey', { viewport: { width: 1440, height: 900 } });
  await sam.click('#notices [data-act=admit-all]');
  await inCall(c.page);
  await c.page.waitForFunction(() => window.meetCall?.whiteboard?.snapshot().elements === 2, null, { timeout: 20000 });

  // Export as PNG and SVG from the board's buttons.
  const [png] = await Promise.all([sam.waitForEvent('download'), sam.click('.meet-wb [data-act=wb-png]')]);
  const pngHead = fs.readFileSync(await png.path()).subarray(0, 8).toString('hex');
  assert.equal(pngHead, '89504e470d0a1a0a', 'a PNG file');
  const [svg] = await Promise.all([sam.waitForEvent('download'), sam.click('.meet-wb [data-act=wb-svg]')]);
  assert.match(fs.readFileSync(await svg.path(), 'utf8'), /<svg[\s\S]*<\/svg>/);
  fs.mkdirSync(new URL('../../.shots/', import.meta.url).pathname, { recursive: true });
  fs.copyFileSync(await png.path(), new URL('../../.shots/whiteboard-export.png', import.meta.url).pathname);
  const ex = await api(srv.base, 'meet.export_whiteboard', { meeting: mid, format: 'svg' }, { ticket: tk });
  assert.match(ex.svg, /^<svg/);

  // Attach: standalone says it needs wOS; inside wOS it calls the CRM's tool.
  await assert.rejects(api(srv.base, 'meet.attach_whiteboard', { meeting: mid, to: 'crm:deal:Acme Dental' }, { ticket: tk }), /inside wOS/);
  const calls = [];
  const whoami = await api(srv.base, 'meet.whoami', {}, { cookie: await devCookie(srv.base, 'sam') });
  const sctx = { db: srv.app.db, config: srv.app.config, room: srv.app.room, base: srv.base, caller: { user: whoami.user, ticket: null }, callTool: async (n, i) => { calls.push([n, i]); return { ok: true }; } };
  await byName.get('meet.attach_whiteboard').handler(sctx, { meeting: mid, to: 'crm:deal:Acme Dental' });
  await byName.get('meet.attach_whiteboard').handler(sctx, { meeting: mid, to: 'board:task:7' });
  assert.equal(calls[0][0], 'crm.log_activity'); assert.equal(calls[0][1].deal, 'Acme Dental'); assert.match(calls[0][1].body, /2 shapes/);
  assert.equal(calls[1][0], 'board.update_task'); assert.equal(calls[1][1].task, '7');

  // Close for everyone.
  await sam.click('.meet-wb [data-act=wb-close]');
  await j.page.waitForFunction(() => !document.querySelector('.meet-wb'), null, { timeout: 10000 });
  console.log(`  whiteboard: a shape reached the other screen in ${syncMs} ms; late joiner got 2 shapes; PNG and SVG exported`);
});
