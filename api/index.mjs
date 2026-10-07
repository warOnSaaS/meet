// Vercel entry: every path is rewritten here (vercel.json). The database opens once per instance.
import { openDb } from '../server/db.mjs';
import { loadConfig } from '../server/config.mjs';
import { createApp } from '../server/http.mjs';

let ready;
export default async function handler(req, res) {
  ready ??= (async () => createApp({ db: await openDb(), config: loadConfig() }))();
  const app = await ready;
  return app.handle(req, res);
}
export const config = { maxDuration: 30 };
