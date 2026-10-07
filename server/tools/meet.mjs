// The Meetings tool catalogue. Every screen action calls one of these, and agents call the same ones over
// MCP (/mcp) or REST (/api/tools/<name>). tools.json is generated from this file (npm run tools:json).
import { id, secretToken, sign, verify } from '../auth.mjs';
import { iceServers } from '../config.mjs';
import { describePlan } from '../room/plan.mjs';
import { runDoctor } from '../doctor.mjs';

export class ToolError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
const fail = (code, message, status) => { throw new ToolError(code, message, status); };
const now = () => Date.now();
const str = (d) => ({ type: 'string', description: d });
const bool = (d) => ({ type: 'boolean', description: d });
const MEETING = str('Meeting id, or the token from its join link');
const PARTICIPANT = str('Participant id');

// ---------- helpers ----------

async function meetingRow(ctx, ref) {
  if (!ref) fail('bad_input', 'Say which meeting.');
  const token = String(ref).split('/m/').pop().split(/[?#]/)[0];
  const m = await ctx.db.get('SELECT * FROM meetings WHERE id = ? OR link_token = ?', [ref, token]);
  if (!m) fail('not_found', 'No meeting with that id or link.', 404);
  return m;
}

async function me(ctx, m) {
  const t = ctx.caller.ticket;
  if (t && t.mid === m.id) return ctx.db.get('SELECT * FROM meeting_participants WHERE id = ?', [t.pid]);
  if (ctx.caller.user) return ctx.db.get("SELECT * FROM meeting_participants WHERE meeting_id = ? AND user_id = ? AND status <> 'left' ORDER BY asked_at DESC", [m.id, ctx.caller.user.id]);
  return null;
}

const isOwner = (ctx, m) => !!ctx.caller.user && ctx.caller.user.id === m.host_id;
async function requireHost(ctx, m) {
  if (isOwner(ctx, m)) return;
  const p = await me(ctx, m);
  if (p && p.status === 'admitted' && ['host', 'cohost'].includes(p.role)) return;
  fail('forbidden', 'Only the host or a co-host can do that.', 403);
}
async function requireIn(ctx, m) {
  const p = await me(ctx, m);
  if (p && p.status === 'admitted') return p;
  if (isOwner(ctx, m)) return p;
  fail('forbidden', 'Join the meeting first.', 403);
}
const requireMember = (ctx) => ctx.caller.user || fail('sign_in', 'Sign in to do that.', 401);
const canCreate = (ctx) => ctx.caller.user || ctx.config.openCreate || fail('sign_in', 'Sign in with GitHub to start a meeting.', 401);

const joinUrl = (ctx, m) => `${ctx.base}/m/${m.link_token}`;
function meetingOut(ctx, m, extra = {}) {
  return {
    id: m.id, title: m.title, kind: m.kind, status: m.status,
    starts_at: m.starts_at ? new Date(Number(m.starts_at)).toISOString() : null,
    duration_min: m.duration_min, waiting_room: !!m.waiting_room, locked: !!m.locked, media_pref: m.media_pref,
    linked_record: m.linked_record, join_url: joinUrl(ctx, m), ...extra,
  };
}
const partOut = (p, inCall) => p && ({
  id: p.id, display_name: p.display_name, role: p.role, status: p.status, kind: p.kind, is_guest: !p.user_id,
  audio_on: !!p.audio_on, video_on: !!p.video_on, sharing: !!p.sharing, hand_raised: !!p.hand_raised, layout: p.layout,
  in_call: inCall ? inCall.has(p.id) : undefined,
});

async function newMeeting(ctx, { title, starts_at, duration_min, waiting_room = true, kind = 'meeting', linked_record = null, status = 'scheduled' }) {
  const u = ctx.caller.user;
  const m = {
    id: id('m_'), title: String(title || 'Meeting').slice(0, 140), host_id: u?.id ?? null,
    starts_at: starts_at ?? null, duration_min: duration_min ?? null, status,
    room_name: id('r_'), link_token: secretToken(9), waiting_room: waiting_room ? 1 : 0, kind,
    e2ee_key: secretToken(32), linked_record, created_at: now(),
  };
  await ctx.db.run(
    'INSERT INTO meetings (id, title, host_id, starts_at, duration_min, status, room_name, link_token, waiting_room, kind, e2ee_key, linked_record, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [m.id, m.title, m.host_id, m.starts_at, m.duration_min, m.status, m.room_name, m.link_token, m.waiting_room, m.kind, m.e2ee_key, m.linked_record, m.created_at],
  );
  const hostKey = sign(ctx.config.secret, { k: 'hostkey', mid: m.id, exp: now() + 30 * 864e5 });
  return { m: { ...m, locked: 0, media_pref: 'auto' }, hostKey };
}

function parseWhen(v) {
  if (v == null || v === '') return null;
  const t = typeof v === 'number' ? v : Date.parse(v);
  if (!Number.isFinite(t)) fail('bad_input', 'starts_at must be a date and time, for example 2026-10-12T15:00:00Z.');
  return t;
}

function ics(ctx, m) {
  const dt = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const start = Number(m.starts_at ?? now());
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//warOnSaaS//wOS Meetings//EN', 'BEGIN:VEVENT',
    `UID:${m.id}@wos-meet`, `DTSTAMP:${dt(now())}`, `DTSTART:${dt(start)}`, `DTEND:${dt(start + (m.duration_min ?? 30) * 60000)}`,
    `SUMMARY:${m.title.replace(/[,;]/g, ' ')}`, `URL:${joinUrl(ctx, m)}`, `DESCRIPTION:Join: ${joinUrl(ctx, m)}`, `LOCATION:${joinUrl(ctx, m)}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

async function mediaFor(ctx, m, p) {
  return { e2ee_key: m.e2ee_key, ice_servers: iceServers(ctx.config, p.id), livekit: !!ctx.config.livekit, p2p_max: ctx.config.p2pMax };
}

async function inCallSet(ctx, m) {
  const rows = await ctx.db.all("SELECT participant_id FROM meet_peers WHERE meeting_id = ? AND kind = 'browser'", [m.id]);
  return new Set(rows.map((r) => r.participant_id));
}

async function setParticipant(ctx, m, pid, fields) {
  const keys = Object.keys(fields);
  await ctx.db.run(`UPDATE meeting_participants SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND meeting_id = ?`, [...keys.map((k) => fields[k]), pid, m.id]);
  await ctx.room.changed(m.id, 'participants', { pid });
}

async function targetParticipant(ctx, m, pid) {
  const p = await ctx.db.get('SELECT * FROM meeting_participants WHERE id = ? AND meeting_id = ?', [pid, m.id]);
  if (!p) fail('not_found', 'No such participant in this meeting.', 404);
  return p;
}

// ---------- the tools ----------

export const tools = [
  {
    name: 'meet.whoami', scope: 'read', confirm: 'none', events: [],
    description: 'Who you are signed in as, and whether you can start meetings here.',
    input: { type: 'object', properties: {} },
    async handler(ctx) {
      const u = ctx.caller.user;
      return { user: u ? { id: u.id, name: u.name, github_login: u.github_login, avatar_url: u.avatar_url } : null, can_start: !!u || ctx.config.openCreate, can_schedule: !!u, signin_available: !!ctx.config.github.clientId || ctx.config.devLogin, dev_login: ctx.config.devLogin, media: { p2p_max: ctx.config.p2pMax, livekit: !!ctx.config.livekit, turn: !!ctx.config.turn } };
    },
  },
  {
    name: 'meet.create', scope: 'write', confirm: 'none', events: ['meet.meeting.created'],
    description: 'Start a meeting now. Returns the join link to share, and a host link that makes whoever opens it the host.',
    input: { type: 'object', properties: { title: str('What the meeting is called'), waiting_room: bool('Hold guests in a waiting room until a host lets them in (default on)'), kind: { type: 'string', enum: ['meeting', 'webinar'], description: 'meeting, or webinar: a few speakers and many viewers' }, linked_record: str('Optional link to a record in another app, for example crm:deal:42 or board:task:7') } },
    async handler(ctx, a) {
      canCreate(ctx);
      const { m, hostKey } = await newMeeting(ctx, { ...a, status: 'live' });
      await ctx.db.run('UPDATE meetings SET started_at = ? WHERE id = ?', [now(), m.id]);
      return meetingOut(ctx, m, { host_link: `${joinUrl(ctx, m)}?host=${hostKey}` });
    },
  },
  {
    name: 'meet.schedule', scope: 'write', confirm: 'none', events: ['meet.meeting.scheduled'],
    description: 'Schedule a meeting for later. Returns the join link and a calendar invite (.ics text) to send.',
    input: { type: 'object', required: ['title', 'starts_at'], properties: { title: str('What the meeting is called'), starts_at: str('When it starts, ISO 8601, for example 2026-10-12T15:00:00Z'), duration_min: { type: 'integer', description: 'How long, in minutes (default 30)' }, waiting_room: bool('Hold guests until a host lets them in (default on)'), kind: { type: 'string', enum: ['meeting', 'webinar'] }, linked_record: str('Optional link to another app\'s record') } },
    async handler(ctx, a) {
      requireMember(ctx);
      const { m, hostKey } = await newMeeting(ctx, { ...a, starts_at: parseWhen(a.starts_at), duration_min: a.duration_min ?? 30 });
      return meetingOut(ctx, m, { host_link: `${joinUrl(ctx, m)}?host=${hostKey}`, ics: ics(ctx, m) });
    },
  },
  {
    name: 'meet.list', scope: 'read', confirm: 'none', events: [],
    description: 'List meetings: live ones first, then upcoming, then recent.',
    input: { type: 'object', properties: { include_ended: bool('Also list ended meetings') } },
    async handler(ctx, a) {
      const u = requireMember(ctx);
      const rows = await ctx.db.all(`SELECT * FROM meetings WHERE host_id = ? ${a.include_ended ? '' : "AND status <> 'ended'"} ORDER BY CASE status WHEN 'live' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, COALESCE(starts_at, created_at) LIMIT 200`, [u.id]);
      return { meetings: rows.map((m) => meetingOut(ctx, m)) };
    },
  },
  {
    name: 'meet.get', scope: 'read', confirm: 'none', events: [],
    description: 'Get one meeting by id or join link: title, time, status and settings. Anyone with the link can read this much.',
    input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING } },
    async handler(ctx, a) {
      const m = await meetingRow(ctx, a.meeting);
      const mine = await me(ctx, m);
      return meetingOut(ctx, m, { you: partOut(mine), you_host: isOwner(ctx, m) || ['host', 'cohost'].includes(mine?.role), signed_in: !!ctx.caller.user, signin_available: !!ctx.config.github.clientId });
    },
  },
  {
    name: 'meet.update', scope: 'write', confirm: 'none', events: ['meet.meeting.updated'],
    description: 'Change a meeting: title, time, length, waiting room, webinar mode, or how media is carried.',
    input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING, title: str('New title'), starts_at: str('New start, ISO 8601'), duration_min: { type: 'integer' }, waiting_room: bool('Waiting room on or off'), kind: { type: 'string', enum: ['meeting', 'webinar'] }, media_pref: { type: 'string', enum: ['auto', 'p2p', 'hosts', 'livekit'], description: 'auto picks for you; the others force one way' } } },
    async handler(ctx, a) {
      const m = await meetingRow(ctx, a.meeting);
      await requireHost(ctx, m);
      const f = {};
      if (a.title != null) f.title = String(a.title).slice(0, 140);
      if (a.starts_at != null) f.starts_at = parseWhen(a.starts_at);
      if (a.duration_min != null) f.duration_min = Number(a.duration_min);
      if (a.waiting_room != null) f.waiting_room = a.waiting_room ? 1 : 0;
      if (a.kind) f.kind = a.kind;
      if (a.media_pref) f.media_pref = a.media_pref;
      if (Object.keys(f).length) await ctx.db.run(`UPDATE meetings SET ${Object.keys(f).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...Object.values(f), m.id]);
      if (a.kind || a.media_pref) await ctx.room.replan(m.id);
      await ctx.room.changed(m.id, 'meeting');
      return meetingOut(ctx, { ...m, ...f });
    },
  },
  {
    name: 'meet.cancel', scope: 'delete', confirm: 'none', events: ['meet.meeting.cancelled'],
    description: 'Cancel a scheduled meeting and delete it with its chat.',
    input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING } },
    async handler(ctx, a) {
      const m = await meetingRow(ctx, a.meeting);
      if (!isOwner(ctx, m)) fail('forbidden', 'Only the person who set up the meeting can cancel it.', 403);
      await ctx.db.run('DELETE FROM meetings WHERE id = ?', [m.id]);
      return { cancelled: m.id };
    },
  },
  {
    name: 'meet.invite', scope: 'write', confirm: 'none', events: [],
    description: 'Make an invitation: the join link, a short message to paste, and a calendar invite. It does not send email; the Email app or you send it.',
    input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING, names: { type: 'array', items: { type: 'string' }, description: 'Who it is for, to address the message' } } },
    async handler(ctx, a) {
      const m = await meetingRow(ctx, a.meeting);
      await requireIn(ctx, m);
      const when = m.starts_at ? ` on ${new Date(Number(m.starts_at)).toUTCString().replace(':00 GMT', ' UTC')}` : ' now';
      const hi = a.names?.length ? `Hi ${a.names.join(', ')},\n\n` : '';
      return { join_url: joinUrl(ctx, m), message: `${hi}Join "${m.title}"${when}: ${joinUrl(ctx, m)}\nNo account or download needed. Open the link in a browser.`, ics: ics(ctx, m) };
    },
  },
  {
    name: 'meet.join', scope: 'write', confirm: 'none', events: ['meet.participant.asked', 'meet.participant.joined'],
    description: 'Join a meeting by its link. Guests give a name and need no account. With a waiting room on, guests wait until a host admits them; call again with the same ticket to check.',
    input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING, name: str('Your name as others will see it (guests)'), host_key: str('The host key from a host link, which makes you the host'), as: { type: 'string', enum: ['person', 'agent'], description: 'agent: an AI agent joining by itself (shown with an agent badge)' } } },
    async handler(ctx, a) {
      const m = await meetingRow(ctx, a.meeting);
      if (m.status === 'ended') fail('ended', 'This meeting has ended.', 410);
      let p = await me(ctx, m);
      if (p?.status === 'removed') fail('removed', 'The host removed you from this meeting.', 403);
      if (p?.status === 'left' && p.joined_at) {
        // Coming back after leaving: same place, same role.
        await ctx.db.run("UPDATE meeting_participants SET status = 'admitted', left_at = NULL WHERE id = ?", [p.id]);
        p = { ...p, status: 'admitted' };
        await ctx.room.changed(m.id, 'participants');
      }
      if (!p || (p.status === 'left' && !p.joined_at)) {
        const u = ctx.caller.user;
        const hostKeyOk = a.host_key && verify(ctx.config.secret, a.host_key, 'hostkey')?.mid === m.id;
        const isHost = (u && u.id === m.host_id) || hostKeyOk;
        const name = String(a.name || u?.name || '').trim().slice(0, 60);
        if (!name) fail('bad_input', 'Tell us your name.');
        if (m.locked && !isHost) fail('locked', 'The host has locked this meeting. Ask them to unlock it.', 403);
        const hasHost = await ctx.db.get("SELECT id FROM meeting_participants WHERE meeting_id = ? AND role = 'host' AND status = 'admitted'", [m.id]);
        const role = isHost ? 'host' : m.kind === 'webinar' ? 'viewer' : u ? 'member' : 'guest';
        // Waiting room holds guests. Team members and the host walk in. With no host present, nobody can admit,
        // so the first person in a meeting with no owner becomes its host.
        const admitted = isHost || !m.waiting_room || (u && m.host_id && u.id) || (!m.host_id && !hasHost);
        p = { id: id('pt_'), meeting_id: m.id, user_id: u?.id ?? null, guest_name: u ? null : name, display_name: name, role: !m.host_id && !hasHost && !isHost ? 'host' : role, status: admitted ? 'admitted' : 'waiting', asked_at: now(), joined_at: admitted ? now() : null, kind: a.as === 'agent' ? 'agent' : 'person' };
        await ctx.db.run('INSERT INTO meeting_participants (id, meeting_id, user_id, guest_name, display_name, role, status, asked_at, joined_at, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [p.id, p.meeting_id, p.user_id, p.guest_name, p.display_name, p.role, p.status, p.asked_at, p.joined_at, p.kind]);
        if (m.status === 'scheduled' && admitted) await ctx.db.run("UPDATE meetings SET status = 'live', started_at = ? WHERE id = ?", [now(), m.id]);
        await ctx.room.changed(m.id, p.status === 'waiting' ? 'waiting' : 'participants');
      }
      const ticket = sign(ctx.config.secret, { k: 'ticket', pid: p.id, mid: m.id, exp: now() + 24 * 3600e3 });
      const out = { meeting: meetingOut(ctx, m), participant: partOut(p), ticket };
      if (p.status === 'admitted') out.media = await mediaFor(ctx, m, p);
      else if (p.status === 'waiting') out.message = 'The host will let you in soon.';
      else if (p.status === 'denied') out.message = 'The host did not let you in.';
      return out;
    },
  },
  {
    name: 'meet.leave', scope: 'write', confirm: 'none', events: ['meet.participant.left'],
    description: 'Leave the meeting. Others stay in the call.',
    input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING } },
    async handler(ctx, a) {
      const m = await meetingRow(ctx, a.meeting);
      const p = await me(ctx, m);
      if (!p) return { left: false };
      await ctx.db.run("UPDATE meeting_participants SET status = 'left', left_at = ?, sharing = 0, hand_raised = 0 WHERE id = ?", [now(), p.id]);
      const peers = await ctx.db.all('SELECT peer_id FROM meet_peers WHERE participant_id = ?', [p.id]);
      for (const r of peers) await ctx.room.leave(r.peer_id);
      await ctx.room.changed(m.id, 'participants');
      return { left: true };
    },
  },
  {
    name: 'meet.end', scope: 'write', confirm: 'none', events: ['meet.meeting.ended'],
    description: 'End the meeting for everyone.',
    input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING } },
    async handler(ctx, a) {
      const m = await meetingRow(ctx, a.meeting);
      await requireHost(ctx, m);
      await ctx.db.run("UPDATE meetings SET status = 'ended', ended_at = ? WHERE id = ?", [now(), m.id]);
      await ctx.db.run("UPDATE meeting_participants SET status = 'left', left_at = ? WHERE meeting_id = ? AND status IN ('admitted', 'waiting')", [now(), m.id]);
      await ctx.room.broadcast(m.id, 'ended', { by: (await me(ctx, m))?.display_name ?? 'the host' });
      await ctx.db.run('DELETE FROM meet_peers WHERE meeting_id = ?', [m.id]);
      return { ended: m.id };
    },
  },
  {
    name: 'meet.list_waiting', scope: 'read', confirm: 'none', events: [],
    description: 'Who is in the waiting room, oldest first.',
    input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING } },
    async handler(ctx, a) {
      const m = await meetingRow(ctx, a.meeting);
      await requireHost(ctx, m);
      const rows = await ctx.db.all("SELECT * FROM meeting_participants WHERE meeting_id = ? AND status = 'waiting' ORDER BY asked_at", [m.id]);
      return { waiting: rows.map((p) => partOut(p)) };
    },
  },
  {
    name: 'meet.admit', scope: 'write', confirm: 'none', events: ['meet.participant.joined'],
    description: 'Let someone in from the waiting room. Use all: true to let everyone in.',
    input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING, participant: PARTICIPANT, all: bool('Let everyone waiting in') } },
    async handler(ctx, a) {
      const m = await meetingRow(ctx, a.meeting);
      await requireHost(ctx, m);
      const ids = a.all ? (await ctx.db.all("SELECT id FROM meeting_participants WHERE meeting_id = ? AND status = 'waiting'", [m.id])).map((r) => r.id) : [a.participant];
      if (!ids.length || !ids[0]) fail('bad_input', 'Say who to let in, or all: true.');
      for (const pid of ids) await ctx.db.run("UPDATE meeting_participants SET status = 'admitted', joined_at = ? WHERE id = ? AND meeting_id = ? AND status = 'waiting'", [now(), pid, m.id]);
      await ctx.room.changed(m.id, 'waiting');
      await ctx.room.changed(m.id, 'participants');
      return { admitted: ids };
    },
  },
  {
    name: 'meet.deny', scope: 'write', confirm: 'none', events: ['meet.participant.denied'],
    description: 'Turn someone away from the waiting room.',
    input: { type: 'object', required: ['meeting', 'participant'], properties: { meeting: MEETING, participant: PARTICIPANT } },
    async handler(ctx, a) {
      const m = await meetingRow(ctx, a.meeting);
      await requireHost(ctx, m);
      await ctx.db.run("UPDATE meeting_participants SET status = 'denied' WHERE id = ? AND meeting_id = ? AND status = 'waiting'", [a.participant, m.id]);
      await ctx.room.changed(m.id, 'waiting');
      return { denied: a.participant };
    },
  },
  {
    name: 'meet.list_participants', scope: 'read', confirm: 'none', events: [],
    description: 'Everyone admitted to the meeting, whether they are in the call now, and their mic, camera, screen and hand.',
    input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING } },
    async handler(ctx, a) {
      const m = await meetingRow(ctx, a.meeting);
      await requireIn(ctx, m);
      const inCall = await inCallSet(ctx, m);
      const rows = await ctx.db.all("SELECT * FROM meeting_participants WHERE meeting_id = ? AND status = 'admitted' ORDER BY joined_at", [m.id]);
      const waiting = (await ctx.db.get("SELECT COUNT(*) AS n FROM meeting_participants WHERE meeting_id = ? AND status = 'waiting'", [m.id])).n;
      return { participants: rows.map((p) => partOut(p, inCall)), waiting: Number(waiting) };
    },
  },
  {
    name: 'meet.room_status', scope: 'read', confirm: 'none', events: [],
    description: 'How the call is carried right now (direct, by computers in the call, or by a media server), the people limit, the computers helping, and your own status.',
    input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING } },
    async handler(ctx, a) {
      const m = await meetingRow(ctx, a.meeting);
      const p = await me(ctx, m);
      if (!p && !isOwner(ctx, m)) fail('forbidden', 'Join the meeting first.', 403);
      const plan = await ctx.room.currentPlan(m.id);
      const peers = await ctx.room.peersOf(m.id);
      const hosts = (await ctx.db.all("SELECT * FROM meet_peers WHERE meeting_id = ? AND kind = 'host'", [m.id])).map((h) => {
        const met = h.metrics ? JSON.parse(h.metrics) : {};
        const inPlan = plan?.hosts?.find((x) => x.peer === h.peer_id);
        return { peer: h.peer_id, name: met.name ?? 'A computer', client: h.client, upload_mbps: met.uploadMbps ?? null, sending_mbps: met.load?.sendMbps ?? null, receiving_mbps: met.load?.recvMbps ?? null, links: met.load?.links ?? 0, carrying: !!inPlan, capacity: inPlan?.capacity ?? null, load: inPlan?.load ?? null, status: plan?.hostStatus?.[h.peer_id]?.ok ? 'ready' : plan?.hostStatus?.[h.peer_id]?.why ?? 'measuring' };
      });
      const out = {
        meeting: meetingOut(ctx, m), you: partOut(p), mode: plan?.mode ?? 'idle', summary: describePlan(plan),
        limit: plan ? (plan.limit === Infinity || plan.limit == null ? null : plan.limit) : ctx.config.p2pMax,
        people_in_call: peers.filter((x) => x.kind === 'browser').length, hosts, livekit_configured: !!ctx.config.livekit, turn_configured: !!ctx.config.turn,
      };
      if (p?.status === 'admitted') {
        const reqs = await ctx.db.all('SELECT id, kind, body FROM meeting_requests WHERE meeting_id = ? AND participant_id = ? AND done_at IS NULL', [m.id, p.id]);
        out.requests = reqs.map((r) => ({ id: r.id, kind: r.kind, body: r.body ? JSON.parse(r.body) : null }));
      }
      return out;
    },
  },
  {
    name: 'meet.set_my_media', scope: 'write', confirm: 'none', events: ['meet.participant.media'],
    description: 'Turn your own microphone or camera on or off. The first time, the browser asks the person to allow the camera and microphone; only they can click that.',
    human: 'Granting camera and microphone permission is a browser prompt only the person can answer (ROADMAP 3.3).',
    input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING, audio: bool('Microphone on'), video: bool('Camera on') } },
    async handler(ctx, a) {
      const m = await meetingRow(ctx, a.meeting);
      const p = await requireIn(ctx, m);
      const f = {};
      if (a.audio != null) f.audio_on = a.audio ? 1 : 0;
      if (a.video != null) f.video_on = a.video ? 1 : 0;
      if (Object.keys(f).length) await setParticipant(ctx, m, p.id, f);
      await ctx.room.broadcast(m.id, 'cmd', { to_pid: p.id, set_media: { audio: a.audio, video: a.video } });
      return { participant: partOut({ ...p, ...f }) };
    },
  },
  {
    name: 'meet.mute_participant', scope: 'write', confirm: 'none', events: ['meet.participant.muted'],
    description: 'Host: mute someone\'s microphone, or turn off their camera. Nobody can turn another person\'s mic or camera on; you can only ask.',
    input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING, participant: PARTICIPANT, all: bool('Mute everyone except you'), video: bool('Turn their camera off as well') } },
    async handler(ctx, a) {
      const m = await meetingRow(ctx, a.meeting);
      await requireHost(ctx, m);
      const mine = await me(ctx, m);
      const targets = a.all ? (await ctx.db.all("SELECT id FROM meeting_participants WHERE meeting_id = ? AND status = 'admitted' AND id <> ?", [m.id, mine?.id ?? ''])).map((r) => r.id) : [a.participant];
      if (!targets[0]) fail('bad_input', 'Say who to mute, or all: true.');
      for (const pid of targets) {
        await setParticipant(ctx, m, pid, a.video ? { audio_on: 0, video_on: 0 } : { audio_on: 0 });
        await ctx.room.broadcast(m.id, 'cmd', { to_pid: pid, set_media: { audio: false, ...(a.video ? { video: false } : {}) }, by: mine?.display_name ?? 'The host' });
      }
      return { muted: targets };
    },
  },
  {
    name: 'meet.remove_participant', scope: 'delete', confirm: 'none', events: ['meet.participant.removed'],
    description: 'Host: remove someone from the meeting. They cannot rejoin with the same ticket.',
    input: { type: 'object', required: ['meeting', 'participant'], properties: { meeting: MEETING, participant: PARTICIPANT } },
    async handler(ctx, a) {
      const m = await meetingRow(ctx, a.meeting);
      await requireHost(ctx, m);
      const t = await targetParticipant(ctx, m, a.participant);
      if (t.role === 'host') fail('forbidden', 'The host cannot be removed.', 403);
      await ctx.db.run("UPDATE meeting_participants SET status = 'removed', left_at = ? WHERE id = ?", [now(), t.id]);
      await ctx.room.broadcast(m.id, 'cmd', { to_pid: t.id, removed: true });
      for (const r of await ctx.db.all('SELECT peer_id FROM meet_peers WHERE participant_id = ?', [t.id])) await ctx.room.leave(r.peer_id);
      await ctx.room.changed(m.id, 'participants');
      return { removed: t.id };
    },
  },
  {
    name: 'meet.set_role', scope: 'write', confirm: 'none', events: ['meet.participant.role'],
    description: 'Host: make someone a co-host, a member again, or in a webinar a speaker or a viewer.',
    input: { type: 'object', required: ['meeting', 'participant', 'role'], properties: { meeting: MEETING, participant: PARTICIPANT, role: { type: 'string', enum: ['cohost', 'member', 'guest', 'speaker', 'viewer'] } } },
    async handler(ctx, a) {
      const m = await meetingRow(ctx, a.meeting);
      await requireHost(ctx, m);
      const t = await targetParticipant(ctx, m, a.participant);
      if (t.role === 'host') fail('forbidden', 'The host keeps the host role.', 403);
      await setParticipant(ctx, m, t.id, { role: a.role, ...(a.role === 'speaker' ? { hand_raised: 0 } : {}) });
      await ctx.room.replan(m.id);
      return { participant: partOut({ ...t, role: a.role }) };
    },
  },
  {
    name: 'meet.lock', scope: 'write', confirm: 'none', events: ['meet.meeting.updated'],
    description: 'Host: lock the meeting so nobody new can join, or unlock it.',
    input: { type: 'object', required: ['meeting', 'locked'], properties: { meeting: MEETING, locked: bool('Locked') } },
    async handler(ctx, a) {
      const m = await meetingRow(ctx, a.meeting);
      await requireHost(ctx, m);
      await ctx.db.run('UPDATE meetings SET locked = ? WHERE id = ?', [a.locked ? 1 : 0, m.id]);
      await ctx.room.changed(m.id, 'meeting');
      return { locked: !!a.locked };
    },
  },
  {
    name: 'meet.set_waiting_room', scope: 'write', confirm: 'none', events: ['meet.meeting.updated'],
    description: 'Host: turn the waiting room on or off. Turning it off lets everyone waiting in.',
    input: { type: 'object', required: ['meeting', 'on'], properties: { meeting: MEETING, on: bool('Waiting room on') } },
    async handler(ctx, a) {
      const m = await meetingRow(ctx, a.meeting);
      await requireHost(ctx, m);
      await ctx.db.run('UPDATE meetings SET waiting_room = ? WHERE id = ?', [a.on ? 1 : 0, m.id]);
      if (!a.on) await ctx.db.run("UPDATE meeting_participants SET status = 'admitted', joined_at = ? WHERE meeting_id = ? AND status = 'waiting'", [now(), m.id]);
      await ctx.room.changed(m.id, 'meeting');
      await ctx.room.changed(m.id, 'waiting');
      return { waiting_room: !!a.on };
    },
  },
  {
    name: 'meet.request_screen_share', scope: 'write', confirm: 'none', events: ['meet.share.requested'],
    description: 'Ask someone (or yourself) to share their screen. Their screen shows a button; the person picks the screen or window in the browser\'s picker. Only a person can pick.',
    human: 'Choosing which screen or window to share is the browser\'s picker, which only the person can use (ROADMAP 3.3).',
    input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING, participant: str('Who to ask; leave out for yourself') } },
    async handler(ctx, a) {
      const m = await meetingRow(ctx, a.meeting);
      const mine = await requireIn(ctx, m);
      const pid = a.participant || mine?.id;
      if (pid !== mine?.id) await requireHost(ctx, m);
      const r = { id: id('rq_'), kind: 'screen_share' };
      await ctx.db.run('INSERT INTO meeting_requests (id, meeting_id, participant_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?)', [r.id, m.id, pid, r.kind, JSON.stringify({ by: mine?.display_name ?? 'An agent' }), now()]);
      await ctx.room.broadcast(m.id, 'cmd', { to_pid: pid, request: r });
      return { request: r.id, waiting_for: 'the person to pick a screen in their browser' };
    },
  },
  {
    name: 'meet.set_sharing', scope: 'write', confirm: 'none', events: ['meet.share.started', 'meet.share.stopped'],
    description: 'Record that you started or stopped sharing your screen. Stopping also asks your screen to stop the share.',
    input: { type: 'object', required: ['meeting', 'sharing'], properties: { meeting: MEETING, sharing: bool('Sharing now'), participant: str('Host only: stop someone else\'s share') } },
    async handler(ctx, a) {
      const m = await meetingRow(ctx, a.meeting);
      const mine = await requireIn(ctx, m);
      const pid = a.participant || mine.id;
      if (pid !== mine.id) { await requireHost(ctx, m); if (a.sharing) fail('forbidden', 'Only the person can start their own share.', 403); }
      await setParticipant(ctx, m, pid, { sharing: a.sharing ? 1 : 0 });
      await ctx.db.run("UPDATE meeting_requests SET done_at = ? WHERE participant_id = ? AND kind = 'screen_share' AND done_at IS NULL", [now(), pid]);
      if (!a.sharing) await ctx.room.broadcast(m.id, 'cmd', { to_pid: pid, stop_share: true });
      return { sharing: !!a.sharing };
    },
  },
  {
    name: 'meet.set_layout', scope: 'write', confirm: 'none', events: [],
    description: 'Choose how you see the call: grid (everyone the same size) or speaker (whoever talks is large).',
    input: { type: 'object', required: ['meeting', 'layout'], properties: { meeting: MEETING, layout: { type: 'string', enum: ['grid', 'speaker'] } } },
    async handler(ctx, a) {
      const m = await meetingRow(ctx, a.meeting);
      const p = await requireIn(ctx, m);
      await ctx.db.run('UPDATE meeting_participants SET layout = ? WHERE id = ?', [a.layout, p.id]);
      await ctx.room.broadcast(m.id, 'cmd', { to_pid: p.id, layout: a.layout });
      return { layout: a.layout };
    },
  },
  {
    name: 'meet.raise_hand', scope: 'write', confirm: 'none', events: ['meet.participant.hand'],
    description: 'Raise or lower your hand. In a webinar, a raised hand asks the host to let you speak.',
    input: { type: 'object', required: ['meeting', 'raised'], properties: { meeting: MEETING, raised: bool('Hand up') } },
    async handler(ctx, a) {
      const m = await meetingRow(ctx, a.meeting);
      const p = await requireIn(ctx, m);
      await setParticipant(ctx, m, p.id, { hand_raised: a.raised ? 1 : 0 });
      return { hand_raised: !!a.raised };
    },
  },
  {
    name: 'meet.send_chat', scope: 'write', confirm: 'none', events: ['meet.chat.message'],
    description: 'Send a message to everyone in the meeting chat.',
    input: { type: 'object', required: ['meeting', 'body'], properties: { meeting: MEETING, body: str('The message') } },
    async handler(ctx, a) {
      const m = await meetingRow(ctx, a.meeting);
      const p = await requireIn(ctx, m);
      const body = String(a.body ?? '').trim().slice(0, 4000);
      if (!body) fail('bad_input', 'The message is empty.');
      const name = p?.display_name ?? ctx.caller.user?.name ?? 'Host';
      const r = await ctx.db.run('INSERT INTO meeting_chat (meeting_id, participant_id, display_name, body, created_at) VALUES (?, ?, ?, ?, ?)', [m.id, p?.id ?? null, name, body, now()]);
      await ctx.room.changed(m.id, 'chat');
      return { sent: true, id: r.lastId ?? null };
    },
  },
  {
    name: 'meet.list_chat', scope: 'read', confirm: 'none', events: [],
    description: 'Read the meeting chat, oldest first. Pass after to get only newer messages.',
    input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING, after: { type: 'integer', description: 'Only messages after this id' } } },
    async handler(ctx, a) {
      const m = await meetingRow(ctx, a.meeting);
      await requireIn(ctx, m);
      const rows = await ctx.db.all('SELECT id, participant_id, display_name, body, created_at FROM meeting_chat WHERE meeting_id = ? AND id > ? ORDER BY id LIMIT 500', [m.id, Number(a.after ?? 0)]);
      return { messages: rows.map((r) => ({ id: Number(r.id), participant: r.participant_id, name: r.display_name, body: r.body, at: new Date(Number(r.created_at)).toISOString() })) };
    },
  },
  {
    name: 'meet.huddle', scope: 'write', confirm: 'none', events: ['meet.meeting.created'],
    description: 'The room API for other apps: open (or find) the live room for a record such as a Chat channel, with no waiting room, and join it. Chat huddles use this.',
    input: { type: 'object', required: ['for'], properties: { for: str('The record the room belongs to, for example chat:channel:general'), title: str('Room title'), name: str('Your name, for guests') } },
    async handler(ctx, a) {
      canCreate(ctx);
      let m = await ctx.db.get("SELECT * FROM meetings WHERE linked_record = ? AND kind = 'huddle' AND status <> 'ended' ORDER BY created_at DESC", [a.for]);
      if (!m) m = (await newMeeting(ctx, { title: a.title || `Huddle: ${a.for.split(':').pop()}`, kind: 'huddle', waiting_room: false, linked_record: a.for, status: 'live' })).m;
      const join = await byName.get('meet.join').handler(ctx, { meeting: m.id, name: a.name });
      return { ...join, meeting: meetingOut(ctx, m) };
    },
  },
  {
    name: 'meet.add_host', scope: 'write', confirm: 'none', events: ['meet.host.offered'],
    description: 'Offer your computer to help carry this call. Returns the command to run (Node 22 or newer), or the desktop app does it for you. The computer forwards media it cannot see: it is end-to-end encrypted.',
    input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING } },
    async handler(ctx, a) {
      const m = await meetingRow(ctx, a.meeting);
      const p = await requireIn(ctx, m);
      const tok = sign(ctx.config.secret, { k: 'hosttoken', mid: m.id, by: p?.id ?? null, exp: now() + 12 * 3600e3 });
      const url = `${joinUrl(ctx, m)}?hk=${tok}`;
      return { command: `npx -y github:warOnSaaS/meet host "${url}"`, host_url: url, needs: 'Node 22 or newer, plugged in, and a connection others can reach over UDP (see docs/SELF-HOSTING.md).' };
    },
  },
  {
    name: 'meet.list_hosts', scope: 'read', confirm: 'none', events: [],
    description: 'The computers offered to carry this call, whether each is carrying it, its measured upload, and how many people it can take.',
    input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING } },
    async handler(ctx, a) {
      const s = await byName.get('meet.room_status').handler(ctx, a);
      return { hosts: s.hosts, limit: s.limit, mode: s.mode };
    },
  },
  {
    name: 'meet.export', scope: 'read', confirm: 'none', events: [],
    description: 'Export everything you host: meetings, who joined, and chat, as JSON.',
    input: { type: 'object', properties: {} },
    async handler(ctx) {
      const u = requireMember(ctx);
      const ms = await ctx.db.all('SELECT * FROM meetings WHERE host_id = ? ORDER BY created_at', [u.id]);
      const out = [];
      for (const m of ms) {
        const { e2ee_key: _k, ...rest } = m;
        out.push({ ...rest, participants: await ctx.db.all('SELECT * FROM meeting_participants WHERE meeting_id = ?', [m.id]), chat: await ctx.db.all('SELECT * FROM meeting_chat WHERE meeting_id = ? ORDER BY id', [m.id]) });
      }
      return { exported_at: new Date().toISOString(), meetings: out };
    },
  },
  {
    name: 'meet.doctor', scope: 'admin', confirm: 'none', events: [],
    description: 'Check this server for calls: public address, UDP out, TURN, TLS, and the media server if one is set. Says in plain words what is wrong.',
    input: { type: 'object', properties: {} },
    async handler(ctx) {
      requireMember(ctx);
      return runDoctor({ config: ctx.config, publicUrl: ctx.base });
    },
  },

  // ---- planned (v1). Listed so agents know they are coming; calling one returns not_built. ----
  ...[
    ['meet.start_recording', 'human', 'Ask everyone in the call to agree to recording. Recording starts only after the notice is shown and spoken to everyone, and each person\'s answer is recorded (ROADMAP F11). Not built yet.'],
    ['meet.stop_recording', 'none', 'Stop a recording. Not built yet.'],
    ['meet.get_transcript', 'none', 'Read the transcript of a recorded meeting. Not built yet.'],
    ['meet.summarise', 'none', 'Write a summary, decisions and action items from the transcript, to the CRM record or the board. Not built yet.'],
    ['meet.join_as_agent', 'none', 'Have an AI agent join the call as a participant that listens and speaks. Not built yet.'],
  ].map(([name, confirm, description]) => ({
    name, scope: name.includes('get_') ? 'read' : 'write', confirm, planned: 'v1', events: [], description,
    input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING } },
    async handler() { fail('not_built', `${name} is planned for v1 and not built yet. See docs/RECORDING-CONSENT.md.`, 501); },
  })),
];

