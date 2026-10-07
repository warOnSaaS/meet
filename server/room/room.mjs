// The live room: who is connected for media, the signalling mailbox between them, and the current plan.
//
// Signalling is a mailbox in the database, so it works the same on one long-running server (where a
// WebSocket pushes messages the moment they land) and on serverless hosting such as Vercel (where browsers
// long-poll and any function instance can answer). Media never passes through here.
import { EventEmitter } from 'node:events';
import { planRoom } from './plan.mjs';
import { id } from '../auth.mjs';

export const STALE_MS = 15000;
const wake = new EventEmitter();
wake.setMaxListeners(0);

export function createRoom({ db, config }) {
  const now = () => Date.now();
  let lastReap = 0;

  async function send(meetingId, from, to, type, body) {
    const r = await db.run('INSERT INTO meet_signals (meeting_id, to_peer, from_peer, type, body, created_at) VALUES (?, ?, ?, ?, ?, ?)', [meetingId, to, from, type, body == null ? null : JSON.stringify(body), now()]);
    wake.emit(meetingId);
    return r.lastId;
  }

  const broadcast = (meetingId, type, body, from = 'server') => send(meetingId, from, '*', type, body);

  async function fetchFor(meetingId, peer, since, limit = 200) {
    const rows = await db.all(
      "SELECT id, from_peer, to_peer, type, body FROM meet_signals WHERE meeting_id = ? AND id > ? AND (to_peer = ? OR (to_peer = '*' AND from_peer <> ?)) ORDER BY id LIMIT ?",
      [meetingId, since, peer, peer, limit],
    );
    return rows.map((r) => ({ id: Number(r.id), from: r.from_peer, to: r.to_peer, type: r.type, body: r.body ? JSON.parse(r.body) : null }));
  }

  // Long-poll: return as soon as something arrives, or after timeoutMs with nothing.
  // isGone: the caller hung up (stop asking the database for it).
  async function poll(peerRow, since, timeoutMs, isGone = () => false) {
    const end = now() + timeoutMs;
    await touch(peerRow.peer_id);
    for (;;) {
      const msgs = await fetchFor(peerRow.meeting_id, peerRow.peer_id, since);
      if (msgs.length || now() >= end || isGone()) return msgs;
      await new Promise((resolve) => {
        const t = setTimeout(done, Math.min(end - now(), db.dialect === 'postgres' ? 300 : 1000));
        function done() { clearTimeout(t); wake.off(peerRow.meeting_id, done); resolve(); }
        wake.on(peerRow.meeting_id, done);
      });
      if (isGone()) return [];
      if (!(await db.get('SELECT peer_id FROM meet_peers WHERE peer_id = ?', [peerRow.peer_id]))) return [{ id: since, from: 'server', type: 'gone', body: null }];
    }
  }

  // Push for WebSocket clients: call onMsgs whenever the mailbox has something new.
  function subscribe(peerRow, since, onMsgs) {
    let cursor = since, busy = false, again = false, closed = false;
    const pump = async () => {
      if (closed) return;
      if (busy) { again = true; return; }
      busy = true;
      try {
        do {
          again = false;
          const msgs = await fetchFor(peerRow.meeting_id, peerRow.peer_id, cursor);
          if (msgs.length) { cursor = msgs.at(-1).id; onMsgs(msgs); if (msgs.length === 200) again = true; }
        } while (again && !closed);
      } finally { busy = false; }
    };
    wake.on(peerRow.meeting_id, pump);
    // Postgres with several server instances: another instance may have written. Check now and then.
    const t = setInterval(pump, db.dialect === 'postgres' ? 500 : 2000);
    pump();
    return () => { closed = true; clearInterval(t); wake.off(peerRow.meeting_id, pump); };
  }

  async function touch(peer) {
    await db.run('UPDATE meet_peers SET last_seen = ? WHERE peer_id = ?', [now(), peer]);
  }

  async function join(meetingId, { participantId = null, kind = 'browser', client = 'browser', metrics = null }) {
    const peer = id(kind === 'host' ? 'h_' : 'p_');
    const cursor = Number((await db.get('SELECT MAX(id) AS m FROM meet_signals WHERE meeting_id = ?', [meetingId]))?.m ?? 0);
    await db.run('INSERT INTO meet_peers (peer_id, meeting_id, participant_id, kind, client, metrics, joined_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [peer, meetingId, participantId, kind, client, metrics ? JSON.stringify(metrics) : null, now(), now()]);
    await replan(meetingId);
    return { peer, cursor };
  }

  async function leave(peer) {
    const row = await db.get('SELECT * FROM meet_peers WHERE peer_id = ?', [peer]);
    if (!row) return;
    await db.run('DELETE FROM meet_peers WHERE peer_id = ?', [peer]);
    await broadcast(row.meeting_id, 'peer-left', { peer });
    await replan(row.meeting_id);
  }

  async function setMetrics(peer, metrics) {
    const row = await db.get('SELECT * FROM meet_peers WHERE peer_id = ?', [peer]);
    if (!row) return;
    await db.run('UPDATE meet_peers SET metrics = ?, last_seen = ? WHERE peer_id = ?', [JSON.stringify(metrics), now(), peer]);
    await replan(row.meeting_id);
  }

  async function drain(peer) {
    const row = await db.get('SELECT * FROM meet_peers WHERE peer_id = ?', [peer]);
    if (!row) return;
    await db.run('UPDATE meet_peers SET draining = 1 WHERE peer_id = ?', [peer]);
    await replan(row.meeting_id);
  }

  // Remove peers that stopped polling. Runs at most every 2 s, from any request.
  async function reap(force = false) {
    if (!force && now() - lastReap < 2000) return;
    lastReap = now();
    const stale = await db.all('SELECT peer_id, meeting_id FROM meet_peers WHERE last_seen < ?', [now() - STALE_MS]);
    const meetings = new Set();
    for (const s of stale) {
      await db.run('DELETE FROM meet_peers WHERE peer_id = ?', [s.peer_id]);
      await broadcast(s.meeting_id, 'peer-left', { peer: s.peer_id, stale: true });
      meetings.add(s.meeting_id);
    }
    for (const m of meetings) await replan(m);
    if (Math.random() < 0.05) await db.run('DELETE FROM meet_signals WHERE created_at < ?', [now() - 10 * 60 * 1000]);
  }

  async function peersOf(meetingId) {
    const rows = await db.all(
      `SELECT rp.*, mp.display_name, mp.role, mp.status FROM meet_peers rp LEFT JOIN meeting_participants mp ON mp.id = rp.participant_id WHERE rp.meeting_id = ?`,
      [meetingId],
    );
    return rows
      .filter((r) => r.kind === 'host' || r.status === 'admitted')
      .map((r) => ({ peer: r.peer_id, kind: r.kind, client: r.client, participantId: r.participant_id, name: r.display_name, role: r.role, joinedAt: Number(r.joined_at), draining: !!r.draining, metrics: r.metrics ? JSON.parse(r.metrics) : null }));
  }

  async function currentPlan(meetingId) {
    const s = await db.get('SELECT version, plan FROM meet_room_state WHERE meeting_id = ?', [meetingId]);
    return s ? { ...JSON.parse(s.plan), version: Number(s.version) } : null;
  }

  // Work out the plan again and tell everyone if it changed. Safe to call from several servers at once:
  // the version check lets only one write win, and the loser retries on the next change.
  async function replan(meetingId) {
    const m = await db.get('SELECT * FROM meetings WHERE id = ?', [meetingId]);
    if (!m) return null;
    const prev = await currentPlan(meetingId);
    const peers = await peersOf(meetingId);
    const plan = planRoom({ meeting: { kind: m.kind, media_pref: m.media_pref, needs: {} }, peers, livekit: !!config.livekit, p2pMax: config.p2pMax, prev });
    const { version: _v, ...prevBody } = prev ?? {};
    if (prev && JSON.stringify(prevBody) === JSON.stringify(plan)) return prev;
    const version = (prev?.version ?? 0) + 1;
    const body = JSON.stringify(plan);
    let ok;
    if (prev) ok = (await db.run('UPDATE meet_room_state SET version = ?, plan = ?, updated_at = ? WHERE meeting_id = ? AND version = ?', [version, body, now(), meetingId, prev.version])).changes === 1;
    else {
      try { await db.run('INSERT INTO meet_room_state (meeting_id, version, plan, updated_at) VALUES (?, ?, ?, ?)', [meetingId, version, body, now()]); ok = true; } catch { ok = false; }
    }
    if (!ok) return currentPlan(meetingId);
    const out = { ...plan, version };
    await broadcast(meetingId, 'plan', out);
    return out;
  }

  // Tell everyone in the meeting that something they show has changed, so their screens reload it with tools.
  const changed = (meetingId, what, extra = {}) => broadcast(meetingId, 'changed', { what, ...extra });

  return { send, broadcast, poll, subscribe, join, leave, touch, setMetrics, drain, reap, peersOf, currentPlan, replan, changed };
}
