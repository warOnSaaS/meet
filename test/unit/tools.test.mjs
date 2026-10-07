// Every tool, over REST and MCP, from the same handlers. Plus the catalogue rules (ROADMAP 3.2).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, api, devCookie } from '../helpers.mjs';
import { catalogue, tools } from '../../server/tools/meet.mjs';
import { checkCatalogue } from '../../scripts/vendor/wos-tools.mjs';

let srv, sam, riley;
before(async () => {
  srv = await startServer();
  sam = await devCookie(srv.base, 'sam');
  riley = await devCookie(srv.base, 'riley');
});
after(() => srv.close());

test('the catalogue passes the suite checks and tools.json is current', () => {
  assert.deepEqual(checkCatalogue(catalogue()), []);
  assert.equal(fs.readFileSync(new URL('../../tools.json', import.meta.url), 'utf8'), JSON.stringify(catalogue(), null, 2) + '\n', 'run npm run tools:json');
  for (const name of ['meet.create', 'meet.schedule', 'meet.invite', 'meet.end', 'meet.admit', 'meet.mute_participant', 'meet.start_recording', 'meet.get_transcript', 'meet.summarise', 'meet.join_as_agent']) {
    assert.ok(tools.some((t) => t.name === name), `ROADMAP 5.6 tool ${name}`);
  }
  assert.equal(tools.find((t) => t.name === 'meet.start_recording').confirm, 'human', 'recording needs a person (F11)');
});

