// Webinar mode: a few speakers, many viewers. Viewers send nothing, are not asked for a camera, hear and see
// speakers 1 to 3 s late (a receive buffer), and raise a hand to be let speak.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, inCall, waitFlowing, api, ticketOf, startHost, waitHostsReady, installToneProbe, measureAudioDelay, sleep } from '../helpers.mjs';

test('webinar: viewers watch, raise a hand, are let speak; with a host it grows, and viewers run 1 to 3 s behind', async (t) => {
  const srv = await startServer();
  const browser = await launch();
  const procs = [];
  t.after(async () => { for (const h of procs) h.kill(); await browser.close(); await srv.close(); });
  const vp = { width: 1000, height: 700 };
  const ctx = await browser.newContext({ viewport: vp, permissions: ['camera', 'microphone'] });
  const sam = await ctx.newPage();
  sam.on('pageerror', (e) => console.log('[Sam pageerror]', e.message));
  await sam.goto(`${srv.base}/auth/dev?login=sam&name=Sam`);
  await sam.click('#start');
  await sam.waitForSelector('#jf');
  await sam.click('#jf button[type=submit]');
  await inCall(sam);
  const meeting = await sam.evaluate(() => window.meetCall.meeting);
  const ticket = await ticketOf(sam);
  await api(srv.base, 'meet.set_waiting_room', { meeting: meeting.id, on: false }, { ticket });
  await sam.click('#bar [data-act=people]');
  await sam.click('#side [data-panel=info]');
  await sam.click('#side [data-act=webinar]');
  await sam.waitForFunction(() => window.meetCall.meeting.kind === 'webinar');

  // Viewers join with no camera prompt and send nothing.
  const join = async (name) => {
    const c = await browser.newContext({ viewport: vp, permissions: ['camera', 'microphone'] });
    const p = await c.newPage();
    p.on('pageerror', (e) => console.log(`[${name} pageerror]`, e.message));
    await p.goto(meeting.join_url);
    await p.waitForSelector('.meet-pre.is-viewer');
    await p.fill('#jf input[name=name]', name);
    await p.click('#jf button[type=submit]');
    await inCall(p);
    return p;
  };
  const jordan = await join('Jordan');
  const casey = await join('Casey');
  await Promise.all([waitFlowing(jordan, 1), waitFlowing(casey, 1)]);
  const v = await casey.evaluate(async () => { const s = await window.meetCall.snapshot(); return { tiles: s.tiles.map((x) => x.name), conns: Object.keys(s.stats).length, camera: !!window.meetCall.local.cam }; });
  assert.deepEqual(v.tiles, ['Sam'], 'a viewer sees only the speakers');
  assert.equal(v.conns, 1, 'viewers do not connect to each other');
  assert.equal(v.camera, false, 'a viewer was never asked for the camera');
  assert.equal(await sam.evaluate(() => window.meetCall.view().tiles.length), 1, 'the host sees no viewer tiles');
  assert.equal(await casey.$('#bar [data-act=mic]'), null, 'viewers have no microphone button');

  // Jordan raises a hand; Sam lets Jordan speak from the people panel.
  await jordan.click('#bar [data-act=hand]');
  await sam.click('#side [data-panel=people]');
  const jid = await jordan.evaluate(() => window.meetCall.me.id);
  await sam.waitForSelector(`#side [data-act=role][data-role=speaker][data-pid="${jid}"]`, { state: 'attached' });
  await sam.locator('#side li.meet-prow', { has: sam.locator(`[data-pid="${jid}"]`) }).hover();
  await sam.click(`#side [data-act=role][data-role=speaker][data-pid="${jid}"]`);
  await jordan.waitForFunction(() => window.meetCall.canPublish() && !!window.meetCall.local.mic, null, { timeout: 15000 });
  await Promise.all([waitFlowing(sam, 1), waitFlowing(casey, 2)]);
  console.log('  direct: 2 viewers watched; Jordan raised a hand, was let speak, and both viewers now see and hear Sam and Jordan');

  // A computer joins to carry it, and more viewers arrive: 6 people, past what direct calls take.
  procs.push(await startHost(srv.base, meeting.id, ticket, { name: 'Riley-desktop', upload: 40 }));
  await waitHostsReady(srv.base, meeting.id, ticket, 1);
  const more = [];
  for (const n of ['Riley', 'Morgan', 'Avery']) more.push(await join(n));
  const all = [sam, jordan, casey, ...more];
  await sam.waitForFunction(() => window.meetCall.plan?.mode === 'hosts', null, { timeout: 30000 });
  await Promise.all([waitFlowing(sam, 1, 45000), waitFlowing(jordan, 1, 45000), ...[casey, ...more].map((p) => waitFlowing(p, 2, 45000))]);
  const plan = await sam.evaluate(() => window.meetCall.plan);
  assert.equal(plan.mode, 'hosts');
  const viewerStats = await more[0].evaluate(async () => (await window.meetCall.snapshot()).stats);
  assert.deepEqual(viewerStats.conns.find((c) => c.role === 'primary').producers, [], 'viewers send nothing through the host');

  // How late each one hears Sam.
  for (const p of all) await installToneProbe(p);
  await sleep(2000);
  const [toJordan, ...toViewers] = await measureAudioDelay(sam, [jordan, casey, ...more]);
  console.log(`  with a host, 6 people: Sam to Jordan (speaker) ${toJordan} ms; Sam to the 4 viewers ${toViewers.join(', ')} ms`);
  assert.ok(toJordan < 600, 'speakers talk with each other live');
  assert.ok(toViewers.every((d) => d >= 1000 && d <= 3000), 'viewers run 1 to 3 s behind');
});
