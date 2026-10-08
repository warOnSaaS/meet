// Notes tools without browsers: consent rules, the transcript, the scripted notes, sending to other apps
// (with a stand-in for the suite's callTool), settings that never show keys.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, api, devCookie } from '../helpers.mjs';
import { byName } from '../../server/tools/meet.mjs';
import { scriptedNotes } from '../../server/notes/summary.mjs';

let srv, sam;
before(async () => { srv = await startServer(); sam = await devCookie(srv.base, 'sam'); });
after(() => srv.close());

async function meeting() {
  const m = await api(srv.base, 'meet.create', { title: 'Acme Dental planning' }, { cookie: sam });
  const host = await api(srv.base, 'meet.join', { meeting: m.id, host_key: new URL(m.host_link).searchParams.get('host') }, { cookie: sam });
  const g = await api(srv.base, 'meet.join', { meeting: m.id, name: 'Jordan' });
  await api(srv.base, 'meet.admit', { meeting: m.id, all: true }, { ticket: host.ticket });
  return { m, host: host.ticket, hostPid: host.participant.id, guest: g.ticket, guestPid: g.participant.id };
}
const seg = (text, t, extra = {}) => ({ id: `s${t}`, start_at: String(t), end_at: String(t + 2000), text, ...extra });

test('consent: nothing is kept for someone who has not agreed, or who left their voice out', async () => {
  const { m, host, guest } = await meeting();
  await assert.rejects(api(srv.base, 'meet.start_notes', { meeting: m.id }, { ticket: guest }), /host/);
  await assert.rejects(api(srv.base, 'meet.add_transcript', { meeting: m.id, segments: [seg('hello', 1)] }, { ticket: host }), /off/);
  const st = await api(srv.base, 'meet.start_notes', { meeting: m.id, send_to: { chat: 'general' } }, { ticket: host });
  assert.equal(st.on, true);
  assert.equal(st.started_by, 'Sam');
  // Asked, not answered: nothing is kept.
  assert.equal((await api(srv.base, 'meet.add_transcript', { meeting: m.id, segments: [seg('too early', 2)] }, { ticket: guest })).saved, 0);
  await api(srv.base, 'meet.answer_notes', { meeting: m.id, include: true, engine: 'whisper-wasm' }, { ticket: guest });
  await api(srv.base, 'meet.answer_notes', { meeting: m.id, include: true, engine: 'whisper-wasm' }, { ticket: host });
  assert.equal((await api(srv.base, 'meet.add_transcript', { meeting: m.id, segments: [seg('I will update the proposal today.', 3000)] }, { ticket: guest })).saved, 1);
  assert.equal((await api(srv.base, 'meet.add_transcript', { meeting: m.id, segments: [seg('I will update the proposal today.', 3000)] }, { ticket: guest })).saved, 0, 'the same line twice is kept once');
  // Nobody can write lines for someone else unless they are that person's helper.
  const hostPid = (await api(srv.base, 'meet.notes_status', { meeting: m.id }, { ticket: host })).you.participant;
  assert.equal((await api(srv.base, 'meet.add_transcript', { meeting: m.id, segments: [seg('words put in Sam\'s mouth', 4000, { participant: hostPid })] }, { ticket: guest })).saved, 0);
  await api(srv.base, 'meet.answer_notes', { meeting: m.id, include: false }, { ticket: guest });
  assert.equal((await api(srv.base, 'meet.add_transcript', { meeting: m.id, segments: [seg('after leaving my voice out', 5000)] }, { ticket: guest })).saved, 0);
  const tr = await api(srv.base, 'meet.get_transcript', { meeting: m.id }, { ticket: host });
  assert.deepEqual(tr.segments.map((s) => s.text), ['I will update the proposal today.']);
  assert.equal(tr.segments[0].speaker, 'Jordan');
  // Turning notes on again asks everyone again.
  await api(srv.base, 'meet.stop_notes', { meeting: m.id }, { ticket: host });
  await api(srv.base, 'meet.start_notes', { meeting: m.id }, { ticket: host });
  const again = await api(srv.base, 'meet.notes_status', { meeting: m.id }, { ticket: host });
  assert.ok(again.people.every((p) => p.answer === 'pending'));
});

