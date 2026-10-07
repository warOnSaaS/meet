// Calls carried by participant hosts: real mediasoup host processes on this computer, real Chromium
// browsers with fake cameras. Media is encrypted end to end in the browsers; the hosts forward it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, joinAs, inCall, waitForMedia, api, startHost, waitHostsReady, ticketOf, installToneProbe, measureAudioDelay, waitFlowing, diag, sleep } from '../helpers.mjs';

const NAMES = ['Sam', 'Jordan', 'Casey', 'Riley', 'Morgan', 'Avery', 'Quinn', 'Rowan', 'Emery', 'Hayden', 'Parker', 'Reese'];

// Start a meeting as Sam with the waiting room off, so people walk straight in.
async function setup(t, { hosts = [] } = {}) {
  const srv = await startServer();
  const browser = await launch();
  const procs = [];
  t.after(async () => { for (const h of procs) h.kill(); await browser.close(); await srv.close(); });
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 }, permissions: ['camera', 'microphone'] });
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
  for (const h of hosts) procs.push(await startHost(srv.base, meeting.id, ticket, h));
  if (hosts.length) await waitHostsReady(srv.base, meeting.id, ticket, hosts.length);
  return { srv, browser, sam, meeting, ticket, procs, pages: [sam] };
}

async function addPeople(s, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const name = NAMES[s.pages.length];
    const p = await joinAs(s.browser, s.meeting.join_url, name, { viewport: { width: 1000, height: 700 } });
    await inCall(p.page);
    s.pages.push(p.page);
    out.push(p.page);
  }
  return out;
}

const hostLoad = async (s) => (await api(s.srv.base, 'meet.room_status', { meeting: s.meeting.id }, { ticket: s.ticket })).hosts;

test('one participant host carries a 5-person call, encrypted end to end', async (t) => {
  const s = await setup(t, { hosts: [{ name: 'Riley-desktop', upload: 40 }] });
  await addPeople(s, 3);
  // Four people: still direct.
  await Promise.all(s.pages.map((p) => waitForMedia(p, 3)));
  assert.equal(await s.sam.evaluate(() => window.meetCall.engine.kind), 'p2p');

  // The fifth person: the whole call moves onto the host.
  const t0 = Date.now();
  await addPeople(s, 1);
  const snaps = await Promise.all(s.pages.map((p) => waitForMedia(p, 4, 45000)));
  const moveMs = Date.now() - t0;
  for (const snap of snaps) {
    assert.equal(snap.mode, 'hosts');
    assert.equal(snap.engine, 'hosts');
    assert.equal(snap.tiles.length, 5);
    const e = snap.stats.e2ee;
    assert.ok(e.enc > 50 && e.dec > 50, `frames encrypted and decrypted in the browser: ${JSON.stringify(e)}`);
  }

  // The host forwards frames it cannot read: what it carries has the encryption marker on every frame
  // (checked in the browser: a frame without it is dropped and counted as a failure).
  const fails = snaps.map((x) => x.stats.e2ee.fail);
  assert.ok(fails.every((f) => f < 20), `few undecryptable frames: ${fails}`);

  // A newcomer sees everyone at once (the host hands over its stream list on connect).
  const t1 = Date.now();
  const [late] = await addPeople(s, 1);
  await waitForMedia(late, 5, 30000);
  const lateMs = Date.now() - t1;

  // Audio delay through the host, and the host's upload.
  for (const p of s.pages) await installToneProbe(p);
  await sleep(1500);
  const delays = await measureAudioDelay(s.pages[1], s.pages.filter((_, i) => i !== 1));
  const load = (await hostLoad(s))[0];
  console.log(`  1 host, 6 people: everyone moved onto the host in ${moveMs} ms; a 6th person saw and heard all in ${lateMs} ms`);
  console.log(`  audio delay speaker to listeners through the host: ${delays.join(', ')} ms`);
  console.log(`  host: carrying ${load.load} people (room for ${load.capacity}), sending ${load.sending_mbps} Mbit/s, receiving ${load.receiving_mbps} Mbit/s`);
  assert.ok(delays.every((d) => d != null && d < 1000), `every listener heard the tone: ${delays}`);
});