// Titles, as the button or menu item says it (sentence case).
const TITLES = {
  'meet.whoami': 'Who am I', 'meet.create': 'Start a meeting', 'meet.schedule': 'Schedule a meeting', 'meet.list': 'List meetings',
  'meet.get': 'Get a meeting', 'meet.update': 'Change a meeting', 'meet.cancel': 'Cancel a meeting', 'meet.invite': 'Make an invite',
  'meet.join': 'Join a meeting', 'meet.leave': 'Leave', 'meet.end': 'End for everyone', 'meet.list_waiting': 'List the waiting room',
  'meet.admit': 'Let someone in', 'meet.deny': 'Turn someone away', 'meet.list_participants': 'List people', 'meet.room_status': 'Call status',
  'meet.set_my_media': 'Turn my mic or camera on or off', 'meet.mute_participant': 'Mute someone', 'meet.remove_participant': 'Remove someone',
  'meet.set_role': 'Change someone\'s role', 'meet.lock': 'Lock the meeting', 'meet.set_waiting_room': 'Turn the waiting room on or off',
  'meet.request_screen_share': 'Ask to share a screen', 'meet.set_sharing': 'Start or stop sharing', 'meet.set_layout': 'Grid or speaker view',
  'meet.raise_hand': 'Raise or lower my hand', 'meet.send_chat': 'Send a chat message', 'meet.list_chat': 'Read the chat', 'meet.huddle': 'Open a huddle',
  'meet.add_host': 'Help carry this call', 'meet.list_hosts': 'List computers carrying the call', 'meet.export': 'Export everything',
  'meet.doctor': 'Check calls can connect', 'meet.start_recording': 'Start recording', 'meet.stop_recording': 'Stop recording',
  'meet.get_transcript': 'Get the transcript', 'meet.summarise': 'Write meeting notes', 'meet.join_as_agent': 'Join as an agent',
};
for (const t of tools) t.title = TITLES[t.name] ?? t.name;

export const byName = new Map(tools.map((t) => [t.name, t]));

// The catalogue in the suite's format (packages/tools in warOnSaaS/suite). tools.json is this, written to disk.
export function catalogue() {
  return {
    $schema: 'https://raw.githubusercontent.com/warOnSaaS/suite/main/packages/tools/tools.schema.json',
    app: 'meet',
    version: 1,
    tools: tools.map((t) => ({
      name: t.name, title: t.title,
      description: t.description + (t.human ? ` ${t.human}` : '') + (t.planned ? ` Planned for ${t.planned}.` : ''),
      input: { additionalProperties: false, ...t.input },
      output: t.output ?? { type: 'object' },
      scope: t.scope, confirm: t.confirm, emits: t.events ?? [],
      test: t.planned ? 'test/unit/tools.test.mjs' : 'test/unit/tools.test.mjs',
      ...(['meet.get', 'meet.join', 'meet.whoami'].includes(t.name) ? { public: true } : {}),
    })),
  };
}
