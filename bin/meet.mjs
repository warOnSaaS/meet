#!/usr/bin/env node
// wOS Meetings command line.
//   meet serve            run the app (PORT, DATABASE_URL; SQLite in ./data when DATABASE_URL is unset)
//   meet host <link>      let this computer help carry a call (the link from "Help carry this call")
//   meet doctor [url]     check UDP, TLS, TURN and the media server, in plain words
import http from 'node:http';

const [cmd = 'serve', ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(rest.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const args = rest.filter((a) => !a.startsWith('--'));

if (cmd === 'serve') {
  const { openDb } = await import('../server/db.mjs');
  const { loadConfig } = await import('../server/config.mjs');
  const { createApp } = await import('../server/http.mjs');
  const { attachWs } = await import('../server/ws.mjs');
  const db = await openDb();
  const config = loadConfig();
  const app = createApp({ db, config });
  const server = http.createServer((req, res) => app.handle(req, res));
  attachWs(server, app);
  const port = Number(flags.port ?? process.env.PORT ?? 8787);
  server.listen(port, process.env.HOST ?? '0.0.0.0', () => console.log(`wOS Meetings on http://localhost:${port} (${db.dialect})`));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
} else if (cmd === 'host') {
  const { runHost } = await import('../host/host.mjs');
  if (!args[0]) { console.error('Usage: meet host "<link from Help carry this call>"'); process.exit(2); }
  await runHost(args[0], flags);
} else if (cmd === 'doctor') {
  const { runDoctor } = await import('../server/doctor.mjs');
  const { loadConfig } = await import('../server/config.mjs');
  const r = await runDoctor({ config: loadConfig(), publicUrl: args[0] ?? process.env.PUBLIC_URL, livekitHost: flags.livekit });
  for (const c of r.checks) console.log(`${c.ok ? 'ok  ' : 'FIX '} ${c.name}: ${c.said}${c.fix ? `\n      ${c.fix}` : ''}`);
  console.log(`\n${r.summary}`);
  process.exit(r.ok ? 0 : 1);
} else {
  console.error(`Unknown command ${cmd}. Try: serve, host, doctor.`);
  process.exit(2);
}
