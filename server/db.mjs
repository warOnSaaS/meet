// One small database layer for SQLite (local, one file) and Postgres (DATABASE_URL).
// Queries are written once with ? placeholders; for Postgres they become $1, $2 and so on.
import path from 'node:path';
import fs from 'node:fs';
import { migrations } from './migrations.mjs';

export async function openDb(url = process.env.DATABASE_URL) {
  const db = url && /^postgres(ql)?:/.test(url) ? await openPg(url) : await openSqlite(url);
  await migrate(db);
  return db;
}

async function openSqlite(url) {
  const { default: Database } = await import('better-sqlite3');
  let file = url?.replace(/^sqlite:(\/\/)?/, '') || process.env.MEET_DB || path.join(process.cwd(), 'data', 'meet.db');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const s = new Database(file);
  s.pragma('journal_mode = WAL');
  s.pragma('busy_timeout = 5000');
  s.pragma('foreign_keys = ON');
  const prep = new Map();
  const st = (sql) => { let p = prep.get(sql); if (!p) { p = s.prepare(sql); prep.set(sql, p); } return p; };
  const fix = (params) => params.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v));
  return {
    dialect: 'sqlite',
    async all(sql, params = []) { return st(sql).all(...fix(params)); },
    async get(sql, params = []) { return st(sql).get(...fix(params)) ?? null; },
    async run(sql, params = []) { const r = st(sql).run(...fix(params)); return { changes: r.changes, lastId: Number(r.lastInsertRowid) }; },
    async exec(sql) { s.exec(sql); },
    async tx(fn) { s.exec('BEGIN IMMEDIATE'); try { const r = await fn(this); s.exec('COMMIT'); return r; } catch (e) { s.exec('ROLLBACK'); throw e; } },
    async close() { s.close(); },
  };
}

async function openPg(url) {
  const { default: pg } = await import('pg');
  pg.types.setTypeParser(20, (v) => Number(v)); // BIGINT as a number: our values are millisecond times and row ids
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX ?? 5), ssl: /sslmode=require|neon\.tech|supabase/.test(url) ? { rejectUnauthorized: false } : undefined });
  const conv = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
  const mk = (q) => ({
    dialect: 'postgres',
    async all(sql, params = []) { return (await q.query(conv(sql), params)).rows; },
    async get(sql, params = []) { return (await q.query(conv(sql), params)).rows[0] ?? null; },
    async run(sql, params = []) {
      const isInsert = /^\s*insert/i.test(sql) && !/returning/i.test(sql) && /\bsignals\b/.test(sql);
      const r = await q.query(conv(sql) + (isInsert ? ' RETURNING id' : ''), params);
      return { changes: r.rowCount, lastId: isInsert ? Number(r.rows[0]?.id) : undefined };
    },
    async exec(sql) { await q.query(sql); },
  });
  const base = mk(pool);
  base.tx = async (fn) => {
    const c = await pool.connect();
    try { await c.query('BEGIN'); const r = await fn(mk(c)); await c.query('COMMIT'); return r; }
    catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
    finally { c.release(); }
  };
  base.close = () => pool.end();
  return base;
}

// Database updates apply themselves on start. Each step runs once and is recorded in meet_migrations.
export async function migrate(db) {
  await db.exec('CREATE TABLE IF NOT EXISTS meet_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at BIGINT NOT NULL)');
  const done = new Set((await db.all('SELECT id FROM meet_migrations')).map((r) => Number(r.id)));
  for (const m of migrations) {
    if (done.has(m.id)) continue;
    const sql = typeof m.sql === 'function' ? m.sql(db.dialect) : m.sql;
    try {
      await db.exec(sql);
      await db.run('INSERT INTO meet_migrations (id, name, applied_at) VALUES (?, ?, ?)', [m.id, m.name, Date.now()]);
    } catch (e) {
      // Two servers starting at once: the other one applied it first.
      if (!(await db.get('SELECT id FROM meet_migrations WHERE id = ?', [m.id]))) throw e;
    }
  }
}
