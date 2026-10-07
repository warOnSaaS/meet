// Screenshots of every screen at 1440 and 390 wide, light and dark, into .shots/ (git-ignored).
// A real three-person direct call with fake cameras, so the call screens show real video.
import fs from 'node:fs';
import { startServer, launch, joinAs, inCall, waitForMedia } from '../test/helpers.mjs';

const out = new URL('../.shots/', import.meta.url).pathname;
fs.mkdirSync(out, { recursive: true });
const srv = await startServer();
const browser = await launch();
const shots = [];

for (const scheme of ['dark', 'light']) {
  for (const [w, h, tag] of [[1440, 900, 'desk'], [390, 844, 'phone']]) {
    const viewport = { width: w, height: h };
    const opts = { viewport, colorScheme: scheme, permissions: ['camera', 'microphone'] };
    const snap = async (page, name) => { const f = `${out}${tag}-${scheme}-${name}.png`; await page.waitForTimeout(400); await page.screenshot({ path: f }); shots.push(f); };

    const anon = await (await browser.newContext(opts)).newPage();
    await anon.goto(srv.base);
    await anon.waitForSelector('.meet-hero');
    await snap(anon, '01-home-signed-out');

    const host = await (await browser.newContext(opts)).newPage();
    await host.goto(`${srv.base}/auth/dev?login=sam&name=Sam%20Rivera`);
    await host.waitForSelector('#schedule');
    if (!(await host.$('.meet-row'))) {
      await host.fill('#schedule input[name=title]', 'Acme Dental weekly');
      await host.click('#schedule button[type=submit]');
      await host.waitForSelector('.meet-row');
    }
    await snap(host, '02-home-signed-in');
    await host.click('#start');
    await host.waitForSelector('#jf');
    await host.waitForTimeout(800);
    await snap(host, '03-join');
    await host.click('#jf button[type=submit]');
    await inCall(host);
    const url = await host.evaluate(() => window.meetCall.meeting.join_url);
    const g1 = await joinAs(browser, url, 'Jordan Lee', { viewport });
    await g1.page.waitForSelector('.meet-waiting');
    await snap(g1.page, '04-waiting');
    await host.waitForSelector('#notices [data-act=admit-all]');
    await snap(host, '05-call-someone-waiting');
    await host.click('#notices [data-act=admit-all]');
    const g2 = await joinAs(browser, url, 'Casey Park', { viewport });
    await host.waitForSelector('#notices [data-act=admit-all]');
    await host.click('#notices [data-act=admit-all]');
    await Promise.all([waitForMedia(host, 2), waitForMedia(g1.page, 2), waitForMedia(g2.page, 2)]);
    await snap(host, '06-call-grid');
    await host.click('#bar [data-act=people]');
    await snap(host, '07-call-people');
    await g1.page.click('#bar [data-act=chat]');
    await g1.page.fill('#chatbox', 'Agenda is in the doc: https://example.com/agenda');
    await g1.page.press('#chatbox', 'Enter');
    await g1.page.click('#side [data-act=close]');
    await host.click('#side [data-panel=chat]');
    await host.waitForSelector('.meet-cmsg');
    await snap(host, '08-call-chat');
    await host.click('#side [data-panel=info]');
    await snap(host, '09-call-details');
    await host.click('#side [data-act=close]');
    await g1.page.click('#bar [data-act=share]');
    await host.waitForSelector('.ui-tile.is-screen.has-video', { timeout: 10000 });
    await snap(host, '10-call-screen-share');
    await g1.page.click('#bar [data-act=share]');
    await host.click('#bar [data-act=layout]');
    await snap(host, '11-call-speaker');
    for (const p of [g1, g2]) await p.ctx.close();
    await host.context().close();
    await anon.context().close();
  }
}
await browser.close();
await srv.close();
console.log(shots.join('\n'));
