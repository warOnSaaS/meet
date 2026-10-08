// Recording, end to end in Chromium with fake cameras and microphones (muted output): the notice on every
// screen, each answer stored, people who say no left out of the picture and the sound, the file saved to
// disk, and uploaded straight to S3-compatible storage with a presigned link (a small stand-in bucket here).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { startServer, launch, joinAs, inCall, api, sleep, ticketOf, devCookie } from '../helpers.mjs';

async function call(srv, browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera', 'microphone'], acceptDownloads: true });
  const sam = await ctx.newPage();
  sam.on('pageerror', (e) => console.log('[sam pageerror]', e.message));
  await sam.goto(`${srv.base}/auth/dev?login=sam&name=Sam`);
  await sam.click('#start'); await sam.waitForSelector('#jf'); await sam.click('#jf button[type=submit]'); await inCall(sam);
  const url = await sam.evaluate(() => window.meetCall.meeting.join_url);
  const j = await joinAs(browser, url, 'Jordan');
  await sam.waitForSelector('#notices [data-act=admit-all]'); await sam.click('#notices [data-act=admit-all]');
  await inCall(j.page);
  await sam.waitForFunction(() => window.meetCall.view().tiles.filter((t) => t.video && t.w > 0).length >= 2, null, { timeout: 20000 });
  return { sam, jordan: j.page, mid: await sam.evaluate(() => window.meetCall.meeting.id) };
}

const startRec = async (sam) => { await sam.click('#bar [data-act=more]'); await sam.click('#more [data-act=rec-start]'); };
const stopRec = async (sam) => { await sam.click('#bar [data-act=more]'); await sam.click('#more [data-act=rec-stop]'); };

test('recording: everyone is asked, a no leaves that person out, the file goes to disk', { timeout: 180000 }, async (t) => {
  const srv = await startServer({ NO_WS: '1' });
  const browser = await launch();
  t.after(async () => { await browser.close(); await srv.close(); });
  const { sam, jordan, mid } = await call(srv, browser);
  const jid = await jordan.evaluate(() => window.meetCall.me.id);
  const sid = await sam.evaluate(() => window.meetCall.me.id);

  await startRec(sam);
  // Nothing records while people are being asked.
  await sam.waitForSelector('#topr .meet-rec-on');
  assert.equal(await sam.evaluate(() => window.meetCall.recording.snapshot().recording), false);
  await sam.waitForSelector('#recdlg[open] [data-act=rec-yes]');
  await jordan.waitForSelector('#recdlg[open] [data-act=rec-no]', { timeout: 10000 });
  await sam.click('#recdlg [data-act=rec-yes]');
  await jordan.click('#recdlg [data-act=rec-no]');
  await sam.waitForFunction(() => window.meetCall.recording.snapshot().recording, null, { timeout: 10000 });
  await jordan.waitForSelector('#topr .ui-chip.is-bad.meet-rec-on');
  const snap = await sam.evaluate(() => window.meetCall.recording.snapshot());
  assert.deepEqual(snap.included, [sid], 'only Sam, who agreed, is in the recording');
  await sleep(4000);
  // What the recording draws: one tile (Sam), Jordan is not in it.
  const frames = await sam.evaluate(() => window.meetCall.recording.snapshot().frames);
  assert.ok(frames > 40, `frames drawn: ${frames}`);
  await stopRec(sam);
  await sam.waitForSelector('#notices [data-act=rec-download]', { timeout: 10000 });
  const [dl] = await Promise.all([sam.waitForEvent('download'), sam.click('#notices [data-act=rec-download]')]);
  const file = await dl.path();
  const head = fs.readFileSync(file).subarray(0, 4).toString('hex');
  const size = fs.statSync(file).size;
  assert.equal(head, '1a45dfa3', 'a WebM file');
  assert.ok(size > 20000, `size ${size}`);
  const shots = new URL('../../.shots/', import.meta.url).pathname;
  fs.mkdirSync(shots, { recursive: true });
  fs.copyFileSync(file, `${shots}recording-sample.webm`);
  await sam.waitForFunction(() => !document.querySelector('#notices [data-act=rec-download]'));
  const rec = await api(srv.base, 'meet.get_recording', { meeting: mid }, { ticket: await ticketOf(sam) });
  assert.equal(rec.where, 'disk');
  assert.equal(rec.size_bytes, size);
  assert.deepEqual(Object.fromEntries(rec.consents.map((c) => [c.participant, c.answer])), { [sid]: 'agree', [jid]: 'decline' });
  assert.ok(rec.consents.every((c) => c.notice_shown_at && c.answered_at));
  console.log(`  recording: ${size} bytes, ${rec.duration_s} s, ${frames} frames drawn in 4 s, Jordan left out`);
});

