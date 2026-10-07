// Direct (peer to peer) calls in real Chromium with fake cameras and microphones.
// Two people, then three: everyone sees everyone's video and hears everyone's audio, through the waiting
// room and host controls, over WebSocket signalling and over long-polling (what Vercel can do).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, joinAs, inCall, waitForMedia, sleep } from '../helpers.mjs';

for (const transport of ['websocket', 'polling']) {
  test(`p2p calls, 2 then 3 people, signalling over ${transport}`, async (t) => {
    const srv = await startServer(transport === 'polling' ? { NO_WS: '1' } : {});
    const browser = await launch();
    t.after(async () => { await browser.close(); await srv.close(); });

    // Sam signs in and starts a meeting from the home screen.
    const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera', 'microphone'] });
    const host = await hostCtx.newPage();
    host.on('pageerror', (e) => console.log('[sam pageerror]', e.message));
    await host.goto(`${srv.base}/auth/dev?login=sam&name=Sam`);
    await host.click('#start');
    await host.waitForSelector('#jf');
    await host.click('#jf button[type=submit]');
    await inCall(host);
    const joinUrl = await host.evaluate(() => window.meetCall.meeting.join_url);
    const signal = await host.evaluate(() => window.meetCall.signalMode);

    // Jordan, a guest, waits in the waiting room until Sam lets them in from the notice.
    const t0 = Date.now();
    const jordan = await joinAs(browser, joinUrl, 'Jordan');
    await jordan.page.waitForSelector('.meet-waiting');
    await host.waitForSelector('#notices [data-act=admit-all]', { timeout: 10000 });
    await host.click('#notices [data-act=admit-all]');
    await inCall(jordan.page);
    const s2 = await Promise.all([waitForMedia(host, 1), waitForMedia(jordan.page, 1)]);
    const twoMs = Date.now() - t0;
    for (const s of s2) assert.equal(s.engine, 'p2p');
    assert.equal(s2[0].signal, transport === 'polling' ? 'poll' : 'ws');

    // Casey joins; Sam lets them in from the people panel.
    const t1 = Date.now();
    const casey = await joinAs(browser, joinUrl, 'Casey');
    await casey.page.waitForSelector('.meet-waiting');
    await host.click('#bar [data-act=people]');
    await host.waitForSelector('#side [data-act=admit]', { timeout: 10000 });
    await host.click('#side [data-act=admit]');
    await inCall(casey.page);
    const s3 = await Promise.all([host, jordan.page, casey.page].map((p) => waitForMedia(p, 2)));
    const threeMs = Date.now() - t1;
    for (const s of s3) {
      assert.equal(s.mode, 'p2p');
      assert.equal(s.tiles.length, 3, `three tiles on every screen: ${JSON.stringify(s.tiles)}`);
      const conns = Object.values(s.stats);
      assert.equal(conns.length, 2, 'two direct connections each');
      for (const c of conns) { assert.equal(c.state, 'connected'); assert.ok(c.inBytes > 10000, 'media flowing in'); }
    }

    // Chat reaches everyone.
    await jordan.page.click('#bar [data-act=chat]');
    await jordan.page.fill('#chatbox', 'Hello from Jordan');
    await jordan.page.press('#chatbox', 'Enter');
    await casey.page.waitForFunction(() => window.meetCall.chat.some((m) => m.body === 'Hello from Jordan'), null, { timeout: 8000 });

    // The host mutes Casey; Casey's microphone turns off and every screen shows it.
    await host.click('#side [data-panel=people]');
    const caseyId = await casey.page.evaluate(() => window.meetCall.me.id);
    await host.locator('#side li.meet-prow', { has: host.locator(`[data-act=mute][data-pid="${caseyId}"]`) }).hover();
    await host.click(`#side [data-act=mute][data-pid="${caseyId}"]`);
    await casey.page.waitForFunction(() => window.meetCall.audioOn === false && window.meetCall.local.mic.enabled === false, null, { timeout: 8000 });
    await jordan.page.waitForFunction((id) => document.querySelector(`.ui-tile[data-key="${id}:cam"]`)?.classList.contains('is-muted'), caseyId, { timeout: 8000 });

    // Jordan turns the camera off and on again; others see the avatar, then video again.
    const jordanId = await jordan.page.evaluate(() => window.meetCall.me.id);
    await jordan.page.click('#bar [data-act=cam]');
    await casey.page.waitForFunction((id) => !document.querySelector(`.ui-tile[data-key="${id}:cam"]`)?.classList.contains('has-video'), jordanId, { timeout: 8000 });
    await jordan.page.click('#bar [data-act=cam]');
    await casey.page.waitForFunction((id) => document.querySelector(`.ui-tile[data-key="${id}:cam"]`)?.classList.contains('has-video'), jordanId, { timeout: 8000 });

    // Screen share (Chromium's fake picker picks a screen) shows as its own tile for the others.
    await jordan.page.click('#bar [data-act=share]');
    await casey.page.waitForFunction((id) => { const v = document.querySelector(`.ui-tile[data-key="${id}:screen"] video`); return v && v.videoWidth > 0; }, jordanId, { timeout: 10000 });
    await jordan.page.click('#bar [data-act=share]');
    await casey.page.waitForFunction((id) => !document.querySelector(`.ui-tile[data-key="${id}:screen"]`), jordanId, { timeout: 8000 });

    // Casey leaves; the others drop to one connection each.
    await casey.page.click('#bar [data-act=leave]');
    await host.waitForFunction(async () => Object.keys((await window.meetCall.snapshot()).stats).length === 1, null, { timeout: 10000 });
    await sleep(300);
    const after = await host.evaluate(() => window.meetCall.snapshot());
    assert.equal(after.tiles.length, 2);

    console.log(`  ${transport}: 2 people connected in ${twoMs} ms from join click, 3 people in ${threeMs} ms`);
  });
}