test('a device that cannot transcribe gets a helper; the helper may write only for them', async () => {
  const { m, host, guest, guestPid } = await meeting();
  await api(srv.base, 'meet.start_notes', { meeting: m.id }, { ticket: host });
  await api(srv.base, 'meet.answer_notes', { meeting: m.id, include: true, engine: 'whisper-wasm' }, { ticket: host });
  await api(srv.base, 'meet.answer_notes', { meeting: m.id, include: true, engine: 'none' }, { ticket: guest });
  // Helpers must be in the call (a media connection). Mark the host's browser as connected.
  const hostPid = (await api(srv.base, 'meet.notes_status', { meeting: m.id }, { ticket: host })).you.participant;
  await srv.db.run("INSERT INTO meet_peers (peer_id, meeting_id, participant_id, kind, joined_at, last_seen) VALUES ('p_test', ?, ?, 'browser', ?, ?)", [m.id, hostPid, Date.now(), Date.now()]);
  const st = await api(srv.base, 'meet.notes_status', { meeting: m.id }, { ticket: host });
  assert.equal(st.people.find((p) => p.participant === guestPid).written_by, `helper:${hostPid}`);
  assert.deepEqual(st.helping, [guestPid]);
  assert.equal((await api(srv.base, 'meet.add_transcript', { meeting: m.id, segments: [seg('Casey should review the contract.', 1000, { participant: guestPid })] }, { ticket: host })).saved, 1);
  const tr = await api(srv.base, 'meet.get_transcript', { meeting: m.id }, { ticket: guest });
  assert.equal(tr.segments[0].speaker, 'Jordan');
  assert.equal(tr.segments[0].written_by, hostPid);
});

test('scripted notes find decisions and action items with owners, and say they are a script', () => {
  const n = scriptedNotes({ title: 'Planning', segments: [
    { speaker: 'Sam', text: 'We decided to move the launch to Friday. Jordan will send the revised quote by Thursday.' },
    { speaker: 'Jordan', text: 'I will update the proposal today. Casey should review the contract.' },
  ] });
  assert.equal(n.scripted, true);
  assert.match(n.model, /script, not AI/);
  assert.deepEqual(n.decisions, ['We decided to move the launch to Friday.']);
  assert.deepEqual(n.action_items.map((a) => [a.owner, a.due]), [['Jordan', 'Thursday'], ['Jordan', 'Today'], ['Casey', null]]);
});

