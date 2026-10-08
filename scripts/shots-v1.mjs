// Screenshots of the v1 screens (notes, captions, recording, whiteboard, blur, More, settings) at 1440 and
// 390 wide, light and dark, into .shots/v1/. Browsers run muted. Transcript lines are added through the same
// tool the browsers use (meet.add_transcript), so no speech model is needed here.
import fs from 'node:fs';
import { startServer, launch, joinAs, inCall, api, ticketOf } from '../test/helpers.mjs';

const out = new URL('../.shots/v1/', import.meta.url).pathname;
fs.mkdirSync(out, { recursive: true });
const srv = await startServer();
const browser = await launch();
const shots = [];
const LINES = [
  ['Sam Rivera', 'Good morning everyone, thanks for joining the Acme Dental planning call.'],
  ['Jordan Lee', 'Thanks Sam, that works for me.'],
  ['Sam Rivera', 'We decided to move the launch to Friday the 14th.'],
  ['Jordan Lee', 'I will update the proposal and share it with the team today.'],
  ['Sam Rivera', 'Jordan will send the revised quote to the client by Thursday.'],
  ['Jordan Lee', 'Casey should review the contract before the launch.'],
];

for (const scheme of ['light', 'dark']) {
  for (const [w, h, tag] of [[1440, 900, 'desk'], [390, 844, 'phone']]) {
    const viewport = { width: w, height: h };
    const opts = { viewport, colorScheme: scheme, permissions: ['camera', 'microphone'] };
    const snap = async (page, name) => { const f = `${out}${tag}-${scheme}-${name}.png`; await page.waitForTimeout(500); await page.screenshot({ path: f }); shots.push(f); };
    const host = await (await browser.newContext(opts)).newPage();
    await host.goto(`${srv.base}/auth/dev?login=sam&name=Sam%20Rivera`);
    await host.waitForSelector('#settingsbox');
    await host.click('#settingsbox summary');
    await host.locator('#settingsbox').scrollIntoViewIfNeeded();
    await snap(host, '24-home-settings');
    await host.goto(`${srv.base}/`);
    await host.click('#start'); await host.waitForSelector('#jf'); await host.click('#jf button[type=submit]'); await inCall(host);
    const url = await host.evaluate(() => window.meetCall.meeting.join_url);
    const mid = await host.evaluate(() => window.meetCall.meeting.id);
    const g = await joinAs(browser, url, 'Jordan Lee', { viewport });
    await host.click('#notices [data-act=admit-all]');
    await inCall(g.page);
    await host.waitForFunction(() => window.meetCall.view().tiles.filter((t) => t.video && t.w > 0).length >= 2, null, { timeout: 20000 });

    // Notes: the notice, then the panel with a transcript and notes, then captions.
    await host.click('#bar [data-act=notes]');
    await host.click('#side [data-act=notes-start]');
    await g.page.waitForSelector('#notesdlg[open]');
    await snap(g.page, '15-notes-notice');
    await g.page.click('#notesdlg [data-act=notes-in]');
    await host.click('#notesdlg [data-act=notes-in]');
    const ids = { 'Sam Rivera': await host.evaluate(() => window.meetCall.me.id), 'Jordan Lee': await g.page.evaluate(() => window.meetCall.me.id) };
    const tk = { 'Sam Rivera': await ticketOf(host), 'Jordan Lee': await ticketOf(g.page) };
    const t0 = Date.now() - 60000;
    for (const [i, [who, text]] of LINES.entries()) await api(srv.base, 'meet.add_transcript', { meeting: mid, segments: [{ id: `shot${i}`, start_at: String(t0 + i * 8000), end_at: String(t0 + i * 8000 + 4000), text, participant: ids[who] }] }, { ticket: tk[who] });
    await host.evaluate(() => window.meetCall.notes.loadTranscript());
    await host.click('#side [data-act=notes-write]');
    await host.waitForSelector('.meet-notes-b');
    await host.evaluate(() => { const b = document.querySelector('#side .meet-side-b'); b.scrollTop = 0; });
    await snap(host, '16-notes-panel');
    await host.click('#side [data-act=close]');
    await host.evaluate(([a, b]) => { const n = window.meetCall.notes; const now = Date.now(); n.add({ id: 'cap1', pid: a, name: 'Sam Rivera', text: 'We decided to move the launch to Friday the 14th.', start_at: now - 4000, end_at: now - 1500 }); n.add({ id: 'cap2', pid: b, name: 'Jordan Lee', text: 'I will update the proposal and share it with the team today.', start_at: now - 1400, end_at: now }); }, [ids['Sam Rivera'], ids['Jordan Lee']]);
    await snap(host, '17-captions');

    // Recording: the notice, recording on, the recorder's save choices.
    await host.click('#bar [data-act=more]');
    await snap(host, '22-more-menu');
    await host.click('#more [data-act=rec-start]');
    await host.waitForSelector('#recdlg[open]');
    await snap(host, '18-recording-notice');
    await host.click('#recdlg [data-act=rec-yes]');
    await g.page.waitForSelector('#recdlg[open]'); await g.page.click('#recdlg [data-act=rec-yes]');
    await host.waitForFunction(() => window.meetCall.recording.snapshot().recording, null, { timeout: 10000 });
    await snap(g.page, '19-recording-on');
    await host.waitForTimeout(2000);
    await host.click('#bar [data-act=more]'); await host.click('#more [data-act=rec-stop]');
    await host.waitForSelector('#notices [data-act=rec-download]');
    await snap(host, '20-recording-ready');
    await host.click('#notices [data-act=rec-download]').catch(() => {});

    // Whiteboard with two shapes.
    await host.click('#bar [data-act=more]'); await host.click('#more [data-act=wb-open]');
    await host.waitForSelector('.meet-wb .excalidraw canvas.interactive', { timeout: 30000 });
    if (w > 600) {
      const box = await host.locator('.meet-wb .excalidraw canvas.interactive').boundingBox();
      for (const [kind, a, b] of [['rectangle', [420, 250], [640, 390]], ['ellipse', [760, 250], [940, 390]]]) {
        await host.click(`.meet-wb label:has([data-testid="toolbar-${kind}"])`);
        await host.mouse.move(box.x + a[0], box.y + a[1]); await host.mouse.down(); await host.mouse.move(box.x + b[0], box.y + b[1], { steps: 6 }); await host.mouse.up();
        await host.keyboard.press('Escape');
      }
      await g.page.waitForFunction(() => window.meetCall?.whiteboard?.snapshot().elements >= 2, null, { timeout: 10000 }).catch(() => {});
    }
    await snap(host, '21-whiteboard');
    await snap(g.page, '21b-whiteboard-other');
    await host.click('.meet-wb [data-act=wb-close]');

    // Background blur.
    await host.click('#bar [data-act=more]'); await host.click('#more [data-act=bg-blur]');
    await host.waitForFunction(() => (window.meetCall.blur?.stats.masks ?? 0) > 10, null, { timeout: 60000 });
    await snap(host, '23-blur');
    await g.ctx.close();
    await host.context().close();
  }
}
await browser.close();
await srv.close();
console.log(shots.join('\n'));
