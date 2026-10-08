// AI notes, end to end, in real Chromium. Each browser's fake microphone plays a known recording (Sam and
// Jordan reading three lines each, made at test time by scripts/make-test-speech.mjs into a file and never played aloud; every test browser runs with --mute-audio), so we know exactly what was said, by whom.
//
// Checks: the notice and each person's answer; each device writes down only its own microphone; lines carry
// the right speaker; captions reach the other person over the encrypted channel; the transcript is kept;
// accuracy (word error rate) and latency (end of speech to the caption on the other screen); notes with
// decisions and action items; leaving your voice out stops your lines; a device that cannot transcribe is
// written down by a helper in the call; ending the meeting writes the notes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, launch, joinAs, inCall, api, sleep, SPEECH, ensureSpeech, cacheModels, wer, words, ticketOf } from '../helpers.mjs';

await ensureSpeech();

const script = JSON.parse(fs.readFileSync(`${SPEECH}script.json`, 'utf8'));
const REF = { Sam: script.sam.lines.map((l) => l.text).join(' '), Jordan: script.jordan.lines.map((l) => l.text).join(' ') };
const mic = (who) => [`--use-file-for-fake-audio-capture=${SPEECH}${who}.wav`];

async function startCall(srv, browsers, { jordanEngine } = {}) {
  const [bs, bj] = browsers;
  const ctxS = await bs.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera', 'microphone'] });
  await cacheModels(ctxS);
  const sam = await ctxS.newPage();
  sam.on('pageerror', (e) => console.log('[sam pageerror]', e.message));
  sam.on('console', (m) => { if (m.type() === 'error' || /\[meet\]/.test(m.text())) console.log('[sam]', m.text()); });
  await sam.goto(`${srv.base}/auth/dev?login=sam&name=Sam`);
  await sam.click('#start');
  await sam.waitForSelector('#jf');
  await sam.click('#jf button[type=submit]');
  await inCall(sam);
  const url = await sam.evaluate(() => window.meetCall.meeting.join_url);
  const ctxJ = await bj.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera', 'microphone'] });
  await cacheModels(ctxJ);
  if (jordanEngine) await ctxJ.addInitScript((e) => localStorage.setItem('meet:engine', e), jordanEngine);
  const jp = await ctxJ.newPage();
  jp.on('pageerror', (e) => console.log('[jordan pageerror]', e.message));
  jp.on('console', (m) => { if (m.type() === 'error' || /\[meet\]/.test(m.text())) console.log('[jordan]', m.text()); });
  await jp.goto(url);
  await jp.waitForSelector('#jf');
  await jp.fill('#jf input[name=name]', 'Jordan');
  await jp.click('#jf button[type=submit]');
  await sam.waitForSelector('#notices [data-act=admit-all]', { timeout: 15000 });
  await sam.click('#notices [data-act=admit-all]');
  await inCall(jp);
  return { sam, jordan: jp, url, mid: await sam.evaluate(() => window.meetCall.meeting.id) };
}

async function notesOn(sam, people) {
  await sam.click('#bar [data-act=notes]');
  await sam.click('#side [data-act=notes-start]');
  for (const p of people) {
    await p.waitForSelector('#notesdlg[open] [data-act=notes-in]', { timeout: 15000 });
    await p.click('#notesdlg [data-act=notes-in]');
  }
}

const lineOf = (snap, pid) => snap.lines.filter((l) => l.pid === pid);

// The first full pass of a speaker's recording: from the line that starts it, for about one loop.
function firstPass(lines, first) {
  const i = lines.findIndex((l) => words(l.text).some((w) => first.includes(w)));
  if (i < 0) return [];
  const t0 = lines[i].start_at;
  return lines.filter((l) => l.start_at >= t0 && l.start_at < t0 + 25000);
}