test('summarise, then send to the CRM, the board, Chat and email through the suite\'s tools', async () => {
  const { m, host, guest } = await meeting();
  await api(srv.base, 'meet.start_notes', { meeting: m.id, send_to: { crm: 'crm:deal:Acme Dental', board: 'Acme Dental', chat: 'general', email: true } }, { ticket: host });
  await api(srv.base, 'meet.answer_notes', { meeting: m.id, include: true, engine: 'whisper-wasm' }, { ticket: guest });
  await api(srv.base, 'meet.add_transcript', { meeting: m.id, segments: [seg('We decided to ship on Friday. I will write the release notes.', 1000)] }, { ticket: guest });
  const notes = await api(srv.base, 'meet.summarise', { meeting: m.id }, { ticket: host });
  assert.equal(notes.action_items[0].owner, 'Jordan');

  // Standalone, there are no other apps: a plain message, not a crash.
  await assert.rejects(api(srv.base, 'meet.notes_to_chat', { meeting: m.id }, { ticket: host }), /inside wOS/);

  // Inside the suite: the same handlers with call.callTool.
  const calls = [];
  const whoami = await api(srv.base, 'meet.whoami', {}, { cookie: sam });
  const ctx = { db: srv.app.db, config: srv.app.config, room: srv.app.room, base: srv.base, caller: { user: whoami.user, ticket: null }, callTool: async (name, input) => { calls.push([name, input]); return { ok: true }; } };
  await byName.get('meet.notes_to_crm').handler(ctx, { meeting: m.id, record: 'crm:deal:Acme Dental' });
  await byName.get('meet.notes_to_board').handler(ctx, { meeting: m.id, client: 'Acme Dental' });
  await byName.get('meet.notes_to_chat').handler(ctx, { meeting: m.id, channel: 'general' });
  await byName.get('meet.notes_to_email').handler(ctx, { meeting: m.id });
  const by = Object.fromEntries(calls.map(([n, i]) => [n, i]));
  assert.equal(by['crm.log_activity'].type, 'meeting');
  assert.equal(by['crm.log_activity'].deal, 'Acme Dental');
  assert.match(by['crm.log_activity'].body, /Decisions:/);
  assert.equal(by['board.add_task'].client, 'Acme Dental');
  assert.equal(by['board.add_task'].assignee, 'Jordan');
  assert.equal(by['chat.post_message'].channel, 'general');
  assert.equal(by['email.send_alert'].to, whoami.user.id, 'only team members who joined are emailed, not the guest');
  const got = await api(srv.base, 'meet.get_notes', { meeting: m.id }, { ticket: host });
  assert.deepEqual(Object.keys(got.sent).sort(), ['board', 'chat', 'crm', 'email']);

  // An app that is off says so in plain words.
  const off = { ...ctx, callTool: async () => { throw Object.assign(new Error('no such tool'), { code: 'no_tool' }); } };
  await assert.rejects(byName.get('meet.notes_to_board').handler(off, { meeting: m.id, client: 'Acme Dental' }), /The board is off/);

  // Ending the meeting writes the notes and sends them where the host chose.
  calls.length = 0;
  const ended = await byName.get('meet.end').handler(ctx, { meeting: m.id });
  assert.equal(ended.notes.written, true);
  assert.deepEqual(Object.keys(ended.notes.sent).sort(), ['board', 'chat', 'crm', 'email']);
  assert.ok(calls.some(([n]) => n === 'chat.post_message'));
});

test('settings keep keys secret and the notes use the model when one is set', async () => {
  await api(srv.base, 'meet.set_settings', { notes_model_url: 'http://127.0.0.1:9/v1', notes_model: 'demo-model', notes_model_key: 'sk-test-secret' }, { cookie: sam });
  const s = await api(srv.base, 'meet.get_settings', {}, { cookie: sam });
  assert.equal(s.notes_model_key.set, true);
  assert.ok(!JSON.stringify(s).includes('sk-test-secret'), 'the key never comes back');
  const row = await srv.db.get("SELECT value FROM meet_settings WHERE key LIKE 'settings:%'");
  assert.ok(!row.value.includes('sk-test-secret'), 'the key is stored encrypted');
  // The model address is unreachable: the script writes the notes and says why.
  const { m, host, guest } = await meeting();
  await api(srv.base, 'meet.start_notes', { meeting: m.id }, { ticket: host });
  await api(srv.base, 'meet.answer_notes', { meeting: m.id, include: true, engine: 'whisper-wasm' }, { ticket: guest });
  await api(srv.base, 'meet.add_transcript', { meeting: m.id, segments: [seg('We agreed on the plan.', 1000)] }, { ticket: guest });
  const n = await api(srv.base, 'meet.summarise', { meeting: m.id }, { ticket: host });
  assert.equal(n.scripted, true);
  assert.match(n.warning, /model failed/);
  await api(srv.base, 'meet.set_settings', { notes_model_url: '', notes_model: '', notes_model_key: '' }, { cookie: sam });
});
