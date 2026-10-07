// A real direct call against a deployed site (default https://meet.waronsaas.com): three Chromium browsers
// with fake cameras, signalling through that site (long-polling on Vercel). Run by hand:
//   node test/live/p2p-live.mjs [base]
// What is real: the deployed server, its database and its signalling. What is not: all three browsers run on
// this one computer, so media goes over loopback, not across the internet.
import { launch, joinAs, inCall, waitForMedia } from '../helpers.mjs';

const base = process.argv[2] ?? 'https://meet.waronsaas.com';
const browser = await launch();
const t = (t0) => `${((Date.now() - t0) / 1000).toFixed(1)} s`;
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera', 'microphone'] });
  const host = await ctx.newPage();
  host.on('console', (m) => { if (m.type() === 'error') console.log('[host]', m.text()); });
  let t0 = Date.now();
  await host.goto(base);
  await host.click('#start');
  await host.waitForSelector('#jf');
  await host.fill('#jf input[name=name]', 'Sam');
  await host.click('#jf button[type=submit]');
  await inCall(host);
  console.log(`host in the call: ${t(t0)} from opening the home page`);
  const url = await host.evaluate(() => window.meetCall.meeting.join_url);
  console.log(`signalling: ${await host.evaluate(() => window.meetCall.signalMode)}`);

  t0 = Date.now();
  const jordan = await joinAs(browser, url, 'Jordan');
  await jordan.page.waitForSelector('.meet-waiting');
  await host.waitForSelector('#notices [data-act=admit-all]', { timeout: 20000 });
  const waitSeen = Date.now() - t0;
  await host.click('#notices [data-act=admit-all]');
  await Promise.all([waitForMedia(host, 1, 45000), waitForMedia(jordan.page, 1, 45000)]);
  console.log(`2 people: host saw the guest waiting after ${(waitSeen / 1000).toFixed(1)} s; seeing and hearing each other ${t(t0)} after the guest clicked Join`);

  t0 = Date.now();
  const casey = await joinAs(browser, url, 'Casey');
  await casey.page.waitForSelector('.meet-waiting');
  await host.waitForSelector('#notices [data-act=admit-all]', { timeout: 20000 });
  await host.click('#notices [data-act=admit-all]');
  const snaps = await Promise.all([host, jordan.page, casey.page].map((p) => waitForMedia(p, 2, 45000)));
  console.log(`3 people: everyone sees and hears everyone ${t(t0)} after the third person clicked Join`);
  for (const s of snaps) {
    const st = await (await [host, jordan.page, casey.page][snaps.indexOf(s)]).evaluate(() => window.meetCall.snapshot());
    console.log(`  ${st.mode} via ${st.signal}: ${st.tiles.length} tiles, connections ${Object.values(st.stats).map((c) => `${c.state} rtt ${c.rtt ?? '?'}s in ${Math.round(c.inBytes / 1024)} KB`).join(', ')}`);
  }
  await jordan.page.click('#bar [data-act=chat]');
  await jordan.page.fill('#chatbox', 'Hello over the deployed site');
  await jordan.page.press('#chatbox', 'Enter');
  t0 = Date.now();
  await casey.page.waitForFunction(() => window.meetCall.chat.some((m) => m.body === 'Hello over the deployed site'), null, { timeout: 20000 });
  console.log(`chat reached Casey in ${t(t0)}`);
  await host.click('#bar [data-act=people]');
  await host.click('#side [data-panel=info]');
  await host.click('#side [data-act=end]');
  await casey.page.waitForSelector('.meet-center', { timeout: 20000 });
  console.log('host ended the meeting; everyone left');
} finally {
  await browser.close();
}