test('two hosts share a 6-person call; killing one mid-call moves its people to the other', async (t) => {
  const s = await setup(t, { hosts: [{ name: 'Riley-desktop', upload: 40 }, { name: 'Morgan-laptop', upload: 40 }] });
  const t0 = Date.now();
  await addPeople(s, 5);
  try { await Promise.all(s.pages.map((p) => waitFlowing(p, 5, 30000))); } catch (e) { await diag(s.pages); throw e; }
  const joinMs = Date.now() - t0;
  const plan = await s.sam.evaluate(() => window.meetCall.plan);
  assert.equal(plan.mode, 'hosts');
  assert.equal(plan.hosts.length, 2);
  assert.equal(plan.links.length, 1, 'the two hosts are linked');
  const loads = plan.hosts.map((h) => h.load);
  assert.ok(loads.every((l) => l >= 2), `both hosts carry people: ${loads}`);
  for (const a of Object.values(plan.assign)) assert.ok(a.standby && a.standby !== a.primary, 'everyone has a warm standby on the other host');
  const before = await hostLoad(s);
  console.log(`  e2ee before the kill: ${JSON.stringify(await Promise.all(s.pages.map(async (p) => (await p.evaluate(() => window.meetCall.snapshot())).stats.e2ee)))}`);

  // Kill the host that carries Sam, with no warning (as if the laptop lost power).
  const samPeer = await s.sam.evaluate(() => window.meetCall.peer);
  const victimPeer = plan.assign[samPeer].primary;
  const victimName = before.find((h) => h.peer === victimPeer).name;
  const victim = s.procs.find((h) => h.name === victimName);
  const moved = Object.entries(plan.assign).filter(([, a]) => a.primary === victimPeer).length;
  const k0 = Date.now();
  victim.kill('SIGKILL');
  let recovered;
  try { recovered = await Promise.all(s.pages.map(async (p) => { await waitFlowing(p, 5, 30000); return Date.now() - k0; })); } catch (e) { await diag(s.pages); throw e; }
  const failovers = await Promise.all(s.pages.map((p) => p.evaluate(() => window.meetCall.lastFailover)));
  const after = await hostLoad(s);
  console.log(`  2 hosts, 6 people: all seeing and hearing all ${joinMs} ms after the first of 5 joined`);
  console.log(`  host loads before: ${before.map((h) => `${h.name} ${h.load} people, sending ${h.sending_mbps} Mbit/s`).join('; ')}`);
  console.log(`  killed ${victimName} (carrying ${moved}); every screen had all video and audio moving again after ${Math.max(...recovered)} ms (per screen: ${recovered.join(', ')})`);
  console.log(`  switch inside the browsers (standby promoted): ${failovers.filter(Boolean).map((f) => `${f.ms} ms`).join(', ')}`);
  console.log(`  after: ${after.map((h) => `${h.name} ${h.load} people`).join('; ')}`);
  assert.ok(Math.max(...recovered) < 15000);
});

test('a host that is leaving hands its people to the other host first', async (t) => {
  const s = await setup(t, { hosts: [{ name: 'Riley-desktop', upload: 40 }, { name: 'Morgan-laptop', upload: 40 }] });
  await addPeople(s, 5);
  await Promise.all(s.pages.map((p) => waitFlowing(p, 5, 60000)));
  const plan = await s.sam.evaluate(() => window.meetCall.plan);
  const leaving = s.procs[0];
  const leavingPeer = (await hostLoad(s)).find((h) => h.name === leaving.name).peer;
  const moved = Object.values(plan.assign).filter((a) => a.primary === leavingPeer).length;
  // Watch for any moment a screen stops getting frames, while the host leaves politely (Ctrl+C).
  for (const p of s.pages) await p.evaluate(() => {
    window.__gap = 0; let last = performance.now(); let prev = null;
    window.__gapT = setInterval(() => {
      const f = window.meetCall.view().tiles.filter((x) => !/\(you\)/.test(x.name)).reduce((n, x) => n + x.frames, 0);
      const now = performance.now();
      if (prev != null && f > prev) { window.__gap = Math.max(window.__gap, now - last); last = now; }
      prev = f;
    }, 50);
  });
  const k0 = Date.now();
  leaving.kill('SIGTERM');
  await leaving.exited;
  const leftMs = Date.now() - k0;
  await Promise.all(s.pages.map((p) => waitFlowing(p, 5, 30000)));
  const gaps = await Promise.all(s.pages.map((p) => p.evaluate(() => Math.round(window.__gap))));
  console.log(`  polite leave: ${leaving.name} handed over ${moved} people and exited after ${leftMs} ms; longest gap in new frames on any screen: ${Math.max(...gaps)} ms (per screen: ${gaps.join(', ')})`);
  const after = await hostLoad(s);
  assert.equal(after.length, 1);
  assert.equal(after[0].load, 6);
});
