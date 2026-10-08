// The suite's way in (CONTRACTS.md): register(ctx) returns one handler per tool, plus the call's media
// routes under /media/meet/. Standalone, bin/meet.mjs serves the same handlers itself; this file lets the
// suite load them with no rewrite.
//
// Inside the suite:
//   - storage is the suite's database (ctx.db), adapted to the small all/get/run/exec shape server/db.mjs has;
//   - every meeting carries the team's id; lists, huddles and exports only see the caller's team;
//   - people are the suite's members (call.actor); a member of the meeting's team walks in, anyone else
//     with the link (a person from another team) waits until a host lets them in;
//   - signalling is long-polling under /media/meet/ (the suite does not pass WebSockets to apps);
//   - the signing secret for tickets lives in the database, so every copy of the server agrees on it.
import crypto from 'node:crypto';
import { tools } from './server/tools/meet.mjs';
import { loadConfig } from './server/config.mjs';
import { createApp } from './server/http.mjs';
import { migrate } from './server/db.mjs';
import { FIELDS } from './server/settings.mjs';

const SETTINGS_ENV = Object.values(FIELDS).map((f) => f.env);

// Columns that are BIGINT on Postgres. The suite's driver returns them as strings; meet's code wants numbers.
const NUMERIC = new Set(['id', 'n', 'm', 'version', 'created_at', 'starts_at', 'ends_at', 'started_at', 'ended_at', 'asked_at', 'joined_at', 'left_at', 'last_seen', 'updated_at', 'done_at', 'applied_at', 'answered_at', 'notice_shown_at', 'duration_min', 'duration_s', 'start_at', 'end_at', 'notes_on', 'notes_started_at', 'written_at', 'scripted', 'size_bytes', 'stopped_at', 'is_open']);
const numbers = (row) => {
  if (!row) return row;
  for (const k of Object.keys(row)) if (NUMERIC.has(k) && typeof row[k] === 'string' && /^-?\d{1,16}$/.test(row[k])) row[k] = Number(row[k]);
  return row;
};
const RETURNS_ID = /^\s*insert\s+into\s+(meet_signals|meeting_chat)\b/i;

/** The suite's Db (query, get, run -> { changes }, tx) in the shape meet's code uses (all, get, run -> { changes, lastId }, exec, tx). */
export function adaptDb(sdb) {
  const wrap = (d) => ({
    dialect: sdb.dialect === 'sqlite' ? 'sqlite' : 'postgres',
    async all(sql, params = []) { return (await d.query(sql, params)).map(numbers); },
    async get(sql, params = []) { return numbers((await d.get(sql, params)) ?? null); },
    async run(sql, params = []) {
      if (RETURNS_ID.test(sql) && !/returning/i.test(sql)) {
        const rows = await d.query(`${sql} RETURNING id`, params);
        return { changes: rows.length, lastId: Number(rows[0]?.id) };
      }
      return d.run(sql, params);
    },
    // A whole file of statements: the suite runs it in one call (SQLite exec, Postgres simple query).
    async exec(sql) { await d.run(sql); },
    async tx(fn) { return d.tx((t) => fn(wrap(t))); },
  });
  return wrap(sdb);
}

async function sharedSecret(db) {
  await db.exec('CREATE TABLE IF NOT EXISTS meet_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const row = await db.get("SELECT value FROM meet_settings WHERE key = 'secret'");
  if (row) return row.value;
  const value = crypto.randomBytes(32).toString('hex');
  try { await db.run("INSERT INTO meet_settings (key, value) VALUES ('secret', ?)", [value]); } catch { /* another copy wrote it first */ }
  return (await db.get("SELECT value FROM meet_settings WHERE key = 'secret'")).value;
}

export default async function register(ctx) {
  const db = adaptDb(ctx.db);
  await migrate(db);
  const env = {};
  for (const k of ['SESSION_SECRET', 'TURN_URLS', 'TURN_SECRET', 'TURN_USERNAME', 'TURN_CREDENTIAL', 'STUN_URLS', 'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'P2P_MAX', ...SETTINGS_ENV]) {
    const v = ctx.env(k);
    if (v) env[k] = v;
  }
  env.SESSION_SECRET ||= await sharedSecret(db);
  const base = `${String(ctx.publicUrl ?? '').replace(/\/$/, '')}/a/meet`;
  // serverless: no WebSocket for signalling, browsers long-poll (the suite never hands an app a socket).
  const config = { ...loadConfig(env), publicUrl: base, serverless: true, env, ...(ctx.config ?? {}) };
  const media = createApp({ db, config });
  const room = media.room;

  const handlers = {};
  for (const t of tools) {
    handlers[t.name] = async (input, call) => {
      const person = call.actor?.kind === 'person' || call.actor?.personId;
      const uid = call.actor?.personId ?? call.actor?.id;
      const user = uid && call.actor?.kind !== 'system' ? { id: uid, name: call.actor.name ?? 'Someone', github_login: null, avatar_url: null, agent: !person } : null;
      // Other apps' tools (CRM, board, Chat, Email) as the same caller, with their scopes and audit.
      const callTool = call.callTool ? (name, i) => call.callTool(name, i) : undefined;
      const out = await t.handler({ db, config, room, base, teamId: call.team?.id || null, caller: { user, ticket: null }, callTool }, input ?? {});
      if (t.events?.length === 1) call.emit?.(t.events[0], { meeting: out?.id ?? out?.meeting?.id ?? input?.meeting ?? null });
      return out;
    };
  }
  return {
    handlers,
    // The call's own traffic (join, long-poll, send, leave) under /media/meet/. Tickets and peer tokens
    // signed by this app say who may use it; tools stay the only way to change a meeting.
    async routes(req, res, url) {
      if (!url.pathname.startsWith('/media/meet/')) return false;
      req.url = `/media/${url.pathname.slice('/media/meet/'.length)}${url.search}`;
      room.reap().catch(() => {});
      await media.handle(req, res);
      return true;
    },
    async exportTeam(team) {
      const meetings = await db.all('SELECT * FROM meetings WHERE team_id = ? ORDER BY created_at', [team.id]);
      for (const m of meetings) {
        delete m.e2ee_key;
        m.participants = await db.all('SELECT * FROM meeting_participants WHERE meeting_id = ?', [m.id]);
        m.chat = await db.all('SELECT * FROM meeting_chat WHERE meeting_id = ? ORDER BY id', [m.id]);
        m.transcript = await db.all('SELECT * FROM meet_segments WHERE meeting_id = ? ORDER BY start_at', [m.id]);
        m.notes = await db.get('SELECT * FROM meeting_notes WHERE meeting_id = ?', [m.id]);
        m.notes_consents = await db.all('SELECT * FROM meet_notes_consents WHERE meeting_id = ?', [m.id]);
      }
      return { meetings };
    },
  };
}

export { catalogue } from './server/tools/meet.mjs';