test('notes: two people, each device writes down its own microphone, captions, notes, opt-out', { timeout: 420000 }, async (t) => {
  const srv = await startServer({ NO_WS: '1' });
  const browsers = [await launch(mic('sam')), await launch(mic('jordan'))];
  t.after(async () => { for (const b of browsers) await b.close(); await srv.close(); });
  const { sam, jordan, mid } = await startCall(srv, browsers);
  const jid = await jordan.evaluate(() => window.meetCall.me.id);
  const sid = await sam.evaluate(() => window.meetCall.me.id);

  // Nothing is written down before notes are on.
  assert.equal(await sam.evaluate(() => window.meetCall.notes.snapshot().lines.length), 0);

  const tOn = Date.now();
  await notesOn(sam, [sam, jordan]);
  await sam.waitForSelector('#topr .meet-notes-on');
  await jordan.waitForSelector('#topr .meet-notes-on');
  const status = await api(srv.base, 'meet.notes_status', { meeting: mid }, { ticket: await ticketOf(sam) });
  assert.equal(status.on, true);
  for (const p of status.people) assert.equal(p.answer, 'include', `${p.name} agreed`);
  const engine = await sam.evaluate(() => window.meetCall.notes.engine);
  await sam.waitForFunction(() => window.meetCall.notes.state === 'listening', null, { timeout: 240000 });
  await jordan.waitForFunction(() => window.meetCall.notes.state === 'listening', null, { timeout: 240000 });
  const loadMs = Date.now() - tOn;

  // Wait for one full pass of both recordings to arrive on the other person's screen.
  // A full pass: a line with the first words of the recording, and later a line with the last words.
  const fullPass = ([pid, first, last]) => {
    const l = window.meetCall.notes.lines().filter((x) => x.pid === pid);
    const start = l.find((x) => new RegExp(first, 'i').test(x.text));
    return !!start && l.some((x) => x.start_at > start.start_at && new RegExp(last, 'i').test(x.text));
  };
  await sam.waitForFunction(fullPass, [jid, 'thanks|works for me', 'contract|launch'], { timeout: 150000, polling: 500 });
  await jordan.waitForFunction(fullPass, [sid, 'morning|everyone', 'thursday|quote'], { timeout: 150000, polling: 500 });
  await sleep(1500);
  const S = await sam.evaluate(() => window.meetCall.notes.snapshot());
  const J = await jordan.evaluate(() => window.meetCall.notes.snapshot());

  // Each device wrote down only its own person, with the right name.
  const samOwn = S.lines.filter((l) => l.pid === sid);
  const jordanOwn = J.lines.filter((l) => l.pid === jid);
  for (const l of samOwn) assert.equal(l.name, 'Sam');
  for (const l of jordanOwn) assert.equal(l.name, 'Jordan');
  assert.ok(!words(samOwn.map((l) => l.text).join(' ')).includes('proposal'), 'Sam\'s device never wrote Jordan\'s words');
  assert.ok(!words(jordanOwn.map((l) => l.text).join(' ')).includes('quote'), 'Jordan\'s device never wrote Sam\'s words');

  // Accuracy, on the first full pass of each recording.
  const passS = firstPass(lineOf(J, sid), ['morning', 'everyone']);
  const passJ = firstPass(lineOf(S, jid), ['thanks', 'works']);
  const accS = wer(REF.Sam, passS.map((l) => l.text).join(' '));
  const accJ = wer(REF.Jordan, passJ.map((l) => l.text).join(' '));

  // Latency: end of speech on the speaker's device to the caption on the other screen (one clock: same Mac).
  const lat = [...S.metrics, ...J.metrics].filter((m) => m.speech_end).map((m) => m.arrived - m.speech_end).sort((a, b) => a - b);
  const runs = [...S.lines, ...J.lines].filter((l) => l.run_ms).map((l) => l.run_ms).sort((a, b) => a - b);
  const med = (a) => a[Math.floor(a.length / 2)];

  // The transcript is kept with the meeting, with speaker names.
  const tr = await api(srv.base, 'meet.get_transcript', { meeting: mid }, { ticket: await ticketOf(sam) });
  assert.ok(tr.segments.some((s) => s.speaker === 'Sam') && tr.segments.some((s) => s.speaker === 'Jordan'));
  assert.match(tr.text, /\] Sam: /);

  // Notes: decisions and action items from what was said (demo script, labelled).
  await sam.click('#side [data-act=notes-write]');
  await sam.waitForSelector('.meet-notes-b', { timeout: 20000 });
  const notes = await api(srv.base, 'meet.get_notes', { meeting: mid }, { ticket: await ticketOf(sam) });
  assert.equal(notes.scripted, true);
  assert.ok(notes.decisions.some((d) => /launch/i.test(d)), `a decision about the launch: ${JSON.stringify(notes.decisions)}`);
  assert.ok(notes.action_items.some((a) => a.owner === 'Jordan'), `an action for Jordan: ${JSON.stringify(notes.action_items)}`);

  // Jordan leaves their voice out: nothing more of Jordan's is kept, while Sam's lines continue.
  await jordan.click('#bar [data-act=notes]');
  await jordan.click('#side [data-act=notes-out]');
  await jordan.waitForFunction(() => window.meetCall.notes.status?.you?.answer === 'exclude');
  const cut = Date.now();
  await sleep(45000);
  const after = await api(srv.base, 'meet.get_transcript', { meeting: mid, after: String(cut + 1500) }, { ticket: await ticketOf(sam) });
  assert.ok(after.segments.every((s) => s.speaker !== 'Jordan'), `no Jordan lines after opting out: ${JSON.stringify(after.segments.filter((s) => s.speaker === 'Jordan'))}`);
  assert.ok(after.segments.some((s) => s.speaker === 'Sam'), 'Sam\'s lines continue');

  // Ending the meeting writes the notes.
  const ended = await api(srv.base, 'meet.end', { meeting: mid }, { ticket: await ticketOf(sam) });
  assert.equal(ended.notes?.written, true);
  const consents = (await api(srv.base, 'meet.export', {}, { cookie: (await sam.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ') })).meetings.find((m) => m.id === mid).notes_consents;
  assert.ok(consents.every((c) => c.notice_shown_at && c.answered_at), 'every answer is stored with when the notice was shown');

  const report = {
    engine, model: S.whisper.model, device: S.whisper.device, model_load_ms: S.whisper.loadMs, notes_on_to_listening_ms: loadMs,
    wer_sam: `${(accS.wer * 100).toFixed(1)}% (${accS.errors} of ${accS.words} words)`, wer_jordan: `${(accJ.wer * 100).toFixed(1)}% (${accJ.errors} of ${accJ.words} words)`,
    heard_sam: passS.map((l) => l.text).join(' '), heard_jordan: passJ.map((l) => l.text).join(' '),
    latency_ms: { median: med(lat), min: lat[0], max: lat.at(-1), n: lat.length }, whisper_run_ms: { median: med(runs), max: runs.at(-1) },
    realtime_factor: S.whisper.audioMs ? +(S.whisper.totalMs / S.whisper.audioMs).toFixed(3) : null,
    channel: { sam: S.channel, jordan: J.channel },
  };
  console.log('  notes report', JSON.stringify(report, null, 2));
  fs.mkdirSync(new URL('../../.shots/', import.meta.url).pathname, { recursive: true });
  fs.writeFileSync(new URL('../../.shots/notes-report.json', import.meta.url).pathname, JSON.stringify(report, null, 2));
  assert.ok(accS.wer < 0.35 && accJ.wer < 0.35, `accuracy: ${report.wer_sam}, ${report.wer_jordan}`);
});

test('notes: a device that cannot transcribe is written down by a helper in the call', { timeout: 300000 }, async (t) => {
  const srv = await startServer({ NO_WS: '1' });
  const browsers = [await launch(mic('sam')), await launch(mic('jordan'))];
  t.after(async () => { for (const b of browsers) await b.close(); await srv.close(); });
  const { sam, jordan, mid } = await startCall(srv, browsers, { jordanEngine: 'none' });
  const jid = await jordan.evaluate(() => window.meetCall.me.id);
  await notesOn(sam, [sam, jordan]);
  const st = await api(srv.base, 'meet.notes_status', { meeting: mid }, { ticket: await ticketOf(sam) });
  const sid = await sam.evaluate(() => window.meetCall.me.id);
  assert.equal(st.people.find((p) => p.participant === jid).written_by, `helper:${sid}`);
  await jordan.click('#bar [data-act=notes]');
  await jordan.waitForSelector('#side .meet-side-b >> text=A helper in the call: Sam');
  // Sam's device writes down Jordan's words, labelled Jordan, from the audio it already receives.
  await jordan.waitForFunction(([jid]) => window.meetCall.notes.lines().filter((l) => l.pid === jid).map((l) => l.text).join(' ').toLowerCase().includes('proposal'), [jid], { timeout: 240000, polling: 500 });
  const tr = await api(srv.base, 'meet.get_transcript', { meeting: mid }, { ticket: await ticketOf(sam) });
  const theirs = tr.segments.filter((s) => s.participant === jid);
  assert.ok(theirs.length && theirs.every((s) => s.speaker === 'Jordan' && s.written_by === sid), JSON.stringify(theirs));
  console.log(`  helper wrote ${theirs.length} of Jordan's lines: ${theirs.map((s) => s.text).join(' | ')}`);
});
