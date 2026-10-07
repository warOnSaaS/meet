// The biggest call this computer can hold: several participant hosts (real mediasoup processes) and many
// Chromium browsers with fake cameras, all on one machine. Run by hand:
//   node test/load/big-call.mjs --hosts=4 --people=16 [--kill]
// Prints join times, audio delay, per-host traffic and, with --kill, the time to recover from a host dying.
// Simulated: every host states its upload (--upload-mbps), CPU load (--cpu-load) and jitter (--jitter-ms),
// because they all share this one computer and its loopback network, so measuring them would measure this
// computer, not the hosts. The traffic numbers are what the hosts really sent.
import os from 'node:os';
import { startServerProcess, launch, joinAs, inCall, api, startHost, waitHostsReady, ticketOf, installToneProbe, measureAudioDelay, waitFlowing, diag, sleep } from '../helpers.mjs';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : d; };
const H = Number(arg('hosts', 4)), N = Number(arg('people', 16)), UP = Number(arg('upload', 40)), KILL = !!arg('kill', false) || !!arg('kill-root', false), KILL_ROOT = !!arg('kill-root', false);
const NAMES = ['Sam', 'Jordan', 'Casey', 'Riley', 'Morgan', 'Avery', 'Quinn', 'Rowan', 'Emery', 'Hayden', 'Parker', 'Reese', 'Sage', 'Blake', 'Drew', 'Kai', 'Lane', 'Noel', 'Remy', 'Shay', 'Tatum', 'Wren', 'Zion', 'Arden', 'Bailey', 'Cameron', 'Dakota', 'Ellis', 'Finley', 'Gray'];
const AUDIO_CAP = 6; // above 12 people, each screen plays the 6 most recent speakers
// Real CPU use of this whole computer (all cores), sampled from the start of the test.
const ticks = () => os.cpus().reduce((a, c) => { const t = Object.values(c.times).reduce((x, y) => x + y, 0); return { busy: a.busy + t - c.times.idle, all: a.all + t }; }, { busy: 0, all: 0 });
let t0cpu = ticks();
const cpu = () => { const t = ticks(); const r = Math.round(((t.busy - t0cpu.busy) / (t.all - t0cpu.all)) * 100); t0cpu = t; return r; };

const srv = await startServerProcess();
const browser = await launch(['--disable-gpu']);
const procs = [];
const pages = [];
const out = { hosts: H, people: N };
try {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 640 }, permissions: ['camera', 'microphone'] });
  const sam = await ctx.newPage();
  await sam.goto(`${srv.base}/auth/dev?login=sam&name=Sam`);
  await sam.click('#start');
  await sam.waitForSelector('#jf');
  await sam.click('#jf button[type=submit]');
  await inCall(sam);
  pages.push(sam);
  const meeting = await sam.evaluate(() => window.meetCall.meeting);
  const ticket = await ticketOf(sam);
  await api(srv.base, 'meet.set_waiting_room', { meeting: meeting.id, on: false }, { ticket });
  for (let i = 0; i < H; i++) procs.push(await startHost(srv.base, meeting.id, ticket, { name: `host-${i + 1}`, upload: UP, extra: ['--cpu-load=0.2', '--jitter-ms=3'] }));
  await waitHostsReady(srv.base, meeting.id, ticket, H);

  // People join one at a time; for each, time from Join click to seeing every video and hearing the room.
  const joins = [];
  for (let i = 1; i < N; i++) {
    const t0 = Date.now();
    const p = await joinAs(browser, meeting.join_url, NAMES[i], { viewport: { width: 900, height: 640 } });
    await inCall(p.page);
    pages.push(p.page);
    if (i % 3 === 0) console.log('\nhosts:', JSON.stringify((await api(srv.base, 'meet.list_hosts', { meeting: meeting.id }, { ticket })).hosts.map((h) => [h.name, h.status, h.jitter_ms, h.load])));
    let ok = true;
    try { await waitFlowing(p.page, i, 30000); } catch { ok = false; console.log(`\n${NAMES[i]} slow:`); await diag([p.page]); }
    joins.push({ n: i + 1, ms: Date.now() - t0, ok });
    process.stdout.write(`${i + 1} `);
  }
  console.log();
  const others = N - 1;
  const audioWant = N > 12 ? Math.min(AUDIO_CAP, others) : others;
  const everyone = async (timeout) => Promise.all(pages.map(async (p) => {
    try { await p.waitForFunction(([v, a]) => { const s = window.meetCall.view(); return s.tiles.filter((t) => !/\(you\)/.test(t.name) && t.video && t.w > 0).length >= v && s.audio.length >= a; }, [others, Math.min(audioWant, 3)], { timeout }); return true; } catch { return false; }
  }));
  const okAll = await everyone(60000);
  const plan = await sam.evaluate(() => window.meetCall.plan);
  out.topology = plan.topology;
  out.hostsUsed = plan.hosts.length;
  out.capped = plan.capped.length;
  out.allSeeAll = okAll.filter(Boolean).length;
  out.joinMs = joins;
  out.cpuBusyPercentWhileJoining = cpu();

  // Audio delay: everyone's microphone becomes a generated silence; Jordan beeps once to become a recent
  // speaker, then again to be measured.
  for (const p of pages) await installToneProbe(p);
  await sleep(2000);
  await measureAudioDelay(pages[1], pages.filter((_, i) => i !== 1));
  const delays = await measureAudioDelay(pages[1], pages.filter((_, i) => i !== 1));
  out.audioDelayMs = delays;

  out.cpuBusyPercentInCall = cpu();
  const load = (await api(srv.base, 'meet.room_status', { meeting: meeting.id }, { ticket })).hosts;
  out.perHost = load.map((h) => ({ name: h.name, status: h.status, jitterMs: h.jitter_ms, carrying: h.load, capacity: h.capacity, sendMbps: h.sending_mbps, recvMbps: h.receiving_mbps, links: h.links }));

  if (KILL) {
    // The root of a star (it relays between all the others), or else the host carrying the most people.
    const vPeer = KILL_ROOT && plan.root ? plan.root : [...plan.hosts].sort((a, b) => b.load - a.load)[0].peer;
    const victim = procs.find((h) => h.name === load.find((x) => x.peer === vPeer)?.name);
    out.killed = { name: victim.name, root: vPeer === plan.root, carrying: Object.values(plan.assign).filter((a) => a.primary === vPeer).length };
    const k0 = Date.now();
    victim.kill('SIGKILL');
    const rec = await Promise.all(pages.map(async (p) => {
      try { await p.waitForFunction(([v]) => { const s = window.meetCall.view(); return s.tiles.filter((t) => !/\(you\)/.test(t.name) && t.video && t.w > 0).length >= v; }, [others], { timeout: 30000 }); await waitFlowing(p, Math.min(others, 3), 30000); return Date.now() - k0; } catch { return null; }
    }));
    out.recoveryMs = { max: Math.max(...rec.filter((x) => x != null)), failed: rec.filter((x) => x == null).length, each: rec };
  }
} catch (e) {
  console.error(e.message);
  await diag(pages.slice(0, 3));
} finally {
  console.log(JSON.stringify(out, null, 1));
  for (const h of procs) h.kill();
  await browser.close();
  await srv.close();
}