test('MCP lists every tool and calls the same handlers as REST', async () => {
  const rpc = async (method, params) => (await fetch(`${srv.base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: sam }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json()));
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(init.result.serverInfo.name, 'wos-meet');
  const list = await rpc('tools/list', {});
  assert.deepEqual(list.result.tools.map((t) => t.name).sort(), tools.map((t) => t.name).sort());
  const made = await rpc('tools/call', { name: 'meet.create', arguments: { title: 'Made over MCP' } });
  assert.equal(made.result.structuredContent.title, 'Made over MCP');
  const got = await api(srv.base, 'meet.get', { meeting: made.result.structuredContent.id });
  assert.equal(got.title, 'Made over MCP');
  const planned = await rpc('tools/call', { name: 'meet.start_recording', arguments: { meeting: got.id } });
  assert.equal(planned.result.isError, true);
});

test('start, join by link as a guest, waiting room, admit, deny, chat, host controls, end', async () => {
  await assert.rejects(api(srv.base, 'meet.create', {}), /Sign in/);
  const m = await api(srv.base, 'meet.create', { title: 'Birch Law intake' }, { cookie: sam });
  assert.match(m.join_url, /\/m\//);
  const hostKey = new URL(m.host_link).searchParams.get('host');
  const host = await api(srv.base, 'meet.join', { meeting: m.id, host_key: hostKey }, { cookie: sam });
  assert.equal(host.participant.role, 'host');
  assert.equal(host.participant.status, 'admitted');
  assert.ok(host.media.ice_servers);

  // A guest with only the link waits.
  const token = m.join_url.split('/m/')[1];
  const g = await api(srv.base, 'meet.join', { meeting: token, name: 'Jordan' });
  assert.equal(g.participant.status, 'waiting');
  assert.equal(g.participant.is_guest, true);
  assert.equal(g.media, undefined, 'no media until admitted');
  await assert.rejects(api(srv.base, 'meet.list_participants', { meeting: m.id }, { ticket: g.ticket }), /Join the meeting first/);
  await assert.rejects(api(srv.base, 'meet.admit', { meeting: m.id, all: true }, { ticket: g.ticket }), /host/);
  const w = await api(srv.base, 'meet.list_waiting', { meeting: m.id }, { ticket: host.ticket });
  assert.deepEqual(w.waiting.map((x) => x.display_name), ['Jordan']);
  await api(srv.base, 'meet.admit', { meeting: m.id, participant: g.participant.id }, { ticket: host.ticket });
  const again = await api(srv.base, 'meet.join', { meeting: m.id }, { ticket: g.ticket });
  assert.equal(again.participant.status, 'admitted');

  // Someone else is turned away.
  const c = await api(srv.base, 'meet.join', { meeting: m.id, name: 'Casey' });
  await api(srv.base, 'meet.deny', { meeting: m.id, participant: c.participant.id }, { ticket: host.ticket });
  assert.equal((await api(srv.base, 'meet.join', { meeting: m.id }, { ticket: c.ticket })).participant.status, 'denied');

  // Chat.
  await api(srv.base, 'meet.send_chat', { meeting: m.id, body: 'Hello' }, { ticket: g.ticket });
  const chat = await api(srv.base, 'meet.list_chat', { meeting: m.id }, { ticket: host.ticket });
  assert.equal(chat.messages[0].name, 'Jordan');

  // Host controls.
  await api(srv.base, 'meet.mute_participant', { meeting: m.id, participant: g.participant.id }, { ticket: host.ticket });
  let ps = await api(srv.base, 'meet.list_participants', { meeting: m.id }, { ticket: host.ticket });
  assert.equal(ps.participants.find((p) => p.id === g.participant.id).audio_on, false);
  await api(srv.base, 'meet.set_role', { meeting: m.id, participant: g.participant.id, role: 'cohost' }, { ticket: host.ticket });
  await api(srv.base, 'meet.lock', { meeting: m.id, locked: true }, { ticket: g.ticket });
  await assert.rejects(api(srv.base, 'meet.join', { meeting: m.id, name: 'Riley' }), /locked/);
  await api(srv.base, 'meet.lock', { meeting: m.id, locked: false }, { ticket: host.ticket });
  await api(srv.base, 'meet.set_waiting_room', { meeting: m.id, on: false }, { ticket: host.ticket });
  const r = await api(srv.base, 'meet.join', { meeting: m.id, name: 'Riley' });
  assert.equal(r.participant.status, 'admitted', 'waiting room off: straight in');
  await api(srv.base, 'meet.request_screen_share', { meeting: m.id, participant: r.participant.id }, { ticket: host.ticket });
  const st = await api(srv.base, 'meet.room_status', { meeting: m.id }, { ticket: r.ticket });
  assert.equal(st.requests[0].kind, 'screen_share');
  await api(srv.base, 'meet.set_sharing', { meeting: m.id, sharing: true }, { ticket: r.ticket });
  await api(srv.base, 'meet.raise_hand', { meeting: m.id, raised: true }, { ticket: r.ticket });
  await api(srv.base, 'meet.set_layout', { meeting: m.id, layout: 'speaker' }, { ticket: r.ticket });
  await api(srv.base, 'meet.set_my_media', { meeting: m.id, audio: false, video: false }, { ticket: r.ticket });
  ps = await api(srv.base, 'meet.list_participants', { meeting: m.id }, { ticket: host.ticket });
  const rp = ps.participants.find((p) => p.id === r.participant.id);
  assert.deepEqual([rp.sharing, rp.hand_raised, rp.layout, rp.audio_on, rp.video_on], [true, true, 'speaker', false, false]);
  await api(srv.base, 'meet.remove_participant', { meeting: m.id, participant: r.participant.id }, { ticket: host.ticket });
  await assert.rejects(api(srv.base, 'meet.join', { meeting: m.id }, { ticket: r.ticket }), /removed/);

  const inv = await api(srv.base, 'meet.invite', { meeting: m.id, names: ['Casey'] }, { ticket: host.ticket });
  assert.match(inv.message, /^Hi Casey/);
  assert.match(inv.ics, /BEGIN:VCALENDAR/);
  const hk = await api(srv.base, 'meet.add_host', { meeting: m.id }, { ticket: host.ticket });
  assert.match(hk.command, /npx -y github:warOnSaaS\/meet host/);
  const hs = await api(srv.base, 'meet.list_hosts', { meeting: m.id }, { ticket: host.ticket });
  assert.deepEqual(hs.hosts, []);

  await api(srv.base, 'meet.leave', { meeting: m.id }, { ticket: g.ticket });
  await api(srv.base, 'meet.end', { meeting: m.id }, { ticket: host.ticket });
  await assert.rejects(api(srv.base, 'meet.join', { meeting: m.id, name: 'Late' }), /ended/);
});

test('schedule, list, update, cancel, export; only the owner sees and changes them', async () => {
  const s = await api(srv.base, 'meet.schedule', { title: 'Acme Dental weekly', starts_at: '2026-10-12T15:00:00Z', duration_min: 45 }, { cookie: sam });
  assert.match(s.ics, /DTSTART:20261012T150000Z/);
  await api(srv.base, 'meet.update', { meeting: s.id, title: 'Acme Dental weekly sync', kind: 'webinar' }, { cookie: sam });
  await assert.rejects(api(srv.base, 'meet.update', { meeting: s.id, title: 'x' }, { cookie: riley }), /host/);
  const l = await api(srv.base, 'meet.list', {}, { cookie: sam });
  assert.ok(l.meetings.some((m) => m.title === 'Acme Dental weekly sync' && m.kind === 'webinar'));
  assert.ok(!(await api(srv.base, 'meet.list', {}, { cookie: riley })).meetings.length);
  const ex = await api(srv.base, 'meet.export', {}, { cookie: sam });
  assert.ok(ex.meetings.length >= 1);
  assert.ok(!JSON.stringify(ex).includes('e2ee_key'), 'export never contains call keys');
  await assert.rejects(api(srv.base, 'meet.cancel', { meeting: s.id }, { cookie: riley }), /set up/);
  await api(srv.base, 'meet.cancel', { meeting: s.id }, { cookie: sam });
  await assert.rejects(api(srv.base, 'meet.get', { meeting: s.id }), /No meeting/);
});

test('huddles: one live room per record, reused, with no waiting room (the room API for Chat)', async () => {
  const a = await api(srv.base, 'meet.huddle', { for: 'chat:channel:general' }, { cookie: sam });
  const b = await api(srv.base, 'meet.huddle', { for: 'chat:channel:general' }, { cookie: riley });
  assert.equal(a.meeting.id, b.meeting.id);
  assert.equal(b.participant.status, 'admitted');
  assert.equal(a.meeting.waiting_room, false);
  const other = await api(srv.base, 'meet.huddle', { for: 'chat:channel:design' }, { cookie: sam });
  assert.notEqual(other.meeting.id, a.meeting.id);
});

test('whoami and doctor', async () => {
  const w = await api(srv.base, 'meet.whoami', {}, { cookie: sam });
  assert.equal(w.user.github_login, 'sam');
  assert.equal((await api(srv.base, 'meet.whoami')).user, null);
  await assert.rejects(api(srv.base, 'meet.doctor'), /Sign in/);
  const d = await api(srv.base, 'meet.doctor', {}, { cookie: sam });
  assert.ok(Array.isArray(d.checks) && d.checks.length >= 2);
});

test('signalling: join needs an admitted ticket; messages reach the right peer; leaving tells the others', async () => {
  const m = await api(srv.base, 'meet.create', { title: 'Signal check', waiting_room: false }, { cookie: sam });
  const a = await api(srv.base, 'meet.join', { meeting: m.id, name: 'A' }, { cookie: sam });
  const b = await api(srv.base, 'meet.join', { meeting: m.id, name: 'B' });
  const j = async (ticket) => (await fetch(`${srv.base}/media/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket }) })).json();
  assert.equal((await j('nope')).ok, false);
  const ja = await j(a.ticket), jb = await j(b.ticket);
  assert.equal(jb.plan.mode, 'p2p');
  assert.deepEqual(jb.plan.p2p.sort(), [ja.peer, jb.peer].sort());
  await fetch(`${srv.base}/media/signal`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-meet-peer': ja.token }, body: JSON.stringify({ msgs: [{ to: jb.peer, type: 'p2p', body: { hi: 1 } }] }) });
  const got = await (await fetch(`${srv.base}/media/signal?since=${jb.cursor}&wait=2000`, { headers: { 'x-meet-peer': jb.token } })).json();
  assert.ok(got.msgs.some((x) => x.type === 'p2p' && x.from === ja.peer && x.body.hi === 1));
  await fetch(`${srv.base}/media/leave`, { method: 'POST', headers: { 'x-meet-peer': ja.token } });
  const got2 = await (await fetch(`${srv.base}/media/signal?since=${got.msgs.at(-1).id}&wait=2000`, { headers: { 'x-meet-peer': jb.token } })).json();
  assert.ok(got2.msgs.some((x) => x.type === 'peer-left' && x.body.peer === ja.peer));
});
