// Vercel entry: every path except static files is rewritten here (vercel.json), with the original path in
// __p. The database opens once per instance. No WebSockets on Vercel: browsers long-poll /media/signal.
import { openDb } from '../server/db.mjs';
import { loadConfig } from '../server/config.mjs';
import { createApp } from '../server/http.mjs';

let ready;
export default async function handler(req, res) {
  ready ??= (async () => createApp({ db: await openDb(), config: loadConfig() }))();
  const app = await ready;
  const u = new URL(req.url, 'http://x');
  const p = u.searchParams.get('__p');
  if (p != null) {
    u.searchParams.delete('__p');
    req.url = (p.startsWith('/') ? p : `/${p}`) + (u.search || '');
  }
  return app.handle(req, res);
}
export const config = { maxDuration: 30 };