test('recording: uploaded straight to S3-compatible storage with a presigned link', { timeout: 180000 }, async (t) => {
  // A stand-in bucket: accepts presigned PUTs and answers CORS like a configured R2 or S3 bucket.
  const got = [];
  const bucket = http.createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', '*'); res.setHeader('access-control-allow-methods', 'PUT, GET, DELETE'); res.setHeader('access-control-allow-headers', 'content-type');
    if (req.method === 'OPTIONS') return res.end();
    let n = 0; for await (const c of req) n += c.length;
    got.push({ method: req.method, url: req.url, type: req.headers['content-type'], size: n });
    res.end();
  });
  await new Promise((r) => bucket.listen(0, '127.0.0.1', r));
  const srv = await startServer({ NO_WS: '1' });
  const browser = await launch();
  t.after(async () => { await browser.close(); await srv.close(); bucket.close(); });
  const cookie = await devCookie(srv.base, 'sam');
  await api(srv.base, 'meet.set_settings', { s3_endpoint: `http://127.0.0.1:${bucket.address().port}`, s3_bucket: 'recordings', s3_region: 'auto', s3_access_key_id: 'AKIDEXAMPLE', s3_secret_access_key: 'secret-example' }, { cookie });
  const { sam, jordan, mid } = await call(srv, browser);
  await startRec(sam);
  await sam.click('#recdlg [data-act=rec-yes]');
  await jordan.waitForSelector('#recdlg[open] [data-act=rec-yes]'); await jordan.click('#recdlg [data-act=rec-yes]');
  await sam.waitForFunction(() => window.meetCall.recording.snapshot().included?.length === 2, null, { timeout: 10000 });
  await sleep(3000);
  await stopRec(sam);
  await sam.waitForSelector('#notices [data-act=rec-upload]', { timeout: 10000 });
  await sam.click('#notices [data-act=rec-upload]');
  await sam.waitForFunction(() => !document.querySelector('#notices [data-act=rec-upload]'), null, { timeout: 20000 });
  const put = got.find((g) => g.method === 'PUT');
  assert.ok(put, 'the browser uploaded to the bucket');
  assert.match(put.url, /^\/recordings\/meet\/default\/m_[^/]+\/rec_[^/]+\.webm\?X-Amz-Algorithm=AWS4-HMAC-SHA256&.*X-Amz-Signature=[0-9a-f]{64}$/);
  assert.equal(put.type, 'video/webm');
  assert.ok(put.size > 20000);
  const rec = await api(srv.base, 'meet.get_recording', { meeting: mid }, { ticket: await ticketOf(sam) });
  assert.equal(rec.where, 'storage');
  assert.match(rec.download_url, /X-Amz-Signature=/);
  await api(srv.base, 'meet.delete_recording', { meeting: mid }, { ticket: await ticketOf(sam) });
  assert.ok(got.some((g) => g.method === 'DELETE'), 'deleting removes the file from the bucket');
  console.log(`  uploaded ${put.size} bytes to the bucket`);
});
